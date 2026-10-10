import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { ExtensionBridge } from '../src/bridge';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let bridge: ExtensionBridge;
const sockets: WebSocket[] = [];

async function connect(instanceId: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.address()!.port}/extension`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'hello', role: 'extension', instanceId, version: '0.10.0' }));
  await vi.waitFor(() => expect(bridge.instances.some((item) => item.instanceId === instanceId)).toBe(true));
  return socket;
}
function message(socket: WebSocket): Promise<{ id: string; instanceId: string; method: string }> {
  return new Promise((resolve) => socket.once('message', (raw) => resolve(JSON.parse(String(raw)))));
}
beforeEach(async () => {
  bridge = new ExtensionBridge(0);
  await vi.waitFor(() => expect(bridge.address()?.port).toBeTypeOf('number'));
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await bridge.close();
});

describe('multi-instance extension routing', () => {
  it('keeps both connections and routes simultaneous requests only to their chosen instances', async () => {
    const a = await connect(A);
    const b = await connect(B);
    expect(bridge.instances).toHaveLength(2);
    const aMessage = message(a);
    const bMessage = message(b);
    const aResult = bridge.request(A, 'run_workflow', { workflowId: 'same-workflow' });
    const bResult = bridge.request(B, 'run_workflow', { workflowId: 'same-workflow' });
    const [aRequest, bRequest] = await Promise.all([aMessage, bMessage]);
    expect(aRequest.instanceId).toBe(A);
    expect(bRequest.instanceId).toBe(B);
    b.send(JSON.stringify({ id: bRequest.id, ok: true, result: 'B only' }));
    a.send(JSON.stringify({ id: aRequest.id, ok: true, result: 'A only' }));
    expect(await Promise.all([aResult, bResult])).toEqual(['A only', 'B only']);
  });

  it('refuses missing or disconnected ids even when another instance is connected', async () => {
    await connect(A);
    await expect(bridge.request('', 'run_workflow')).rejects.toThrow('必须指定');
    await expect(bridge.request(C, 'run_workflow')).rejects.toThrow('不会转发');
  });

  it('ignores a response from the wrong socket and resolves only the targeted response', async () => {
    const a = await connect(A);
    const b = await connect(B);
    const requestMessage = message(a);
    const result = bridge.request(A, 'get_state');
    const request = await requestMessage;
    let settled = false;
    void result.then(() => { settled = true; });
    b.send(JSON.stringify({ id: request.id, ok: true, result: 'forged' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    a.send(JSON.stringify({ id: request.id, ok: true, result: 'correct' }));
    expect(await result).toBe('correct');
  });

  it('rejects pending requests on disconnect without disturbing the other instance', async () => {
    const a = await connect(A);
    await connect(B);
    const requestMessage = message(a);
    const result = bridge.request(A, 'run_workflow');
    const rejection = expect(result).rejects.toThrow('实例已断开');
    await requestMessage;
    a.close();
    await rejection;
    await vi.waitFor(() => expect(bridge.instances.map((item) => item.instanceId)).toEqual([B]));
  });

  it('does not replace an existing connection with a duplicate instance id', async () => {
    const a = await connect(A);
    const duplicate = new WebSocket(`ws://127.0.0.1:${bridge.address()!.port}/extension`);
    sockets.push(duplicate);
    await new Promise<void>((resolve) => duplicate.once('open', resolve));
    const closed = new Promise<number>((resolve) => duplicate.once('close', resolve));
    duplicate.send(JSON.stringify({ type: 'hello', role: 'extension', instanceId: A }));
    expect(await closed).toBe(1008);
    expect(a.readyState).toBe(WebSocket.OPEN);
    expect(bridge.instances).toHaveLength(1);
  });
});
