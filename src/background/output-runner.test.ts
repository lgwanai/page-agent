vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugNode, runGraph } from './runner';
import { DEFAULT_DOM_QUERY, type OutputNode, type QueryNode, type WorkflowEdge, type WorkflowNode } from '@/types/workflow';

const output: OutputNode = { id: 'out', kind: 'output', name: '返回结果', source: 'text', value: '未成功', outcome: 'failure' };
const query: QueryNode = { id: 'query', kind: 'query', name: '已完成状态', target: { name: '状态', selector: '#status', tagName: 'td', label: '', frameId: 0 }, query: { ...DEFAULT_DOM_QUERY, source: 'text', match: 'contains', pattern: '取数完成' }, onEmpty: 'failure' };
const edge = (sourceNodeId: string, targetNodeId: string, sourcePort: WorkflowEdge['sourcePort'] = 'success'): WorkflowEdge => ({ id: `${sourceNodeId}_${targetNodeId}_${sourcePort}`, sourceNodeId, targetNodeId, sourcePort });
function setup(queryData: unknown[] = [], domData: unknown = 'ready') {
  const send = vi.fn(async (_tab, message) => {
    if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: 1 };
    if (message.type === 'PAGE_AGENT_QUERY_DOM') return { ok: true, data: queryData };
    if (message.type === 'PAGE_AGENT_READ_OUTPUT') return { ok: true, data: domData };
    return { ok: true, data: 'clicked' };
  });
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com', documentId: 'doc' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  return send;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('Output execution and Query branching', () => {
  it('returns a business failure without confusing it with an execution failure', async () => {
    const send = setup();
    const result = await runGraph([query, output], [edge('query', 'out', 'failure')]);
    expect(result).toMatchObject({ ok: true, output: '未成功', outputs: { 返回结果: '未成功' }, businessOk: false });
    expect(result.steps[0]).toMatchObject({ ok: false, outputPort: 'failure', diagnostic: { code: 'QUERY_NO_MATCH' } });
    expect(send.mock.calls.some(([, message]) => message.type === 'PAGE_AGENT_EXECUTE_EVENT')).toBe(false);
  });
  it('takes only the success branch on a match and never returns the failure text', async () => {
    setup([{ selector: '#status', text: '取数完成' }]);
    const success: OutputNode = { ...output, id: 'success', name: '成功结果', value: '已触发下载', outcome: 'success' };
    const result = await runGraph([query, output, success], [edge('query', 'out', 'failure'), edge('query', 'success')]);
    expect(result).toMatchObject({ ok: true, output: '已触发下载', businessOk: true });
    expect(result.steps.some(step => step.nodeId === 'out')).toBe(false);
  });
  it('preserves legacy empty Query output and fails when a configured failure branch is unhandled', async () => {
    setup();
    expect((await runGraph([{ ...query, onEmpty: undefined }], [])).ok).toBe(true);
    expect((await runGraph([query], [])).ok).toBe(false);
  });
  it.each([0, false, null, ['a', 2], { rows: [{ count: 2 }] }])('preserves variable JSON types: %j', async value => {
    setup();
    expect(await runGraph([{ ...output, source: 'variable', value: '{{data}}', outcome: 'neutral' }], [], { data: value })).toMatchObject({ ok: true, output: value });
  });
  it('interpolates text and rejects missing or unsafe variable paths', async () => {
    setup();
    expect((await runGraph([{ ...output, value: '状态：{{status}}' }], [], { status: '完成' })).output).toBe('状态：完成');
    for (const value of ['{{missing}}', '{{data.constructor}}']) expect((await runGraph([{ ...output, source: 'variable', value }], [], { data: {} })).ok).toBe(false);
    expect((await runGraph([{ ...output, value: '状态：{{missing}}' }], [])).ok).toBe(false);
  });
  it('reads a previous node output and a nested field without evaluating code', async () => {
    setup([{ selector: '#s', value: '完成' }]);
    const node: OutputNode = { ...output, source: 'node', sourceNodeId: 'query', path: '0.value' };
    expect((await runGraph([query, node], [edge('query', 'out')])).output).toBe('完成');
    expect((await runGraph([node, query], [])).error).toContain('尚未执行');
    expect((await runGraph([query, { ...node, path: '0.noSuchField' }], [edge('query', 'out')])).error).toContain('字段不存在');
  });
  it('reads the requested DOM attribute in the selected document', async () => {
    const send = setup([], ['10', '20']);
    const node: OutputNode = { ...output, source: 'dom', target: query.target, read: 'attribute', attributeName: '{{attr}}', multiple: true };
    expect((await runGraph([node], [], { attr: 'data-id' })).output).toEqual(['10', '20']);
    expect(send).toHaveBeenCalledWith(1, { type: 'PAGE_AGENT_READ_OUTPUT', selector: '#status', read: 'attribute', attributeName: 'data-id', multiple: true }, { frameId: 0, documentId: 'doc' });
  });
  it('propagates nested outputs and never leaks results between runs or debug sessions', async () => {
    setup();
    const loop: WorkflowNode = { id: 'loop', name: '循环', kind: 'loop', items: '[1]', itemVariable: 'item', indexVariable: 'i', maxIterations: 1, body: { nodes: [output], edges: [] } };
    expect(await runGraph([loop], [])).toMatchObject({ ok: true, output: '未成功', businessOk: false });
    expect(await debugNode([output], 'out', {})).toMatchObject({ output: '未成功', businessOk: false });
    const next = await runGraph([{ id: 'wait', kind: 'wait', name: '等待', durationMs: 0 }], []);
    expect(next).not.toHaveProperty('output');
  });
  it('collects named outputs, preserves failure business status and reports later execution errors honestly', async () => {
    setup();
    const other: OutputNode = { ...output, id: 'other', name: '其他结果', value: '完成', outcome: 'success' };
    const result = await runGraph([output, other], [edge('out', 'other')]);
    expect(result).toMatchObject({ output: '完成', outputs: { 返回结果: '未成功', 其他结果: '完成' }, businessOk: false });
    const failed = await runGraph([output, { ...other, source: 'variable', value: '{{missing}}' }], [edge('out', 'other')]);
    expect(failed).toMatchObject({ ok: false, output: '未成功', businessOk: false });
  });
});
