import { executeBrowserDialog } from './browser-dialog';
import { validateDialogNode } from '@/shared/dialog';
import { SelectorUpgradeSession } from './selector-upgrade';
import { uploadLocalFiles } from './upload';
import { recordRun } from '@/shared/run-history';
import { beginExecution, finishExecution, checkCancellation, pauseExecution, RunCancelled, executionStatus } from './execution-control';
import { invokeAiNode } from './ai-provider';
import { sendFrameMessage } from './frame-messaging';
import { prepareStart } from './start-runtime';
import { mapStartInputs, resolveValue, interpolate } from './runtime-values';
export { mapStartInputs, resolveValue } from './runtime-values';
export { matchesTargetUrl } from './start-runtime';
import { withAlertConfirmation } from './dialogs';
import { WorkflowTabs } from './workflow-tabs';
import { loadWorkspace, mutateWorkspace } from '@/shared/storage';
import { diagnose } from '@/shared/diagnostics';
import type { AiInvocationInput } from '@/types/provider';
import type {
  ActionDefinition, AiNode, DomQueryMatch, EdgePort, ExecutionVerification, LoopNode, RunResult, StartNode, StepResult,
  PageTarget, RecordedTargetHint, WorkflowEdge, WorkflowNode,
  PaginationNode, PaginationState, WorkflowBody, DataTableOutput,
} from '@/types/workflow';
import { allNodes } from '@/shared/nested-graph';
import { watchMatches } from '@/shared/watch';
import { waitDuration } from '@/shared/wait';
import { capturePage } from './screenshot';
import { sendWorkflowEmail } from './email';
import { prepareEmail } from '@/shared/email';
import { validateMediaNode } from '@/shared/media-nodes';
import { dataTableExcel } from '@/shared/datatable-excel';
import { outputBusinessOk, outputPath, validateOutputNode } from '@/shared/output';
import { executeRequest } from './request';

type Variables = Record<string, unknown>;
type RuntimeContext = Record<string, unknown>;
export type RunProgress = (nodeId: string, phase: 'running' | 'completed', steps?: StepResult[]) => void;
export async function exclusiveExecution<T>(execute: () => Promise<T>): Promise<T> {
  beginExecution();
  try { return await execute(); } finally { finishExecution(); }
}

export async function activeTabId(allowNavigation = false): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有可操作的活动网页');
  if (!allowNavigation && !/^https?:/i.test(tab.url ?? '')) throw new Error('Page Agent 只能操作 http/https 网页');
  return tab.id;
}

export async function sendToFrame(tabId: number, frameId: number, message: unknown, frameUrl?: string, frameQueryKeys?: string[], operationSignal?: AbortSignal): Promise<Record<string, unknown>> {
  checkCancellation();
  return sendFrameMessage(tabId, frameId, message, frameUrl, undefined, frameQueryKeys, operationSignal);
}

async function collectAiInputs(tabId: number, node: AiNode, nodes: WorkflowNode[], variables: Variables, context: RuntimeContext): Promise<AiInvocationInput[]> {
  const inputs: AiInvocationInput[] = [];
  for (const input of node.inputs) {
    if (input.type === 'literal') {
      inputs.push({ name: input.name, type: 'literal', value: resolveValue(input.value, variables, context) });
      continue;
    }
    if (input.type === 'node') {
      const source = nodes.find((item) => item.id === input.sourceNodeId);
      inputs.push({ name: input.name, type: source?.kind ?? 'node', value: source ? context[source.name] : undefined });
      continue;
    }
    if (!input.target) throw new Error(`AI 输入「${input.name}」未配置 selector`);
    const response = await sendToFrame(tabId, input.target.frameId ?? 0, {
      type: 'PAGE_AGENT_READ_SELECTOR', ...capturedHint(input.target), selector: interpolate(input.target.selector, variables, context),
      multiple: input.multiple, attribute: input.attribute ?? 'text',
    }, input.target.frameUrl, input.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? `读取 AI 输入失败：${input.name}`)), { diagnostic: response.diagnostic });
    inputs.push({ name: input.name, type: input.multiple ? 'selector[]' : 'selector', value: response.data });
  }
  return inputs;
}

interface AtomicResult { data?: unknown; port: EdgePort; nested?: StepResult[]; verification?: ExecutionVerification }
interface ExecutionBudget {
  steps: number; depth: number; nodes?: WorkflowNode[]; upgrades?: SelectorUpgradeSession;
  maxSteps?: number;
  tabs?: WorkflowTabs;
  operationSignal?: AbortSignal;
  outputs?: Map<string, unknown>; output?: unknown; businessOk?: boolean;
}

function withOutputs(result: RunResult, budget: ExecutionBudget): RunResult {
  if (!budget.outputs?.size) return result;
  return { ...result, output: budget.output, outputs: Object.fromEntries(budget.outputs), ...(budget.businessOk !== undefined ? { businessOk: budget.businessOk } : {}) };
}

function capturedHint(target: PageTarget) { return target.locator ? targetHint(target) : {}; }

function targetHint(target: PageTarget): { targetHint?: RecordedTargetHint } {
  if (!target.attributes && !target.text && !target.locator && !target.frameName) return {};
  return { targetHint: { tagName: target.tagName, attributes: target.attributes, text: target.text, locator: target.locator, frameName: target.frameName } };
}

