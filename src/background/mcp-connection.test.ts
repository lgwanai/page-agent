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
