vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import type { PaginationNode, WorkflowNode, WorkflowEdge } from '@/types/workflow';
const dom: WorkflowNode = { id: 'input', name: '输入', kind: 'dom', target: { name: '输入', selector: '#field', frameId: 0, tagName: 'input', label: '' }, event: { type: 'input', value: '{{page}}:{{item}}' } };
const pagination: PaginationNode = { id: 'pages', name: '分页', kind: 'pagination', target: { name: '分页', selector: '#pages', frameId: 0, tagName: 'div', label: '' }, mode: 'all', page: '{{target}}', pageVariable: 'page', maxPages: 10, timeoutMs: 100, settleMs: 0, body: { nodes: [dom], edges: [] } };
const edge = (from: string, to: string, port: WorkflowEdge['sourcePort']): WorkflowEdge => ({ id: `${from}_${to}`, sourceNodeId: from, targetNodeId: to, sourcePort: port });
function setup(total = 3, fail = false, known = true) {
  let page = 1;
  const send = vi.fn(async (_id: number, message: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (message.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
    if (message.type === 'PAGE_AGENT_LOCATE_SELECTOR') return { ok: true, count: 1 };
    if (message.type === 'PAGE_AGENT_PAGINATION') { if (message.page !== undefined) page = Number(message.page); return { ok: true, data: { page, totalPages: total, hasNext: known ? page < total : null } }; }
    return fail ? { ok: false, error: '输入验收失败' } : { ok: true };
  });
  vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), sendMessage: send }, webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
  return send;
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('container execution', () => {
  it('continues for empty matches and stops before page 3 only after a successful page-2 body', async () => {
    const send = setup(1828);
    const query: WorkflowNode = { id: 'match', name: '本页匹配', kind: 'query', target: { ...pagination.target, selector: '#table' }, query: { candidateSelector: 'tr', includeRoot: false, source: 'text', attributeName: '', match: 'equals', pattern: '茶', regexFlags: '', readSelector: ':scope > td:nth-child(2)' } };
    const normal = send.getMockImplementation()!;
    send.mockImplementation(async (id, message) => message.type === 'PAGE_AGENT_QUERY_DOM' ? { ok: true, data: message.query && send.mock.calls.filter(([, m]) => m.type === 'PAGE_AGENT_QUERY_DOM').length === 2 ? [{ selector: '#row' }] : [] } : normal(id, message));
    const result = await runGraph([{ ...pagination, maxPages: 5000, stopWhen: '{{本页匹配.output}}', body: { nodes: [query], edges: [] } }], []);
    expect(result.ok).toBe(true);
    expect(send.mock.calls.filter(([, m]) => m.type === 'PAGE_AGENT_PAGINATION' && m.page !== undefined).map(([, m]) => m.page)).toEqual([1, 2]);
    expect(result.steps.find(step => (step.data as { complete?: boolean })?.complete)?.data).toMatchObject({ terminationReason: 'condition', visited: [1, 2] });
  });
  it('does not let a nonempty stale result mask a child error', async () => {
    setup(3, true);
    expect((await runGraph([{ ...pagination, stopWhen: '{{found}}' }], [], { found: ['row'] })).ok).toBe(false);
  });
  it('has a bounded budget large enough for declared large pagination', async () => {
    setup(1100);
    const result = await runGraph([{ ...pagination, maxPages: 1200 }], []);
    expect(result.ok).toBe(true);
    expect(result.steps.filter(step => step.nodeId === 'input')).toHaveLength(1100);
  });
  it('normally completes after processing page 10 and never requests page 11', async () => {
    const send=setup(1000); const after:WorkflowNode={id:'after',name:'完成',kind:'wait',durationMs:0};
    const result=await runGraph([{...pagination,stopAtPage:'10'},after],[edge('pages','after','done')]);
    expect(result.ok).toBe(true); expect(result.steps.filter(s=>s.nodeId==='input')).toHaveLength(10);
    expect(send.mock.calls.filter(([,m])=>m.type==='PAGE_AGENT_PAGINATION' && m.page!==undefined).map(([,m])=>m.page)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(result.steps.find(s=>s.nodeId==='pages' && (s.data as {complete?:boolean})?.complete)?.data).toMatchObject({terminationReason:'stopAtPage',stopAtPage:10});
    expect(result.steps.at(-1)?.nodeId).toBe('after');
  });
  it('resolves a variable stop page before overriding the current-page variable', async () => {
    setup(100); const result=await runGraph([{...pagination,stopAtPage:'{{page}}'}],[],{page:2});
    expect(result.ok).toBe(true);expect(result.steps.filter(s=>s.nodeId==='input')).toHaveLength(2);
  });
  it('finishes at the actual last page if it precedes the configured stop page', async () => {
    setup(3);const result=await runGraph([{...pagination,stopAtPage:'10'}],[]);
    expect(result.ok).toBe(true);expect(result.steps.filter(s=>s.nodeId==='input')).toHaveLength(3);
    expect(result.steps.find(s=>s.nodeId==='pages' && (s.data as {complete?:boolean})?.complete)?.data).toMatchObject({terminationReason:'lastPage'});
  });
  it.each(['','  ','0','-1','1.5','abc','{{missing}}'])('rejects invalid stop page %s before any page operation',async stopAtPage=>{
    const send=setup(100);const result=await runGraph([{...pagination,stopAtPage}],[]);
    expect(result.ok).toBe(false);expect(result.error).toContain('终止页码');expect(send).not.toHaveBeenCalled();
  });
  it('does not confuse a safety limit or child failure with normal termination', async () => {
    setup(100); expect((await runGraph([{...pagination,maxPages:2,stopAtPage:'10'}],[])).ok).toBe(false);
    setup(100,true); expect((await runGraph([{...pagination,stopAtPage:'1'}],[])).ok).toBe(false);
  });
  it('supports pagination nested inside a loop with isolated item and page variables', async () => {
    const send = setup(2);
    const loop: WorkflowNode = { id:'loop', name:'循环', kind:'loop', items:'["a","b"]', itemVariable:'item', indexVariable:'index', maxIterations:10, body:{ nodes:[pagination], edges:[] } };
    expect((await runGraph([loop],[])).ok).toBe(true);
    expect(send.mock.calls.filter(([,m])=>m.type==='PAGE_AGENT_EXECUTE_EVENT').map(([,m])=>(m.event as {value:string}).value)).toEqual(['1:a','2:a','1:b','2:b']);
  });
  it('executes the internal body once for each page, then takes done', async () => {
    const send = setup(); const after: WorkflowNode = { id: 'after', name: '完成', kind: 'wait', durationMs: 0 };
    const progress = vi.fn();
    const result = await runGraph([pagination, after], [edge('pages','after','done')], { item: 'abc' }, progress);
    expect(result.ok).toBe(true);
    expect(send.mock.calls.filter(([, m]) => m.type === 'PAGE_AGENT_EXECUTE_EVENT').map(([, m]) => (m.event as { value: string }).value)).toEqual(['1:abc','2:abc','3:abc']);
    expect(result.steps.at(-1)?.nodeId).toBe('after');
    expect(progress.mock.calls.filter(([id, phase]) => id === 'input' && phase === 'completed')).toHaveLength(3);
    expect(progress.mock.calls.filter(([id, phase]) => id === 'pages' && phase === 'completed')).toHaveLength(1);
  });
  it('resolves a variable target page and restores the outer page variable', async () => {
    const send = setup(10); const after = { ...dom, id: 'after', name: '后续' };
    expect((await runGraph([{ ...pagination, mode: 'goto' }, after], [edge('pages','after','done')], { target: 7, page: 'outer', item: 'abc' })).ok).toBe(true);
    expect(send.mock.calls.filter(([, m]) => m.type === 'PAGE_AGENT_EXECUTE_EVENT').map(([, m]) => (m.event as { value: string }).value)).toEqual(['7:abc','outer:abc']);
  });
  it('fails on partial pagination rather than claiming all pages were traversed', async () => {
    setup(5); const result = await runGraph([{ ...pagination, maxPages: 2 }], []);
    expect(result.ok).toBe(false); expect(result.error).toContain('仍有后续页');
  });
  it('fails when the last page cannot be verified', async () => {
    setup(3,false,false); expect((await runGraph([pagination], [])).error).toContain('无法确认');
  });
  it('routes a failing body through the container failure output', async () => {
    setup(3,true); const recovery: WorkflowNode = { id: 'recover', name: '恢复', kind: 'wait', durationMs: 0 };
    const result = await runGraph([pagination,recovery], [edge('pages','recover','failure')]);
    expect(result.ok).toBe(true); expect(result.steps.some((s) => s.nodeId === 'input' && !s.ok)).toBe(true); expect(result.steps.at(-1)?.nodeId).toBe('recover');
  });
  it('runs a loop body without an external back edge and restores variables', async () => {
    const send = setup(); const loop: WorkflowNode = { id: 'loop', name: '循环', kind: 'loop', items: '["a","b"]', itemVariable: 'item', indexVariable: 'index', maxIterations: 10, body: { nodes: [dom], edges: [] } };
    const after = { ...dom, id: 'after', name: '后续' };
    expect((await runGraph([loop,after], [edge('loop','after','done')], { page: 1, item: 'old' })).ok).toBe(true);
    expect(send.mock.calls.filter(([, m]) => m.type === 'PAGE_AGENT_EXECUTE_EVENT').map(([, m]) => (m.event as { value: string }).value)).toEqual(['1:a','1:b','1:old']);
  });
});
