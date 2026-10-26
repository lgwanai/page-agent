import { validateDialogNode } from '@/shared/dialog';
import { validateTargetLocator } from '@/shared/target-locator';
import { loadWorkspace, mutateWorkspace } from '@/shared/storage';
import { ensureWorkflowKey, verifyWorkflowKey } from '@/shared/workflow-keys';
import { exportWorkflow, importWorkflow } from '@/shared/workflow-file';
import { allowedEventsForTarget, createStartNode, EVENT_LABELS, type ScriptDefinition, type WorkflowNode } from '@/types/workflow';
import { activeTabId, debugNode, exclusiveExecution, runScript } from './runner';
import { capturePage } from './screenshot';
import { readyFrame } from './frame-messaging';
import { waitDuration } from '@/shared/wait';
import { validateMediaNode } from '@/shared/media-nodes';
import { validateOutputNode } from '@/shared/output';
import { validateRequestNode } from '@/shared/request';
import { diagnosticError } from '@/shared/diagnostics';
import { allNodes, nodeBody, mapNodes, removeNode, graphFor, replaceGraph } from '@/shared/nested-graph';

export const AUTHORING_METHODS = ['create_workflow', 'get_workflow', 'edit_workflow', 'delete_node', 'export_workflow', 'import_workflow', 'inspect_page', 'debug_node', 'debug_workflow', 'get_debug_result', 'validate_workflow', 'capture_screenshot'];

export function validateGraph(workflow: ScriptDefinition): void {
  try { validateGraphInternal(workflow); }
  catch (error) { throw diagnosticError(error, { phase: 'validation', workflowId: workflow?.id, actionDispatched: false }); }
}

