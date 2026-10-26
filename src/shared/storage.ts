import { removeWorkflowKey } from './workflow-keys';
import { EDITOR_DRAFT_KEY, isEditorDraft } from './editor-draft';
import { mutateRunHistory } from './run-history';
import { allowedEventsForTarget, createStartNode, defaultEventForTarget, DEFAULT_DOM_QUERY, type WorkflowEdge, type WorkflowNode, type WorkspaceState } from '@/types/workflow';

const STORAGE_KEY = 'pageAgentLibraryV2';
const LEGACY_STORAGE_KEY = 'pageAgentWorkspaceV1';

export const EMPTY_WORKSPACE: WorkspaceState = { actions: [], scripts: [], draft: [], draftEdges: [] };

interface StoredLibraryV2 {
  schemaVersion: 2;
  actions: WorkspaceState['actions'];
  scripts: WorkspaceState['scripts'];
  trash?: WorkspaceState['trash'];
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
    if (node.kind === 'start') return {
      ...createStartNode(node.id),
      ...node,
      position,
      inputs: (node.inputs ?? []).map((input) => ({ ...input, type: input.type ?? 'string' })),
      targetUrl: node.targetUrl ?? '',
      strictValidation: Boolean(node.strictValidation),
      waitForLogin: Boolean(node.waitForLogin),
      loadTimeoutMs: node.loadTimeoutMs ?? 30_000,
      loginTimeoutMs: node.loginTimeoutMs ?? 300_000,
      settleDelayMs: node.settleDelayMs ?? 500,
    };
    if (node.kind === 'dom') {
      const target = { ...node.target, name: node.target.name || node.name };
      const event = allowedEventsForTarget(target).includes(node.event.type) ? node.event : defaultEventForTarget(target);
      return { ...node, position, target, event };
    }
    if (node.kind === 'ai') return { ...node, position, inputs: node.inputs ?? [] };
    if (node.kind === 'query') return {
      ...node, position,
      target: {
        ...node.target, name: node.target?.name || node.name, selector: node.target?.selector ?? '',
        frameId: node.target?.frameId ?? 0, tagName: node.target?.tagName ?? '', label: node.target?.label ?? '',
      },
      query: { ...DEFAULT_DOM_QUERY, ...node.query },
    };
    if ((node.kind === 'loop' || node.kind === 'pagination') && node.body) return { ...node, position, body: { ...node.body, nodes: migrateNodes(node.body.nodes) } };
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
  if (!nodes.some((node) => node.kind === 'start')) {
    const root = nodes.find((node) => !edges.some((edge) => edge.targetNodeId === node.id));
    const startId = nodes.some((node) => node.id === 'start') ? 'start_entry' : 'start';
    const start = createStartNode(startId);
    if (root) {
      start.position = { x: (root.position?.x ?? 360) - 300, y: root.position?.y ?? 80 };
      edges.push({ id: `edge_${start.id}_${root.id}`, sourceNodeId: start.id, targetNodeId: root.id, sourcePort: 'success' });
    }
    nodes.unshift(start);
  }
  return { nodes, edges: edges as WorkflowEdge[] };
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  const value = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  const stored = (value[STORAGE_KEY] ?? value[LEGACY_STORAGE_KEY]) as Partial<StoredLibraryV2 & WorkspaceState> | undefined;
  let workflowIdsMigrated = false;
  const workspace: WorkspaceState = {
    actions: Array.isArray(stored?.actions) ? stored.actions.map((action) => {
      const graph = migrateGraph(action.nodes, action.edges);
      return { ...action, ...graph };
    }) : [],
    scripts: Array.isArray(stored?.scripts) ? stored.scripts.map((script) => {
      const graph = migrateGraph(script.nodes, script.edges);
      const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(script.id);
      if (!validUuid) workflowIdsMigrated = true;
      return { ...script, id: validUuid ? script.id : crypto.randomUUID(), ...graph };
    }) : [],
    ...(Array.isArray(stored?.trash) ? { trash: stored.trash } : {}),
    // Recoverable editor drafts live separately from the executable library.
    draft: [],
    draftEdges: [],
  };
  if (value[LEGACY_STORAGE_KEY]) {
    if (!value[STORAGE_KEY]) {
      await chrome.storage.local.set({
        [STORAGE_KEY]: { schemaVersion: 2, actions: workspace.actions, scripts: workspace.scripts, ...(workspace.trash?.length ? { trash: workspace.trash } : {}) } satisfies StoredLibraryV2,
      });
    }
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  } else if (workflowIdsMigrated) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { schemaVersion: 2, actions: workspace.actions, scripts: workspace.scripts, ...(workspace.trash?.length ? { trash: workspace.trash } : {}) } satisfies StoredLibraryV2,
    });
  }
  return workspace;
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const library: StoredLibraryV2 = {
    schemaVersion: 2,
    actions: state.actions ?? [],
    scripts: state.scripts ?? [],
    ...(state.trash?.length ? { trash: state.trash } : {}),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: library });
  await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_STATE_CHANGED' }).catch(() => undefined);
}

