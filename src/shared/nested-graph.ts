import type { WorkflowBody, WorkflowEdge, WorkflowNode } from '@/types/workflow';

export function nodeBody(node: WorkflowNode): WorkflowBody | undefined {
  return node.kind === 'loop' || node.kind === 'pagination' ? node.body : undefined;
}

export function allNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.flatMap((node) => [node, ...allNodes(nodeBody(node)?.nodes ?? [])]);
}

export function mapNodes(nodes: WorkflowNode[], change: (node: WorkflowNode) => WorkflowNode): WorkflowNode[] {
  return nodes.map((node) => {
    const body = nodeBody(node);
    const next = body ? { ...node, body: { ...body, nodes: mapNodes(body.nodes, change) } } as WorkflowNode : node;
    return change(next);
  });
}

/** Locate the one graph that owns a node/virtual container entry. No cross-scope edges. */
export function graphFor(nodes: WorkflowNode[], edges: WorkflowEdge[], id: string): WorkflowBody | undefined {
  if (nodes.some((node) => node.id === id)) return { nodes, edges };
  for (const node of nodes) {
    const body = nodeBody(node);
    if (!body) continue;
    if (id === `${node.id}::entry`) return body;
    const found = graphFor(body.nodes, body.edges, id);
    if (found) return found.nodes === body.nodes ? body : found;
  }
  return undefined;
}

function insertNode(nodes: WorkflowNode[], edges: WorkflowEdge[], node: WorkflowNode, source?: { nodeId: string; port: WorkflowEdge['sourcePort'] }): WorkflowBody {
  const next: WorkflowBody = {
    nodes: [...nodes, node],
    edges: source ? [...edges, { id: crypto.randomUUID(), sourceNodeId: source.nodeId, targetNodeId: node.id, sourcePort: source.port }] : edges,
  };
  return next;
}

export function replaceGraph(nodes: WorkflowNode[], scope: WorkflowBody, next: WorkflowBody): WorkflowNode[] {
  return nodes.map((node) => {
    const body = nodeBody(node);
    if (!body) return node;
    return { ...node, body: body.nodes === scope.nodes ? next : { ...body, nodes: replaceGraph(body.nodes, scope, next) } } as WorkflowNode;
  });
}

export function addToGraph(nodes: WorkflowNode[], edges: WorkflowEdge[], node: WorkflowNode, source?: { nodeId: string; port: WorkflowEdge['sourcePort'] }): WorkflowBody {
  const scope = source ? graphFor(nodes, edges, source.nodeId) : { nodes, edges };
  if (!scope) throw new Error('子流程不存在');
  const next = insertNode(scope.nodes, scope.edges, node, source?.nodeId.endsWith('::entry') ? undefined : source);
  if (scope.entryNodeId) next.entryNodeId = scope.entryNodeId;
  if (source?.nodeId.endsWith('::entry')) next.entryNodeId = node.id;
  return scope.nodes === nodes ? next : { nodes: replaceGraph(nodes, scope, next), edges };
}

export function removeNode(nodes: WorkflowNode[], edges: WorkflowEdge[], id: string): WorkflowBody {
  const scope = graphFor(nodes, edges, id);
  if (!scope) return { nodes, edges };
  const next = { ...scope, nodes: scope.nodes.filter((node) => node.id !== id), edges: scope.edges.filter((edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id), entryNodeId: scope.entryNodeId === id ? undefined : scope.entryNodeId };
  return scope.nodes === nodes ? next : { nodes: replaceGraph(nodes, scope, next), edges };
}
