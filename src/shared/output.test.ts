import { describe, expect, it } from 'vitest';
import { outputPath, validateOutputNode } from './output';
import { exportWorkflow, importWorkflow } from './workflow-file';
import { createStartNode, DEFAULT_DOM_QUERY, type OutputNode, type ScriptDefinition, type WorkflowNode } from '@/types/workflow';
const output: OutputNode = { id: 'out', kind: 'output', name: '返回', source: 'text', value: '未成功', outcome: 'failure' };
describe('Output import and validation', () => {
  it('round-trips all sources and Query empty-result branches in nested workflows', () => {
    const nodes: WorkflowNode[] = [output, { ...output, id: 'var', name: '变量', source: 'variable', value: '{{data}}' }, { ...output, id: 'ref', name: '引用', source: 'node', sourceNodeId: 'out', path: '' }, { ...output, id: 'dom', name: '属性', source: 'dom', target: { name: '状态', selector: '#s', frameId: 5, frameUrl: 'https://example.com/frame', tagName: 'div', label: '' }, read: 'attribute', attributeName: 'data-status', multiple: true }];
    const workflow: ScriptDefinition = { id: '30cb4d69-86b9-45aa-a497-e025f812c834', name: '输出', createdAt: 1, updatedAt: 2, nodes: [createStartNode('start'), { id: 'q', name: '检索', kind: 'query', target: { name: '状态', selector: '#s', frameId: 0, tagName: 'div', label: '' }, query: DEFAULT_DOM_QUERY, onEmpty: 'failure' }, { id: 'loop', name: '循环', kind: 'loop', items: '[1]', itemVariable: 'i', indexVariable: 'index', maxIterations: 1, body: { nodes, edges: [] } }], edges: [] };
    const restored = importWorkflow(exportWorkflow(workflow), []).workflow;
    expect(restored.nodes[1]).toMatchObject({ onEmpty: 'failure' });
    expect(restored.nodes[2]).toMatchObject({ body: { nodes } });
  });
  it.each([
    { source: 'eval' }, { source: 'variable', value: 'data' }, { source: 'node', sourceNodeId: '' },
    { outcome: 'maybe' }, { source: 'dom', target: {} }, { path: '__proto__.secret' },
  ])('rejects invalid output configuration: %j', patch => expect(() => validateOutputNode({ ...output, ...patch } as OutputNode)).toThrow('Output'));
  it('uses own fields only, including arrays and null', () => {
    expect(outputPath({ rows: [0, null] }, 'rows.1')).toBeNull();
    expect(() => outputPath({}, 'toString')).toThrow('字段不存在');
    expect(() => outputPath({}, '__proto__')).toThrow('字段不存在');
  });
});
