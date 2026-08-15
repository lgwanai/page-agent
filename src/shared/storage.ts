import type { WorkspaceState } from '@/types/workflow';

const STORAGE_KEY = 'pageAgentWorkspaceV1';

export const EMPTY_WORKSPACE: WorkspaceState = { actions: [], scripts: [], draft: [] };

export async function loadWorkspace(): Promise<WorkspaceState> {
  const value = await chrome.storage.local.get(STORAGE_KEY);
  const stored = value[STORAGE_KEY] as Partial<WorkspaceState> | undefined;
  return {
    actions: Array.isArray(stored?.actions) ? stored.actions : [],
    scripts: Array.isArray(stored?.scripts) ? stored.scripts : [],
    draft: Array.isArray(stored?.draft) ? stored.draft : [],
  };
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_STATE_CHANGED' }).catch(() => undefined);
}
