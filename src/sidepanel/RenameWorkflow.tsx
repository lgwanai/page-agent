import { useEffect, useRef, useState } from 'react';

export function RenameWorkflow({ name, onRename, onClose }: { name: string; onRename: (name: string) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <div className="settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form ref={panel} className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="rename-workflow-title" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const next = value.trim();
      if (!next || next.length > 120 || /[\r\n\u0000-\u001f]/.test(next)) return setError('请输入 1–120 个字符的有效名称');
      setBusy(true); setError('');
      try { await onRename(next); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
    }} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const fields = [...(panel.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)') ?? [])];
        const at = fields.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && at === 0 || !event.shiftKey && at === fields.length - 1) { event.preventDefault(); fields[event.shiftKey ? fields.length - 1 : 0]?.focus(); }
      }
    }}>
      <h2 id="rename-workflow-title">重命名工作流</h2>
      <label>工作流名称<input ref={input} aria-label="工作流名称" value={value} maxLength={120} disabled={busy} onChange={event => { setValue(event.target.value); setError(''); }} /></label>
      <small>只修改名称；工作流 ID、访问密钥、输入参数和节点配置保持不变。</small>
      {error && <p className="mcp-error" role="alert">{error}</p>}
      <div className="settings-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy || !value.trim()}>{busy ? '保存中…' : '确认重命名'}</button></div>
    </form>
  </div>;
}
