import type { WorkspaceState } from '@/types/workflow';

const STORAGE_KEY = 'pageAgentWorkspaceV1';

export const EMPTY_WORKSPACE: WorkspaceState = { actions: [], scripts: [], draft: [], draftEdges: [] };

function linearEdges(nodes: WorkspaceState['draft']) {
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

export async function loadWorkspace(): Promise<WorkspaceState> {
  const value = await chrome.storage.local.get(STORAGE_KEY);
  const stored = value[STORAGE_KEY] as Partial<WorkspaceState> | undefined;
  const draft = migrateNodes(Array.isArray(stored?.draft) ? stored.draft : []);
  return {
    actions: Array.isArray(stored?.actions) ? stored.actions.map((action) => {
      const nodes = migrateNodes(action.nodes);
      return { ...action, nodes, edges: action.edges ?? linearEdges(nodes) };
    }) : [],
    scripts: Array.isArray(stored?.scripts) ? stored.scripts.map((script) => {
      const nodes = migrateNodes(script.nodes);
      return { ...script, nodes, edges: script.edges ?? linearEdges(nodes) };
    }) : [],
    draft,
    draftEdges: Array.isArray(stored?.draftEdges) ? stored.draftEdges : linearEdges(draft),
  };
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_STATE_CHANGED' }).catch(() => undefined);
}
