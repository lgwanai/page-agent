import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAuthoring, validateGraph } from './authoring';
import { createStartNode, type ScriptDefinition } from '@/types/workflow';

let stored: Record<string, unknown>;
beforeEach(() => {
  stored = {};
  const area = {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(stored[key])]))),
    set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, structuredClone(value)); }),
    remove: vi.fn(async (key: string) => { delete stored[key]; }),
  };
  vi.stubGlobal('chrome', { storage: { local: area, session: area }, runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), get: vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com', status: 'complete' }), sendMessage: vi.fn(async (_tab, message) => message.type === 'PAGE_AGENT_PING' ? { ok: true, frameLocator: true } : { ok: true, nodes: [] }) },
    webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, url: 'https://example.com', documentId: 'doc-main' }, { frameId: 19, url: 'https://example.com/frame', documentId: 'doc-child' }]) },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function create() {
  return await handleAuthoring('create_workflow', { name: 'Agent 新工作流' }) as { workflow: ScriptDefinition; key: string };
}
describe('authenticated workflow authoring', () => {
  it('saves and reopens Output and returns it from authenticated MCP debugging', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    const output = { id: 'out', name: '未完成结果', kind: 'output', source: 'text', value: '未成功', outcome: 'failure' };
    await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [
      { type: 'add_node', node: output },
      { type: 'connect', edge: { id: 'out-edge', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'out' } },
    ] });
    expect(await handleAuthoring('get_workflow', auth)).toMatchObject({ nodes: [expect.anything(), output] });
    expect(await handleAuthoring('debug_node', { ...auth, nodeId: 'out', data: {} })).toMatchObject({ result: { ok: true, output: '未成功', businessOk: false, outputs: { 未完成结果: '未成功' } } });
  });
  it('adds, connects, updates and removes nodes inside a container via MCP operations', async () => {
    const {workflow,key}=await create(); const auth={workflowId:workflow.id,key};
    const edited=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:workflow.updatedAt,operations:[
      {type:'add_node',node:{id:'loop',kind:'loop',name:'循环',items:'[1]',itemVariable:'item',indexVariable:'index',maxIterations:10,body:{nodes:[],edges:[]}}},
      {type:'add_node',parentNodeId:'loop',node:{id:'child',kind:'wait',name:'内部等待',durationMs:0}},
      {type:'add_node',parentNodeId:'loop',node:{id:'child2',kind:'wait',name:'内部等待2',durationMs:0}},
      {type:'connect',edge:{id:'inner-edge',sourceNodeId:'child',targetNodeId:'child2',sourcePort:'success'}},
      {type:'update_node',nodeId:'child2',patch:{durationMs:12}},
    ]}) as ScriptDefinition;
    const loop=edited.nodes.find((n)=>n.kind==='loop');
    expect(loop?.kind==='loop' && loop.body).toMatchObject({entryNodeId:'child',nodes:[{id:'child'},{id:'child2',durationMs:12}],edges:[{id:'inner-edge'}]});
    const removed=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:edited.updatedAt,operations:[{type:'remove_node',nodeId:'child2'}]}) as ScriptDefinition;
    expect(removed.nodes.find((n)=>n.kind==='loop')).toMatchObject({body:{nodes:[{id:'child'}],edges:[],entryNodeId:'child'}});
  });
  it('creates a saved UUID workflow with one Start and its own key', async () => {
    const { workflow, key } = await create();
    expect(workflow.id).toMatch(/^[\da-f-]{36}$/); expect(key.length).toBeGreaterThan(20);
    expect(workflow.nodes).toHaveLength(1); expect(workflow.nodes[0].kind).toBe('start');
    expect(await handleAuthoring('get_workflow', { workflowId: workflow.id, key })).toEqual(expect.objectContaining({ id: workflow.id }));
    await expect(handleAuthoring('get_workflow', { workflowId: workflow.id, key: 'wrong' })).rejects.toThrow('密钥');
  });
  it('atomically adds a node and connection, then updates and removes it', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    const next = await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [
      { type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: 0 } },
      { type: 'connect', edge: { id: 'e', sourceNodeId: 'start', targetNodeId: 'wait', sourcePort: 'success' } },
    ] }) as ScriptDefinition;
    expect(next.nodes).toHaveLength(2); expect(next.updatedAt).toBeGreaterThan(workflow.updatedAt);
    const removed = await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: next.updatedAt, operations: [{ type: 'remove_node', nodeId: 'wait' }] }) as ScriptDefinition;
    expect(removed.nodes).toHaveLength(1); expect(removed.edges).toEqual([]);
  });
  it('rejects stale edits, including concurrent clients', async () => {
    const { workflow, key } = await create();
    const params = { workflowId: workflow.id, key, expectedUpdatedAt: workflow.updatedAt, name: '新名称' };
    const results = await Promise.allSettled([handleAuthoring('edit_workflow', params), handleAuthoring('edit_workflow', params)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('does not save a partially invalid edit', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    await expect(handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [
      { type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: -1 } },
    ] })).rejects.toMatchObject({ diagnostic: { code: 'WORKFLOW_INVALID', phase: 'validation', context: { nodeId: 'wait', path: 'nodes[1].durationMs' } } });
    expect((await handleAuthoring('get_workflow', auth) as ScriptDefinition).nodes).toHaveLength(1);
  });
  it('exports without keys and imports with a new identity on conflict', async () => {
    const { workflow, key } = await create();
    const file = await handleAuthoring('export_workflow', { workflowId: workflow.id, key });
    expect(JSON.stringify(file)).not.toContain(key);
    const imported = await handleAuthoring('import_workflow', { file }) as { workflow: ScriptDefinition; key: string };
    expect(imported.workflow.id).not.toBe(workflow.id); expect(imported.key).not.toBe(key);
  });
  it('lists frames and pins inspection to the selected document', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    expect(await handleAuthoring('inspect_page', { ...auth, listFrames: true })).toMatchObject({ frames: [{ frameId: 0 }, { frameId: 19 }] });
    await handleAuthoring('inspect_page', { ...auth, frameUrl: 'https://example.com/frame', selector: '#form' });
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ type: 'PAGE_AGENT_INSPECT_PAGE', selector: '#form' }), { frameId: 19, documentId: 'doc-child' });
    await expect(handleAuthoring('inspect_page', { ...auth, frameId: 999 })).rejects.toThrow('Frame');
  });
  it('debugs exactly one node and stores only the latest session report', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [{ type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: 0 } }] });
    const report = await handleAuthoring('debug_node', { ...auth, nodeId: 'wait', data: {} });
    expect(report).toMatchObject({ result: { ok: true, steps: [{ nodeId: 'wait' }] } });
    expect(await handleAuthoring('get_debug_result', auth)).toEqual(report);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('protects concurrent execution and does not overwrite edits when a full run finishes', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    const edited = await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [
      { type: 'update_node', nodeId: 'start', patch: { settleDelayMs: 0 } },
      { type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: 150 } },
      { type: 'connect', edge: { id: 'e', sourceNodeId: 'start', targetNodeId: 'wait', sourcePort: 'success' } },
    ] }) as ScriptDefinition;
    const running = handleAuthoring('debug_workflow', auth);
    await vi.waitFor(() => expect(chrome.tabs.get).toHaveBeenCalled());
    await expect(handleAuthoring('debug_node', { ...auth, nodeId: 'wait' })).rejects.toThrow('正在执行');
    await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: edited.updatedAt, name: '运行期间的新编辑' });
    expect(await running).toMatchObject({ result: { ok: true, steps: [{ nodeId: 'start' }, { nodeId: 'wait' }] } });
    expect(await handleAuthoring('get_workflow', auth)).toMatchObject({ name: '运行期间的新编辑', lastRunAt: expect.any(Number) });
  });
  it('validates disconnected nodes without operating the page', async () => {
    const { workflow, key } = await create(); const auth = { workflowId: workflow.id, key };
    await handleAuthoring('edit_workflow', { ...auth, expectedUpdatedAt: workflow.updatedAt, operations: [{ type: 'add_node', node: { id: 'wait', name: '等待', kind: 'wait', durationMs: 0 } }] });
    expect(await handleAuthoring('validate_workflow', auth)).toMatchObject({ valid: true, ready: false, warnings: [{ nodeId: 'wait' }] });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });
});