function validateGraphInternal(workflow: ScriptDefinition, child = false, globalNodes = allNodes(workflow.nodes), names = new Set<string>(), depth = 0): void {
  if (depth > 8) throw new Error('子流程嵌套超过 8 层');
  if (!workflow.name.trim()) throw new Error('工作流名称不能为空');
  if (workflow.nodes.length > 500 || workflow.edges.length > 1000) throw new Error('工作流超过节点或连线数量限制');
  if (workflow.nodes.filter((n) => n.kind === 'start').length !== (child ? 0 : 1)) throw new Error(child ? '内部子流程不能有开始节点' : '工作流必须有且只有一个开始节点');
  const ids = new Set<string>();
  for (const [index, node] of workflow.nodes.entries()) {
    try {
    if (!node || typeof node !== 'object') throw new Error('无效节点');
    if (!node.id || !node.name?.trim() || ids.has(node.id) || names.has(node.name)) throw new Error('节点 ID 和名称必须唯一且非空');
    ids.add(node.id); names.add(node.name);
    if ('target' in node) validateTargetLocator(node.target);
    if (node.kind === 'ai') for (const input of node.inputs) validateTargetLocator(input.target);
    const string = (value: unknown) => typeof value === 'string';
    const duration = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1800000;
    if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) throw new Error('节点位置无效');
    if (node.kind === 'start') {
      if (!string(node.targetUrl) || !Array.isArray(node.inputs) || !duration(node.loadTimeoutMs) || !duration(node.loginTimeoutMs) || !duration(node.settleDelayMs)
        || typeof node.strictValidation !== 'boolean' || typeof node.waitForLogin !== 'boolean') throw new Error('开始节点配置无效');
      const inputNames = new Set<string>();
      for (const input of node.inputs) {
        if (!input || !string(input.id) || !string(input.name) || !input.name.trim() || inputNames.has(input.name) || !['string', 'number', 'array', 'object', 'objectArray'].includes(input.type) || typeof input.required !== 'boolean') throw new Error('输入参数声明无效或重名');
        inputNames.add(input.name);
      }
    }
    if (node.kind === 'dom' || node.kind === 'dialog' || node.kind === 'datatable' || node.kind === 'tableFill' || node.kind === 'watch' || node.kind === 'query' || node.kind === 'calendar' || node.kind === 'pagination') {
      if (!node.target || !string(node.target.selector) || !Number.isInteger(node.target.frameId) || node.target.frameId < 0 || !string(node.target.tagName) || !string(node.target.name) || !string(node.target.label)) throw new Error('页面目标配置无效');
    }
    if (node.kind === 'dom' || node.kind === 'dialog' || node.kind === 'ai') {
      if (!node.event || !Object.hasOwn(EVENT_LABELS, node.event.type)
        || (node.event.value !== undefined && !string(node.event.value)) || (node.event.code !== undefined && !string(node.event.code))
        || (node.event.keepFocus !== undefined && typeof node.event.keepFocus !== 'boolean') || (node.event.relatedSelector !== undefined && !string(node.event.relatedSelector))
        || (node.event.modifiers !== undefined && (!node.event.modifiers || typeof node.event.modifiers !== 'object' || Array.isArray(node.event.modifiers) || Object.entries(node.event.modifiers).some(([key, value]) => !['alt', 'ctrl', 'meta', 'shift'].includes(key) || typeof value !== 'boolean')))) throw new Error('事件配置无效');
    }
    if (node.kind === 'dom' && node.event.type === 'upload' && (typeof node.event.value !== 'string' || !node.event.value.trim())) throw new Error('上传文件节点必须配置文件路径或路径变量');
    if (node.kind === 'dom' && !allowedEventsForTarget(node.target).includes(node.event.type)) throw new Error('事件与控件类型不匹配，请使用页面读取结果中的 tagName 和 attributes');
    validateDialogNode(node);
    validateMediaNode(node);
    validateRequestNode(node);
    validateOutputNode(node);
    if (node.kind === 'output' && node.source === 'node' && (!globalNodes.some(source => source.id === node.sourceNodeId) || node.sourceNodeId === node.id)) throw new Error('Output 引用的前序节点不存在');
    if (node.kind === 'wait') waitDuration(node, () => 0);
    if (node.kind === 'loop' && (!string(node.items) || !string(node.itemVariable) || !string(node.indexVariable) || !Number.isInteger(node.maxIterations) || node.maxIterations < 1 || node.maxIterations > 1000)) throw new Error('循环配置无效');
    if (node.kind === 'ai') {
      if (!string(node.instruction) || !Array.isArray(node.inputs)) throw new Error('AI 配置无效');
      for (const input of node.inputs) {
        if (!input || !string(input.id) || !string(input.name) || !['selector', 'node', 'literal'].includes(input.type)) throw new Error('AI 输入配置无效');
        if (input.type === 'node' && !globalNodes.some((n) => n.id === input.sourceNodeId)) throw new Error('AI 输入引用的节点不存在');
        if (input.type === 'selector' && (!input.target || !string(input.target.selector) || !Number.isInteger(input.target.frameId))) throw new Error('AI 输入 Selector 无效');
      }
    }
    const body = nodeBody(node);
    if (body) validateGraphInternal({ ...workflow, nodes: body.nodes, edges: body.edges }, true, globalNodes, names, depth + 1);
    } catch (error) { throw diagnosticError(error, { phase: 'validation', nodeId: node?.id, nodeName: node?.name, nodeKind: node?.kind, path: `nodes[${index}]`, actionDispatched: false }); }
  }
  if (!child) importWorkflow(exportWorkflow(workflow), []);
  const ports = new Set<string>(); const edgeIds = new Set<string>();
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) throw new Error('连线 ID 重复');
    edgeIds.add(edge.id);
    const source = workflow.nodes.find((n) => n.id === edge.sourceNodeId)!;
    if (!source || !ids.has(edge.targetNodeId)) throw new Error('连线引用不存在的节点');
    if (workflow.nodes.find((n) => n.id === edge.targetNodeId)?.kind === 'start') throw new Error('不能连接到开始节点');
    if (!(source.kind === 'pagination' || (source.kind === 'loop' && source.body) ? ['done','failure'] : ['success', 'failure', ...(source.kind === 'loop' ? ['body', 'done'] : [])]).includes(edge.sourcePort)) throw new Error('节点输出端口无效');
    const slot = `${source.id}:${edge.sourcePort}`;
    if (ports.has(slot)) throw new Error('同一输出端口只能连接一个后续节点');
    ports.add(slot);
  }
}

async function authorized(params: Record<string, unknown>): Promise<ScriptDefinition> {
  const id = String(params.workflowId ?? '');
  if (!await verifyWorkflowKey(id, String(params.key ?? ''))) throw new Error('工作流密钥无效');
  const workflow = (await loadWorkspace()).scripts.find((item) => item.id === id);
  if (!workflow) throw new Error('工作流不存在');
  return workflow;
}

