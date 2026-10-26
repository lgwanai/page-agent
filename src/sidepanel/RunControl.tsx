import { useEffect, useState } from 'react';
import type { ExecutionStatus } from '@/background/execution-control';

export function RunControl({ notify, onStatus }: { notify: (message: string) => void; onStatus: (active: boolean) => void }) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_EXECUTION_STATUS' });
        if (live && response?.ok) { setStatus(response.result ?? null); onStatus(Boolean(response.result)); }
      } catch { /* The next poll reconnects after worker restart. */ }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 500);
    return () => { live = false; clearInterval(timer); };
  }, [onStatus]);
  if (!status) return null;
  return <aside className="run-control" role="status"><span>{status.stopping ? '正在停止：等待当前操作结束，不再执行后续步骤' : '工作流执行中'}<small>已完成的操作不会回滚</small></span><button className="secondary danger" disabled={status.stopping} onClick={async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_CANCEL_RUN', runId: status.runId });
      if (!response.ok) throw new Error('运行已结束，请刷新状态');
      setStatus(current => current?.runId === status.runId ? { ...current, stopping: true } : current);
    } catch (error) { notify((error as Error).message); }
  }}>{status.stopping ? '正在停止…' : '停止运行'}</button></aside>;
}
