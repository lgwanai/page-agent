import { expect, it } from 'vitest';
import type { RequestNode } from '@/types/workflow';
import { requestHeaders, validateRequestNode } from './request';
import { exportWorkflow, importWorkflow } from './workflow-file';
export const requestNode = (): RequestNode => ({ id: 'request', name: '请求', kind: 'request', url: 'https://example.com/{{path}}', method: 'GET', headers: '{"Authorization":"Bearer {{token}}"}', body: '', responseType: 'json', timeoutMs: 30000 });
it('round trips a request through export, import and nested workflow validation', () => {
  const node = requestNode();
  const workflow = { id: '11223344-1111-4111-8111-aabbccddeeff', name: '请求流程', nodes: [node], edges: [], createdAt: 1, updatedAt: 1 };
  expect(importWorkflow(exportWorkflow(workflow), []).workflow.nodes.find(item => item.id === node.id)).toMatchObject(node);
  const nested = { ...workflow, nodes: [{ id: 'loop', name: '循环', kind: 'loop' as const, items: '[]', itemVariable: 'item', indexVariable: 'index', maxIterations: 1, body: { nodes: [node], edges: [] } }] };
  expect(importWorkflow(exportWorkflow(nested), []).workflow.nodes.find(item => item.id === 'loop')).toMatchObject({ body: { nodes: [expect.objectContaining(node)] } });
});
it.each([
  { url: 'file:///tmp/file' }, { url: 'javascript:alert(1)' }, { url: 'https://u:p@example.com' }, { url: '' },
  { method: 'TRACE' }, { headers: '[]' }, { headers: 'null' }, { headers: '{"x":3}' }, { headers: '{' }, { headers: '{"x":"a\\r\\nb"}' },
  { method: 'GET', body: '{}' }, { method: 'HEAD', body: 'body' }, { responseType: 'html' }, { timeoutMs: NaN }, { timeoutMs: 0 }, { timeoutMs: 300001 },
])('rejects invalid request config %j before execution or import', patch => {
  const node = { ...requestNode(), ...patch } as RequestNode;
  expect(() => validateRequestNode(node)).toThrow();
  expect(() => importWorkflow(exportWorkflow({ id: '11223344-1111-4111-8111-aabbccddeeff', name: '请求', nodes: [node], edges: [], createdAt: 1, updatedAt: 1 }), [])).toThrow();
});
it('allows text responses and post bodies, and treats header values as strings', () => {
  expect(() => validateRequestNode({ ...requestNode(), method: 'POST', body: '{{对象}}', responseType: 'text' })).not.toThrow();
  expect(requestHeaders(requestNode().headers)).toEqual({ Authorization: 'Bearer {{token}}' });
});