async function executeAtomic(
  tabId: number,
  node: Exclude<WorkflowNode, LoopNode>,
  nodes: WorkflowNode[],
  actions: ActionDefinition[],
  variables: Variables,
  context: RuntimeContext,
  stack: string[],
  progress?: RunProgress,
  budget: ExecutionBudget = { steps: 0, depth: 0 },
): Promise<AtomicResult> {
  checkCancellation();
  budget.nodes ??= nodes;
  if (node.kind === 'request') {
    const result = await executeRequest(node, variables, context, budget.operationSignal);
    return { data: result.data, port: 'success', verification: { ok: true, summary: `请求完成：HTTP ${result.status} · ${node.responseType === 'json' ? 'JSON' : 'Text'}`, actual: { status: result.status, responseType: node.responseType } } };
  }
  let resolvedFrameUrl: string | undefined;
  if (budget.tabs) {
    const target = 'target' in node ? node.target : undefined;
    const resolved = await budget.tabs.resolve(target);
    tabId = resolved.tabId;
    resolvedFrameUrl = resolved.frameUrl;
    await budget.upgrades?.prepare(tabId, node, resolvedFrameUrl);
    if (target && resolved.frameUrl !== target.frameUrl) node = { ...node, target: { ...target, frameUrl: resolved.frameUrl } } as typeof node;
  } else await budget.upgrades?.prepare(tabId, node);
  if (node.kind === 'output') {
    validateOutputNode(node);
    let data: unknown;
    if (node.source === 'text') {
      for (const match of node.value!.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
        if (match[1].split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part.trim())) || resolveValue(`{{${match[1]}}}`, variables, context) === undefined) throw new Error(`Output 文本引用的变量不存在或路径无效：${match[1]}`);
      }
      data = interpolate(node.value, variables, context);
    }
    else if (node.source === 'variable') {
      const key = node.value!.slice(2, -2).trim();
      if (key.split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Output 变量路径无效');
      data = resolveValue(node.value, variables, context);
    } else if (node.source === 'node') {
      const source = nodes.find(item => item.id === node.sourceNodeId);
      if (!source || source.id === node.id) throw new Error('Output 引用的前序节点不存在');
      const previous = Object.hasOwn(context, source.name) ? context[source.name] : undefined;
      if (!previous || typeof previous !== 'object' || !Object.hasOwn(previous, 'output')) throw new Error(`Output 引用的节点尚未执行或没有输出：${source.name}`);
      data = outputPath((previous as { output: unknown }).output, node.path);
    } else {
      const response = await sendToFrame(tabId, node.target!.frameId, {
        type: 'PAGE_AGENT_READ_OUTPUT', ...capturedHint(node.target!), selector: interpolate(node.target!.selector, variables, context) ?? '',
        read: node.read, attributeName: interpolate(node.attributeName, variables, context), multiple: node.multiple,
      }, node.target!.frameUrl, node.target!.frameQueryKeys);
      if (!response.ok) throw Object.assign(new Error(String(response.error ?? 'Output DOM 读取失败')), { diagnostic: response.diagnostic });
      data = response.data;
    }
    if (data === undefined) throw new Error('Output 返回值不存在，请检查变量、字段路径或前序节点是否执行');
    budget.outputs ??= new Map();
    budget.outputs.set(node.name, data); budget.output = data;
    const business = outputBusinessOk(node);
    if (business !== undefined) budget.businessOk = budget.businessOk === false ? false : business;
    return { data, port: 'success', verification: { ok: true, summary: `Output 已返回${node.outcome === 'failure' ? '（业务未成功）' : node.outcome === 'success' ? '（业务成功）' : ''}`, actual: data } };
  }
  if (node.kind === 'start') {
    const mappedInputs = mapStartInputs(node, variables);
    Object.assign(variables, mappedInputs);
    const data = await prepareStart(tabId, node, variables, context);
    return {
      data: { ...data, inputs: mappedInputs },
      port: 'success',
      verification: {
        ok: true,
        summary: `${data.navigated ? '已打开目标页面' : '使用当前页面'}：${data.url}（后续节点将验证业务控件）`,
        expected: node.keepCurrentPage ? '当前页面（不刷新）' : interpolate(node.targetUrl, variables, context) || '当前页面',
        actual: data.url,
      },
    };
  }
  if (node.kind === 'tableFill') {
    validateMediaNode(node);
    const response = await sendToFrame(tabId, node.target.frameId ?? 0, { type: 'PAGE_AGENT_FILL_TABLE', ...capturedHint(node.target), selector: interpolate(node.target.selector, variables, context) ?? '', data: resolveValue(node.data, variables, context), keyColumns: node.keyColumns, skipUnmatchedRows: node.skipUnmatchedRows, structure: node.structure }, node.target.frameUrl, node.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? '表格填充失败')), { verification: { ok: false, summary: String(response.error ?? '表格填充失败'), actual: response.report } });
    const data = response.data as { matchedRows: number; filledCells: number; skippedCells: number; unmatchedRows: number };
    return { data, port: 'success', verification: { ok: true, summary: `已匹配 ${data.matchedRows} 行，填充 ${data.filledCells} 个单元格，跳过 ${data.skippedCells} 个单元格、${data.unmatchedRows} 条未匹配数据；未自动提交`, actual: data } };
  }
  if (node.kind === 'datatable') {
    const response=await sendToFrame(tabId,node.target.frameId??0,{type:'PAGE_AGENT_READ_DATATABLE',...capturedHint(node.target), selector:interpolate(node.target.selector,variables,context)??'',header:node.header,parseNumbers:node.parseNumbers},node.target.frameUrl,node.target.frameQueryKeys);
    if(!response.ok)throw Object.assign(new Error(String(response.error??'DataTable 读取失败')),{diagnostic:response.diagnostic});
    const data=response.data as DataTableOutput;
    if(!data||data.type!=='datatable'||!Array.isArray(data.rows)||!Array.isArray(data.columns)||!Array.isArray(data.values))throw new Error('DataTable 返回格式无效');
    if(node.exportExcel)data.excel={type:'files',files:[await dataTableExcel(data,interpolate(node.fileName,variables,context)||node.name)]};
    return {data,port:'success',verification:{ok:true,summary:`已转换 ${data.rowCount} 行、${data.columns.length} 列`,actual:{rows:data.rowCount,columns:data.columns.length}}};
  }
  if (node.kind === 'screenshot') {
    validateMediaNode(node);
    if (node.mode === 'region' && !node.region) throw new Error('请先框选截图区域');
    const result = await capturePage({ mode: node.mode, region: node.region });
    if (result.metadata?.complete !== true) throw new Error('整页截图未完成，不能作为成功文件输出');
    const base = (interpolate(node.fileName, variables, context) || node.name).replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\.png$/i, '');
    return { data: { type: 'files', files: result.images.map((image, index) => ({ name: `${base}${result.images.length > 1 ? `-${index + 1}` : ''}.png`, mimeType: image.mimeType, base64: image.data })), metadata: result.metadata }, port: 'success' };
  }
  if (node.kind === 'email') {
    validateMediaNode(node);
    const message = prepareEmail(resolveValue(node.body, variables, context), node.attachments.map((value) => resolveValue(value, variables, context)));
    const result = await sendWorkflowEmail(interpolate(node.to, variables, context) ?? '', interpolate(node.subject, variables, context) ?? '', message.text, message.files);
    return { data: result, port: 'success', verification: { ok: true, summary: '邮件已被发送服务器接受（不代表收件箱已送达）', actual: result } };
  }
  if (node.kind === 'wait') {
    const durationMs = waitDuration(node);
    await pauseExecution(durationMs);
    return { data: durationMs, port: 'success', verification: { ok: true, summary: `${node.mode === 'random' ? '随机' : '固定'}等待 ${durationMs} 毫秒完成`, actual: durationMs } };
  }
  if (node.kind === 'action') {
    if (stack.includes(node.actionId)) throw new Error(`Action 循环调用：${[...stack, node.actionId].join(' → ')}`);
    const action = actions.find((item) => item.id === node.actionId);
    if (!action) throw new Error(`Action 不存在：${node.actionId}`);
    const nested = await runGraphInternal(tabId, action.nodes, action.edges, actions, variables, context, [...stack, node.actionId], progress, undefined, budget);
    if (!nested.ok) throw Object.assign(new Error(nested.error ?? `Action ${action.name} 执行失败`), { nested: nested.steps });
    return { data: nested, port: 'success', nested: nested.steps };
  }
  if (node.kind === 'dialog') {
    validateDialogNode(node);
    for (const match of node.message.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      if (match[1].split('.').some(part => ['__proto__', 'prototype', 'constructor'].includes(part.trim())) || resolveValue(`{{${match[1]}}}`, variables, context) === undefined) throw new Error(`浏览器弹窗匹配文字引用的变量不存在或路径无效：${match[1]}`);
    }
    const config = { ...node, message: interpolate(node.message, variables, context) ?? '', promptText: interpolate(node.promptText, variables, context) ?? '' };
    const result = await executeBrowserDialog(tabId, config, async signal => {
      try { return await executeAtomic(tabId, { ...node, kind: 'dom' }, nodes, actions, variables, context, stack, progress, { ...budget, tabs: undefined, upgrades: undefined, operationSignal: signal }); }
      catch (error) {
        // Accepting beforeunload destroys the sender document. The native closed
        // receipt is still required by executeBrowserDialog; never replay the event.
        const failure = error as Error & { diagnostic?: { code?: string } };
        if (config.dialogType === 'beforeunload' && config.action === 'accept'
          && failure.diagnostic?.code === 'EXECUTION_OUTCOME_UNKNOWN' && failure.message.startsWith('页面操作已发送，但响应中断')) {
          return { port: 'success' as const, data: { navigationRequested: true, responseInterrupted: true } };
        }
        throw error;
      }
    });
    return { data: { ...result.dialog, trigger: result.trigger.data }, port: 'success', verification: { ok: true, summary: `${result.dialog.type} 弹窗已${result.dialog.accepted ? '确定' : '取消'}`, expected: { type: config.dialogType, action: config.action, message: config.message }, actual: result.dialog, evidence: ['Chrome 已报告弹窗关闭，实际应答与配置一致', '触发事件仅执行一次'] } };
  }
  if (node.kind === 'dom') {
    if (node.event.type === 'upload') return uploadLocalFiles(tabId, node.target, interpolate(node.target.selector, variables, context) ?? '', resolveValue(node.event.value, variables, context));
    const event = { ...node.event, value: interpolate(node.event.value, variables, context) };
    const response = await sendToFrame(tabId, node.target.frameId ?? 0, {
      type: 'PAGE_AGENT_EXECUTE_EVENT', ...targetHint(node.target), selector: interpolate(node.target.selector, variables, context), event,
    }, node.target.frameUrl, node.target.frameQueryKeys, budget.operationSignal);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? '页面执行失败')), {
      verification: response.verification as ExecutionVerification | undefined,
      diagnostic: response.diagnostic,
    });
    return { data: response.data, port: 'success', verification: response.verification as ExecutionVerification | undefined };
  }

  if (node.kind === 'watch') {
    if (!Number.isFinite(node.timeoutMs) || node.timeoutMs < 100 || node.timeoutMs > 3600000 || !Number.isFinite(node.intervalMs) || node.intervalMs < 100 || node.intervalMs > 10000) throw new Error('Watch 超时或检查间隔配置无效');
    const expected = interpolate(node.expected, variables, context) ?? '';
    const attributeName = interpolate(node.attributeName, variables, context) ?? '';
    if (node.source === 'attribute' && !attributeName.trim()) throw new Error('Watch 需要配置属性名称');
    if (node.match === 'regex') new RegExp(expected);
    const started = Date.now();
    let actual: unknown;
    let lastError = '';
    while (true) {
      checkCancellation();
      try {
        const remaining = Math.max(0, node.timeoutMs - (Date.now() - started));
        const response = await sendFrameMessage(tabId, node.target.frameId ?? 0, {
          type: 'PAGE_AGENT_READ_SELECTOR', ...capturedHint(node.target), selector: interpolate(node.target.selector, variables, context) ?? '', multiple: true,
          attribute: node.source === 'attribute' ? 'attributes' : node.source === 'value' ? 'value' : 'text',
        }, node.target.frameUrl, Math.min(remaining, node.intervalMs), node.target.frameQueryKeys);
        if (!response.ok) throw new Error(String(response.error));
        if (!Array.isArray(response.data) || response.data.length !== 1) throw new Error('Watch Selector 必须匹配唯一 DOM');
        actual = node.source === 'attribute' ? (response.data[0] as Record<string, string>)?.[attributeName] : response.data[0];
        lastError = '';
        if (watchMatches(actual, node.match, expected)) return { data: { actual, expected, elapsedMs: Date.now() - started }, port: 'success', verification: { ok: true, summary: `${node.name}：已达到监控预期`, expected, actual } };
      } catch (error) { lastError = (error as Error).message; }
      if (Date.now() - started >= node.timeoutMs) throw Object.assign(new Error(`Watch 监控超时：${node.target.selector}；预期 ${node.match} ${expected}；实际 ${String(actual ?? '未找到')}${lastError ? `；${lastError}` : ''}`), { verification: { ok: false, summary: '监控未达到预期', expected, actual } });
      await pauseExecution(Math.min(node.intervalMs, Math.max(0, node.timeoutMs - (Date.now() - started))));
    }
  }

  if (node.kind === 'query') {
    validateOutputNode(node);
    const frameId = node.target.frameId ?? 0;
    const response = await sendToFrame(tabId, frameId, {
      type: 'PAGE_AGENT_QUERY_DOM', ...capturedHint(node.target), selector: interpolate(node.target.selector, variables, context) ?? '',
      query: {
        ...node.query,
        candidateSelector: interpolate(node.query.candidateSelector, variables, context) ?? '*',
        readSelector: interpolate(node.query.readSelector, variables, context),
        attributeName: interpolate(node.query.attributeName, variables, context) ?? '',
        pattern: interpolate(node.query.pattern, variables, context) ?? '',
      },
    }, node.target.frameUrl, node.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? 'Query 检索失败')), { diagnostic: response.diagnostic });
    if (!Array.isArray(response.data)) throw new Error('Query 返回的 DOM 列表无效');
    const data = (response.data as Omit<DomQueryMatch, 'frameId'>[]).map((item) => ({ ...item, frameId: Number(response.frameId ?? frameId) }));
    if (!data.length && node.onEmpty === 'failure') throw Object.assign(new Error(`${node.name}：没有匹配项，转到失败出口`), { verification: { ok: false, summary: 'Query 没有匹配项', expected: '至少 1 个匹配项', actual: 0 } });
    return { data, port: 'success', verification: { ok: true, summary: `${node.name}：匹配 ${data.length} 个 DOM`, actual: data.length } };
  }

  if (node.kind === 'calendar') {
    const endDate = node.mode === 'range' ? interpolate(node.endDate, variables, context) : undefined;
    if (node.mode === 'range' && !endDate?.trim()) throw new Error('区间日历需要配置结束日期');
    const response = await sendToFrame(tabId, node.target.frameId ?? 0, {
      type: 'PAGE_AGENT_SELECT_DATE', ...capturedHint(node.target), selector: interpolate(node.target.selector, variables, context) ?? '',
      date: interpolate(node.date, variables, context) ?? '',
      endDate,
    }, node.target.frameUrl, node.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? '日历选择失败')), { verification: response.verification, diagnostic: response.diagnostic });
    return { data: response.data, port: 'success', verification: response.verification as ExecutionVerification };
  }

  if (node.kind === 'pagination') return executePagination(tabId, node, actions, variables, context, stack, progress, budget);

  const inputs = await collectAiInputs(tabId, node, nodes, variables, context);
  const result = await invokeAiNode(interpolate(node.instruction, variables, context) ?? '', inputs, actions.map((action) => action.name));
  const nested: StepResult[] = [];
  const invocation = result.invoke;
  if (invocation?.kind === 'event') {
    if (invocation.event.type === 'upload') throw new Error('AI 动态事件不允许读取本机文件，请使用显式配置路径的上传文件节点');
    const binding = node.inputs.find((input) => input.name === invocation.inputName && input.type === 'selector');
    if (!binding?.target) throw new Error(`AI 返回了未知 selector 输入：${invocation.inputName}`);
    const response = await sendToFrame(tabId, binding.target.frameId ?? 0, {
      type: 'PAGE_AGENT_EXECUTE_EVENT', selector: binding.target.selector, event: invocation.event, ...targetHint(binding.target),
    }, binding.target.frameUrl, binding.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? 'AI 事件执行失败')), {
      verification: response.verification as ExecutionVerification | undefined,
      diagnostic: response.diagnostic,
    });
  }
  if (invocation?.kind === 'action') {
    const action = actions.find((item) => item.name === invocation.actionName || item.id === invocation.actionName);
    if (!action) throw new Error(`AI 返回了未知 Action：${invocation.actionName}`);
    if (stack.includes(action.id)) throw new Error(`AI Action 循环调用：${[...stack, action.id].join(' → ')}`);
    const actionResult = await runGraphInternal(tabId, action.nodes, action.edges, actions, variables, context, [...stack, action.id], progress, undefined, budget);
    nested.push(...actionResult.steps);
    if (!actionResult.ok) throw Object.assign(new Error(actionResult.error ?? 'AI Action 执行失败'), { nested });
  }
  return { data: result, port: 'success', nested };
}

