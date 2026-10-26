import { expect, it } from 'vitest';
import type { WorkflowNode } from '@/types/workflow';
import { canvasGeometry, CONTAINER_HEADER } from './canvas-geometry';
const wait = (id: string, x: number, y: number): WorkflowNode => ({ id, name: id, kind: 'wait', durationMs: 0, position: { x, y } });
const loop = (id: string, nodes: WorkflowNode[], x = 300, y = 60): WorkflowNode => ({ id, name: id, kind: 'loop', items: '[]', itemVariable: 'item', indexVariable: 'index', maxIterations: 10, position: { x, y }, body: { nodes, edges: [] } });
it('grows every ancestor to contain all descendants at their unscaled size', () => {
  const graph = canvasGeometry([loop('outer', [wait('one', 150, 65), loop('inner', [wait('two', 150, 65), wait('far', 1000, 400)], 500, 65)])]);
  const outer = graph.nodes.outer, inner = outer.body!.nodes.inner;
  expect(inner.width).toBeGreaterThan(1100);
  expect(inner.height).toBeGreaterThan(600);
  expect(outer.width).toBeGreaterThan(inner.x + inner.width + 26);
  expect(outer.height).toBeGreaterThan(CONTAINER_HEADER + inner.y + inner.height);
  expect(inner.body!.nodes.two.width).toBe(220);
});
it('clears siblings around expanding containers without editing stored positions', () => {
  const nodes = [loop('outer', [wait('far', 1200, 65)]), wait('after', 1050, 60), wait('below', 300, 500)];
  const before = structuredClone(nodes), graph = canvasGeometry(nodes);
  const boxes = Object.values(graph.nodes);
  for (const a of boxes) for (const b of boxes) if (a !== b) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  expect(nodes).toEqual(before);
  expect(canvasGeometry(nodes)).toEqual(graph);
});
it('contains negative coordinates, protects the entry and gives empty bodies a usable size', () => {
  const graph = canvasGeometry([wait('negative', -5000, -3000), wait('entry-overlap', 30, 65)], 'loop');
  expect(graph.x).toBe(-5142); expect(graph.y).toBe(-3032);
  expect(graph.nodes['entry-overlap'].y).toBeGreaterThan(109);
  const empty = canvasGeometry([loop('empty', [])]).nodes.empty;
  expect(empty.body!.width).toBeGreaterThan(400); expect(empty.body!.height).toBeGreaterThanOrEqual(180);
});
