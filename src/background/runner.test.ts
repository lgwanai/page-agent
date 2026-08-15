import { describe, expect, it } from 'vitest';
import { loopItems, testCondition } from './runner';
import type { ConditionNode, LoopNode } from '@/types/workflow';

const condition = (left: string, operator: ConditionNode['operator'], right?: string): ConditionNode => ({
  id: 'condition', kind: 'condition', name: '判断', left, operator, right,
});

describe('graph runtime expressions', () => {
  it('branches from named AI output', () => {
    const context = { AI判断: { decision: 'approve', output: { score: 92 } } };
    expect(testCondition(condition('{{AI判断.decision}}', 'equals', 'approve'), {}, context)).toBe(true);
    expect(testCondition(condition('{{AI判断.output.score}}', 'greaterThan', '80'), {}, context)).toBe(true);
    expect(testCondition(condition('{{AI判断.output.missing}}', 'exists'), {}, context)).toBe(false);
  });

  it('resolves loop arrays from variables and JSON literals', () => {
    const node: LoopNode = { id: 'loop', kind: 'loop', name: '循环', items: '{{items}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10 };
    expect(loopItems(node, { items: ['a', 'b'] }, {})).toEqual(['a', 'b']);
    expect(loopItems({ ...node, items: '[1,2,3]' }, {}, {})).toEqual([1, 2, 3]);
  });
});