async function runBody(tabId: number, body: WorkflowBody, actions: ActionDefinition[], variables: Variables, context: RuntimeContext, stack: string[], progress: RunProgress | undefined, budget: ExecutionBudget): Promise<RunResult> {
  if (budget.depth >= 8) throw new Error('子流程嵌套超过 8 层');
  budget.depth++;
  try { return await runGraphInternal(tabId, body.nodes, body.edges, actions, variables, context, stack, progress, body.entryNodeId, budget); }
  finally { budget.depth--; }
}

async function executePagination(tabId: number, node: PaginationNode, actions: ActionDefinition[], variables: Variables, context: RuntimeContext, stack: string[], progress: RunProgress | undefined, budget: ExecutionBudget): Promise<AtomicResult> {
  const nested: StepResult[] = [];
  if (!node.pageVariable?.trim()) throw new Error('分页当前页变量不能为空');
  const previous = variables[node.pageVariable];
  const existed = Object.prototype.hasOwnProperty.call(variables, node.pageVariable);
  const stopValue = node.mode === 'all' ? (interpolate(node.stopAtPage ?? '', variables, context) ?? '').trim() : '';
  const stopAtPage = stopValue ? Number(stopValue) : undefined;
  if (node.mode === 'all' && node.stopAtPage !== undefined && (!stopValue || !Number.isSafeInteger(stopAtPage) || stopAtPage! < 1)) throw new Error('分页终止页码必须是大于 0 的整数，请检查终止条件或传入变量');
  if (node.stopWhen !== undefined && !/^\{\{\s*[^{}]+?\s*\}\}$/.test(node.stopWhen)) throw new Error('分页结果终止条件必须是一个变量引用，例如 {{本页匹配.output}}');
  const request = async (page?: number): Promise<PaginationState> => {
    const response = await sendToFrame(tabId, node.target.frameId, {
      type: 'PAGE_AGENT_PAGINATION', ...capturedHint(node.target), selector: interpolate(node.target.selector, variables, context), page,
      timeoutMs: node.timeoutMs, settleMs: node.settleMs, maxSteps: node.maxPages,
    }, node.target.frameUrl, node.target.frameQueryKeys);
    if (!response.ok) throw Object.assign(new Error(String(response.error ?? '分页操作失败')), { diagnostic: response.diagnostic, verification: response.verification });
    const state = response.data as PaginationState;
    if (!state || !Number.isSafeInteger(state.page) || state.page < 1) throw new Error('分页返回的当前页无效');
    if (page !== undefined && state.page !== page) throw new Error(`分页实际页 ${state.page} 与预期 ${page} 不符`);
    const step: StepResult = { nodeId: node.id, ok: true, message: `分页当前第 ${state.page} 页`, data: state, verification: response.verification as ExecutionVerification | undefined };
    nested.push(step);
    return state;
  };
  try {
    let state = await request(node.mode === 'all' ? 1 : Number(interpolate(node.page, variables, context)));
    const visited: number[] = [];
    for (let iteration = 0; iteration < node.maxPages; iteration++) {
      checkCancellation();
      variables[node.pageVariable || 'page'] = state.page;
      context[node.name] = { ok: true, output: state, page: state.page };
      if (node.mode === 'all' && !node.body.nodes.length) throw new Error('遍历分页需要在容器内配置每页执行的子节点');
      const result = await runBody(tabId, node.body, actions, variables, context, stack, progress, budget);
      nested.push(...result.steps);
      if (!result.ok) throw Object.assign(new Error(result.error ?? '分页内部子流程失败'), { diagnostic: result.diagnostic });
      visited.push(state.page);
      if (node.mode === 'goto') return { data: { ...state, visited }, port: 'done', nested };
      const after = await request();
      if (after.page !== state.page) throw new Error(`分页子流程改变了当前页：预期 ${state.page}，实际 ${after.page}；停止避免重复遍历`);
      if (node.stopWhen) {
        const value = resolveValue(node.stopWhen, variables, context);
        if (value === undefined) throw new Error(`分页终止条件引用的变量不存在：${node.stopWhen}`);
        // Do not interpret expressions or stringify [] into a truthy string.
        const found = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== false && value !== 0
          && (typeof value !== 'string' || value.trim().length > 0)
          && (typeof value !== 'object' || Object.keys(value).length > 0);
        if (found) return { data: { ...after, visited, complete: true, terminationReason: 'condition' }, port: 'done', nested,
          verification: { ok: true, summary: `第 ${after.page} 页内部流程完成且结果非空，停止翻页`, actual: after.page } };
      }
      if (stopAtPage !== undefined && after.page >= stopAtPage) return {
        data: { ...after, visited, complete: true, terminationReason: 'stopAtPage', stopAtPage }, port: 'done', nested,
        verification: { ok: true, summary: `已处理至第 ${after.page} 页，达到终止条件，分页完成`, expected: stopAtPage, actual: after.page },
      };
      if (after.hasNext === false) return { data: { ...after, visited, complete: true, terminationReason: 'lastPage' }, port: 'done', nested };
      if (after.hasNext === null) throw new Error('无法确认是否存在下一页；未识别总页数或下一页按钮，不能将当前页当作末页');
      if (iteration + 1 >= node.maxPages) throw new Error(`分页遍历达到 ${node.maxPages} 页上限，仍有后续页；流程未完整执行`);
      state = await request(state.page + 1);
    }
    throw new Error('分页最大页数配置无效');
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { nested });
  } finally {
    if (existed) variables[node.pageVariable] = previous; else delete variables[node.pageVariable];
  }
}

