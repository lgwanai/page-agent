import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DOM_QUERY, type WorkflowNode, type WorkflowEdge } from '@/types/workflow';
import { runGraph } from './runner';
import { invokeAiNode } from './ai-provider';

vi.mock('./ai-provider', () => ({ invokeAiNode: vi.fn().mockResolvedValue({ output: { done: true } }) }));

const query: WorkflowNode = {
  id: 'query', kind: 'query', name: '结果',
  target: { name: '结果', selector: '{{范围}}', frameId: 7, tagName: 'div', label: '列表' },
  query: { ...DEFAULT_DOM_QUERY, source: 'attribute', attributeName: 'href', match: 'regex', pattern: '{{规则}}' },
};
const edge = (sourceNodeId: string, targetNodeId: string, sourcePort: WorkflowEdge['sourcePort'] = 'success'): WorkflowEdge => ({ id: `${sourceNodeId}_${targetNodeId}_${sourcePort}`, sourceNodeId, targetNodeId, sourcePort });
const matches = [{ selector: '#one', value: '订单1', attributes: { href: '/1' } }, { selector: '#two', value: '订单2', attributes: { href: '/2' } }];

function mockChrome(response: Record<string, unknown> = { ok: true, data: matches }) {
  const sendMessage = vi.fn(async (_tabId: number, message: { type: string }, _options: { frameId: number }) => message.type === 'PAGE_AGENT_QUERY_DOM' ? response : { ok: true });
  const dispatch = vi.fn(async (tabId: number, message: { type: string }, options: { frameId: number }) => {
    if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: 1 };
    return sendMessage(tabId, message, options);
  });
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: dispatch }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 7, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  return sendMessage;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Query graph integration', () => {
  it('maps input variables and passes the DOM array into loop operations', async () => {
    const send = mockChrome();
    const loop: WorkflowNode = { id: 'loop', kind: 'loop', name: '循环', items: '{{结果.output}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10 };
    const dom: WorkflowNode = { id: 'dom', kind: 'dom', name: '输入', target: { name: '输入', selector: '{{item.selector}}', frameId: 7, tagName: 'input', label: '' }, event: { type: 'input', value: '{{item.value}}' } };
    const result = await runGraph([query, loop, dom], [edge('query', 'loop'), edge('loop', 'dom', 'body'), edge('dom', 'loop')], { 范围: '#orders', 规则: '^/orders/' });
    expect(result.ok).toBe(true);
    expect(send).toHaveBeenNthCalledWith(1, 1, { type: 'PAGE_AGENT_QUERY_DOM', selector: '#orders', query: { ...query.query, pattern: '^/orders/' } }, { frameId: 7 });
    expect(send).toHaveBeenNthCalledWith(2, 1, { type: 'PAGE_AGENT_EXECUTE_EVENT', selector: '#one', event: { type: 'input', value: '订单1' } }, { frameId: 7 });
    expect(send).toHaveBeenNthCalledWith(3, 1, { type: 'PAGE_AGENT_EXECUTE_EVENT', selector: '#two', event: { type: 'input', value: '订单2' } }, { frameId: 7 });
    expect(result.steps[0].data).toEqual(matches.map((item) => ({ ...item, frameId: 7 })));
  });

  it('provides Query output to AI node inputs without losing list types', async () => {
    mockChrome();
    const ai: WorkflowNode = { id: 'ai', name: 'AI', kind: 'ai', instruction: '分析列表', event: { type: 'click' }, inputs: [{ id: 'input', name: '列表', type: 'node', sourceNodeId: 'query' }] };
    expect((await runGraph([query, ai], [edge('query', 'ai')])).ok).toBe(true);
    expect(invokeAiNode).toHaveBeenCalledWith('分析列表', [{ name: '列表', type: 'query', value: { ok: true, output: matches.map((item) => ({ ...item, frameId: 7 })), data: matches.map((item) => ({ ...item, frameId: 7 })) } }], []);
  });

  it('takes the failure edge when querying fails, but accepts empty results', async () => {
    mockChrome({ ok: false, error: 'Query 正则表达式无效' });
    const wait: WorkflowNode = { id: 'wait', name: '恢复', kind: 'wait', durationMs: 0 };
    const failed = await runGraph([query, wait], [edge('query', 'wait', 'failure')]);
    expect(failed.ok).toBe(true);
    expect(failed.steps.map((step) => [step.nodeId, step.outputPort])).toEqual([['query', 'failure'], ['wait', 'success']]);
    mockChrome({ ok: true, data: [] });
    const empty = await runGraph([query], []);
    expect(empty.ok).toBe(true);
    expect(empty.steps[0].data).toEqual([]);
  });
});
