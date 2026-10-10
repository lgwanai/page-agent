import { describe, expect, it } from 'vitest';
import type { RecordedPageEvent } from '@/types/workflow';
import { compactRecordedEvents, recordingToGraph } from './recording';

function event(type: RecordedPageEvent['event']['type'], value?: string): RecordedPageEvent {
  return {
    id: `${type}_${value}`,
    timestamp: Date.now(),
    url: 'https://example.com/form',
    target: { name: '', selector: '#field', frameId: 0, tagName: 'input', label: '客户名' },
    event: { type, value },
  };
}

describe('recording graph', () => {
  it('compacts consecutive value changes on the same element', () => {
    const compacted = compactRecordedEvents([event('input', 'a'), event('input', 'abc')]);
    expect(compacted).toHaveLength(1);
    expect(compacted[0].event.value).toBe('abc');
  });

  it('creates a start URL and a linear editable graph', () => {
    const result = recordingToGraph('https://example.com/form', 10, 20, [event('click'), event('input', 'abc')]);
    expect(result.nodes[0]).toMatchObject({ kind: 'start', targetUrl: 'https://example.com/form' });
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every((edge) => edge.sourcePort === 'success')).toBe(true);
  });
});
