import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('native service start', () => {
  it('coalesces concurrent requests and sends only the fixed action', async () => {
    let finish!: (value: unknown) => void;
    const sendNativeMessage = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage } });
    const { launchMcpServer } = await import('./mcp-launcher');
    const first = launchMcpServer(); const second = launchMcpServer();
    expect(first).toBe(second);
    finish({ ok: true }); await first;
    expect(sendNativeMessage).toHaveBeenCalledOnce();
    expect(sendNativeMessage).toHaveBeenCalledWith('com.page_agent.launcher', { type: 'ensure_server' });
  });
  it('explains missing registration and allows a later manual retry', async () => {
    const sendNativeMessage = vi.fn().mockRejectedValueOnce(new Error('Specified native messaging host not found.')).mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage } });
    const { launchMcpServer } = await import('./mcp-launcher');
    await expect(launchMcpServer()).rejects.toThrow('Setup');
    await expect(launchMcpServer()).resolves.toBeUndefined();
  });
  it('recovers valid paths from an installed native host without an imported file', async () => {
    const clientOptions = { command: '/local/runtime/node', serverPath: '/local/mcp-server/dist/index.js' };
    const sendNativeMessage = vi.fn().mockResolvedValueOnce({ ok: true, clientOptions }).mockResolvedValueOnce({ ok: true, clientOptions: { command: 'node', serverPath: '~/invalid' } });
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage } });
    const { launchMcpServer } = await import('./mcp-launcher');
    await expect(launchMcpServer()).resolves.toEqual(clientOptions);
    await expect(launchMcpServer()).rejects.toThrow('路径无效');
  });
  it('does not claim success for a host error or an unresponsive host', async () => {
    vi.useFakeTimers();
    const sendNativeMessage = vi.fn().mockResolvedValueOnce({ ok: false, error: '端口被占用' }).mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage } });
    const { launchMcpServer } = await import('./mcp-launcher');
    await expect(launchMcpServer()).rejects.toThrow('端口被占用');
    const pending = expect(launchMcpServer()).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(15000); await pending;
  });
});
