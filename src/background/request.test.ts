import { afterEach, expect, it, vi } from 'vitest';
import type { RequestNode, WorkflowNode } from '@/types/workflow';
import { executeRequest } from './request';
import { beginExecution, cancelExecution, finishExecution, RunCancelled } from './execution-control';
import { runGraph } from './runner';
const node = (): RequestNode => ({ id: 'request', name: '请求', kind: 'request', url: 'https://example.com/api/{{path}}', method: 'GET', headers: '{"Authorization":"Bearer {{token}}"}', body: '', responseType: 'json', timeoutMs: 500 });
afterEach(() => { finishExecution(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('interpolates URL/headers and serializes a typed body once without sending cookies', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":5}', { status: 201 })); vi.stubGlobal('fetch', fetchMock);
  expect(await executeRequest({ ...node(), method: 'POST', body: '{{payload}}' }, { path: 'items', token: 'secret', payload: { name: '测试' } }, {})).toEqual({ data: { id: 5 }, status: 201 });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://example.com/api/items'); expect(init.body).toBe('{"name":"测试"}');
  expect(init.headers.get('Authorization')).toBe('Bearer secret'); expect(init.credentials).toBe('omit');
});
it.each(['[1,2]', '42', 'null', 'true', '"文字"'])('preserves the JSON response type for %s', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  expect((await executeRequest(node(), {}, {})).data).toEqual(JSON.parse(body));
});
it('returns text without parsing and rejects invalid JSON, HTTP errors and network errors without retry', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response('plain text')); vi.stubGlobal('fetch', fetchMock);
  expect((await executeRequest({ ...node(), responseType: 'text' }, {}, {})).data).toBe('plain text');
  await expect(executeRequest(node(), {}, {})).rejects.toThrow('不是有效的 JSON');
  fetchMock.mockResolvedValueOnce(new Response('failure', { status: 503 }));
  await expect(executeRequest(node(), {}, {})).rejects.toThrow('HTTP 503');
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(executeRequest(node(), {}, {})).rejects.toThrow('网络请求失败'); expect(fetchMock).toHaveBeenCalledTimes(4);
});
it('rejects unsafe URLs after interpolation, and header newlines, before dispatch', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  await expect(executeRequest({ ...node(), url: '{{url}}' }, { url: 'file:///secret' }, {})).rejects.toThrow('HTTP/HTTPS');
  await expect(executeRequest(node(), { token: 'a\r\nx: b' }, {})).rejects.toThrow('换行');
  expect(fetchMock).not.toHaveBeenCalled();
});
it('aborts a timed out fetch and cancels a running request when the workflow stops', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  vi.stubGlobal('fetch', fetchMock);
  const timeout = expect(executeRequest(node(), {}, {})).rejects.toThrow('请求超时');
  await vi.advanceTimersByTimeAsync(501); await timeout;
  const runId = beginExecution();
  const cancelled = expect(executeRequest(node(), {}, {})).rejects.toBeInstanceOf(RunCancelled);
  cancelExecution(runId); await cancelled;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('applies the timeout while the response body is still being read', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok: true, status: 200, text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) })));
  const timeout = expect(executeRequest(node(), {}, {})).rejects.toThrow('请求超时');
  await vi.advanceTimersByTimeAsync(501); await timeout;
});
it('makes JSON available to downstream nodes and follows the failure edge for HTTP errors', async () => {
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } } });
  const fetchMock = vi.fn().mockImplementation(async () => new Response('{"id":7}')); vi.stubGlobal('fetch', fetchMock);
  const nodes: WorkflowNode[] = [node(), { id: 'out', name: '输出', kind: 'output', source: 'variable', value: '{{请求.output.id}}', outcome: 'neutral' }];
  expect(await runGraph(nodes, [{ id: 'edge', sourceNodeId: 'request', sourcePort: 'success', targetNodeId: 'out' }])).toMatchObject({ ok: true, output: 7 });
  fetchMock.mockImplementation(async () => new Response('', { status: 500 }));
  const fallback: WorkflowNode = { id: 'fallback', name: '失败结果', kind: 'output', source: 'text', value: '请求失败', outcome: 'failure' };
  expect(await runGraph([node(), fallback], [{ id: 'failure', sourceNodeId: 'request', sourcePort: 'failure', targetNodeId: 'fallback' }])).toMatchObject({ ok: true, output: '请求失败', businessOk: false, steps: [expect.objectContaining({ ok: false, outputPort: 'failure' }), expect.objectContaining({ ok: true })] });
});