describe('graph validation', () => {
  const graph = (): ScriptDefinition => ({ id: crypto.randomUUID(), name: '流程', nodes: [createStartNode('start'), { id: 'wait', kind: 'wait', name: '等待', durationMs: 0 }], edges: [], createdAt: 1, updatedAt: 1 });
  it('rejects duplicate names and multiple Starts', () => {
    const g = graph(); g.nodes.push({ id: 'wait2', kind: 'wait', name: '等待', durationMs: 0 }); expect(() => validateGraph(g)).toThrow('唯一');
    g.nodes = [createStartNode('a'), createStartNode('b')]; expect(() => validateGraph(g)).toThrow('开始');
  });
  it('rejects unknown targets, duplicate branch ports and invalid node configuration', () => {
    const g = graph(); g.edges = [{ id: 'e', sourceNodeId: 'start', targetNodeId: 'missing', sourcePort: 'success' }]; expect(() => validateGraph(g)).toThrow();
    g.edges[0].targetNodeId = 'wait'; g.edges.push({ ...g.edges[0], id: 'e2' }); expect(() => validateGraph(g)).toThrow('输出端口');
    g.edges = []; g.nodes[1] = { id: 'wait', kind: 'wait', name: '等待', durationMs: NaN }; expect(() => validateGraph(g)).toThrow('等待');
  });
});

