import type { RunResult } from '@/types/workflow';
export const RUN_HISTORY_KEY = 'pageAgentRunHistoryV1';
export interface RunHistoryEntry {
  runId: string; workflowId?: string; name: string; startedAt: number; durationMs: number;
  status: 'success' | 'failed' | 'cancelled'; businessOk?: boolean;
  inputs: Array<{ name: string; type: string; size?: number }>;
  steps: Array<{ nodeId: string; ok: boolean; message: string }>;
  error?: string;
}
let queue: Promise<unknown> = Promise.resolve();
export function mutateRunHistory(change: (entries: RunHistoryEntry[]) => RunHistoryEntry[]): Promise<void> {
  const task = queue.then(async () => {
    const stored = await chrome.storage.local.get(RUN_HISTORY_KEY);
    const entries = Array.isArray(stored[RUN_HISTORY_KEY]) ? stored[RUN_HISTORY_KEY] as RunHistoryEntry[] : [];
    await chrome.storage.local.set({ [RUN_HISTORY_KEY]: change(entries) });
  });
  queue = task.catch(() => undefined); return task;
}
export async function loadRunHistory(): Promise<RunHistoryEntry[]> {
  await queue;
  const stored = await chrome.storage.local.get(RUN_HISTORY_KEY);
  return Array.isArray(stored[RUN_HISTORY_KEY]) ? stored[RUN_HISTORY_KEY] as RunHistoryEntry[] : [];
}
export function recordRun(result: RunResult, startedAt: number, variables: Record<string, unknown>, workflow?: { id: string; name: string }) {
  const entry: RunHistoryEntry = {
    runId: result.runId!, workflowId: workflow?.id, name: workflow?.name ?? '画布调试', startedAt, durationMs: Math.max(0, Date.now() - startedAt),
    status: result.cancelled ? 'cancelled' : result.ok ? 'success' : 'failed', businessOk: result.businessOk,
    // Values and page outputs are deliberately excluded from persistent history.
    inputs: Object.entries(variables).slice(0, 100).map(([name, value]) => ({ name: name.slice(0, 120), type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, ...(Array.isArray(value) ? { size: value.length } : {}) })),
    steps: result.steps.slice(-500).map(step => ({ nodeId: step.nodeId, ok: step.ok, message: step.message.slice(0, 300) })),
    error: result.error?.slice(0, 500),
  };
  return mutateRunHistory(entries => {
    const next = [entry, ...entries];
    const counts = new Map<string, number>();
    let bytes = 2;
    return next.filter(item => {
      const key = item.workflowId ?? '__draft__'; const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
      const size = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1;
      if (count > 20 || bytes + size > 2_000_000) return false;
      bytes += size; return true;
    }).slice(0, 200);
  });
}
