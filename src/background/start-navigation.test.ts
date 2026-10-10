import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateToStartUrl } from './start-navigation';

function event() {
  const listeners = new Set<(...args: unknown[]) => void>();
  return {
    addListener: vi.fn((listener: (...args: unknown[]) => void) => { listeners.add(listener); }),
    removeListener: vi.fn((listener: (...args: unknown[]) => void) => { listeners.delete(listener); }),
    emit: (...args: unknown[]) => { for (const listener of listeners) listener(...args); },
    size: () => listeners.size,
  };
}
function setup() {
  const updated = event();
  const removed = event();
  const committed = event();
  const get = vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com/app', status: 'loading' });
  const update = vi.fn().mockResolvedValue({ id: 1, status: 'complete' });
  const reload = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    tabs: { get, update, reload, onUpdated: updated, onRemoved: removed },
    webNavigation: { onCommitted: committed },
  });
  return { updated, removed, committed, get, update, reload };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Start navigation load barrier', () => {
  it('explicitly reloads an already matching URL to reset its document state', async () => {
    const { update, reload, committed, updated } = setup();
    const url = 'https://example.com/app';
    const pending = navigateToStartUrl(1, url, 5000, url);
    expect(reload).toHaveBeenCalledWith(1);
    expect(update).not.toHaveBeenCalled();
    committed.emit({ tabId: 1, frameId: 0 });
    updated.emit(1, { status: 'complete' }, { id: 1, url, status: 'complete' });
    expect((await pending).url).toBe(url);
  });

  it('reloads after applying a hash-only target change instead of waiting for a nonexistent full navigation', async () => {
    const { update, reload, committed, updated } = setup();
    const url = 'https://example.com/app#/report';
    const pending = navigateToStartUrl(1, url, 5000, 'https://example.com/app#/home');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith(1));
    expect(update).toHaveBeenCalledWith(1, { url });
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
    committed.emit({ tabId: 1, frameId: 0 });
    updated.emit(1, { status: 'complete' }, { id: 1, url, status: 'complete' });
    expect((await pending).url).toBe(url);
  });

  it('does not accept the old complete status or an iframe commit as a new page load', async () => {
    const { updated, committed, update } = setup();
    const done = vi.fn();
    const pending = navigateToStartUrl(1, 'https://example.com/app', 5000);
    void pending.then(done);
    updated.emit(1, { status: 'complete' }, { id: 1, status: 'complete' });
    committed.emit({ tabId: 1, frameId: 5 });
    committed.emit({ tabId: 2, frameId: 0 });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(1, { url: 'https://example.com/app' });
    committed.emit({ tabId: 1, frameId: 0 });
    updated.emit(1, { status: 'complete' }, { id: 1, status: 'complete', url: 'https://example.com/app' });
    expect((await pending).url).toBe('https://example.com/app');
    expect(committed.size()).toBe(0);
    expect(updated.size()).toBe(0);
  });

  it('registers listeners before requesting a fast navigation', async () => {
    const { update, committed, updated, get } = setup();
    const loaded = { id: 1, status: 'complete', url: 'https://example.com/app' };
    get.mockResolvedValue(loaded);
    update.mockImplementation(async () => {
      committed.emit({ tabId: 1, frameId: 0 });
      updated.emit(1, { status: 'complete' }, loaded);
      return loaded;
    });
    expect(await navigateToStartUrl(1, loaded.url, 5000)).toEqual(loaded);
    expect(committed.size()).toBe(0);
  });

  it('cleans up listeners when opening the URL fails', async () => {
    const { update, committed, updated, removed } = setup();
    update.mockRejectedValue(new Error('navigation blocked'));
    await expect(navigateToStartUrl(1, 'https://example.com/app', 5000)).rejects.toThrow('navigation blocked');
    expect([committed.size(), updated.size(), removed.size()]).toEqual([0, 0, 0]);
  });

  it('rejects a closed target instead of continuing operations on another tab', async () => {
    const { removed, committed } = setup();
    const pending = navigateToStartUrl(1, 'https://example.com/app', 5000);
    removed.emit(1);
    await expect(pending).rejects.toThrow('目标页面已关闭');
    expect(committed.size()).toBe(0);
  });

  it('times out without treating an old document as ready', async () => {
    vi.useFakeTimers();
    const { committed } = setup();
    const pending = navigateToStartUrl(1, 'https://example.com/app', 5000);
    const assertion = expect(pending).rejects.toThrow('目标页面加载超时');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(committed.size()).toBe(0);
  });
});
