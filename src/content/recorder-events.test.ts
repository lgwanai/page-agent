// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startRecording, stopRecording } from './recorder';
import { compactRecordedEvents } from '@/shared/recording';
import type { RecordedPageEvent } from '@/types/workflow';
let records: RecordedPageEvent[];
beforeEach(() => { records = []; vi.stubGlobal('CSS', { escape: (value: string) => value }); });
afterEach(() => { stopRecording(); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const start = () => startRecording(event => records.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn(), false);

it('absorbs incidental native focus families into input instead of creating extra cards', () => {
  document.body.innerHTML = '<input id="field">'; start();
  const field = document.querySelector('input')!;
  field.focus(); field.value = 'abc'; field.dispatchEvent(new Event('input', { bubbles: true })); field.blur();
  stopRecording();
  expect(records.map(item => item.event.type)).toEqual(['input']);
  expect(compactRecordedEvents(records).map(item => item.event.type)).toEqual(['input']);
});
it('does not turn an untouched focus/blur into a redundant value write', () => {
  document.body.innerHTML = '<input value="keep">'; start();
  const field = document.querySelector('input')!; field.focus(); field.blur();
  expect(records.some(item => item.event.type === 'input')).toBe(false);
});
it('keeps meaningful focusout validation and its real relatedTarget', () => {
  document.body.innerHTML = '<label><input id="one"><span id="error"></span></label><input id="two">'; start();
  const one = document.querySelector<HTMLInputElement>('#one')!, two = document.querySelector<HTMLInputElement>('#two')!;
  one.addEventListener('focusout', () => { document.querySelector('#error')!.textContent = '校验完成'; });
  one.focus(); one.value = 'abc'; one.dispatchEvent(new Event('input', { bubbles: true })); two.focus();
  stopRecording();
  const events = compactRecordedEvents(records);
  expect(events.find(item => item.event.type === 'input')?.event.keepFocus).toBe(true);
  expect(events.find(item => item.event.type === 'focusout')?.event.relatedSelector).toBe('#two');
});
it('keeps independent focusin/focusout only when they change widget state', () => {
  document.body.innerHTML = '<div id="widget" tabindex="0" aria-expanded="false"></div>'; start();
  const field = document.querySelector('div')!;
  field.addEventListener('focusin', () => field.setAttribute('aria-expanded', 'true'));
  field.addEventListener('focusout', () => field.setAttribute('aria-expanded', 'false'));
  field.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  stopRecording();
  expect(records.map(item => item.event.type)).toEqual(['focusin', 'focusout']);
  expect(records[0].target.attributes?.tabindex).toBe('0');
});
it('does not create cards for pointer/mouse movement or transitions between children', () => {
  document.body.innerHTML = '<button><span id="one">1</span><span id="two">2</span></button>'; start();
  const one = document.querySelector('#one')!, two = document.querySelector('#two')!;
  one.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  one.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  one.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: two }));
  two.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: one }));
  two.dispatchEvent(new MouseEvent('pointerout', { bubbles: true }));
  two.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  stopRecording();
  expect(records).toEqual([]);
});
it('keeps a small meaningful hover popup and its closing leave, without requiring a large DOM change', () => {
  document.body.innerHTML = '<button id="menu">菜单</button><div role="menu" hidden>下载</div>'; start();
  const button = document.querySelector('button')!, menu = document.querySelector('[role="menu"]')!;
  button.addEventListener('mouseover', () => menu.removeAttribute('hidden'));
  button.addEventListener('mouseout', () => menu.setAttribute('hidden', ''));
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); stopRecording();
  expect(records.map(item => item.event.type)).toEqual(['hover', 'mouseLeave']);
});
it('records one click after dozens of ineffective hovers and focus transitions', () => {
  document.body.innerHTML = '<button>报名</button>'; start(); const button = document.querySelector('button')!;
  for (let i = 0; i < 40; i++) {
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    button.classList.toggle('hover');
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  }
  button.focus(); button.click(); button.blur(); stopRecording();
  expect(records.map(item => item.event.type)).toEqual(['click']);
});
it('keeps a hover which enables the button clicked next', () => {
  document.body.innerHTML = '<div><button disabled>报名</button></div>'; start(); const button = document.querySelector('button')!;
  button.addEventListener('mouseover', () => { button.disabled = false; });
  button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); button.click(); stopRecording();
  expect(records.map(item => item.event.type)).toEqual(['hover', 'click']);
});
it('emits a delayed meaningful hover once and does not emit after stopping', async () => {
  vi.useFakeTimers();
  try {
    document.body.innerHTML = '<button>菜单</button><div role="menu" hidden>下载</div>'; start();
    const button = document.querySelector('button')!, menu = document.querySelector('[role="menu"]')!;
    button.addEventListener('mouseover', () => { window.setTimeout(() => menu.removeAttribute('hidden'), 200); });
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(records.map(item => item.event.type)).toEqual(['hover']);
    stopRecording(); await vi.runAllTimersAsync(); expect(records).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
it('records Tab, Home, End, function keys and modifier/code metadata', () => {
  document.body.innerHTML = '<input>'; start(); const field = document.querySelector('input')!;
  for (const key of ['Tab', 'Home', 'End', 'F2']) field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, shiftKey: true, bubbles: true }));
  const keys = records.filter(item => item.event.type === 'pressKey');
  expect(keys.map(item => item.event.value)).toEqual(['Tab', 'Home', 'End', 'F2', 's']);
  expect(keys.at(-1)?.event).toMatchObject({ code: 'KeyS', modifiers: { ctrl: true, shift: true } });
});
it('records final IME text only and ignores the composing Enter key', () => {
  document.body.innerHTML = '<input>'; start(); const field = document.querySelector('input')!;
  field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  field.value = 'ni'; field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
  field.value = '你好'; field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
  field.dispatchEvent(new InputEvent('input', { bubbles: true, data: '你好' }));
  expect(records.map(item => item.event)).toEqual([{ type: 'input', value: '你好' }]);
});
it('flushes the final paste/cut value on stop without reading clipboard data', () => {
  document.body.innerHTML = '<input>'; start(); const field = document.querySelector('input')!;
  field.dispatchEvent(new Event('paste', { bubbles: true })); field.value = '粘贴结果'; stopRecording();
  expect(records.map(item => item.event)).toEqual([{ type: 'input', value: '粘贴结果' }]);
});
it('records standalone custom change/reset but not reset caused by an already recorded click', () => {
  document.body.innerHTML = '<div id="widget"></div><form><button type="reset">重置</button></form>'; start();
  document.querySelector('#widget')!.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('form')!.reset();
  document.querySelector('button')!.click();
  expect(records.map(item => item.event.type)).toEqual(['change', 'reset', 'click']);
});
it('keeps only the Space action when native activation clicks and changes the checkbox', () => {
  document.body.innerHTML = '<input type="checkbox">'; start(); const field = document.querySelector('input')!;
  field.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); field.click();
  expect(records.map(item => item.event.type)).toEqual(['pressKey']);
});
it('does not disclose passwords through new focus/clipboard listeners and removes every listener on stop', () => {
  document.body.innerHTML = '<input type="password" name="secret">'; start(); const field = document.querySelector('input')!;
  field.focus(); field.value = 'NEVER-STORE'; field.dispatchEvent(new Event('input', { bubbles: true })); field.blur();
  expect(JSON.stringify(records)).not.toContain('NEVER-STORE');
  expect(records.filter(item => item.event.type === 'input')).toHaveLength(1);
  expect(records.find(item => item.event.type === 'input')?.event.value).toBe('{{secret}}');
  stopRecording(); const count = records.length;
  field.focus(); field.dispatchEvent(new Event('paste', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); field.blur();
  expect(records).toHaveLength(count);
});
