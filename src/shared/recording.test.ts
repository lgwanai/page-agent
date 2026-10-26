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
  it('compacts native focus pairs only for the same frame/element and retains keyboard metadata', () => {
    const pair = [event('focus'), event('focusin'), event('input', 'abc'), event('blur'), event('focusout'), { ...event('pressKey', 's'), event: { type: 'pressKey' as const, value: 's', code: 'KeyS', modifiers: { ctrl: true } } }];
    expect(compactRecordedEvents(pair).map(item => item.event.type)).toEqual(['focusin','input','focusout','pressKey']);
    const graph = recordingToGraph('https://example.com', 1, 2, pair);
    expect(graph.nodes.at(-1)).toMatchObject({ kind: 'dom', event: { code: 'KeyS', modifiers: { ctrl: true } } });
    expect(compactRecordedEvents([event('focus'), { ...event('focusin'), target: { ...event('focusin').target, frameId: 2 } }])).toHaveLength(2);
  });
});
