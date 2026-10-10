import type { ScriptDefinition, WorkflowExportFile, WorkflowNode } from '@/types/workflow';
import { migrateGraph } from './storage';

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

const NODE_KINDS = new Set<WorkflowNode['kind']>(['start', 'dom', 'query', 'calendar', 'ai', 'action', 'wait', 'loop']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function importWorkflow(raw: unknown, existingIds: Iterable<string>): { workflow: ScriptDefinition; idChanged: boolean } {
  if (!object(raw) || raw.kind !== 'page-agent-workflow' || raw.schemaVersion !== 1 || !object(raw.workflow)) {
    throw new Error('不是有效的 Page Agent 工作流文件（需要 kind=page-agent-workflow、schemaVersion=1）');
  }
  const candidate = raw.workflow;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) throw new Error('工作流缺少有效 ID');
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) throw new Error('工作流缺少名称');
  if (!Array.isArray(candidate.nodes) || !candidate.nodes.length) throw new Error('工作流必须包含节点');
  if (!Array.isArray(candidate.edges)) throw new Error('工作流连线格式无效');
  for (const node of candidate.nodes) {
    if (!object(node) || typeof node.id !== 'string' || typeof node.name !== 'string' || !NODE_KINDS.has(node.kind as WorkflowNode['kind'])) {
      throw new Error('工作流包含无效节点');
    }
    if (node.kind === 'query') {
      const target = node.target;
      const query = node.query;
      if (!object(target) || typeof target.selector !== 'string' || typeof target.frameId !== 'number' || !Number.isInteger(target.frameId) || target.frameId < 0
        || !object(query) || typeof query.includeRoot !== 'boolean'
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
  const graph = migrateGraph(candidate.nodes, candidate.edges);
  const known = new Set(existingIds);
  const idChanged = known.has(candidate.id) || !UUID_PATTERN.test(candidate.id);
  const now = Date.now();
  const workflow: ScriptDefinition = {
    id: idChanged ? createWorkflowId() : candidate.id,
    name: candidate.name.trim(),
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    urlPattern: typeof candidate.urlPattern === 'string' ? candidate.urlPattern : undefined,
    nodes: graph.nodes,
    edges: graph.edges,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
    updatedAt: now,
  };
  return { workflow, idChanged };
}
