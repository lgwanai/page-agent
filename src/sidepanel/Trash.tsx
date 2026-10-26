import { useEffect, useState } from 'react';
import type { WorkspaceState } from '@/types/workflow';
import type { RuntimeResponse } from '@/types/messages';
export function Trash({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [entries, setEntries] = useState<NonNullable<WorkspaceState['trash']>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_GET_STATE' }) as RuntimeResponse;
    if (!response.ok || !response.state) throw new Error(response.error ?? '读取回收站失败');
    setEntries(response.state.trash ?? []);
  };
  useEffect(() => { void refresh().catch(error => setError(error.message)); }, []);
  const change = async (workflowId: string, permanent: boolean) => {
    const entry = entries.find(item => item.workflow.id === workflowId);
    if (permanent && !window.confirm(`彻底删除「${entry?.workflow.name}」及其密钥、手动参数历史和运行历史？此操作无法恢复。`)) return;
    setBusy(true); setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: permanent ? 'PAGE_AGENT_PURGE_WORKFLOW' : 'PAGE_AGENT_RESTORE_WORKFLOW', workflowId });
      if (!response.ok) throw new Error(response.error ?? '操作失败');
      await refresh(); onChanged();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="settings-overlay"><section className="settings-panel" role="dialog" aria-modal="true" aria-label="回收站"><h2>回收站</h2><p>移入回收站后暂停调用；恢复时保留原 ID 和密钥。彻底删除后无法恢复。</p>{error && <p role="alert">{error}</p>}{!entries.length && <p>回收站为空</p>}{entries.map(entry => <article className="trash-entry" key={entry.workflow.id}><strong>{entry.workflow.name}</strong><small>{new Date(entry.deletedAt).toLocaleString()}</small><div><button className="secondary" disabled={busy} onClick={() => void change(entry.workflow.id, false)}>恢复</button><button className="secondary danger" disabled={busy} onClick={() => void change(entry.workflow.id, true)}>彻底删除</button></div></article>)}<button className="secondary" disabled={busy} onClick={onClose}>关闭回收站</button></section></div>;
}
