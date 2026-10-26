import { validateDialogNode } from './dialog';
import { validateTargetLocator } from './target-locator';
import type { ScriptDefinition, WorkflowExportFile, WorkflowNode } from '@/types/workflow';
import { EVENT_LABELS } from '@/types/workflow';
import { migrateGraph } from './storage';
import { allNodes } from './nested-graph';
import { waitDuration } from './wait';
import { validateMediaNode } from './media-nodes';
import { validateOutputNode } from './output';
import { validateRequestNode } from './request';

export const WORKFLOW_SCHEMA_URL = 'https://page-agent.dev/schemas/workflow-v1.json' as const;

export function createWorkflowId(): string {
  return crypto.randomUUID();
}

export function exportWorkflow(workflow: ScriptDefinition): WorkflowExportFile {
  return {
    $schema: WORKFLOW_SCHEMA_URL,
    schemaVersion: 1,
    kind: 'page-agent-workflow',
    exportedAt: new Date().toISOString(),
    workflow: structuredClone(workflow),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const NODE_KINDS = new Set<WorkflowNode['kind']>(['start', 'dom', 'dialog', 'query', 'output', 'watch', 'screenshot', 'datatable', 'tableFill', 'email', 'calendar', 'pagination', 'ai', 'action', 'wait', 'loop', 'request']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateScope(nodes: unknown[], edges: unknown[], globalIds = new Set<string>(), depth = 0): void {
  if (depth > 8) throw new Error('子流程嵌套超过 8 层');
  const local = new Set<string>();
  for (const value of nodes) {
    if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !NODE_KINDS.has(value.kind as WorkflowNode['kind'])) throw new Error('工作流包含无效节点');
    if (globalIds.has(value.id)) throw new Error('工作流节点 ID 不能重复（包括子流程）');
    globalIds.add(value.id); local.add(value.id);
    if (object(value.target) && value.target.frameQueryKeys !== undefined && (typeof value.target.frameUrl !== 'string' || !Array.isArray(value.target.frameQueryKeys) || value.target.frameQueryKeys.length > 100 || value.target.frameQueryKeys.some(key => typeof key !== 'string' || !key) || new Set(value.target.frameQueryKeys).size !== value.target.frameQueryKeys.length)) throw new Error('目标页面 URL 参数范围配置无效');
    validateTargetLocator(value.target);
    if (Array.isArray(value.inputs)) for (const input of value.inputs) if (object(input)) validateTargetLocator(input.target);
    validateDialogNode(value as unknown as WorkflowNode);
    validateMediaNode(value as unknown as WorkflowNode);
    validateOutputNode(value as unknown as WorkflowNode);
    validateRequestNode(value as unknown as WorkflowNode);
    if (value.kind === 'dom' || value.kind === 'dialog' || value.kind === 'ai') {
      const event = value.event;
      if (!object(event) || typeof event.type !== 'string' || !Object.hasOwn(EVENT_LABELS, event.type)
        || ['value', 'code', 'relatedSelector', 'customEvent'].some(key => event[key] !== undefined && typeof event[key] !== 'string')
        || (event.keepFocus !== undefined && typeof event.keepFocus !== 'boolean')
        || (event.optionalValue !== undefined && typeof event.optionalValue !== 'boolean')
        || ['minWaitMs', 'maxWaitMs'].some(key => event[key] !== undefined && (typeof event[key] !== 'number' || !Number.isFinite(event[key]) || Number(event[key]) < 0 || Number(event[key]) > 10000))
        || (event.minWaitMs !== undefined && event.maxWaitMs !== undefined && Number(event.minWaitMs) > Number(event.maxWaitMs))
        || (event.modifiers !== undefined && (!object(event.modifiers) || Object.entries(event.modifiers).some(([key, flag]) => !['alt', 'ctrl', 'meta', 'shift'].includes(key) || typeof flag !== 'boolean')))) throw new Error('网页事件配置无效');
    }
    if (value.kind === 'dom' && object(value.event) && value.event.type === 'upload' && (typeof value.event.value !== 'string' || !value.event.value.trim())) throw new Error('上传文件节点必须配置文件路径或路径变量');
    if (value.kind === 'start' && value.keepCurrentPage !== undefined && typeof value.keepCurrentPage !== 'boolean') throw new Error('开始节点的保持当前页面配置必须是布尔值');
    if (value.kind === 'wait') waitDuration(value as unknown as Extract<WorkflowNode, { kind: 'wait' }>, () => 0);
    if (globalIds.size > 500) throw new Error('工作流超过 500 个节点');
    if (depth && value.kind === 'start') throw new Error('内部子流程不能包含开始节点');
    if (value.kind === 'watch' && (!object(value.target) || typeof value.target.selector !== 'string' || !Number.isInteger(value.target.frameId) || Number(value.target.frameId) < 0 || !['attribute', 'value', 'text'].includes(String(value.source)) || !['equals', 'contains', 'regex', 'exists'].includes(String(value.match)) || typeof value.expected !== 'string' || typeof value.attributeName !== 'string' || typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 3600000 || typeof value.intervalMs !== 'number' || !Number.isFinite(value.intervalMs) || value.intervalMs < 100 || value.intervalMs > 10000)) throw new Error('Watch 节点配置无效');
    if (value.kind === 'pagination' && value.stopAtPage !== undefined && typeof value.stopAtPage !== 'string') throw new Error('分页终止条件格式无效，终止页码应为文本或变量表达式');
    if (value.kind === 'pagination' && value.stopWhen !== undefined && (typeof value.stopWhen !== 'string' || !/^\{\{\s*[^{}]+?\s*\}\}$/.test(value.stopWhen))) throw new Error('分页结果终止条件必须是一个变量引用');
    if (value.kind === 'pagination' && (!object(value.target) || typeof value.target.selector !== 'string' || !Number.isInteger(value.target.frameId) || Number(value.target.frameId) < 0 || !['goto', 'all'].includes(String(value.mode)) || typeof value.page !== 'string' || typeof value.pageVariable !== 'string' || !value.pageVariable.trim() || !Number.isInteger(value.maxPages) || Number(value.maxPages) < 1 || Number(value.maxPages) > 5000 || typeof value.timeoutMs !== 'number' || value.timeoutMs < 100 || value.timeoutMs > 30000 || typeof value.settleMs !== 'number' || value.settleMs < 0 || value.settleMs > 10000 || !object(value.body))) throw new Error('分页节点配置无效');
    if ((value.kind === 'loop' || value.kind === 'pagination') && value.body !== undefined) {
      if (!object(value.body) || !Array.isArray(value.body.nodes) || !Array.isArray(value.body.edges)) throw new Error('内部子流程格式无效');
      validateScope(value.body.nodes, value.body.edges, globalIds, depth + 1);
      const entryNodeId = value.body.entryNodeId;
      if (entryNodeId !== undefined && !value.body.nodes.some((n) => object(n) && n.id === entryNodeId)) throw new Error('子流程入口不存在');
    }
  }
  if (edges.length > 1000) throw new Error('工作流连线过多');
  const ports = new Set<string>();
  for (const edge of edges) {
    if (!object(edge) || typeof edge.id !== 'string' || !local.has(String(edge.sourceNodeId)) || !local.has(String(edge.targetNodeId)) || !['success','failure','body','done'].includes(String(edge.sourcePort))) throw new Error('工作流连线无效：引用了不存在的节点或跨越子流程边界');
    const slot = `${edge.sourceNodeId}:${edge.sourcePort}`;
    if (ports.has(slot)) throw new Error('同一输出端口只能连接一个后续节点');
    ports.add(slot);
  }
}

export function importWorkflow(raw: unknown, existingIds: Iterable<string>): { workflow: ScriptDefinition; idChanged: boolean } {
  if (!object(raw) || raw.kind !== 'page-agent-workflow' || raw.schemaVersion !== 1 || !object(raw.workflow)) {
    throw new Error('不是有效的 Page Agent 工作流文件（需要 kind=page-agent-workflow、schemaVersion=1）');
  }
  const candidate = raw.workflow;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) throw new Error('工作流缺少有效 ID');
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) throw new Error('工作流缺少名称');
  if (!Array.isArray(candidate.nodes) || !candidate.nodes.length) throw new Error('工作流必须包含节点');
  if (!Array.isArray(candidate.edges)) throw new Error('工作流连线格式无效');
  validateScope(candidate.nodes, candidate.edges);
  for (const node of allNodes(candidate.nodes as WorkflowNode[])) {
    if (!object(node) || typeof node.id !== 'string' || typeof node.name !== 'string' || !NODE_KINDS.has(node.kind as WorkflowNode['kind'])) {
      throw new Error('工作流包含无效节点');
    }
    if (node.kind === 'output' && node.source === 'node' && (!allNodes(candidate.nodes as WorkflowNode[]).some(source => source.id === node.sourceNodeId) || node.sourceNodeId === node.id)) throw new Error('Output 引用的前序节点不存在');
    if (node.kind === 'query') {
      const target = node.target;
      const query = node.query;
      if (!object(target) || typeof target.selector !== 'string' || typeof target.frameId !== 'number' || !Number.isInteger(target.frameId) || target.frameId < 0
        || !object(query) || typeof query.includeRoot !== 'boolean'
        || (query.readSelector !== undefined && typeof query.readSelector !== 'string')
        || (query.normalizeWhitespace !== undefined && typeof query.normalizeWhitespace !== 'boolean')
        || !['attribute', 'value', 'text'].includes(String(query.source))
        || !['exists', 'equals', 'contains', 'regex'].includes(String(query.match))
        || ['candidateSelector', 'attributeName', 'pattern', 'regexFlags'].some((key) => typeof query[key] !== 'string')) {
        throw new Error('工作流 Query 节点的检索范围或配置无效');
      }
    }
    if (node.kind === 'calendar' && (!object(node.target) || typeof node.target.selector !== 'string' || !Number.isInteger(node.target.frameId) || Number(node.target.frameId) < 0 || typeof node.date !== 'string' || typeof node.endDate !== 'string' || !['single', 'range'].includes(String(node.mode)))) {
      throw new Error('工作流日历节点配置无效');
    }
  }
  const nodeIds = new Set(candidate.nodes.map((node) => (node as Record<string, unknown>).id as string));
  if (nodeIds.size !== candidate.nodes.length) throw new Error('工作流节点 ID 不能重复');
  const edgePorts = new Set(['success', 'failure', 'body', 'done']);
  for (const edge of candidate.edges) {
    if (!object(edge) || typeof edge.id !== 'string' || typeof edge.sourceNodeId !== 'string' || typeof edge.targetNodeId !== 'string'
      || typeof edge.sourcePort !== 'string' || !edgePorts.has(edge.sourcePort)) throw new Error('工作流包含无效连线');
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) throw new Error('工作流连线引用了不存在的节点');
  }
  if (candidate.tags !== undefined && (!Array.isArray(candidate.tags) || candidate.tags.length > 10 || candidate.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 30))) throw new Error('工作流标签无效');
  const graph = migrateGraph(candidate.nodes, candidate.edges);
  const known = new Set(existingIds);
  const idChanged = known.has(candidate.id) || !UUID_PATTERN.test(candidate.id);
  const now = Date.now();
  const workflow: ScriptDefinition = {
    id: idChanged ? createWorkflowId() : candidate.id,
    name: candidate.name.trim(),
    ...(candidate.tags !== undefined ? { tags: candidate.tags as string[] } : {}),
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    urlPattern: typeof candidate.urlPattern === 'string' ? candidate.urlPattern : undefined,
    nodes: graph.nodes,
    edges: graph.edges,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
    updatedAt: now,
  };
  return { workflow, idChanged };
}
