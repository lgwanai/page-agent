import { describe, expect, it } from 'vitest';
import { migrateGraph } from './storage';

describe('workspace graph migration', () => {
  it('folds a legacy condition node into its predecessor result property', () => {
    const nodes = [
      { id: 'ai', kind: 'ai', name: '识别结果', instruction: '', inputs: [], event: { type: 'click' } },
      { id: 'condition', kind: 'condition', name: '状态判断', left: '{{识别结果.output.status}}', operator: 'equals', right: 'ready' },
      { id: 'success', kind: 'wait', name: '继续', durationMs: 10 },
      { id: 'failure', kind: 'wait', name: '恢复', durationMs: 10 },
    ];
    const edges = [
      { id: 'in', sourceNodeId: 'ai', targetNodeId: 'condition', sourcePort: 'success' },
      { id: 'yes', sourceNodeId: 'condition', targetNodeId: 'success', sourcePort: 'true' },
      { id: 'no', sourceNodeId: 'condition', targetNodeId: 'failure', sourcePort: 'false' },
    ];

    const migrated = migrateGraph(nodes, edges);

    expect(migrated.nodes.map((node) => node.id)).toEqual(['ai', 'success', 'failure']);
    expect(migrated.nodes[0].outcomeCondition).toEqual({
      enabled: true,
      left: '{{识别结果.output.status}}',
      operator: 'equals',
      right: 'ready',
    });
    expect(migrated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'ai', targetNodeId: 'success', sourcePort: 'success' }),
      expect.objectContaining({ sourceNodeId: 'ai', targetNodeId: 'failure', sourcePort: 'failure' }),
    ]));
    expect(migrated.edges.some((edge) => edge.sourceNodeId === 'condition' || edge.targetNodeId === 'condition')).toBe(false);
  });
});
