// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeInspector } from './NodeInspector';
import type { TableFillNode } from '@/types/workflow';

it('edits the three optional relative selectors without losing data, keys or the selected scope', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const changed = vi.fn(), pick = vi.fn();
  const initial: TableFillNode = { id: 'fill', kind: 'tableFill', name: '填充', target: { name: '表格', selector: '#grid', frameId: 0, tagName: 'div', label: '' }, keyColumns: ['SKU', '仓库'], data: '{{data}}', skipUnmatchedRows: false };
  function Harness() {
    const [node, setNode] = useState(initial);
    return <NodeInspector node={node} nodes={[node]} actions={[]} onChange={next => { changed(next); setNode(next as TableFillNode); }} onDelete={() => {}} onRun={() => {}} onClose={() => {}} onPickAiSelector={() => {}} onPickQueryScope={pick} lastRun={null} notify={() => {}} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain('ul/li');
    container.querySelector('details')!.open = true;
    const selectors = [
      ['例如 .header .cell 或 thead th', 'thead th'],
      ['例如 .body > li 或 .body > .row', '.body > li'],
      ['例如 :scope > .cell', ':scope > span'],
    ];
    for (const [placeholder, value] of selectors) {
      const input = [...container.querySelectorAll('input')].find(el => el.placeholder === placeholder)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ ...initial, structure: { headerSelector: 'thead th', rowSelector: '.body > li', cellSelector: ':scope > span' } });
    const button = [...container.querySelectorAll('button')].find(el => el.textContent?.includes('在网页选择可编辑表格'))!;
    await act(async () => button.click());
    expect(pick).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
