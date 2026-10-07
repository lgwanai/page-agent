import { describe, expect, it } from 'vitest';
import { allowedEventsForTarget, createId, createStartNode, defaultEventForTarget, EVENT_LABELS, NODE_KIND_LABELS, type PageTarget } from './workflow';

describe('workflow contract', () => {
  it('creates prefixed unique ids', () => {
    const first = createId('node');
    const second = createId('node');
    expect(first).toMatch(/^node_/);
    expect(second).toMatch(/^node_/);
    expect(first).not.toBe(second);
  });

  it('keeps every supported web event understandable to users', () => {
    expect(EVENT_LABELS.input).toBe('输入内容');
    expect(EVENT_LABELS.select).toBe('选择选项');
    expect(EVENT_LABELS.custom).toBe('自定义 Web 事件');
    expect(Object.keys(EVENT_LABELS)).toHaveLength(12);
  });

  it.each([
    ['input', { tagName: 'input', attributes: { type: 'text' } }, 'input', ['select', 'check']],
    ['select', { tagName: 'select' }, 'select', ['input', 'check']],
    ['checkbox', { tagName: 'input', attributes: { type: 'checkbox' } }, 'check', ['input', 'select']],
    ['button', { tagName: 'button' }, 'click', ['input', 'select', 'check']],
    ['contenteditable', { tagName: 'div', attributes: { contenteditable: 'true' } }, 'input', ['select', 'check']],
  ])('infers meaningful operations for %s elements', (_label, partial, initial, excluded) => {
    const target: PageTarget = { name: '目标', selector: '#target', frameId: 0, label: '目标', ...partial };
    const allowed = allowedEventsForTarget(target);
    expect(defaultEventForTarget(target).type).toBe(initial);
    for (const event of excluded) expect(allowed).not.toContain(event);
  });

  it('keeps loops as first-class nodes without standalone conditions', () => {
    expect(NODE_KIND_LABELS.loop).toBe('循环');
    expect(Object.keys(NODE_KIND_LABELS)).toEqual(expect.arrayContaining(['dom', 'ai', 'loop']));
    expect(Object.keys(NODE_KIND_LABELS)).not.toContain('condition');
  });

  it('creates a safe default Start node', () => {
    expect(createStartNode('start')).toMatchObject({
      id: 'start', kind: 'start', targetUrl: '', strictValidation: false,
      inputs: [], waitForLogin: false, loadTimeoutMs: 30_000, loginTimeoutMs: 300_000, settleDelayMs: 500,
    });
  });
});
