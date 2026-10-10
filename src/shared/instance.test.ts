import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('Chrome extension instance identity', () => {
  it('creates one identity for concurrent callers and reuses it after worker restarts', async () => {
    const storage: Record<string, unknown> = {};
    const set = vi.fn(async (value: Record<string, unknown>) => Object.assign(storage, value));
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async (key: string) => ({ [key]: storage[key] })), set } } });
    const { getInstanceId } = await import('./instance');
    const [first, second] = await Promise.all([getInstanceId(), getInstanceId()]);
    expect(first).toBe(second);
    expect(set).toHaveBeenCalledOnce();
    vi.resetModules();
    const restarted = await import('./instance');
    expect(await restarted.getInstanceId()).toBe(first);
    expect(set).toHaveBeenCalledOnce();
  });

  it('different profiles get different instance ids', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } } });
    const first = await (await import('./instance')).getInstanceId();
    vi.resetModules();
    const second = await (await import('./instance')).getInstanceId();
    expect(first).not.toBe(second);
  });
});
