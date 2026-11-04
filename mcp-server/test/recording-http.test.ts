import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExtensionBridge } from '../src/bridge';
import { RecordingTaskRegistry, RECORDING_TASK_TTL_MS } from '../src/recording-tasks';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let bridge: ExtensionBridge, directory: string;
const sockets: WebSocket[] = [];
const snapshot = (id = 'clip') => ({ id, tabId: 7, mode: 'videoAudio', state: 'recording', startedAt: Date.now(), durationMs: 0, bytes: 0, chunks: 0, fileName: `${id}.webm` });
async function connect(instanceId = A) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.address()!.port}/extension`); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const hello = new Promise<Record<string, unknown>>(resolve => socket.once('message', raw => resolve(JSON.parse(String(raw)))));
  socket.send(JSON.stringify({ type: 'hello', role: 'extension', instanceId, version: '0.10.76' }));
  expect(await hello).toMatchObject({ type: 'services', recordingTasks: true });
  return socket;
}
function register(socket: WebSocket, value = snapshot(), requireFullDuration = true): Promise<{ taskId: string; statusUrl: string; expiresAt: string; pollAfterMs: number }> {
  return new Promise((resolve, reject) => {
    const listener = (raw: unknown) => { const data = JSON.parse(String(raw)); if (data.type !== 'media_recording_task_result') return; socket.off('message', listener); if (data.ok) resolve(data.result); else reject(new Error(data.error)); };
    socket.on('message', listener);
    socket.send(JSON.stringify({ type: 'register_media_recording_task', id: 'register', result: value, requireFullDuration, requestedDurationMs: 5000 }));
  });
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'page-agent-tasks-'));
  bridge = new ExtensionBridge(0, { recordingTaskStorePath: join(directory, 'tasks.json') }); await bridge.ready;
});
afterEach(async () => { vi.restoreAllMocks(); for (const socket of sockets.splice(0)) socket.terminate(); await bridge.close(); await rm(directory, { recursive: true, force: true }); });

it('returns a URL before completion, polls the owning extension and serves saved bytes after all clients disconnect', async () => {
  const extension = await connect(); let latest: Record<string, unknown> = snapshot();
  const receipt = await register(extension);
  expect(receipt.statusUrl).toMatch(new RegExp(`^http://127.0.0.1:${bridge.address()!.port}/recordings/[A-Za-z0-9_-]{43}$`));
  extension.on('message', raw => { const data = JSON.parse(String(raw)); if (data.method === 'recording_status') { expect(data.instanceId).toBe(A); expect(data.params.recordingId).toBe('clip'); extension.send(JSON.stringify({ id: data.id, ok: true, result: latest })); } });
  expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ status: 'recording', done: false, success: false, taskId: receipt.taskId });
  expect((await fetch(`${receipt.statusUrl}/file`)).status).toBe(409);
  const path = join(directory, 'clip.webm'), content = Buffer.from('real-file-bytes'); await writeFile(path, content);
  latest = { ...latest, state: 'saved', durationMs: 5000, stopReason: 'duration', bytes: content.length, chunks: 5, savedPath: path };
  extension.send(JSON.stringify({ type: 'media_recording_task_update', result: latest }));
  await vi.waitFor(async () => expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ status: 'completed', done: true, success: true, filePath: path, fileUrl: `${receipt.statusUrl}/file` }));
  extension.close(); await vi.waitFor(() => expect(bridge.connected).toBe(false));
  expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ status: 'completed', filePath: path });
  expect(Buffer.from(await (await fetch(`${receipt.statusUrl}/file`)).arrayBuffer())).toEqual(content);
  const range = await fetch(`${receipt.statusUrl}/file`, { headers: { Range: 'bytes=2-5' } });
  expect(range.status).toBe(206); expect(range.headers.get('content-range')).toBe(`bytes 2-5/${content.length}`); expect(await range.text()).toBe(content.subarray(2, 6).toString());
  const suffix = await fetch(`${receipt.statusUrl}/file`, { headers: { Range: 'bytes=-3' } }); expect(await suffix.text()).toBe('tes');
  expect((await fetch(`${receipt.statusUrl}/file`, { headers: { Range: 'bytes=999-' } })).status).toBe(416);
  const head = await fetch(`${receipt.statusUrl}/file`, { method: 'HEAD' }); expect(head.status).toBe(200); expect(head.headers.get('content-length')).toBe(String(content.length)); expect(await head.text()).toBe('');
  // Windows ignores POSIX mode bits; its filesystem ACLs determine access.
  if (process.platform !== 'win32') expect((await stat(join(directory, 'tasks.json'))).mode & 0o777).toBe(0o600);
});
it('isolates task owners, rejects browser origins, does not expose arbitrary paths and keeps old URLs after later tasks', async () => {
  const a = await connect(), b = await connect(B); const receipt = await register(a);
  a.on('message', raw => { const data = JSON.parse(String(raw)); if (data.method) a.send(JSON.stringify({ id: data.id, ok: true, result: snapshot() })); });
  b.send(JSON.stringify({ type: 'media_recording_task_update', result: { ...snapshot(), state: 'error', error: 'forged' } }));
  const missing = await fetch(receipt.statusUrl); expect(missing.status).toBe(200); expect(await missing.json()).toMatchObject({ status: 'recording', done: false });
  expect((await fetch(receipt.statusUrl, { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
  const wrongHost = await new Promise<number>(resolve => { httpRequest(receipt.statusUrl, { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode!); }).end(); });
  expect(wrongHost).toBe(403);
  expect((await fetch(`${receipt.statusUrl}?path=/etc/passwd`)).status).toBe(404);
  expect((await fetch(receipt.statusUrl, { method: 'POST' })).status).toBe(405);
  expect((await fetch(receipt.statusUrl.replace(/.$/, '!'))).status).toBe(404);
  const next = await register(a, snapshot('clip-two')); expect(next.statusUrl).not.toBe(receipt.statusUrl);
  a.send(JSON.stringify({ type: 'media_recording_task_update', result: { ...snapshot(), state: 'error', error: 'source interrupted' } }));
  await vi.waitFor(async () => expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ status: 'failed', done: true, error: 'source interrupted' }));
});
it('reports partial fixed-duration clips as failure but accepts explicit start/stop tasks', async () => {
  const extension = await connect(); const full = await register(extension), manual = await register(extension, snapshot('manual'), false);
  const path = join(directory, 'partial.webm'); await writeFile(path, 'bytes');
  for (const id of ['clip', 'manual']) extension.send(JSON.stringify({ type: 'media_recording_task_update', result: { ...snapshot(id), state: 'saved', savedPath: path, bytes: 5, durationMs: 1500, stopReason: 'manual' } }));
  await vi.waitFor(async () => expect(await (await fetch(full.statusUrl)).json()).toMatchObject({ status: 'failed', success: false, partialFile: { filePath: path } }));
  const partial = await (await fetch(full.statusUrl)).json(); expect(partial.filePath).toBeUndefined();
  expect(await (await fetch(manual.statusUrl)).json()).toMatchObject({ status: 'completed', success: true, filePath: path });
  await rm(path); const absent = await fetch(manual.statusUrl); expect(absent.status).toBe(503); expect(await absent.json()).toMatchObject({ status: 'failed', success: false });
});
it('restores the same capability URLs from a private persistent index after a broker restart', async () => {
  const extension = await connect(); const receipt = await register(extension);
  extension.send(JSON.stringify({ type: 'media_recording_task_update', result: { ...snapshot(), state: 'error', error: 'interrupted' } }));
  await vi.waitFor(async () => expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ status: 'failed' }));
  const port = bridge.address()!.port; await bridge.close();
  bridge = new ExtensionBridge(port, { recordingTaskStorePath: join(directory, 'tasks.json') }); await bridge.ready;
  expect(await (await fetch(receipt.statusUrl)).json()).toMatchObject({ taskId: receipt.taskId, status: 'failed', error: 'interrupted' });
  const offline = await register(await connect(), snapshot('offline'));
  sockets.at(-1)!.close(); await vi.waitFor(() => expect(bridge.connected).toBe(false));
  const unavailable = await fetch(offline.statusUrl); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ status: 'unavailable', done: false });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RECORDING_TASK_TTL_MS + 1);
  expect((await fetch(receipt.statusUrl)).status).toBe(410);
  const index = JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8')); expect(index.tasks[0].snapshot.blobUrl).toBeUndefined();
});
it('expires URLs and never changes a terminal result back into progress', async () => {
  const registry = new RecordingTaskRegistry(() => 'http://127.0.0.1:17373');
  const receipt = await registry.create(A, snapshot(), true, 5000); const token = new URL(receipt.statusUrl).pathname.split('/').pop()!;
  await registry.update(A, { ...snapshot(), state: 'error', error: 'failed' });
  await registry.update(A, snapshot()); expect((await registry.get(token))?.snapshot.state).toBe('error');
  expect(await registry.create(A, snapshot(), true, 5000)).toEqual(receipt);
  await expect(registry.create(A, snapshot('invalid'), true, 1800001)).rejects.toThrow('时长');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RECORDING_TASK_TTL_MS + 1);
  const fresh = await registry.create(A, snapshot(), true, 5000); expect(fresh.statusUrl).not.toBe(receipt.statusUrl);
});