export async function handleAuthoring(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (method === 'delete_node') {
    if (typeof params.nodeId !== 'string' || !params.nodeId.trim()) throw diagnosticError(new Error('删除节点必须提供非空 nodeId'), { phase: 'editing', actionDispatched: false, path: 'nodeId' });
    return handleAuthoring('edit_workflow', { workflowId: params.workflowId, key: params.key, expectedUpdatedAt: params.expectedUpdatedAt,
      operations: [{ type: 'remove_node', nodeId: params.nodeId.trim() }] });
  }

  if (method === 'create_workflow' || method === 'import_workflow') {
    const created = await mutateWorkspace(async (state) => {
      const now = Date.now();
      const created: ScriptDefinition = method === 'import_workflow'
        ? importWorkflow(params.file, [...state.scripts.map(s => s.id), ...(state.trash ?? []).map(entry => entry.workflow.id)]).workflow
        : { id: crypto.randomUUID(), name: String(params.name ?? 'Agent 工作流'), description: String(params.description ?? ''), nodes: [{ ...createStartNode('start'), targetUrl: String(params.targetUrl ?? '') }], edges: [], createdAt: now, updatedAt: now };
      validateGraph(created);
      // Install the key before broadcasting the new library to the side panel.
      const key = await ensureWorkflowKey(created.id);
      state.scripts.push(created); return { workflow: created, key };
    });
    return { ...created, hint: '已保存，可在插件列表中打开画布编辑。密钥仅在创建时返回，请妥善保存。' };
  }
  const workflow = await authorized(params);
  if (method === 'capture_screenshot') return exclusiveExecution(() => capturePage(params));
  if (method === 'get_workflow') return workflow;
  if (method === 'validate_workflow') {
    validateGraph(workflow);
    const warnings: Array<{ nodeId: string; message: string }> = [];
    const reachable = new Set(workflow.nodes.filter((n) => n.kind === 'start').map((n) => n.id));
    for (let i = 0; i < workflow.nodes.length; i++) for (const edge of workflow.edges) if (reachable.has(edge.sourceNodeId)) reachable.add(edge.targetNodeId);
    for (const node of workflow.nodes) {
      if (!reachable.has(node.id)) warnings.push({ nodeId: node.id, message: '节点没有连接到开始节点，不会被执行' });
      if (((node.kind === 'dom' || node.kind === 'calendar' || node.kind === 'query') && !node.target.selector.trim()) || (node.kind === 'output' && node.source === 'dom' && !node.target?.selector.trim())) warnings.push({ nodeId: node.id, message: '尚未配置 Selector' });
    }
    return { valid: true, ready: warnings.length === 0, updatedAt: workflow.updatedAt, warnings };
  }
  if (method === 'export_workflow') return exportWorkflow(workflow);
  if (method === 'edit_workflow') return mutateWorkspace((state) => {
    const current = state.scripts.find((s) => s.id === workflow.id)!;
    if (!current || params.expectedUpdatedAt !== current.updatedAt) throw diagnosticError(new Error('工作流已被修改，请重新读取后编辑（expectedUpdatedAt 不匹配）'), { phase: 'editing', workflowId: workflow.id, path: 'expectedUpdatedAt', expectedUpdatedAt: params.expectedUpdatedAt, actualUpdatedAt: current?.updatedAt });
    const next = structuredClone(current);
    if (typeof params.name === 'string') next.name = params.name;
    if (typeof params.description === 'string') next.description = params.description;
    if (Array.isArray(params.nodes)) next.nodes = params.nodes as WorkflowNode[];
    if (Array.isArray(params.edges)) next.edges = params.edges as ScriptDefinition['edges'];
    for (const [operationIndex, operation] of ((params.operations ?? []) as Array<Record<string, unknown>>).entries()) {
      try {
      const nodeId = String(operation.nodeId ?? '');
      if (operation.type === 'add_node') {
        if (operation.parentNodeId) {
          const parent = allNodes(next.nodes).find((n) => n.id === operation.parentNodeId);
          const body = parent && nodeBody(parent);
          if (!body) throw new Error('目标容器不存在或不是循环/分页节点');
          next.nodes = replaceGraph(next.nodes, body, { ...body, nodes: [...body.nodes, operation.node as WorkflowNode], entryNodeId: body.entryNodeId ?? (operation.node as WorkflowNode).id });
        } else next.nodes.push(operation.node as WorkflowNode);
      }
      else if (operation.type === 'update_node') {
        if (!allNodes(next.nodes).some((n) => n.id === nodeId)) throw new Error('更新的节点不存在');
        next.nodes = mapNodes(next.nodes, (n) => n.id === nodeId ? { ...n, ...(operation.patch as object), id: nodeId } as WorkflowNode : n);
      } else if (operation.type === 'remove_node') {
        const removing = allNodes(next.nodes).find(n => n.id === nodeId);
        if (!removing) throw new Error('删除的节点不存在，请重新读取工作流并确认 nodeId');
        if (removing.kind === 'start') throw new Error('不能删除开始节点');
        const removed = removeNode(next.nodes, next.edges, nodeId); next.nodes = removed.nodes; next.edges = removed.edges;
      } else if (operation.type === 'connect') {
        const edge = operation.edge as ScriptDefinition['edges'][number];
        const scope = graphFor(next.nodes, next.edges, edge.sourceNodeId);
        if (!scope || !scope.nodes.some((n) => n.id === edge.targetNodeId)) throw new Error('连线不能跨越子流程边界');
        if (scope.nodes === next.nodes) next.edges.push(edge);
        else next.nodes = replaceGraph(next.nodes, scope, { ...scope, edges: [...scope.edges, edge] });
      }
      else if (operation.type === 'disconnect') {
        next.edges = next.edges.filter((e) => e.id !== operation.edgeId);
        next.nodes = mapNodes(next.nodes, (n) => { const body = nodeBody(n); return body ? { ...n, body: { ...body, edges: body.edges.filter((e) => e.id !== operation.edgeId) } } as WorkflowNode : n; });
      }
      else throw new Error('不支持的编辑操作');
      } catch (error) { throw diagnosticError(error, { phase: 'editing', workflowId: workflow.id, operationIndex, operationType: operation.type, nodeId: operation.nodeId, edgeId: operation.edgeId, path: `operations[${operationIndex}]` }); }
    }
    validateGraph(next); next.updatedAt = Math.max(Date.now(), current.updatedAt + 1);
    state.scripts[state.scripts.indexOf(current)] = next; return next;
  });
  if (method === 'inspect_page') {
    const tabId = await activeTabId();
    const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? [];
    if (params.listFrames === true) return { tabId, frames };
    const matches = frames.filter((f) => params.frameUrl ? f.url === params.frameUrl : f.frameId === Number(params.frameId ?? 0));
    if (matches.length !== 1) throw diagnosticError(new Error('Frame 不存在或不唯一，请先 listFrames 获取当前 frame 信息'), { phase: 'locating', tabId, requestedFrameId: params.frameId, requestedFrameUrl: params.frameUrl, matchCount: matches.length, availableFrames: frames.map((f) => ({ frameId: f.frameId, url: f.url })), actionDispatched: false });
    const frame = matches[0];
    if (!await readyFrame(tabId, frame.frameId)) throw new Error('目标页面不允许插件读取');
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_INSPECT_PAGE', selector: String(params.selector ?? 'body'), maxNodes: params.maxNodes, maxText: params.maxText }, { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) });
    if (!snapshot?.ok) throw new Error(snapshot?.error ?? '页面读取失败');
    return { ...snapshot, tabId, frameId: frame.frameId, frameUrl: frame.url };
  }
  const reportKey = `pageAgentDebug:${workflow.id}`;
  if (method === 'get_debug_result') return (await chrome.storage.session.get(reportKey))[reportKey] ?? null;
  if (method === 'debug_node' || method === 'debug_workflow') {
    validateGraph(workflow);
    const startedAt = Date.now();
    const data = params.data as Record<string, unknown> ?? {};
    const result = method === 'debug_node' ? await debugNode(workflow.nodes, String(params.nodeId), data, params.context as Record<string, unknown> ?? {}, { id: workflow.id, name: workflow.name }) : await runScript(workflow.id, data);
    const report = { runId: crypto.randomUUID(), workflowId: workflow.id, workflowUpdatedAt: workflow.updatedAt, startedAt, finishedAt: Date.now(), result };
    try { await chrome.storage.session.set({ [reportKey]: report }); }
    catch { return { ...report, warning: '调试已经执行完成，但会话日志存储失败，请保存本次返回结果，不要盲目重复执行' }; }
    return report;
  }
  throw new Error('不支持的工作流工具');
}
