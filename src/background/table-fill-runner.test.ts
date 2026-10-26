vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import type { WorkflowNode } from '@/types/workflow';
afterEach(() => { vi.unstubAllGlobals(); });
it('passes a real array to the selected iframe and exposes the named report', async () => {
  const data = [{ SKU: '001', 仓库: '上海', 数量: 0 }];
  const send = vi.fn(async (_tab, message) => message.type === 'PAGE_AGENT_PING' ? { ok: true, frameLocator: true } : message.type === 'PAGE_AGENT_LOCATE_SELECTOR' ? { ok: true, count: 1 } : message.type === 'PAGE_AGENT_FILL_TABLE' ? { ok: true, data: { type: 'tableFill', matchedRows: 1, filledCells: 1, skippedCells: 0, unmatchedRows: 0 } } : { ok: true });
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  const structure = { headerSelector: '.head > span', rowSelector: '.body > li', cellSelector: ':scope > .cell' };
  const node: WorkflowNode = { id: 'fill', kind: 'tableFill', name: '填充表格', target: { name: '表格', selector: '#t', frameId: 0, tagName: 'div', label: '' }, data: '{{data}}', keyColumns: ['SKU', '仓库'], skipUnmatchedRows: false, structure };
  const result = await runGraph([node], [], { data });
  expect(result.ok).toBe(true);
  expect(send.mock.calls.find(([, message]) => message.type === 'PAGE_AGENT_FILL_TABLE')?.[1]).toMatchObject({ data, keyColumns: ['SKU', '仓库'], structure });
  expect(result.steps[0].data).toMatchObject({ filledCells: 1 });
});