describe('explicit MCP node deletion',()=>{
  async function setupDelete(){
    const {workflow,key}=await create();
    const auth={workflowId:workflow.id,key};
    const graph=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:workflow.updatedAt,operations:[
      {type:'add_node',node:{id:'first',name:'第一步',kind:'wait',durationMs:0}},
      {type:'add_node',node:{id:'last',name:'最后一步',kind:'wait',durationMs:0}},
      {type:'connect',edge:{id:'in',sourceNodeId:'start',targetNodeId:'first',sourcePort:'success'}},
      {type:'connect',edge:{id:'out',sourceNodeId:'first',targetNodeId:'last',sourcePort:'success'}},
    ]}) as ScriptDefinition;
    return {auth,graph};
  }
  it('deletes a saved node and its links without rewiring or operating the page',async()=>{
    const {auth,graph}=await setupDelete();
    const deleted=await handleAuthoring('delete_node',{...auth,nodeId:'first',expectedUpdatedAt:graph.updatedAt}) as ScriptDefinition;
    expect(deleted.nodes.map(n=>n.id)).toEqual(['start','last']);
    expect(deleted.edges).toEqual([]);expect(deleted.updatedAt).toBeGreaterThan(graph.updatedAt);
    expect(await handleAuthoring('get_workflow',auth)).toEqual(deleted);
    expect(chrome.tabs.query).not.toHaveBeenCalled();expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('deletes a nested entry and then its container including descendants',async()=>{
    const {workflow,key}=await create();const auth={workflowId:workflow.id,key};
    const graph=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:workflow.updatedAt,operations:[
      {type:'add_node',node:{id:'loop',name:'循环',kind:'loop',items:'[1]',itemVariable:'item',indexVariable:'index',maxIterations:2,body:{entryNodeId:'one',nodes:[{id:'one',name:'内部一',kind:'wait',durationMs:0},{id:'two',name:'内部二',kind:'wait',durationMs:0}],edges:[{id:'inner',sourceNodeId:'one',targetNodeId:'two',sourcePort:'success'}]}}},
      {type:'connect',edge:{id:'outer',sourceNodeId:'start',targetNodeId:'loop',sourcePort:'success'}},
    ]}) as ScriptDefinition;
    const nested=await handleAuthoring('delete_node',{...auth,nodeId:'one',expectedUpdatedAt:graph.updatedAt}) as ScriptDefinition;
    expect(nested.nodes[1]).toMatchObject({body:{nodes:[{id:'two'}],edges:[],entryNodeId:undefined}});
    const removed=await handleAuthoring('delete_node',{...auth,nodeId:'loop',expectedUpdatedAt:nested.updatedAt}) as ScriptDefinition;
    expect(removed.nodes.map(n=>n.id)).toEqual(['start']);expect(removed.edges).toEqual([]);
  });
  it('rejects missing/virtual nodes consistently in dedicated and existing edit tools',async()=>{
    const {auth,graph}=await setupDelete();
    for(const nodeId of ['missing','loop::entry']){
      await expect(handleAuthoring('delete_node',{...auth,nodeId,expectedUpdatedAt:graph.updatedAt})).rejects.toThrow('节点不存在');
      await expect(handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:graph.updatedAt,operations:[{type:'remove_node',nodeId}]})).rejects.toThrow('节点不存在');
    }
    await expect(handleAuthoring('delete_node',{...auth,nodeId:' ',expectedUpdatedAt:graph.updatedAt})).rejects.toThrow('nodeId');
    expect(await handleAuthoring('get_workflow',auth)).toMatchObject(graph);
  });
  it('rejects deleting Start, stale revisions and wrong credentials without changing the graph',async()=>{
    const {auth,graph}=await setupDelete();
    await expect(handleAuthoring('delete_node',{...auth,nodeId:'start',expectedUpdatedAt:graph.updatedAt})).rejects.toThrow('开始节点');
    await expect(handleAuthoring('delete_node',{...auth,nodeId:'first',expectedUpdatedAt:1})).rejects.toThrow('expectedUpdatedAt');
    await expect(handleAuthoring('delete_node',{...auth,key:'wrong',nodeId:'first',expectedUpdatedAt:graph.updatedAt})).rejects.toThrow('密钥');
    expect(await handleAuthoring('get_workflow',auth)).toMatchObject(graph);
  });
  it('rejects dangling node references atomically and allows deleting both references in one edit',async()=>{
    const {auth,graph}=await setupDelete();
    const referenced=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:graph.updatedAt,operations:[
      {type:'add_node',node:{id:'result',name:'结果',kind:'output',source:'node',sourceNodeId:'first',outcome:'neutral'}},
    ]}) as ScriptDefinition;
    await expect(handleAuthoring('delete_node',{...auth,nodeId:'first',expectedUpdatedAt:referenced.updatedAt})).rejects.toThrow('引用');
    expect(await handleAuthoring('get_workflow',auth)).toMatchObject(referenced);
    const removed=await handleAuthoring('edit_workflow',{...auth,expectedUpdatedAt:referenced.updatedAt,operations:[{type:'remove_node',nodeId:'result'},{type:'remove_node',nodeId:'first'}]}) as ScriptDefinition;
    expect(removed.nodes.map(n=>n.id)).toEqual(['start','last']);
  });
  it('allows only one concurrent deletion against the same revision',async()=>{
    const {auth,graph}=await setupDelete();
    const outcomes=await Promise.allSettled(['first','last'].map(nodeId=>handleAuthoring('delete_node',{...auth,nodeId,expectedUpdatedAt:graph.updatedAt})));
    expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o=>o.status==='rejected')).toHaveLength(1);
    expect((await handleAuthoring('get_workflow',auth) as ScriptDefinition).nodes).toHaveLength(2);
  });
});
