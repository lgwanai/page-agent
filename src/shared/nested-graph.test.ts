import { describe, expect, it } from 'vitest';
import { addToGraph, allNodes, graphFor, removeNode } from './nested-graph';
import { exportWorkflow, importWorkflow } from './workflow-file';
import { validateGraph } from '@/background/authoring';
import { createStartNode, type LoopNode, type WorkflowNode, type ScriptDefinition } from '@/types/workflow';
const child: WorkflowNode = { id: 'child', kind: 'wait', name: '内部等待', durationMs: 0 };
const loop: LoopNode = { id: 'loop', kind: 'loop', name: '循环', items: '[1,2]', itemVariable: 'item', indexVariable: 'index', maxIterations: 10, body: { nodes: [child], edges: [], entryNodeId: child.id } };
const workflow: ScriptDefinition = { id: '4ccfb46b-5849-4ecd-aa93-00ae59dd6178', name: '测试', createdAt: 1, updatedAt: 1, nodes: [createStartNode('start'),loop], edges: [] };
describe('nested graph persistence and scope', () => {
  it('preserves the explicit entry when adding to a child output', () => {
    const next: WorkflowNode = { ...child, id: 'second', name: '下一步' };
    const graph = addToGraph(workflow.nodes,[],next,{ nodeId: 'child',port: 'success' });
    expect(allNodes(graph.nodes)).toHaveLength(4);
    expect(graph.edges).toEqual([]);
    expect(graphFor(graph.nodes,[], 'child')).toMatchObject({ entryNodeId:'child', edges:[{sourceNodeId:'child',targetNodeId:'second'}] });
  });
  it('adds via the virtual entry and removes internal nodes without affecting outer nodes', () => {
    const empty = { ...loop,body:{nodes:[],edges:[]} };
    const graph = addToGraph([empty],[],child,{ nodeId:'loop::entry',port:'success' });
    expect((graph.nodes[0] as LoopNode).body?.entryNodeId).toBe('child');
    expect((removeNode(graph.nodes,[],'child').nodes[0] as LoopNode).body?.nodes).toEqual([]);
  });
  it('roundtrips body nodes, edges and entry through JSON and storage migration', () => {
    const imported = importWorkflow(JSON.parse(JSON.stringify(exportWorkflow(workflow))),[]).workflow;
    expect((imported.nodes[1] as LoopNode).body).toMatchObject(loop.body!);
    expect(() => validateGraph(imported)).not.toThrow();
  });
  it('accepts an empty new container during authoring', () => {
    expect(() => validateGraph({ ...workflow,nodes:[workflow.nodes[0],{...loop,body:{nodes:[],edges:[]}}] })).not.toThrow();
  });
  it('rejects global duplicate IDs and cross-scope edges', () => {
    const duplicate = structuredClone(workflow); duplicate.nodes.push(child);
    expect(() => importWorkflow(exportWorkflow(duplicate),[])).toThrow('ID 不能重复');
    const cross = structuredClone(workflow); cross.edges.push({id:'bad',sourceNodeId:'start',targetNodeId:'child',sourcePort:'success'});
    expect(() => importWorkflow(exportWorkflow(cross),[])).toThrow('子流程边界');
  });
  it('rejects duplicated names and start nodes inside a body', () => {
    expect(() => validateGraph({...workflow,nodes:[workflow.nodes[0],{...loop,body:{nodes:[{...child,name:'循环'}],edges:[]}}]})).toThrow('名称必须唯一');
    expect(() => importWorkflow(exportWorkflow({...workflow,nodes:[workflow.nodes[0],{...loop,body:{nodes:[createStartNode('innerStart')],edges:[]}}]}),[])).toThrow('内部子流程');
  });
});
