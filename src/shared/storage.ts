import type { WorkflowEdge, WorkflowNode, WorkspaceState } from '@/types/workflow';

const STORAGE_KEY = 'pageAgentLibraryV2';
const LEGACY_STORAGE_KEY = 'pageAgentWorkspaceV1';

export const EMPTY_WORKSPACE: WorkspaceState = { actions: [], scripts: [], draft: [], draftEdges: [] };

interface StoredLibraryV2 {
  schemaVersion: 2;
  actions: WorkspaceState['actions'];
  scripts: WorkspaceState['scripts'];
}

function linearEdges(nodes: Array<{ id: string }>): WorkflowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `edge_${node.id}_${nodes[index + 1].id}`,
    sourceNodeId: node.id,
    targetNodeId: nodes[index + 1].id,
    sourcePort: 'success' as const,
  }));
}

function migrateNodes(nodes: WorkspaceState['draft']): WorkspaceState['draft'] {
  return nodes.map((node, index) => {
    const position = node.position ?? { x: 80 + index * 280, y: 100 };
    if (node.kind === 'dom') return { ...node, position, target: { ...node.target, name: node.target.name || node.name } };
    if (node.kind === 'ai') return { ...node, position, inputs: node.inputs ?? [] };
    return { ...node, position };
  });
}

interface LegacyConditionNode {
  id: string;
  kind: 'condition';
  name: string;
  left: string;
  operator: string;
  right?: string;
}

interface LegacyWorkflowEdge extends Omit<WorkflowEdge, 'sourcePort'> {
  sourcePort: WorkflowEdge['sourcePort'] | 'true' | 'false';
}

export function migrateGraph(rawNodes: unknown[], rawEdges?: unknown[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const storedNodes = rawNodes as Array<WorkflowNode | LegacyConditionNode>;
  let edges: LegacyWorkflowEdge[] = rawEdges as LegacyWorkflowEdge[] | undefined ?? linearEdges(storedNodes);
  const legacyConditions = storedNodes.filter((node): node is LegacyConditionNode => node.kind === 'condition');
  const nodes = migrateNodes(storedNodes.filter((node): node is WorkflowNode => node.kind !== 'condition'));

  for (const condition of legacyConditions) {
    const incoming = edges.filter((edge) => edge.targetNodeId === condition.id);
    const truthy = edges.find((edge) => edge.sourceNodeId === condition.id && edge.sourcePort === 'true')
      ?? edges.find((edge) => edge.sourceNodeId === condition.id && edge.sourcePort === 'success');
    const falsy = edges.find((edge) => edge.sourceNodeId === condition.id && edge.sourcePort === 'false')
      ?? edges.find((edge) => edge.sourceNodeId === condition.id && edge.sourcePort === 'failure');
    edges = edges.filter((edge) => edge.sourceNodeId !== condition.id && edge.targetNodeId !== condition.id);

    // v0.2 condition nodes are removed. Preserve their branch topology using the
    // predecessor card's automatic success/failure outcome.
    for (const entry of incoming.filter((edge) => edge.sourcePort === 'success')) {
      const predecessor = nodes.find((node) => node.id === entry.sourceNodeId);
      if (!predecessor) continue;
      if (truthy) edges.push({ id: `edge_${predecessor.id}_${truthy.targetNodeId}_success`, sourceNodeId: predecessor.id, targetNodeId: truthy.targetNodeId, sourcePort: 'success' });
      if (falsy) edges.push({ id: `edge_${predecessor.id}_${falsy.targetNodeId}_failure`, sourceNodeId: predecessor.id, targetNodeId: falsy.targetNodeId, sourcePort: 'failure' });
    }
  }
  return { nodes, edges: edges as WorkflowEdge[] };
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  const value = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  const stored = (value[STORAGE_KEY] ?? value[LEGACY_STORAGE_KEY]) as Partial<StoredLibraryV2 & WorkspaceState> | undefined;
  const workspace: WorkspaceState = {
    actions: Array.isArray(stored?.actions) ? stored.actions.map((action) => {
      const graph = migrateGraph(action.nodes, action.edges);
      return { ...action, ...graph };
    }) : [],
    scripts: Array.isArray(stored?.scripts) ? stored.scripts.map((script) => {
      const graph = migrateGraph(script.nodes, script.edges);
      return { ...script, ...graph };
    }) : [],
    // The editor is intentionally session-only. A saved Action or Script must be
    // explicitly opened before it becomes an editable graph again.
    draft: [],
    draftEdges: [],
  };
  if (value[LEGACY_STORAGE_KEY]) {
    if (!value[STORAGE_KEY]) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: { schemaVersion: 2, actions: workspace.actions, scripts: workspace.scripts } satisfies StoredLibraryV2,
      });
    }
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  }
  return workspace;
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const library: StoredLibraryV2 = {
    schemaVersion: 2,
    actions: state.actions ?? [],
    scripts: state.scripts ?? [],
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: library });
  await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_STATE_CHANGED' }).catch(() => undefined);
}
