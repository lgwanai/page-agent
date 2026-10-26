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
      const tools = (await mcp.listTools()).tools;
      for (const name of ['run_page_workflow', 'create_page_workflow', 'edit_page_workflow', 'inspect_page_content', 'debug_page_node', 'get_page_workflow_toolkit', 'capture_page_screenshot', 'delete_page_node']) expect(tools.some((tool) => tool.name === name)).toBe(true);
      expect(JSON.stringify(await mcp.callTool({ name: 'get_page_workflow_toolkit', arguments: {} }))).toContain('templates');
      const result = await mcp.callTool({ name: 'list_page_agent_instances', arguments: {} });
      expect(JSON.stringify(result)).toContain(INSTANCE);
    }
    await a.close();
    expect(JSON.stringify(await b.callTool({ name: 'page_agent_status', arguments: {} }))).toContain(INSTANCE);
    extension.on('message', (raw) => {
      const request = JSON.parse(String(raw));
      if (request.method === 'get_workflow') {
        extension.send(JSON.stringify({ id: request.id, ok: false, error: '工作流已被修改', diagnostic: { code: 'WORKFLOW_REVISION_CONFLICT', phase: 'editing', context: { actualUpdatedAt: 99 }, retryPolicy: 'after_fix', suggestions: ['重新读取工作流'] } })); return;
      }
      if (request.method === 'debug_node') {
        extension.send(JSON.stringify({ id: request.id, ok: true, result: { result: { ok: false, steps: [], error: '节点不可见' } } })); return;
      }
      if (request.method === 'capture_screenshot') {
        extension.send(JSON.stringify({ id: request.id, ok: true, result: { images: [{ data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRD8AAAAASUVORK5CYII=', mimeType: 'image/png', width: 1, height: 1, offsetY: 0 }], metadata: { mode: request.params.mode, complete: true, scrollRestored: true } } })); return;
      }
      extension.send(JSON.stringify({ id: request.id, ok: true, result: { method: request.method, params: request.params } }));
    });
    const created = await b.callTool({ name: 'create_page_workflow', arguments: { instanceId: INSTANCE, name: 'SDK 新流程', targetUrl: 'https://example.com' } });
    expect(JSON.stringify(created)).toContain('create_workflow'); expect(created.isError).not.toBe(true);
    const edited = await b.callTool({ name: 'edit_page_workflow', arguments: { instanceId: INSTANCE, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'test-key', expectedUpdatedAt: 1, operations: [{ type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: 0 } }] } });
    expect(JSON.stringify(edited)).toContain('edit_workflow'); expect(edited.isError).not.toBe(true);
    const deleted = await b.callTool({ name: 'delete_page_node', arguments: { instanceId: INSTANCE, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'test-key', expectedUpdatedAt: 2, nodeId: 'wait' } });
    expect(deleted.isError).not.toBe(true);
    expect(JSON.stringify(deleted)).toContain('edit_workflow');
    expect(JSON.stringify(deleted)).toContain('remove_node');
    expect(JSON.stringify(deleted)).toContain('wait');
    const badDelete = await b.callTool({ name: 'delete_page_node', arguments: { instanceId: INSTANCE, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'test-key', nodeId: 'wait' } });
    expect(badDelete.isError).toBe(true);
    const auth = { instanceId: INSTANCE, workflowId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key: 'PRIVATE-KEY' };
    const failure = await b.callTool({ name: 'get_page_workflow', arguments: auth });
    expect(failure.isError).toBe(true); expect(JSON.stringify(failure)).toContain('WORKFLOW_REVISION_CONFLICT');
    expect(JSON.stringify(failure)).toContain('actualUpdatedAt'); expect(JSON.stringify(failure)).not.toContain('PRIVATE-KEY');
    const failedRun = await b.callTool({ name: 'debug_page_node', arguments: { ...auth, nodeId: 'input1' } });
    expect(failedRun.isError).toBe(true);
    const screenshot = await b.callTool({ name: 'capture_page_screenshot', arguments: { ...auth, mode: 'viewport' } });
    expect(screenshot.isError).not.toBe(true);
    expect(screenshot.content).toMatchObject([{ type: 'text' }, { type: 'image', mimeType: 'image/png' }]);
    const invalidRegion = await b.callTool({ name: 'capture_page_screenshot', arguments: { ...auth, mode: 'region' } });
    expect(invalidRegion.isError).toBe(true); expect(JSON.stringify(invalidRegion)).toContain('SCREENSHOT_REGION_INVALID');
  });
});
