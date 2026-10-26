import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCopy, faDownload, faEllipsisVertical, faKey, faPen, faPlay, faICursor, faTrash, faTags } from '@fortawesome/free-solid-svg-icons';
import type { ScriptDefinition } from '@/types/workflow';

interface Props {
  workflow: ScriptDefinition;
  busy: boolean;
  running: boolean;
  onRun: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onTags: () => void;
  onCopyId: () => void;
  onCopyPrompt: () => void;
  onCopyKey: () => void;
  onExport: () => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function WorkflowRow({ workflow, busy, running, onRun, onEdit, onRename, onDelete, onDuplicate, onTags, onCopyId, onCopyPrompt, onCopyKey, onExport, open, onToggle, onClose }: Props) {
  const controls = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [upward, setUpward] = useState(false);
  useEffect(() => {
    if (!open) return;
    setUpward((controls.current?.getBoundingClientRect().bottom ?? 0) + 350 > window.innerHeight);
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!controls.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, onClose]);
  const items = [
    { label: '编辑', icon: faPen, action: onEdit, disabled: busy },
    { label: '复制为新工作流', icon: faCopy, action: onDuplicate, disabled: busy },
    { label: '设置标签', icon: faTags, action: onTags, disabled: busy },
    { label: '重命名', icon: faICursor, action: onRename, disabled: busy },
    { label: '复制运行 Prompt', icon: faCopy, action: onCopyPrompt, title: '包含插件实例 ID、工作流 ID 和密钥，请仅交给可信工具' },
    { label: '复制密钥', icon: faKey, action: onCopyKey },
    { label: '导出', icon: faDownload, action: onExport },
    { label: '删除工作流', icon: faTrash, action: onDelete, disabled: busy },
  ];
  return <article className="script-card">
    <div className="workflow-card-main">
      <button className="workflow-name" disabled={busy} onClick={onEdit} title={workflow.name}>{workflow.name}</button>
      {!!workflow.tags?.length && <div className="workflow-tags">{workflow.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
      <div className="workflow-meta">
        <span>{workflow.description || `${workflow.nodes.length} 个节点 · ${workflow.edges.length} 条连线`}</span>
        <div className="workflow-id"><code title={workflow.id}>ID · {workflow.id.length > 20 ? `${workflow.id.slice(0, 8)}…${workflow.id.slice(-4)}` : workflow.id}</code><button className="workflow-icon copy-id" aria-label={`复制工作流 ID · ${workflow.name}`} title={`复制完整工作流 ID：${workflow.id}`} onClick={onCopyId}><FontAwesomeIcon icon={faCopy} /></button></div>
      </div>
    </div>
    <div className="workflow-card-actions" ref={controls}>
      <button className="primary compact" disabled={busy} onClick={onRun}><FontAwesomeIcon icon={faPlay} />{running ? '执行中…' : '运行'}</button>
      <button ref={trigger} className="workflow-icon more" aria-label={`更多操作 · ${workflow.name}`} aria-haspopup="menu" aria-expanded={open} onClick={onToggle} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); onToggle(); } }}><FontAwesomeIcon icon={faEllipsisVertical} /></button>
      {open && <div className={`workflow-menu${upward ? ' upward' : ''}`} role="menu" aria-label={`${workflow.name}的操作`} ref={menu} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); trigger.current?.focus(); return; }
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
        if (event.key === 'Tab') onClose();
      }}>{items.map((item) => <button key={item.label} className={item.label === '删除工作流' ? 'danger' : undefined} role="menuitem" disabled={item.disabled} title={item.title} onClick={() => { onClose(); trigger.current?.focus(); item.action(); }}><FontAwesomeIcon icon={item.icon} /><span>{item.label}</span></button>)}</div>}
    </div>
  </article>;
}
