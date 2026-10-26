import { expect, it } from 'vitest';
import { applyLayoutPositions, readLayoutPositions } from './canvas-layout';
import type { WorkflowNode } from '@/types/workflow';
it('pins a virtual child entry and preserves relative gaps after translating children', () => {
  expect(readLayoutPositions({ edges: [], nodes: [
    { id: 'loop::entry', type: 'entry', meta: { position: { x: -20, y: 40 } } },
    { id: 'one', type: 'wait', meta: { position: { x: 150, y: 40 } } },
    { id: 'two', type: 'wait', meta: { position: { x: 450, y: 70 } } },
  ] }, 'loop')).toEqual({ one: { x: 200, y: 65 }, two: { x: 500, y: 95 } });
});
it('rejects missing or nonfinite coordinates before applying a layout', () => {
  for (const position of [undefined, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) expect(() => readLayoutPositions({ edges: [], nodes: [{ id: 'bad', type: 'wait', meta: { position } }] })).toThrow('有效节点位置');
});
it('only updates positions in nested graphs, retaining configuration, IDs and every edge', () => {
  const nodes: WorkflowNode[] = [{ id: 'loop', kind: 'loop', name: '循环', items: '{{items}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10, body: { entryNodeId: 'wait', nodes: [{ id: 'wait', kind: 'wait', name: '等待', durationMs: 100 }], edges: [] } }];
  const result = applyLayoutPositions(nodes, { loop: { x: 50, y: 60 }, wait: { x: 300, y: 50 } });
  expect(result).toEqual([{ ...nodes[0], position: { x: 50, y: 60 }, body: { ...(nodes[0].kind === 'loop' ? nodes[0].body : {}), nodes: [{ id: 'wait', kind: 'wait', name: '等待', durationMs: 100, position: { x: 300, y: 50 } }] } }]);
  expect(nodes[0].position).toBeUndefined();
});
