import { invokeAiNode } from './ai-provider';
import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import type { AiInvocationInput } from '@/types/provider';
import type {
  ActionDefinition, AiNode, ConditionNode, EdgePort, LoopNode, RunResult, StepResult,
  WorkflowEdge, WorkflowNode,
} from '@/types/workflow';

type Variables = Record<string, unknown>;
type RuntimeContext = Record<string, unknown>;

function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, source);
}

function resolveValue(value: string | undefined, variables: Variables, context: RuntimeContext): unknown {
  if (value === undefined) return undefined;
  const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exact) return getPath({ ...context, ...variables }, exact[1]);
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => String(getPath({ ...context, ...variables }, key) ?? ''));
}

function interpolate(value: string | undefined, variables: Variables, context: RuntimeContext): string | undefined {
  const resolved = resolveValue(value, variables, context);
  return resolved === undefined ? undefined : typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
}

export async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有可操作的活动网页');
  if (!/^https?:/i.test(tab.url ?? '')) throw new Error('Page Agent 只能操作 http/https 网页');
  return tab.id;
}

export async function sendToFrame(tabId: number, frameId: number, message: unknown): Promise<Record<string, unknown>> {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId }) as Record<string, unknown>;
  } catch {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (!files.length) throw new Error('插件页面脚本不可用，请刷新网页后重试');
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files });
    return await chrome.tabs.sendMessage(tabId, message, { frameId }) as Record<string, unknown>;
  }
}

export function testCondition(node: ConditionNode, variables: Variables, context: RuntimeContext): boolean {
  const left = resolveValue(node.left, variables, context);
  const right = resolveValue(node.right, variables, context);
  switch (node.operator) {
    case 'equals': return String(left) === String(right);
    case 'notEquals': return String(left) !== String(right);
    case 'contains': return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
    case 'exists': return left !== undefined && left !== null && left !== '';
    case 'greaterThan': return Number(left) > Number(right);
    case 'lessThan': return Number(left) < Number(right);
  }
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
      type: 'PAGE_AGENT_READ_SELECTOR', selector: interpolate(input.target.selector, variables, context),
      multiple: input.multiple, attribute: input.attribute ?? 'text',
    });
    if (!response.ok) throw new Error(String(response.error ?? `读取 AI 输入失败：${input.name}`));
    inputs.push({ name: input.name, type: input.multiple ? 'selector[]' : 'selector', value: response.data });
  }
  return inputs;
}

interface AtomicResult { data?: unknown; port: EdgePort; nested?: StepResult[] }

async function executeAtomic(
  tabId: number,
  node: Exclude<WorkflowNode, LoopNode>,
  nodes: WorkflowNode[],
  actions: ActionDefinition[],
  variables: Variables,
  context: RuntimeContext,
  stack: string[],
): Promise<AtomicResult> {
  if (node.kind === 'wait') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(node.durationMs, 60_000))));
    return { data: node.durationMs, port: 'success' };
  }
  if (node.kind === 'condition') {
    const matched = testCondition(node, variables, context);
    return { data: matched, port: matched ? 'true' : 'false' };
  }
  if (node.kind === 'action') {
    if (stack.includes(node.actionId)) throw new Error(`Action 循环调用：${[...stack, node.actionId].join(' → ')}`);
    const action = actions.find((item) => item.id === node.actionId);
    if (!action) throw new Error(`Action 不存在：${node.actionId}`);
    const nested = await runGraphInternal(tabId, action.nodes, action.edges, actions, variables, context, [...stack, node.actionId]);
    if (!nested.ok) throw Object.assign(new Error(nested.error ?? `Action ${action.name} 执行失败`), { nested: nested.steps });
    return { data: nested, port: 'success', nested: nested.steps };
  }
  if (node.kind === 'dom') {
    const event = { ...node.event, value: interpolate(node.event.value, variables, context) };
    const response = await sendToFrame(tabId, node.target.frameId ?? 0, {
      type: 'PAGE_AGENT_EXECUTE_EVENT', selector: interpolate(node.target.selector, variables, context), event,
    });
    if (!response.ok) throw new Error(String(response.error ?? '页面执行失败'));
    return { data: response.data, port: 'success' };
  }

  const inputs = await collectAiInputs(tabId, node, nodes, variables, context);
  const result = await invokeAiNode(interpolate(node.instruction, variables, context) ?? '', inputs, actions.map((action) => action.name));
  const nested: StepResult[] = [];
  const invocation = result.invoke;
  if (invocation?.kind === 'event') {
    const binding = node.inputs.find((input) => input.name === invocation.inputName && input.type === 'selector');
    if (!binding?.target) throw new Error(`AI 返回了未知 selector 输入：${invocation.inputName}`);
    const response = await sendToFrame(tabId, binding.target.frameId ?? 0, {
      type: 'PAGE_AGENT_EXECUTE_EVENT', selector: binding.target.selector, event: invocation.event,
    });
    if (!response.ok) throw new Error(String(response.error ?? 'AI 事件执行失败'));
  }
  if (invocation?.kind === 'action') {
    const action = actions.find((item) => item.name === invocation.actionName || item.id === invocation.actionName);
    if (!action) throw new Error(`AI 返回了未知 Action：${invocation.actionName}`);
    if (stack.includes(action.id)) throw new Error(`AI Action 循环调用：${[...stack, action.id].join(' → ')}`);
    const actionResult = await runGraphInternal(tabId, action.nodes, action.edges, actions, variables, context, [...stack, action.id]);
    nested.push(...actionResult.steps);
    if (!actionResult.ok) throw Object.assign(new Error(actionResult.error ?? 'AI Action 执行失败'), { nested });
  }
  return { data: result, port: 'success', nested };
}

