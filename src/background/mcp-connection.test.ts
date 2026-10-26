import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('keeps the new Setup configuration when an older shared broker reports its own path', async () => {
    const local = { command: '/delivery/0.10.39/runtime/node', serverPath: '/delivery/0.10.39/mcp-server/dist/index.js' };
    const old = { command: '/delivery/0.10.37/runtime/node', serverPath: '/delivery/0.10.37/mcp-server/dist/index.js' };
    Object.assign(chrome.runtime, { getURL: vi.fn(() => 'chrome-extension://test/mcp-local-config.json') });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mcpServers: { 'page-agent': { command: local.command, args: [local.serverPath] } } }) }));
    const bridge = await import('./bridge');
    bridge.connectBridge();
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
    bridge.connectBridge();
    expect((await bridge.getMcpConnectionInfo()).connecting).toBe(true);
    const socket = MockSocket.connections[0];
    expect(socket.url).toBe('ws://127.0.0.1:17373/extension');
    socket.open();
    await vi.advanceTimersByTimeAsync(0);
    expect((await bridge.getMcpConnectionInfo()).connected).toBe(true);
    bridge.retryMcpConnection();
    expect(MockSocket.connections).toHaveLength(1);
  });
  it('exposes disconnect reasons and immediately retries without duplicating the delayed retry', async () => {
    const bridge = await import('./bridge');
    bridge.connectBridge();
    MockSocket.connections[0].close();
    expect((await bridge.getMcpConnectionInfo()).error).toBe('Test service disconnected');
    bridge.retryMcpConnection();
    expect(MockSocket.connections).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(MockSocket.connections).toHaveLength(2);
  });
});

it('requires upload capability and transports local file content only for a matching pending request', async () => {
  const bridge = await import('./bridge'); bridge.connectBridge();
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
