const WORKFLOW_KEYS_STORAGE = 'pageAgentWorkflowKeysV1';

type WorkflowKeys = Record<string, string>;

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function loadKeys(): Promise<WorkflowKeys> {
  const stored = await chrome.storage.local.get(WORKFLOW_KEYS_STORAGE);
  const value = stored[WORKFLOW_KEYS_STORAGE];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as WorkflowKeys : {};
}

async function saveKeys(keys: WorkflowKeys): Promise<void> {
  await chrome.storage.local.set({ [WORKFLOW_KEYS_STORAGE]: keys });
}

let queue: Promise<unknown> = Promise.resolve();
function mutateKeys<T>(change: (keys: WorkflowKeys) => T): Promise<T> {
  const task = queue.then(async () => { const keys = await loadKeys(); const result = change(keys); await saveKeys(keys); return result; });
  queue = task.catch(() => undefined); return task;
}
export function ensureWorkflowKey(workflowId: string): Promise<string> {
  return mutateKeys(keys => keys[workflowId] ||= randomKey());
}
export function ensureWorkflowKeys(workflowIds: string[]): Promise<void> {
  return mutateKeys(keys => { for (const id of workflowIds) keys[id] ||= randomKey(); });
}
export function rotateWorkflowKey(workflowId: string): Promise<string> {
  return mutateKeys(keys => keys[workflowId] = randomKey());
}
export function removeWorkflowKey(workflowId: string): Promise<void> {
  return mutateKeys(keys => { delete keys[workflowId]; });
}

export async function verifyWorkflowKey(workflowId: string, supplied: string): Promise<boolean> {
  if (!supplied) return false;
  await queue;
  const keys = await loadKeys();
  const expected = keys[workflowId];
  if (!expected || expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}
