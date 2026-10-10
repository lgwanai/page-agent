import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { ExtensionBridge } from '../src/bridge';
import { SharedBridge } from '../src/shared-bridge';
import { Client } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { fileURLToPath } from 'node:url';

const INSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let broker: ExtensionBridge;
let extension: WebSocket;
let port: number;
const clients: SharedBridge[] = [];
const stdioClients: Client[] = [];
beforeEach(async () => {
  broker = new ExtensionBridge(0);
  await broker.ready;
  port = broker.address()!.port;
  extension = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  await new Promise<void>((resolve) => extension.once('open', resolve));
  extension.send(JSON.stringify({ type: 'hello', role: 'extension', instanceId: INSTANCE, version: 'test' }));
  await vi.waitFor(() => expect(broker.instances).toHaveLength(1));
});
afterEach(async () => {
  for (const client of stdioClients.splice(0)) await client.close();
  for (const client of clients.splice(0)) client.close();
  extension.terminate(); await broker.close();
});
async function client() {
  const next = new SharedBridge(port); clients.push(next); await next.connect(false); return next;
}
describe('shared multi-client broker', () => {
  it('keeps MCP initialized when a legacy server occupies the port and returns a diagnostic', async () => {
    const legacy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => legacy.once('listening', resolve));
    legacy.on('connection', (socket) => socket.close(1008, 'Only extension clients are allowed'));
    const legacyPort = (legacy.address() as { port: number }).port;
    const mcp = new Client({ name: 'legacy-conflict-test', version: '1' });
    stdioClients.push(mcp);
    try {
      await mcp.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
        env: { ...process.env as Record<string, string>, PAGE_AGENT_BRIDGE_PORT: String(legacyPort) }, stderr: 'pipe',
      }));
      expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
      expect(JSON.stringify(await mcp.callTool({ name: 'page_agent_status', arguments: {} }))).toContain('旧版');
      expect((await mcp.listTools()).tools.length).toBeGreaterThan(0);
    } finally {
      await mcp.close();
      await new Promise<void>((resolve) => legacy.close(() => resolve()));
    }
  });
  it('routes simultaneous client responses without cross-talk and retains other clients on close', async () => {
    const [a, b] = await Promise.all([client(), client()]);
    extension.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      extension.send(JSON.stringify({ id: message.id, ok: true, result: message.params.client }));
    });
    expect(a.instances).toHaveLength(1);
    expect(b.instances).toHaveLength(1);
    expect(await Promise.all([a.request(INSTANCE, 'get_state', { client: 'A' }), b.request(INSTANCE, 'get_state', { client: 'B' })])).toEqual(['A', 'B']);
    a.close();
    expect(await b.request(INSTANCE, 'get_state', { client: 'still connected' })).toBe('still connected');
  });

  it('rejects overlapping runs on the same instance but permits concurrent reads', async () => {
    const [a, b] = await Promise.all([client(), client()]);
    let held: { id: string } | undefined;
    extension.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.method === 'run_workflow') held = message;
      else extension.send(JSON.stringify({ id: message.id, ok: true, result: 'read works' }));
    });
    const run = a.request(INSTANCE, 'run_workflow');
    await vi.waitFor(() => expect(held).toBeDefined());
    await expect(b.request(INSTANCE, 'run_workflow')).rejects.toThrow('正在执行');
    expect(await b.request(INSTANCE, 'get_state')).toBe('read works');
    extension.send(JSON.stringify({ id: held!.id, ok: true, result: 'done' }));
    expect(await run).toBe('done');
  });

  it('updates every client when an extension disconnects', async () => {
    const [a, b] = await Promise.all([client(), client()]);
    extension.close();
    await vi.waitFor(() => { expect(a.instances).toEqual([]); expect(b.instances).toEqual([]); });
  });

  it('rejects browser-origin clients on the local MCP relay endpoint', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/mcp-client`, { origin: 'https://example.com' });
    const code = await new Promise<number>((resolve, reject) => { socket.once('close', resolve); socket.once('error', reject); });
    expect(code).toBe(1008);
  });

  it('handles a competing broker port claim without an unhandled server error', async () => {
    const competitor = new ExtensionBridge(port);
    await expect(competitor.ready).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect((await client()).instances).toHaveLength(1);
  });

  it('allows two actual stdio MCP processes to initialize and call tools on the same port', async () => {
    const makeClient = async (name: string) => {
      const mcp = new Client({ name, version: '1.0.0' }); stdioClients.push(mcp);
      await mcp.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
        env: { ...process.env as Record<string, string>, PAGE_AGENT_BRIDGE_PORT: String(port) }, stderr: 'pipe',
      }));
      return mcp;
    };
    const [a, b] = await Promise.all([makeClient('tool-A'), makeClient('tool-B')]);
    for (const mcp of [a, b]) {
      expect((await mcp.listTools()).tools.some((tool) => tool.name === 'run_page_workflow')).toBe(true);
      const result = await mcp.callTool({ name: 'list_page_agent_instances', arguments: {} });
      expect(JSON.stringify(result)).toContain(INSTANCE);
    }
    await a.close();
    expect(JSON.stringify(await b.callTool({ name: 'page_agent_status', arguments: {} }))).toContain(INSTANCE);
  });
});
