import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBridgeListening } from './bridge-readiness';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('local broker readiness', () => {
  it('recognizes the existing broker HTTP upgrade response without creating a WebSocket', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 426 });
    const socket = vi.fn();
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('WebSocket', socket);
    await expect(isBridgeListening()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17373/extension', expect.objectContaining({ cache: 'no-store', credentials: 'omit' }));
    expect(socket).not.toHaveBeenCalled();
  });
  it('treats an absent service and unrelated HTTP servers as offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ status: 200 }));
    await expect(isBridgeListening()).resolves.toBe(false);
    await expect(isBridgeListening()).resolves.toBe(false);
  });
  it('bounds an unresponsive listener so startup and manual retry can continue', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const pending = isBridgeListening();
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBe(false);
  });
});