export function loopItems(node: LoopNode, variables: Variables, context: RuntimeContext): unknown[] {
  const value = resolveValue(node.items, variables, context);
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
): Promise<RunResult> {
  if (!nodes.length) return { ok: true, steps: [] };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Set(edges.map((edge) => edge.targetNodeId));
  let current: WorkflowNode | undefined = nodes.find((node) => !incoming.has(node.id)) ?? nodes[0];
  const steps: StepResult[] = [];
  const loops = new Map<string, { items: unknown[]; index: number }>();
  let guard = 0;

  while (current && guard++ < 1000) {
    let port: EdgePort = 'success';
    try {
      if (current.kind === 'loop') {
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
        const result = await executeAtomic(tabId, current, nodes, actions, variables, context, stack);
        port = result.port;
        context[current.name] = current.kind === 'ai' && result.data && typeof result.data === 'object'
          ? { ok: true, ...(result.data as Record<string, unknown>), output: (result.data as { output?: unknown }).output }
          : { ok: true, output: result.data, data: result.data };
        steps.push({ ok: true, nodeId: current.id, message: `${current.name}执行成功`, data: result.data, outputPort: port });
        if (result.nested?.length) steps.push(...result.nested);
      }
    } catch (error) {
      port = 'failure';
      context[current.name] = { ok: false, error: (error as Error).message };
      steps.push({ ok: false, nodeId: current.id, message: (error as Error).message, outputPort: port });
      const failureEdge = edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === 'failure');
      if (!failureEdge && !current.continueOnError) return { ok: false, steps, error: (error as Error).message };
      if (!failureEdge && current.continueOnError) port = 'success';
    }

    const nextEdge = edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === port)
      ?? (port === 'success' ? edges.find((edge) => edge.sourceNodeId === current!.id && edge.sourcePort === 'success') : undefined);
    if (nextEdge && !byId.has(nextEdge.targetNodeId)) return { ok: false, steps, error: `连线目标节点不存在：${nextEdge.targetNodeId}` };
    current = nextEdge ? byId.get(nextEdge.targetNodeId) : undefined;
  }
  if (guard >= 1000) return { ok: false, steps, error: '流程超过 1000 个执行步，可能存在未受控循环' };
  return { ok: steps.every((step) => step.ok || Boolean(edges.find((edge) => edge.sourceNodeId === step.nodeId && edge.sourcePort === 'failure'))), steps };
}

function linearEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({ id: `edge_${node.id}_${nodes[index + 1].id}`, sourceNodeId: node.id, targetNodeId: nodes[index + 1].id, sourcePort: 'success' }));
}

export async function runGraph(nodes: WorkflowNode[], edges: WorkflowEdge[], variables: Variables = {}): Promise<RunResult> {
  const tabId = await activeTabId();
  const { actions } = await loadWorkspace();
  return runGraphInternal(tabId, nodes, edges, actions, { ...variables }, {});
}

export async function runNodes(nodes: WorkflowNode[], variables: Variables = {}): Promise<RunResult> {
  return runGraph(nodes, linearEdges(nodes), variables);
}

export async function runScript(scriptId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const script = state.scripts.find((item) => item.id === scriptId || item.name === scriptId);
  if (!script) return { ok: false, steps: [], error: `Script 不存在：${scriptId}` };
  const result = await runGraph(script.nodes, script.edges, variables);
  script.lastRunAt = Date.now();
  await saveWorkspace(state);
  return result;
}

export async function runAction(actionId: string, variables: Variables = {}): Promise<RunResult> {
  const state = await loadWorkspace();
  const action = state.actions.find((item) => item.id === actionId || item.name === actionId);
  if (!action) return { ok: false, steps: [], error: `Action 不存在：${actionId}` };
  return runGraph(action.nodes, action.edges, variables);
}
