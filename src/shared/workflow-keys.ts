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

export async function ensureWorkflowKey(workflowId: string): Promise<string> {
  const keys = await loadKeys();
  if (keys[workflowId]) return keys[workflowId];
  const key = randomKey();
  await saveKeys({ ...keys, [workflowId]: key });
  return key;
}

export async function ensureWorkflowKeys(workflowIds: string[]): Promise<void> {
  const keys = await loadKeys();
  let changed = false;
  for (const id of workflowIds) {
    if (!keys[id]) { keys[id] = randomKey(); changed = true; }
  }
  if (changed) await saveKeys(keys);
}

export async function rotateWorkflowKey(workflowId: string): Promise<string> {
  const keys = await loadKeys();
  const key = randomKey();
  await saveKeys({ ...keys, [workflowId]: key });
  return key;
}

export async function verifyWorkflowKey(workflowId: string, supplied: string): Promise<boolean> {
  if (!supplied) return false;
  const keys = await loadKeys();
  const expected = keys[workflowId];
  if (!expected || expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
}
