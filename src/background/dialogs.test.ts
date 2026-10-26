import { afterEach, expect, it, vi } from 'vitest';
import { withAlertConfirmation } from './dialogs';
afterEach(() => { vi.unstubAllGlobals(); });
it('accepts only alerts in the workflow tab and detaches after completion', async () => {
  let listener: (source: { tabId: number }, method: string, params: object) => void = () => undefined;
  const api = { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn().mockResolvedValue(undefined), onEvent: { addListener: vi.fn(fn => { listener = fn; }), removeListener: vi.fn() } };
  vi.stubGlobal('chrome', { debugger: api });
  await withAlertConfirmation(3, async () => {
    listener({ tabId: 3 }, 'Page.javascriptDialogOpening', { type: 'alert' });
    for (const type of ['confirm', 'prompt', 'beforeunload']) listener({ tabId: 3 }, 'Page.javascriptDialogOpening', { type });
    listener({ tabId: 4 }, 'Page.javascriptDialogOpening', { type: 'alert' });
  });
  expect(api.sendCommand.mock.calls.filter(call => call[1] === 'Page.handleJavaScriptDialog')).toEqual([[{ tabId: 3 }, 'Page.handleJavaScriptDialog', { accept: true }]]);
  expect(api.detach).toHaveBeenCalledWith({ tabId: 3 });
  expect(api.onEvent.removeListener).toHaveBeenCalledWith(listener);
});
it('does not detach another debugger when attach is refused', async () => {
  const detach = vi.fn(); const removeListener = vi.fn();
  vi.stubGlobal('chrome', { debugger: { attach: vi.fn().mockRejectedValue(new Error('Another debugger is attached')), detach, onEvent: { addListener: vi.fn(), removeListener } } });
  await expect(withAlertConfirmation(1, vi.fn())).rejects.toThrow('无法启用 alert');
  expect(detach).not.toHaveBeenCalled(); expect(removeListener).toHaveBeenCalledOnce();
});
it('releases its debugger when execution fails', async () => {
  const detach = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { debugger: { attach: vi.fn().mockResolvedValue(undefined), detach, sendCommand: vi.fn().mockResolvedValue(undefined), onEvent: { addListener: vi.fn(), removeListener: vi.fn() } } });
  await expect(withAlertConfirmation(1, async () => { throw new Error('node failed'); })).rejects.toThrow('node failed');
  expect(detach).toHaveBeenCalledOnce();
});
it('reuses its debugger for nested nodes and releases a child-tab debugger independently', async () => {
  const api = { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn().mockResolvedValue(undefined), onEvent: { addListener: vi.fn(), removeListener: vi.fn() } };
  vi.stubGlobal('chrome', { debugger: api });
  await withAlertConfirmation(1, () => withAlertConfirmation(1, () => withAlertConfirmation(2, async () => 'done')));
  expect(api.attach.mock.calls.map(([target]) => target.tabId)).toEqual([1, 2]);
  expect(api.detach.mock.calls.map(([target]) => target.tabId)).toEqual([2, 1]);
});

function navigationHarness() {
  let url = 'chrome://extensions/';
  const listeners = new Set<(event: { tabId: number; frameId: number; url: string }) => void>();
  const events = new Set<(source: { tabId: number }, method: string, params: object) => void>();
  const api = { attach: vi.fn(async () => { if (!url.startsWith('https:')) throw new Error('Cannot access a chrome:// URL'); }), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn().mockResolvedValue(undefined), onEvent: { addListener: vi.fn(fn => events.add(fn)), removeListener: vi.fn(fn => events.delete(fn)) } };
  vi.stubGlobal('chrome', { debugger: api, tabs: { get: vi.fn(async () => ({ id: 1, url })) }, webNavigation: { onCommitted: { addListener: vi.fn(fn => listeners.add(fn)), removeListener: vi.fn(fn => listeners.delete(fn)) } } });
  return { api, listeners, navigate: async (frameId = 0, tabId = 1) => {
    if (!frameId && tabId === 1) url = 'https://example.com/report';
    listeners.forEach(fn => fn({ tabId, frameId, url: 'https://example.com/report' }));
    await Promise.resolve(); await Promise.resolve();
    events.forEach(fn => fn({ tabId }, 'Page.javascriptDialogOpening', { type: 'alert' }));
  } };
}
it('allows Start to leave chrome:// and accepts alerts during the new document load, before action completion', async () => {
  const { api, listeners, navigate } = navigationHarness();
  await withAlertConfirmation(1, async () => {
    expect(api.attach).not.toHaveBeenCalled();
    await withAlertConfirmation(1, async () => {
      await navigate(2); await navigate(0, 99);
      expect(api.attach).not.toHaveBeenCalled();
      await navigate(); await navigate();
      expect(api.attach).toHaveBeenCalledOnce();
      expect(api.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Page.handleJavaScriptDialog', { accept: true });
    });
  });
  expect(api.detach).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
});
it('propagates navigation-time attach refusal without waiting for a blocked page load or detaching another debugger', async () => {
  const { api, listeners, navigate } = navigationHarness();
  api.attach.mockRejectedValue(new Error('Another debugger is attached'));
  await expect(withAlertConfirmation(1, async () => { await navigate(); return new Promise<never>(() => undefined); })).rejects.toThrow('Another debugger');
  expect(api.detach).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
});
it('cleans up when navigation fails before any accessible document exists', async () => {
  const { api, listeners } = navigationHarness();
  await expect(withAlertConfirmation(1, async () => { throw new Error('navigation failed'); })).rejects.toThrow('navigation failed');
  expect(api.attach).not.toHaveBeenCalled(); expect(api.detach).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
});
