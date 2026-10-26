// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeInspector } from './NodeInspector';
import type { OutputNode } from '@/types/workflow';
it('edits Output sources, business status and DOM picking through controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const changed = vi.fn(), pick = vi.fn();
  const initial: OutputNode = { id: 'out', name: '返回', kind: 'output', source: 'text', value: '未成功', outcome: 'failure' };
  function Harness() {
    const [node, setNode] = useState(initial);
    return <NodeInspector node={node} nodes={[node]} actions={[]} onChange={next => { changed(next); setNode(next as OutputNode); }} onDelete={() => {}} onRun={() => {}} onClose={() => {}} onPickAiSelector={() => {}} onPickQueryScope={pick} lastRun={null} notify={() => {}} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(host.querySelector('textarea')!.value).toBe('未成功');
    const source = host.querySelector('select')!;
    await act(async () => { source.value = 'dom'; source.dispatchEvent(new Event('change', { bubbles: true })); });
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('选择输出 DOM'))!;
    await act(async () => button.click()); expect(pick).toHaveBeenCalledOnce();
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ source: 'dom', read: 'text', outcome: 'failure', target: { frameId: 0 } });
    expect(host.textContent).toContain('businessOk');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
