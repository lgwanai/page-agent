import { expect, it } from 'vitest';
import { createStartNode, type DialogNode, type ScriptDefinition } from '@/types/workflow';
import { validateDialogNode } from './dialog';
import { exportWorkflow, importWorkflow } from './workflow-file';
import { validateGraph } from '@/background/authoring';
const node: DialogNode = { id: 'dialog', name: '确认操作', kind: 'dialog', target: { name: '触发', selector: '#trigger', tagName: 'button', frameId: 7, frameUrl: 'https://example.com/frame', label: '触发' }, event: { type: 'click' }, dialogType: 'confirm', action: 'dismiss', message: '确认？', promptText: '', timeoutMs: 1000 };
const workflow: ScriptDefinition = { id: '30cb4d69-86b9-45aa-a497-e025f812c834', name: '弹窗测试', nodes: [createStartNode('start'), node], edges: [{ id: 'edge', sourceNodeId: 'start', targetNodeId: node.id, sourcePort: 'success' }], createdAt: 1, updatedAt: 1 };
it('preserves native dialog choices and frame identity through import/export and MCP validation', () => {
  expect(() => validateGraph(workflow)).not.toThrow();
  expect(importWorkflow(exportWorkflow(workflow), []).workflow.nodes[1]).toMatchObject(node);
});
it.each([
  { dialogType: 'comfirm' }, { action: 'delete' }, { timeoutMs: NaN }, { timeoutMs: Infinity }, { timeoutMs: 99 }, { timeoutMs: 300001 },
  { dialogType: 'alert', action: 'dismiss' }, { promptText: null }, { message: false }, { target: null }, { target: { ...node.target, selector: ' ' } }, { target: { ...node.target, frameId: -1 } }, { event: { type: 'upload' } }, { event: { type: 'unknown' } },
])('rejects invalid native dialog config %j in editor import and MCP authoring', patch => {
  const invalid = { ...node, ...patch } as unknown as DialogNode;
  expect(() => validateDialogNode(invalid)).toThrow();
  const bad = { ...workflow, nodes: [workflow.nodes[0], invalid] };
  expect(() => importWorkflow(exportWorkflow(bad), [])).toThrow();
  expect(() => validateGraph(bad)).toThrow();
});
it.each(['alert', 'confirm', 'prompt', 'beforeunload'] as const)('validates %s with appropriate actions', dialogType => {
  expect(() => validateDialogNode({ ...node, dialogType, action: 'accept' })).not.toThrow();
  if (dialogType !== 'alert') expect(() => validateDialogNode({ ...node, dialogType, action: 'dismiss' })).not.toThrow();
});