export function loopItems(node: LoopNode, variables: Variables, context: RuntimeContext): unknown[] {
  const value = resolveValue(node.items, variables, context);
  if(value&&typeof value==='object'&&(value as DataTableOutput).type==='datatable'&&Array.isArray((value as DataTableOutput).rows))return (value as DataTableOutput).rows;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value) as unknown; if (Array.isArray(parsed)) return parsed; } catch { /* fall through */ }
  }
  throw new Error(`循环输入不是数组：${node.items}`);
}

async function runGraphInternal(
  tabId: number,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  actions: ActionDefinition[],
  variables: Variables,
  context: RuntimeContext,
  stack: string[] = [],
  progress?: RunProgress,
  entryNodeId?: string,
  budget: ExecutionBudget = { steps: 0, depth: 0 },
): Promise<RunResult> {
  budget.nodes ??= allNodes(nodes);
  budget.maxSteps ??= Math.min(50000, 1000 + budget.nodes.reduce((sum, node) => sum + (node.kind === 'pagination' && node.mode === 'all'
    ? Math.min(5000, Math.max(0, node.maxPages)) * allNodes(node.body.nodes).length : 0), 0));
  if (!nodes.length) return { ok: true, steps: [] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Set(edges.map((edge) => edge.targetNodeId));
  let current: WorkflowNode | undefined = entryNodeId ? byId.get(entryNodeId) : nodes.find((node) => node.kind === 'start')
    ?? nodes.find((node) => !incoming.has(node.id))
    ?? nodes[0];
  if (entryNodeId && !current) return { ok: false, steps: [], error: `子流程入口不存在：${entryNodeId}` };
  const steps: StepResult[] = [];
  const loops = new Map<string, { items: unknown[]; index: number }>();
  let guard = 0;

  while (current && guard++ < 1000) {
    if (executionStatus()?.stopping) return { ok: false, cancelled: true, steps, error: new RunCancelled().message };
    if (++budget.steps > budget.maxSteps) return { ok: false, steps, error: `流程（含子流程）超过 ${budget.maxSteps} 个执行步，可能存在未受控循环` };
    const stepOffset = steps.length;
    progress?.(current.id, 'running');
    let port: EdgePort = 'success';
    try {
      if (current.kind === 'loop' && current.body) {
        const loop = current;
        const items = loopItems(loop, variables, context);
        if (items.length > loop.maxIterations) throw new Error(`循环数组 ${items.length} 项超过最大次数 ${loop.maxIterations}，停止以避免静默遗漏`);
        if (!loop.body?.nodes.length && items.length) throw new Error('循环容器内尚未添加子节点');
        const previousItem = variables[loop.itemVariable]; const previousIndex = variables[loop.indexVariable];
        const hadItem = Object.prototype.hasOwnProperty.call(variables, loop.itemVariable); const hadIndex = Object.prototype.hasOwnProperty.call(variables, loop.indexVariable);
        try {
          for (let index = 0; index < items.length; index++) {
            checkCancellation();
            variables[loop.itemVariable] = items[index]; variables[loop.indexVariable] = index;
            context[loop.name] = { ok: true, output: items[index], index };
            const iteration: StepResult = { ok: true, nodeId: loop.id, message: `${loop.name}：第 ${index + 1}/${items.length} 次`, data: items[index], outputPort: 'body' };
            steps.push(iteration);
            const result = await runBody(tabId, loop.body!, actions, variables, context, stack, progress, budget);
            steps.push(...result.steps);
            if (!result.ok) throw Object.assign(new Error(result.error ?? '循环内部子流程失败'), { diagnostic: result.diagnostic });
          }
        } finally {
          if (hadItem) variables[loop.itemVariable] = previousItem; else delete variables[loop.itemVariable];
          if (hadIndex) variables[loop.indexVariable] = previousIndex; else delete variables[loop.indexVariable];
        }
        port = 'done'; context[loop.name] = { ok: true, output: { count: items.length } };
        steps.push({ ok: true, nodeId: loop.id, message: `${loop.name}：循环完成`, outputPort: port });
      } else if (current.kind === 'loop') {
        let state = loops.get(current.id);
        if (!state) {
          const items = loopItems(current, variables, context);
          state = { items: items.slice(0, Math.max(0, current.maxIterations)), index: 0 };
          loops.set(current.id, state);
        } else {
          state.index += 1;
        }
        if (state.index < state.items.length) {
          variables[current.itemVariable || 'item'] = state.items[state.index];
          variables[current.indexVariable || 'index'] = state.index;
          port = 'body';
          steps.push({ ok: true, nodeId: current.id, message: `${current.name}：第 ${state.index + 1}/${state.items.length} 次`, data: state.items[state.index], outputPort: port });
        } else {
          delete variables[current.itemVariable || 'item'];
          delete variables[current.indexVariable || 'index'];
          loops.delete(current.id);
          port = 'done';
          steps.push({ ok: true, nodeId: current.id, message: `${current.name}：循环完成`, outputPort: port });
        }
      } else {
        const availableNodes = [...allNodes(nodes), ...budget.nodes.filter((node) => !allNodes(nodes).some((local) => local.id === node.id))];
        const execute = async () => {
          if (current!.kind === 'request') return executeAtomic(tabId, current as Exclude<WorkflowNode, LoopNode>, availableNodes, actions, variables, context, stack, progress, budget);
          const resolved = budget.tabs ? await budget.tabs.resolve('target' in current! ? current!.target : undefined) : { tabId };
          return withAlertConfirmation(resolved.tabId, () => executeAtomic(resolved.tabId, current as Exclude<WorkflowNode, LoopNode>, availableNodes, actions, variables, context, stack, progress, budget));
        };
        const result = await (budget.tabs ? budget.tabs.during(execute) : execute());
        port = result.port;
        context[current.name] = current.kind === 'ai' && result.data && typeof result.data === 'object'
          ? { ok: true, ...(result.data as Record<string, unknown>), output: (result.data as { output?: unknown }).output }
          : { ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string,unknown> : {}), ok: true, output: result.data, data: result.data };
        steps.push({
          ok: true,
          nodeId: current.id,
          message: result.verification?.summary ?? `${current.name}执行成功`,
          data: result.data,
          verification: result.verification,
          outputPort: port,
        });
        if (result.nested?.length) steps.push(...result.nested);
      }
    } catch (error) {
      const nested = (error as { nested?: StepResult[] }).nested;
      if (nested?.length) steps.push(...nested);
      const executionError = error as Error & { verification?: ExecutionVerification };
      const diagnostic = diagnose(error, { nodeId: current.id, nodeName: current.name, nodeKind: current.kind, ...('target' in current && current.target ? { selector: current.target.selector, recordedFrameId: current.target.frameId, frameUrl: current.target.frameUrl } : {}) });
      port = 'failure';
      context[current.name] = { ok: false, error: executionError.message, verification: executionError.verification };
      steps.push({ ok: false, nodeId: current.id, message: executionError.message, diagnostic, verification: executionError.verification, outputPort: port });
      if (executionStatus()?.stopping || error instanceof RunCancelled) return { ok: false, cancelled: true, steps, error: new RunCancelled().message };
      const failureEdge = edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === 'failure');
      if (!failureEdge) return { ok: false, steps, error: executionError.message, diagnostic };
    } finally {
      progress?.(current.id, 'completed', steps.slice(stepOffset).filter((step) => step.nodeId === current!.id));
    }

    const nextEdge: WorkflowEdge | undefined = edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === port)
      ?? (port === 'success' ? edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === 'success') : undefined);
    if (nextEdge && !byId.has(nextEdge.targetNodeId)) return { ok: false, steps, error: `连线目标节点不存在：${nextEdge.targetNodeId}` };
    current = nextEdge ? byId.get(nextEdge.targetNodeId) : undefined;
  }
  if (guard >= 1000) return { ok: false, steps, error: '流程超过 1000 个执行步，可能存在未受控循环' };
  return { ok: true, steps };
}

function linearEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({ id: `edge_${node.id}_${nodes[index + 1].id}`, sourceNodeId: node.id, targetNodeId: nodes[index + 1].id, sourcePort: 'success' }));
}

export async function runGraph(nodes: WorkflowNode[], edges: WorkflowEdge[], variables: Variables = {}, progress?: RunProgress, workflow?: { id: string; name: string }, repairOwner?: { kind: 'script' | 'action'; id: string }): Promise<RunResult> {
  return exclusiveExecution(async () => {
    const runId = executionStatus()!.runId;
    const startedAt = Date.now();
    let tabId: number | undefined;
    let result: RunResult;
    let tabs: WorkflowTabs | undefined;
    const upgrades = new SelectorUpgradeSession();
    upgrades.register(nodes, repairOwner ?? (workflow ? { kind: 'script', id: workflow.id } : undefined));
    try {
      checkCancellation();
      const allowNavigation = nodes.some(node => node.kind === 'start' && !node.keepCurrentPage && Boolean(node.targetUrl.trim()));
      tabId = await activeTabId(allowNavigation);
      const { actions } = await loadWorkspace();
      for (const action of actions) upgrades.register(action.nodes, { kind: 'action', id: action.id });
      checkCancellation();
      tabs = new WorkflowTabs(tabId);
      const budget: ExecutionBudget = { steps: 0, depth: 0, tabs, upgrades };
      result = withOutputs(await runGraphInternal(tabId, nodes, edges, actions, { ...variables }, {}, [], progress, undefined, budget), budget);
    } catch (error) {
      result = { ok: false, steps: [], error: (error as Error).message, diagnostic: diagnose(error, { tabId }) };
    } finally { tabs?.dispose(); }
    if (executionStatus()?.stopping) result = { ...result, ok: false, cancelled: true, error: new RunCancelled().message };
    if (upgrades.reports.length) {
      try { await upgrades.persist(); } catch { result.historyWarning = '定位已用于本次运行，但自动升级保存失败，下次运行会再次修复'; }
      result.selectorUpgrades = upgrades.reports;
    }
    result.runId = runId;
    if (!result.ok && !result.diagnostic) result.diagnostic = diagnose(new Error(result.error ?? '工作流执行失败'), { tabId });
    try { await recordRun(result, startedAt, variables, workflow); }
    catch { result.historyWarning = '运行结果已返回，但本机运行历史保存失败'; }
    return result;
  });
}