let mutationQueue: Promise<unknown> = Promise.resolve();
/** Serialize read/modify/write operations in the extension background. */
export function mutateWorkspace<T>(change: (state: WorkspaceState) => T | Promise<T>): Promise<T> {
  const task = mutationQueue.then(async () => {
    const state = await loadWorkspace();
    const result = await change(state);
    await saveWorkspace(state);
    return result;
  });
  mutationQueue = task.catch(() => undefined);
  return task;
}

/** Metadata-only update: never replace a graph or recreate its ID/access key. */
export function renameWorkflow(id: string, name: string, expectedUpdatedAt: number) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\r\n\u0000-\u001f]/.test(name)) return Promise.reject(new Error('工作流名称需为 1–120 个字符，不能包含换行或控制字符'));
  if (!Number.isFinite(expectedUpdatedAt)) return Promise.reject(new Error('缺少工作流版本，请刷新后重试'));
  return mutateWorkspace(state => {
    const workflow = state.scripts.find(item => item.id === id);
    if (!workflow) throw new Error('工作流已不存在，请刷新列表');
    if (workflow.updatedAt !== expectedUpdatedAt) throw new Error('工作流已被其他客户端更新，请刷新后重新命名');
    if (workflow.name !== name.trim()) { workflow.name = name.trim(); workflow.updatedAt = Math.max(Date.now(), workflow.updatedAt + 1); }
    return structuredClone(workflow);
  });
}

/** Delete only the selected revision, preserving concurrent changes to other workflows. */
export function deleteWorkflow(id: string, expectedUpdatedAt: number) {
  if (!Number.isFinite(expectedUpdatedAt)) return Promise.reject(new Error('缺少工作流版本，请刷新后重试'));
  return mutateWorkspace(state => {
    const workflow = state.scripts.find(item => item.id === id);
    if (!workflow) throw new Error('工作流已不存在，请刷新列表');
    if (workflow.updatedAt !== expectedUpdatedAt) throw new Error('工作流已被其他客户端更新，请刷新后重新删除');
    state.trash = [...(state.trash ?? []), { workflow: structuredClone(workflow), deletedAt: Date.now() }];
    state.scripts = state.scripts.filter(item => item.id !== id);
  });
}

export function restoreWorkflow(id: string) {
  return mutateWorkspace(state => {
    const entry = state.trash?.find(item => item.workflow.id === id);
    if (!entry) throw new Error('回收站中未找到此工作流');
    if (state.scripts.some(item => item.id === id)) throw new Error('工作流 ID 已被占用，请先导出回收站中的工作流');
    state.scripts.push({ ...entry.workflow, updatedAt: Math.max(Date.now(), entry.workflow.updatedAt + 1) });
    state.trash = state.trash!.filter(item => item.workflow.id !== id);
  });
}

