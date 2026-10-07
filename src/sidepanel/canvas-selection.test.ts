import { describe, expect, it } from 'vitest';
import { selectedWorkflowNodeId } from './canvas-selection';

describe('selectedWorkflowNodeId', () => {
  const nodeIds = new Set(['node_input', 'node_submit']);

  it('returns the clicked workflow node from FlowGram selection', () => {
    expect(selectedWorkflowNodeId([{ id: 'node_input' }], nodeIds)).toBe('node_input');
  });

  it('ignores edges and still resolves a workflow node', () => {
    expect(selectedWorkflowNodeId([{ id: 'edge_1' }, { id: 'node_submit' }], nodeIds)).toBe('node_submit');
  });

  it('clears the inspector when no workflow node is selected', () => {
    expect(selectedWorkflowNodeId([{ id: 'edge_1' }], nodeIds)).toBeNull();
  });
});
