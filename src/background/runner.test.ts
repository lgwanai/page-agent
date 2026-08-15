import { describe, expect, it } from 'vitest';
import { loopItems, testOutcomeCondition } from './runner';
import type { LoopNode, OutcomeCondition } from '@/types/workflow';

const condition = (left: string, operator: OutcomeCondition['operator'], right?: string): OutcomeCondition => ({
  enabled: true, left, operator, right,
});

describe('graph runtime expressions', () => {
  it('branches from named AI output', () => {
    const context = { AI判断: { decision: 'approve', output: { score: 92 } } };
    expect(testOutcomeCondition(condition('{{AI判断.decision}}', 'equals', 'approve'), {}, context, {})).toBe(true);
    expect(testOutcomeCondition(condition('{{AI判断.output.score}}', 'greaterThan', '80'), {}, context, {})).toBe(true);
    expect(testOutcomeCondition(condition('{{AI判断.output.missing}}', 'exists'), {}, context, {})).toBe(false);
  });

  it('can evaluate the current card output without a separate condition node', () => {
    const result = { output: { status: 'ready', count: 3 }, ok: true };
    expect(testOutcomeCondition(condition('{{output.status}}', 'equals', 'ready'), {}, {}, result)).toBe(true);
    expect(testOutcomeCondition(condition('{{output.count}}', 'greaterThan', '5'), {}, {}, result)).toBe(false);
  });

  it('resolves loop arrays from variables and JSON literals', () => {
    const node: LoopNode = { id: 'loop', kind: 'loop', name: '循环', items: '{{items}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10 };
    expect(loopItems(node, { items: ['a', 'b'] }, {})).toEqual(['a', 'b']);
    expect(loopItems({ ...node, items: '[1,2,3]' }, {}, {})).toEqual([1, 2, 3]);
  });
});
