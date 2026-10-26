export interface ExecutionStatus { runId: string; stopping: boolean; startedAt: number }
let active: (ExecutionStatus & { controller: AbortController }) | null = null;
export class RunCancelled extends Error {
  constructor() { super('运行已停止；已完成的网页操作不会回滚'); }
}
export function executionStatus(): ExecutionStatus | null {
  return active ? { runId: active.runId, stopping: active.stopping, startedAt: active.startedAt } : null;
}
export function beginExecution(): string {
  if (active) throw new Error('当前插件实例正在执行工作流，请等待完成后再操作');
  active = { runId: crypto.randomUUID(), stopping: false, startedAt: Date.now(), controller: new AbortController() };
  return active.runId;
}
export function finishExecution() { active = null; }
export function cancelExecution(runId: string): boolean {
  if (!active || active.runId !== runId) return false;
  active.stopping = true; active.controller.abort(); return true;
}
export function checkCancellation() { if (active?.stopping) throw new RunCancelled(); }
export function executionSignal() { return active?.controller.signal; }
export function pauseExecution(ms: number): Promise<void> {
  checkCancellation();
  const signal = executionSignal();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new RunCancelled()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
