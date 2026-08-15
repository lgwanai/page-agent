import { describe, expect, it } from 'vitest';
import { loopItems } from './runner';
import type { LoopNode } from '@/types/workflow';

describe('graph runtime expressions', () => {
  it('resolves loop arrays from variables and JSON literals', () => {
    const node: LoopNode = { id: 'loop', kind: 'loop', name: '循环', items: '{{items}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10 };
    expect(loopItems(node, { items: ['a', 'b'] }, {})).toEqual(['a', 'b']);
    expect(loopItems({ ...node, items: '[1,2,3]' }, {}, {})).toEqual([1, 2, 3]);
  });
});
