vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, expect, it, vi } from 'vitest';
import { WorkflowTabs } from './workflow-tabs';
import { runGraph } from './runner';
import type { DomNode, PageTarget } from '@/types/workflow';

const oldUrl = 'https://seller.example/old/activity_detail.htm?activityId=5911';
const newUrl = 'https://seller.example/new/activity_detail.htm?activityId=5911';
const target: PageTarget = { name: '再次报名', selector: '#old > button.tbd-btn', frameId: 0, frameUrl: oldUrl, tagName: 'button', label: '再次报名', text: '再次报名', attributes: { type: 'button' } };
const eventApi = () => {
  const listeners = new Set<(...args: any[]) => void>();
  return { addListener: vi.fn(fn => listeners.add(fn)), removeListener: vi.fn(fn => listeners.delete(fn)), emit: (...args: any[]) => listeners.forEach(fn => fn(...args)), listeners };
};
function setup() {
  const opened = eventApi(), created = eventApi(), updated = eventApi(), history = eventApi();
  const get = vi.fn(async (id: number) => ({ id, url: id === 2 ? newUrl : 'https://seller.example/list', status: 'complete' }));
  const sendMessage = vi.fn(async (_id: number, message: any) => {
    if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: 1 };
    if (message.selector === '#open') { opened.emit({ sourceTabId: 1, tabId: 2, url: oldUrl }); updated.emit(2, { url: newUrl }); }
    return { ok: true, data: 'clicked' };
  });
  vi.stubGlobal('chrome', {
    tabs: { get, sendMessage, query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://seller.example/list' }]), onCreated: created, onUpdated: updated },
    webNavigation: { onCreatedNavigationTarget: opened, onHistoryStateUpdated: history, onCommitted: eventApi(), getAllFrames: vi.fn(async ({ tabId }) => [{ frameId: 0, url: (await get(tabId)).url }]) },
    storage: { local: { get: vi.fn().mockResolvedValue({}) } },
  });
  return { opened, created, updated, history, get, sendMessage };
}
afterEach(() => { vi.unstubAllGlobals(); });
it('follows an observed child tab through its redirect without choosing any pre-existing/active tab', async () => {
  const { opened, created, get } = setup(); const tabs = new WorkflowTabs(1);
  try {
    created.emit({ id: 9, openerTabId: 99, url: oldUrl });
    opened.emit({ sourceTabId: 1, tabId: 8, url: oldUrl }); // outside an operation: ignore
    await tabs.during(async () => { opened.emit({ sourceTabId: 1, tabId: 2, url: oldUrl }); });
    expect(await tabs.resolve(target)).toEqual({ tabId: 2, frameUrl: newUrl });
    expect(await tabs.resolve()).toEqual({ tabId: 2, frameUrl: undefined });
    expect(get).not.toHaveBeenCalledWith(8); expect(get).not.toHaveBeenCalledWith(9);
  } finally { tabs.dispose(); }
  expect(opened.listeners.size).toBe(0); expect(created.listeners.size).toBe(0);
});
it('waits for a child SPA destination and ignores only the explicitly unguarded processId', async () => {
  vi.useFakeTimers();
  const { opened, get } = setup(); const tabs = new WorkflowTabs(1);
  const expected = 'https://seller.example/apply?activityId=5911&puCode=base&processId=old';
  try {
    await tabs.during(async () => opened.emit({ sourceTabId: 1, tabId: 2, url: 'https://seller.example/apply?activityId=5911' }));
    get.mockResolvedValueOnce({ id: 2, url: 'https://seller.example/apply?activityId=5911', status: 'loading' })
      .mockResolvedValue({ id: 2, url: expected.replace('processId=old', 'processId=fresh'), status: 'complete' });
    const pending = tabs.resolve({ ...target, frameUrl: expected, frameQueryKeys: ['activityId', 'puCode'] });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ tabId: 2, frameUrl: expected.replace('processId=old', 'processId=fresh') });
  } finally { tabs.dispose(); vi.useRealTimers(); }
});
it('does not route an iframe URL to another top-level tab', async () => {
  const { opened } = setup(); const tabs = new WorkflowTabs(1);
  try {
    await tabs.during(async () => opened.emit({ sourceTabId: 1, tabId: 2, url: oldUrl }));
    expect(await tabs.resolve({ ...target, frameId: 47 })).toEqual({ tabId: 1, frameUrl: oldUrl });
  } finally { tabs.dispose(); }
});
it('fails safely if this operation opens two matching tabs', async () => {
  const { opened } = setup(); const tabs = new WorkflowTabs(1);
  try {
    await tabs.during(async () => { opened.emit({ sourceTabId: 1, tabId: 2, url: oldUrl }); opened.emit({ sourceTabId: 1, tabId: 3, url: oldUrl }); });
    await expect(tabs.resolve(target)).rejects.toThrow('多个');
  } finally { tabs.dispose(); }
});
it('does not silently follow a different activity or another origin after opening the target', async () => {
  const { opened, get } = setup(); const tabs = new WorkflowTabs(1);
  try {
    await tabs.during(async () => opened.emit({ sourceTabId: 1, tabId: 2, url: oldUrl }));
    for (const url of ['https://seller.example/new/activity_detail.htm?activityId=9999', 'https://other.example/activity_detail.htm?activityId=5911']) {
      get.mockResolvedValueOnce({ id: 2, url, status: 'complete' });
      await expect(tabs.resolve(target)).rejects.toThrow('未发送操作');
    }
  } finally { tabs.dispose(); }
});
it('runs the next node in the newly opened redirected document exactly once and preserves saved selectors', async () => {
  const { sendMessage, opened } = setup();
  const first: DomNode = { id: 'open', kind: 'dom', name: '去报名', target: { ...target, selector: '#open', frameUrl: 'https://seller.example/list' }, event: { type: 'click' } };
  const last: DomNode = { id: 'last', kind: 'dom', name: '再次报名', target, event: { type: 'click' } };
  const result = await runGraph([first, last], [{ id: 'edge', sourceNodeId: 'open', targetNodeId: 'last', sourcePort: 'success' }]);
  expect(result.ok).toBe(true); expect(result.runId).toMatch(/^[\da-f-]{36}$/);
  const actions = sendMessage.mock.calls.filter(([, message]) => message.type === 'PAGE_AGENT_EXECUTE_EVENT');
  expect(actions.map(([tabId]) => tabId)).toEqual([1, 2]);
  expect(last.target.frameUrl).toBe(oldUrl);
  expect(opened.listeners.size).toBe(0);
});
