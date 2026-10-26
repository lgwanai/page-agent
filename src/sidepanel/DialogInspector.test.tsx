// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeInspector } from './NodeInspector';
import type { WorkflowNode } from '@/types/workflow';
it('converts an existing click without losing its locator and configures native prompt cancellation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const target = { name: '提交', selector: '#submit', frameId: 9, frameUrl: 'https://example.com/frame', tagName: 'button', label: '提交', locator: { version: 1 as const, selector: '#submit', tagName: 'button', confidence: 'high' as const, candidates: [{ kind: 'id' as const, selector: '#submit' }] } };
  const initial: WorkflowNode = { id: 'click', kind: 'dom', name: '提交操作', target, event: { type: 'click' } };
  const changed = vi.fn(), pick = vi.fn();
  function Harness() {
    const [node, setNode] = useState(initial);
    return <NodeInspector node={node} nodes={[node]} actions={[]} onChange={next => { changed(next); setNode(next); }} onDelete={() => {}} onRun={() => {}} onClose={() => {}} onPickAiSelector={() => {}} onPickQueryScope={pick} lastRun={null} notify={() => {}} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '转为浏览器弹窗节点')!.click());
    expect(changed.mock.calls.at(-1)![0]).toMatchObject({ ...initial, kind: 'dialog', dialogType: 'confirm', action: 'accept', target });
    const select = (label: string) => [...container.querySelectorAll('label')].find(el => el.textContent?.startsWith(label))!.querySelector('select')!;
    await act(async () => { const el = select('弹窗类型'); el.value = 'prompt'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(container.textContent).toContain('弹窗输入内容');
    await act(async () => { const el = select('应答方式'); el.value = 'dismiss'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(changed.mock.calls.at(-1)![0]).toMatchObject({ kind: 'dialog', dialogType: 'prompt', action: 'dismiss', target });
    expect(container.textContent).not.toContain('弹窗输入内容');
    await act(async () => { const el = select('弹窗类型'); el.value = 'alert'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(changed.mock.calls.at(-1)![0]).toMatchObject({ dialogType: 'alert', action: 'accept' });
    expect(select('应答方式').options.length).toBe(1);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent?.includes('选择触发弹窗的控件'))!.click());
    expect(pick).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
