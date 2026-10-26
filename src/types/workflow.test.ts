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
    expect(EVENT_LABELS.scrollPage).toBe('滚动页面 / 区域');
    expect(EVENT_LABELS.contextMenu).toBe('右键点击');
    expect(EVENT_LABELS.longPress).toBe('长按');
    expect(EVENT_LABELS.drag).toBe('拖拽移动');
    expect(Object.keys(EVENT_LABELS)).toHaveLength(22);
    expect(EVENT_LABELS.focusin).toContain('focusin');
    expect(EVENT_LABELS.focusout).toContain('focusout');
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

it('defaults file controls to upload while keeping ordinary buttons as clicks', () => {
  expect(defaultEventForTarget({ name: '上传', selector: '#file', frameId: 0, label: '', tagName: 'input', attributes: { type: 'file' } }).type).toBe('upload');
  expect(defaultEventForTarget({ name: '按钮', selector: '#button', frameId: 0, label: '', tagName: 'button' }).type).toBe('click');
});
