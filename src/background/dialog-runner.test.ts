vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, expect, it, vi } from 'vitest';
import { debugNode, runGraph } from './runner';
import type { DialogNode, WorkflowNode } from '@/types/workflow';
const node: DialogNode = { id: 'dialog', name: '备注弹窗', kind: 'dialog', target: { name: '触发', selector: '.trigger', tagName: 'button', frameId: 0, label: '' }, event: { type: 'click' }, dialogType: 'prompt', action: 'accept', message: '{{expected}}', promptText: '{{memo}}', timeoutMs: 100 };
function setup(type = 'prompt', message = '输入备注', open = true, interrupt = false) {
  const listeners = new Set<(source: { tabId: number }, method: string, params: object) => void>();
  const emit = (method: string, params: object) => listeners.forEach(fn => fn({ tabId: 1 }, method, params));
  const send = vi.fn(async (_tab, msg) => {
    if (msg.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (msg.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: 1 };
    if (msg.type === 'PAGE_AGENT_EXECUTE_EVENT' && open) emit('Page.javascriptDialogOpening', { type, message, defaultPrompt: '默认' });
    if (msg.type === 'PAGE_AGENT_EXECUTE_EVENT' && interrupt) throw new Error('The message port closed before a response was received');
    return { ok: true, data: 'clicked' };
  });
  const command = vi.fn(async (_source, method, params) => { if (method === 'Page.handleJavaScriptDialog') emit('Page.javascriptDialogClosed', { result: params.accept, userInput: params.promptText ?? '' }); });
  const detach = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com', documentId: 'doc' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } }, debugger: { attach: vi.fn().mockResolvedValue(undefined), detach, sendCommand: command, onEvent: { addListener: (fn: typeof listeners extends Set<infer V> ? V : never) => listeners.add(fn), removeListener: (fn: typeof listeners extends Set<infer V> ? V : never) => listeners.delete(fn) } } });
  return { send, command, detach };
}
afterEach(() => { vi.unstubAllGlobals(); });
it('interpolates expected message and prompt input and exposes a verified dialog result to Output', async () => {
  const h = setup(); const output: WorkflowNode = { id: 'out', name: '结果', kind: 'output', source: 'node', sourceNodeId: node.id, path: 'promptText' };
  const result = await runGraph([node, output], [{ id: 'e', sourceNodeId: node.id, sourcePort: 'success', targetNodeId: 'out' }], { memo: '中文内容', expected: '输入备注' });
  expect(result).toMatchObject({ ok: true, output: '中文内容', steps: [{ ok: true, data: { type: 'prompt', accepted: true, promptText: '中文内容', trigger: 'clicked' }, verification: { ok: true } }, { ok: true }] });
  expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(1); expect(h.detach).toHaveBeenCalledTimes(2);
});
it('treats cancelling a confirm as success and supports single node debugging', async () => {
  setup('confirm', '取消测试');
  const result = await debugNode([{ ...node, dialogType: 'confirm', action: 'dismiss', message: '' }], node.id, {});
  expect(result).toMatchObject({ ok: true, steps: [{ ok: true, outputPort: 'success', data: { type: 'confirm', accepted: false } }] });
});
it('routes a missing dialog to the failure edge without dispatching another trigger', async () => {
  const h = setup('prompt', '', false); const recover: WorkflowNode = { id: 'recover', name: '失败恢复', kind: 'output', source: 'text', value: '未出现弹窗' };
  const result = await runGraph([{ ...node, message: '' }, recover], [{ id: 'f', sourceNodeId: node.id, sourcePort: 'failure', targetNodeId: 'recover' }]);
  expect(result).toMatchObject({ ok: true, output: '未出现弹窗', steps: [{ ok: false, outputPort: 'failure' }, { ok: true }] });
  expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(1);
});
it('rejects invalid config before any trigger', async () => {
  const h = setup(); const result = await runGraph([{ ...node, timeoutMs: NaN }], []);
  expect(result.ok).toBe(false); expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(0);
});

it('accepts a navigation-interrupted trigger only with a verified accepted beforeunload', async () => {
  const h = setup('beforeunload', '离开', true, true);
  const result = await runGraph([{ ...node, dialogType: 'beforeunload', message: '' }], []);
  expect(result).toMatchObject({ ok: true, steps: [{ ok: true, data: { type: 'beforeunload', accepted: true, trigger: { navigationRequested: true, responseInterrupted: true } }, verification: { ok: true } }] });
  expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(1);
});
it('does not infer a successful beforeunload when the port closes without a native receipt', async () => {
  setup('beforeunload', '', false, true);
  expect((await runGraph([{ ...node, dialogType: 'beforeunload', message: '' }], [])).ok).toBe(false);
});
it('never clicks a trigger whose read-only locator finishes after the dialog timeout', async () => {
  const h = setup('confirm', '', false);
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise(resolve => { release = resolve; });
  h.send.mockImplementation(async (_tab, msg) => {
    if (msg.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (msg.type === 'PAGE_AGENT_LOCATE_SELECTOR') return await pending as { ok: boolean; count: number };
    return { ok: true, data: 'clicked' };
  });
  const result = await runGraph([{ ...node, dialogType: 'confirm', message: '' }], []);
  expect(result.ok).toBe(false);
  release({ ok: true, count: 1 });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(0);
});

it('does not silently broaden a message match when its variable is missing', async () => {
  const h = setup();
  const result = await runGraph([node], []);
  expect(result.ok).toBe(false); expect(result.error).toContain('变量不存在');
  expect(h.send.mock.calls.filter(c => c[1].type === 'PAGE_AGENT_EXECUTE_EVENT')).toHaveLength(0);
});
