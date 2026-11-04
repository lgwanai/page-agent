import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readiness } = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock('./bridge-readiness', () => ({ isBridgeListening: readiness }));

class MockSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static connections: MockSocket[] = [];
  readyState = 0;
  send = vi.fn();
  constructor(public url: string) { super(); MockSocket.connections.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  close() { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), { reason: 'Test service disconnected' })); }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
}
beforeEach(() => {
  vi.resetModules();
  readiness.mockReset().mockResolvedValue(true);
  vi.useFakeTimers();
  MockSocket.connections = [];
  vi.stubGlobal('WebSocket', MockSocket);
  vi.stubGlobal('self', { setTimeout, clearTimeout, setInterval, clearInterval });
  vi.stubGlobal('chrome', {
    storage: { local: { get: vi.fn(async () => ({ pageAgentInstanceIdV1: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })) } },
    runtime: { sendMessage: vi.fn().mockResolvedValue({}), getManifest: () => ({ version: '0.10.1' }) },
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('MCP connection diagnostics', () => {
  it('treats a stopped service as offline without creating failed WebSockets', async () => {
    readiness.mockResolvedValue(false);
    const sendNativeMessage = vi.fn().mockRejectedValue(new Error('Specified native messaging host not found.'));
    Object.assign(chrome.runtime, { sendNativeMessage });
    const bridge = await import('./bridge');
    await bridge.connectBridge();
    await vi.advanceTimersByTimeAsync(0);
    expect(MockSocket.connections).toHaveLength(0);
    expect(sendNativeMessage).toHaveBeenCalledOnce();
    expect(await bridge.getMcpConnectionInfo()).toMatchObject({ connected: false, connecting: false, launcherError: expect.stringContaining('Setup') });
    await vi.advanceTimersByTimeAsync(60000);
    expect(readiness.mock.calls.length).toBeGreaterThan(2);
    expect(MockSocket.connections).toHaveLength(0);
    expect(sendNativeMessage).toHaveBeenCalledOnce();
  });
  it('waits for service startup before the first WebSocket and coalesces startup probes', async () => {
    readiness.mockResolvedValue(false);
    let started!: (value: unknown) => void;
    const sendNativeMessage = vi.fn(() => new Promise(resolve => { started = resolve; }));
    Object.assign(chrome.runtime, { sendNativeMessage });
    const bridge = await import('./bridge');
    const first = bridge.connectBridge(); const second = bridge.connectBridge();
    expect(first).toBe(second); await first;
    expect(MockSocket.connections).toHaveLength(0);
    readiness.mockResolvedValue(true);
    started({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(MockSocket.connections).toHaveLength(1);
    expect(sendNativeMessage).toHaveBeenCalledOnce();
  });
  it('automatically starts once after a failed connection, and retries the socket when ready', async () => {
    const sendNativeMessage = vi.fn().mockResolvedValue({ ok: true });
    Object.assign(chrome.runtime, { sendNativeMessage });
    const bridge = await import('./bridge');
    await bridge.connectBridge();
    MockSocket.connections[0].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendNativeMessage).toHaveBeenCalledOnce();
    expect(sendNativeMessage).toHaveBeenCalledWith('com.page_agent.launcher', { type: 'ensure_server' });
    expect(MockSocket.connections).toHaveLength(2);
    MockSocket.connections[1].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(sendNativeMessage).toHaveBeenCalledOnce();
  });
  it('manual start does not call the launcher for a healthy connection', async () => {
    const sendNativeMessage = vi.fn(); Object.assign(chrome.runtime, { sendNativeMessage });
    const bridge = await import('./bridge'); await bridge.connectBridge();
    MockSocket.connections[0].open(); await vi.advanceTimersByTimeAsync(0);
    await bridge.startMcpServer();
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });
  it('one-click setup recovers missing paths from the native host and waits for connection', async () => {
    const storage: Record<string, unknown> = { pageAgentInstanceIdV1: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    Object.assign(chrome.storage.local, {
      get: vi.fn(async () => ({ ...storage })),
      set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(storage, patch); }),
    });
    const clientOptions = { command: '/local/runtime/node', serverPath: '/local/mcp-server/dist/index.js' };
    const sendNativeMessage = vi.fn().mockResolvedValue({ ok: true, clientOptions });
    Object.assign(chrome.runtime, { sendNativeMessage });
    const bridge = await import('./bridge');
    const setup = bridge.configureAndStartMcpServer();
    await vi.advanceTimersByTimeAsync(0);
    expect(MockSocket.connections).toHaveLength(1);
    MockSocket.connections[0].open();
    await vi.advanceTimersByTimeAsync(100);
    expect(await setup).toMatchObject({ connected: true, clientOptions, clientOptionsSource: 'saved' });
    expect(sendNativeMessage).toHaveBeenCalledOnce();
  });
  it('one-click setup reports a connection timeout instead of claiming startup success', async () => {
    Object.assign(chrome.runtime, { sendNativeMessage: vi.fn().mockResolvedValue({ ok: true }) });
    const bridge = await import('./bridge');
    const setup = expect(bridge.configureAndStartMcpServer()).rejects.toThrow('仍未连接');
    await vi.advanceTimersByTimeAsync(8100); await setup;
  });
  it('keeps the current Setup paths when the launcher belongs to another package', async () => {
    const local = { command: '/new/runtime/node', serverPath: '/new/mcp-server/dist/index.js' };
    const old = { command: '/old/runtime/node', serverPath: '/old/mcp-server/dist/index.js' };
    Object.assign(chrome.runtime, { getURL: () => 'chrome-extension://test/mcp-local-config.json', sendNativeMessage: vi.fn().mockResolvedValue({ ok: true, clientOptions: old }) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mcpServers: { 'page-agent': { command: local.command, args: [local.serverPath] } } }) }));
    const bridge = await import('./bridge');
    await bridge.startMcpServer();
    expect((await bridge.getMcpConnectionInfo()).clientOptions).toEqual(local);
    MockSocket.connections[0].open(); await vi.advanceTimersByTimeAsync(0);
    MockSocket.connections[0].receive({ type: 'services', clientOptions: old });
    await expect(bridge.configureAndStartMcpServer()).rejects.toThrow('其他安装目录');
  });
  it('keeps the new Setup configuration when an older shared broker reports its own path', async () => {
    const local = { command: '/delivery/0.10.39/runtime/node', serverPath: '/delivery/0.10.39/mcp-server/dist/index.js' };
    const old = { command: '/delivery/0.10.37/runtime/node', serverPath: '/delivery/0.10.37/mcp-server/dist/index.js' };
    Object.assign(chrome.runtime, { getURL: vi.fn(() => 'chrome-extension://test/mcp-local-config.json') });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mcpServers: { 'page-agent': { command: local.command, args: [local.serverPath] } } }) }));
    const bridge = await import('./bridge');
    await bridge.connectBridge();
    MockSocket.connections[0].open();
    await vi.advanceTimersByTimeAsync(0);
    MockSocket.connections[0].receive({ type: 'services', clientOptions: old });
    const info = await bridge.getMcpConnectionInfo();
    expect(info.clientOptions).toEqual(local);
    expect(info.runningClientOptions).toEqual(old);
    expect(info.configurationMismatch).toBe(true);
    expect(info.clientOptionsSource).toBe('setup');
  });
  it('reports real connection state and does not reconnect an open socket', async () => {
    const bridge = await import('./bridge');
    await bridge.connectBridge();
    expect((await bridge.getMcpConnectionInfo()).connecting).toBe(true);
    const socket = MockSocket.connections[0];
    expect(socket.url).toBe('ws://127.0.0.1:17373/extension');
    socket.open();
    await vi.advanceTimersByTimeAsync(0);
    expect((await bridge.getMcpConnectionInfo()).connected).toBe(true);
    await bridge.retryMcpConnection();
    expect(MockSocket.connections).toHaveLength(1);
  });
  it('exposes disconnect reasons and immediately retries without duplicating the delayed retry', async () => {
    const bridge = await import('./bridge');
    await bridge.connectBridge();
    MockSocket.connections[0].close();
    expect((await bridge.getMcpConnectionInfo()).error).toBe('Test service disconnected');
    await bridge.retryMcpConnection();
    expect(MockSocket.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(MockSocket.connections).toHaveLength(2);
  });
});

it('requires upload capability and transports local file content only for a matching pending request', async () => {
  const bridge = await import('./bridge'); await bridge.connectBridge();
  const socket = MockSocket.connections[0]; socket.open(); await vi.advanceTimersByTimeAsync(0);
  await expect(bridge.inspectUploadFilesViaBridge(['/tmp/file.txt'])).rejects.toThrow('新版');
  socket.receive({ type: 'services', uploadNativePaths: true });
  const pending = bridge.inspectUploadFilesViaBridge(['/tmp/file.txt']);
  const request = JSON.parse(socket.send.mock.calls.at(-1)![0]);
  expect(request).toMatchObject({ type: 'inspect_upload_files', paths: ['/tmp/file.txt'] });
  const files = [{ name: 'file.txt', size: 1, path: '/tmp/file.txt', mimeType: 'text/plain', lastModified: 1 }];
  socket.receive({ type: 'upload_file_paths_result', id: request.id, ok: true, result: files });
  expect(await pending).toEqual(files);
  const disconnected = bridge.inspectUploadFilesViaBridge(['/tmp/file.txt']);
  socket.close(); await expect(disconnected).rejects.toThrow('断开');
});
