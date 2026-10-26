import type { CanvasViewCommand } from './canvas-layout';
import { useEffect, useRef, useState } from 'react';
import { NODE_KIND_LABELS, NODE_KIND_ENGLISH } from '@/types/workflow';
export const NODE_CHOICES = [
  ['dom', '⌖'], ['query', '⌕'], ['output', '↗'], ['dialog', '▢'], ['watch', '◉'],
  ['request', '⇢'], ['tableFill', '▤'], ['datatable', '▤'], ['screenshot', '▣'], ['email', '✉'],
  ['calendar', '▦'], ['pagination', '⇄'], ['ai', '✦'], ['loop', '↻'], ['wait', '◷'],
] as const;
export type CreatableNodeKind = typeof NODE_CHOICES[number][0];
export function NodeChoices({ onChoose }: { onChoose: (kind: CreatableNodeKind) => void }) {
  return <div className="node-picker-grid">{NODE_CHOICES.map(([kind, icon]) => <button type="button" key={kind} aria-label={NODE_KIND_LABELS[kind]} onClick={() => onChoose(kind)}><i aria-hidden="true">{icon}</i><span><strong>{NODE_KIND_LABELS[kind]}</strong><small lang="en">{NODE_KIND_ENGLISH[kind]}</small></span></button>)}</div>;
}
export function CanvasToolbar({ onAdd, onArrange, busy, arranging, onView, zoom }: { onView: (command: CanvasViewCommand) => void; zoom: number; onAdd: (kind: CreatableNodeKind) => void; onArrange: () => void; busy: boolean; arranging: boolean }) {
  const [open, setOpen] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!toolbar.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); addButton.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (busy) setOpen(false); }, [busy]);
  return <div className="canvas-floating-tools" ref={toolbar}>
    <div className="canvas-floating-toolbar" role="toolbar" aria-label="画布工具">
      <button type="button" ref={addButton} title="新增节点" aria-label="新增节点" aria-expanded={open} aria-controls="canvas-node-palette" disabled={busy} onClick={() => setOpen(value => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h7v7h-7z" /></svg></button>
      <button type="button" title="自动整理画布（可撤销）" aria-label="自动整理画布" disabled={busy} onClick={onArrange}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="5" height="6" rx="1"/><rect x="16" y="3" width="5" height="6" rx="1"/><rect x="16" y="15" width="5" height="6" rx="1"/><path d="M8 12h4V6h4M12 12v6h4"/></svg></button>
      <span className="canvas-tools-divider" aria-hidden="true" />
      <button type="button" title="放大画布" aria-label="放大画布" disabled={arranging} onClick={() => onView('zoomIn')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <button type="button" title="缩小画布" aria-label="缩小画布" disabled={arranging} onClick={() => onView('zoomOut')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
      <button type="button" className="canvas-zoom-percent" title="重置为 100%" aria-label="重置画布缩放为100%" disabled={arranging} onClick={() => onView('resetZoom')}>{zoom}%</button>
      <button type="button" title="适应全部节点" aria-label="适应全部节点" disabled={arranging} onClick={() => onView('fitView')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/></svg></button>
    </div>
    {open && <section className="node-picker canvas-node-palette" id="canvas-node-palette" aria-label="新增节点类型"><div><strong>新增节点</strong><button type="button" className="icon-btn" aria-label="关闭节点菜单" onClick={() => { setOpen(false); addButton.current?.focus(); }}>×</button></div><NodeChoices onChoose={kind => { setOpen(false); onAdd(kind); }} /></section>}
    {arranging && <span className="layout-status" role="status">正在整理…</span>}
  </div>;
}