export function updateWorkflowTags(id: string, tags: string[], expectedUpdatedAt: number) {
  if (!Array.isArray(tags) || tags.length > 10 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 30)) return Promise.reject(new Error('最多 10 个标签，每个 1–30 个字符'));
  return mutateWorkspace(state => {
    const workflow = state.scripts.find(item => item.id === id);
    if (!workflow || workflow.updatedAt !== expectedUpdatedAt) throw new Error('工作流已更新或不存在，请刷新后重试');
    workflow.tags = [...new Set(tags.map(tag => tag.trim()))];
    workflow.updatedAt = Math.max(Date.now(), workflow.updatedAt + 1);
  });
}

/** Whole-library replacement is legacy API: require explicit revisions, never bypass the queue. */
export function replaceWorkspace(next: WorkspaceState, expectedRevisions?: Record<string, number>) {
  if (!expectedRevisions || typeof expectedRevisions !== 'object' || Array.isArray(expectedRevisions)) return Promise.reject(new Error('替换工作流库必须提供 expectedRevisions，请先读取最新工作区'));
  return mutateWorkspace(latest => {
    const revisions = Object.fromEntries(latest.scripts.map(script => [script.id, script.updatedAt]));
    if (Object.keys(revisions).length !== Object.keys(expectedRevisions).length || Object.entries(revisions).some(([id, version]) => expectedRevisions[id] !== version)) throw new Error('工作流库已被其他客户端更新，请重新打开工作流后保存');
    if (!next || !Array.isArray(next.scripts) || !Array.isArray(next.actions)) throw new Error('工作流库格式无效');
    if (new Set(next.scripts.map(script => script.id)).size !== next.scripts.length || next.scripts.some(script => !script || typeof script.id !== 'string' || !script.id || typeof script.name !== 'string' || !script.name.trim() || !Number.isFinite(script.updatedAt) || !Array.isArray(script.nodes) || !Array.isArray(script.edges))) throw new Error('工作流库包含无效或重复的工作流');
    if (latest.scripts.some(script => !next.scripts.some(item => item.id === script.id))) throw new Error('请使用删除工作流入口移入回收站，不能通过整库替换删除');
    const trashedIds = new Set(latest.trash?.map(entry => entry.workflow.id));
    if (next.scripts.some(script => trashedIds.has(script.id))) throw new Error('工作流已在回收站，请先恢复或使用新的 ID');
    if (JSON.stringify(next.actions) !== JSON.stringify(latest.actions)) throw new Error('整库保存不能修改旧 Action，请使用工作流编辑接口');
    latest.scripts = next.scripts.map(script => {
      const current = latest.scripts.find(item => item.id === script.id);
      if (!current) return script;
      const { lastRunAt: _beforeRun, ...before } = current;
      const { lastRunAt: _afterRun, ...after } = script;
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      return { ...script, updatedAt: changed ? Math.max(Date.now(), current.updatedAt + 1, script.updatedAt) : current.updatedAt, ...(current.lastRunAt ? { lastRunAt: Math.max(script.lastRunAt ?? 0, current.lastRunAt) } : {}) };
    });
  });
}

export function purgeWorkflow(id: string) {
  return mutateWorkspace(async state => {
    if (state.scripts.some(item => item.id === id)) throw new Error('请先将工作流移入回收站');
    if (!state.trash?.some(item => item.workflow.id === id)) throw new Error('回收站中未找到此工作流');
    await removeWorkflowKey(id);
    await mutateRunHistory(entries => entries.filter(entry => entry.workflowId !== id));
    await chrome.storage.local.remove([`pageAgentRunInputs:${id}`, `pageAgentDebug:${id}`]);
    const stored = await chrome.storage.local.get(EDITOR_DRAFT_KEY);
    if (isEditorDraft(stored[EDITOR_DRAFT_KEY]) && stored[EDITOR_DRAFT_KEY].editing?.id === id) await chrome.storage.local.set({ [EDITOR_DRAFT_KEY]: null });
    state.trash = state.trash.filter(item => item.workflow.id !== id);
  });
}