export async function runNodes(nodes: WorkflowNode[], variables: Variables = {}): Promise<RunResult> {
  return runGraph(nodes, linearEdges(nodes), variables);
}

export async function runScript(scriptId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const script = state.scripts.find((item) => item.id === scriptId || item.name === scriptId);
  if (!script) return { ok: false, steps: [], error: `Script 不存在：${scriptId}` };
  const result = await runGraph(script.nodes, script.edges, variables, undefined, { id: script.id, name: script.name });
  await mutateWorkspace((latest) => {
    const current = latest.scripts.find((item) => item.id === script.id);
    if (current) current.lastRunAt = Date.now();
  }).catch(() => { result.historyWarning = '运行已结束，但最近运行时间保存失败'; });
  return result;
}

/** Debug exactly one node, without implicitly navigating or running successors. */
export async function debugNode(nodes: WorkflowNode[], nodeId: string, data: Variables, context: RuntimeContext = {}, workflow?: { id: string; name: string }): Promise<RunResult> {
  return exclusiveExecution(async () => {
  const node = allNodes(nodes).find((item) => item.id === nodeId);
  if (!node) throw new Error('节点不存在');
  const start = nodes.find((item): item is StartNode => item.kind === 'start');
  const variables = start ? { ...data, ...mapStartInputs(start, data) } : { ...data };
  const tabId = await activeTabId(node.kind === 'start' && !node.keepCurrentPage && Boolean(node.targetUrl));
  const { actions } = await loadWorkspace();
  const upgrades = new SelectorUpgradeSession();
  upgrades.register(nodes, workflow ? { kind: 'script', id: workflow.id } : undefined);
  for (const action of actions) upgrades.register(action.nodes, { kind: 'action', id: action.id });
  const budget: ExecutionBudget = { steps: 0, depth: 0, nodes: allNodes(nodes), upgrades };
  const finish = async (result: RunResult) => {
    if (upgrades.reports.length) {
      try { await upgrades.persist(); } catch { result.historyWarning = '本次定位已升级，但保存失败'; }
      result.selectorUpgrades = upgrades.reports;
    }
    return result;
  };
  if (node.kind === 'loop' && node.body) return finish(withOutputs(await runGraphInternal(tabId, [node], [], actions, variables, structuredClone(context), [], undefined, undefined, budget), budget));
  try {
    const items = node.kind === 'loop' ? loopItems(node, variables, context) : undefined;
    const result: AtomicResult = node.kind === 'loop'
      ? { data: items, port: items?.length ? 'body' : 'done' }
      : await withAlertConfirmation(tabId, async () => executeAtomic(tabId, node, allNodes(nodes), actions, variables, structuredClone(context), [], undefined, budget));
    return finish(withOutputs({ ok: true, steps: [...(result.nested ?? []), { ok: true, nodeId, message: result.verification?.summary ?? '单节点执行完成', data: result.data, verification: result.verification, outputPort: result.port }] }, budget));
  } catch (error) {
    const failure = error as Error & { verification?: ExecutionVerification; nested?: StepResult[] };
    const diagnostic = diagnose(error, { nodeId, nodeName: node.name, nodeKind: node.kind, ...('target' in node && node.target ? { selector: node.target.selector, recordedFrameId: node.target.frameId, frameUrl: node.target.frameUrl } : {}) });
    return finish(withOutputs({ ok: false, error: failure.message, diagnostic, steps: [...(failure.nested ?? []), { ok: false, nodeId, message: failure.message, diagnostic, verification: failure.verification, outputPort: 'failure' }] }, budget));
  }
  });
}

export async function runAction(actionId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const action = state.actions.find((item) => item.id === actionId || item.name === actionId);
  if (!action) return { ok: false, steps: [], error: `Action 不存在：${actionId}` };
  return runGraph(action.nodes, action.edges, variables, undefined, { id: action.id, name: action.name }, { kind: 'action', id: action.id });
}
