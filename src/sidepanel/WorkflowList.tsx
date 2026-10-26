import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceState, ScriptDefinition, RunResult } from '@/types/workflow';
import { WorkflowRow } from './WorkflowRow';
import { RunReport } from './RunReport';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faUpload } from '@fortawesome/free-solid-svg-icons';
interface WorkflowListProps {
  state: WorkspaceState;
  onRun: (workflow: ScriptDefinition) => void;
  onCreate: () => void;
  onEdit: (workflow: ScriptDefinition) => void;
  onRename: (workflow: ScriptDefinition) => void;
  onDelete: (workflow: ScriptDefinition) => void;
  onDuplicate: (workflow: ScriptDefinition) => void;
  onTags: (workflow: ScriptDefinition) => void;
  onImport: () => void;
  onExport: (workflow: ScriptDefinition) => void;
  onCopyId: (workflow: ScriptDefinition) => void;
  onCopyKey: (workflow: ScriptDefinition) => void;
  onCopyPrompt: (workflow: ScriptDefinition) => void;
  running: string | null;
  busy: boolean;
  lastRun: RunResult | null;
}

export function WorkflowList({ state, onRun, onCreate, onEdit, onRename, onDelete, onDuplicate, onTags, onImport, onExport, onCopyId, onCopyKey, onCopyPrompt, running, busy, lastRun }: WorkflowListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const closeMenu = useCallback(() => setOpenId(null), []);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('updated');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void chrome.storage.local.get('pageAgentListPreferencesV1').then(stored => {
      const value = stored.pageAgentListPreferencesV1;
      if (value && ['updated', 'used', 'name'].includes(value.sort)) setSort(value.sort);
    }).catch(() => undefined).finally(() => setLoaded(true));
  }, []);
  useEffect(() => { if (loaded) void chrome.storage.local.set({ pageAgentListPreferencesV1: { sort } }).catch(() => undefined); }, [loaded, sort]);
  const tags = [...new Set(state.scripts.flatMap(workflow => workflow.tags ?? []))].sort();
  const visible = state.scripts.filter(workflow => `${workflow.name} ${workflow.description ?? ''} ${workflow.id} ${(workflow.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (!tag || workflow.tags?.includes(tag))).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'used' ? (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0) || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt);
  return <section className="run-view">
    <div className="section-title workflow-title"><div><h2>工作流</h2><p>录制、编辑并安全地交给 MCP 调用</p></div><span>{state.scripts.length} 个</span></div>
    <div className="workflow-actions"><button className="primary" disabled={busy} onClick={onCreate}><FontAwesomeIcon icon={faPlus} />创建工作流</button><button className="secondary" disabled={busy} onClick={onImport}><FontAwesomeIcon icon={faUpload} />导入 JSON</button></div>
    {state.scripts.length > 0 && <div className="library-filters"><input type="search" aria-label="搜索工作流" placeholder="搜索名称、描述、标签或 ID" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="工作流排序" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近修改</option><option value="used">最近使用</option><option value="name">名称</option></select><select aria-label="工作流标签" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(item => <option key={item} value={item}>{item}</option>)}</select></div>}
    {state.scripts.length > 0 && !visible.length && <p role="status">没有匹配的工作流</p>}
    {!state.scripts.length && <div className="empty"><div className="empty-icon">▷</div><strong>还没有工作流</strong><p>点击“创建工作流”，选择录制网页操作或手动画布编辑。</p></div>}
    <div className="script-list">{visible.map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} busy={busy} running={running === workflow.id} onRun={() => onRun(workflow)} onEdit={() => onEdit(workflow)} onRename={() => onRename(workflow)} onDelete={() => onDelete(workflow)} onDuplicate={() => onDuplicate(workflow)} onTags={() => onTags(workflow)} onCopyId={() => onCopyId(workflow)} onCopyPrompt={() => onCopyPrompt(workflow)} onCopyKey={() => onCopyKey(workflow)} onExport={() => onExport(workflow)} open={openId === workflow.id} onToggle={() => setOpenId((current) => current === workflow.id ? null : workflow.id)} onClose={closeMenu} />)}</div>
    {lastRun && <RunReport result={lastRun} />}
  </section>;
}

