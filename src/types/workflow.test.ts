import { describe, expect, it } from 'vitest';
import { createId, EVENT_LABELS } from './workflow';

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
});
