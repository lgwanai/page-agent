import { useEffect, useState } from 'react';
import { loadRunHistory, type RunHistoryEntry } from '@/shared/run-history';
export function RunHistory({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void loadRunHistory().then(setEntries).catch(() => setError('读取运行历史失败')); }, []);
  const workflows = [...new Map(entries.map(entry => [entry.workflowId ?? '__draft__', entry.name])).entries()];
  return <div className="settings-overlay"><section className="settings-panel" role="dialog" aria-modal="true" aria-label="运行历史"><h2>运行历史</h2><p>每个工作流保留最近 20 次，总计最多 200 次，并限制摘要存储在 2 MB 内。记录参数名称和类型，不直接保存参数值、网页输出或文件；步骤及错误摘要仍可能包含页面文字。</p><label>工作流<select aria-label="筛选运行历史" value={filter} onChange={event => setFilter(event.target.value)}><option value="">全部工作流</option>{workflows.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>{error && <p role="alert">{error}</p>}{!entries.length && <p>暂无运行记录</p>}
    {entries.filter(entry => !filter || (entry.workflowId ?? '__draft__') === filter).map(entry => <details key={entry.runId} className="history-entry"><summary>{entry.name} · {{ success: '成功', failed: '失败', cancelled: '已停止' }[entry.status]} · {(entry.durationMs / 1000).toFixed(1)} 秒<small>{new Date(entry.startedAt).toLocaleString()}</small></summary>{entry.businessOk !== undefined && <p>业务结果：{entry.businessOk ? '成功' : '未成功'}</p>}<p>参数：{entry.inputs.map(input => `${input.name}（${input.type}${input.size !== undefined ? `，${input.size} 项` : ''}）`).join('、') || '无'}</p>{entry.error && <p className="danger">{entry.error}</p>}<ol>{entry.steps.map((step, index) => <li key={index}>{step.ok ? '✓' : '!'} {step.message} <small>{step.nodeId}</small></li>)}</ol><small>运行 ID：{entry.runId}</small></details>)}
    <button className="secondary" onClick={onClose}>关闭运行历史</button></section></div>;
}
