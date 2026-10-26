// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { focusElement } from './focus';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('does not duplicate native focus lifecycle events in a focused document', () => {
  document.body.innerHTML = '<input id="first"><input id="second">';
  const [first, second] = [...document.querySelectorAll('input')]; first.focus();
  const events: string[] = [];
  for (const type of ['blur', 'focusout', 'focus', 'focusin']) document.addEventListener(type, event => events.push(`${(event.target as HTMLElement).id}:${type}`), { once: true, capture: true });
  const result = focusElement(second);
  expect(result).toMatchObject({ ok: true, nativeFocus: true, nativeFocusIn: true, repaired: [] });
  expect(events).toEqual(['first:blur', 'first:focusout', 'second:focus', 'second:focusin']);
  expect(focusElement(second).repaired).toEqual([]);
});

it('repairs missing events when the side panel owns focus although activeElement changes', () => {
  document.body.innerHTML = '<input id="start"><input id="end">';
  const [start, end] = [...document.querySelectorAll('input')];
  let active: Element = start;
  vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => active);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.spyOn(end, 'focus').mockImplementation(() => { active = end; });
  const events: Array<[string, string, EventTarget | null]> = [];
  for (const type of ['blur', 'focusout', 'focus', 'focusin']) document.addEventListener(type, event => events.push([(event.target as HTMLElement).id, type, (event as FocusEvent).relatedTarget]), { once: true, capture: true });
  const result = focusElement(end);
  expect(result).toMatchObject({ ok: true, documentFocused: false, nativeFocus: false, nativeFocusIn: false, repaired: ['blur', 'focusout', 'focus', 'focusin'] });
  expect(events).toEqual([['start', 'blur', end], ['start', 'focusout', end], ['end', 'focus', start], ['end', 'focusin', start]]);
});

it('synchronizes an already-active input when its unfocused document suppressed focusin', () => {
  document.body.innerHTML = '<input id="start">';
  const field = document.querySelector('input')!; field.focus();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const handler = vi.fn(); field.addEventListener('focusin', handler);
  expect(focusElement(field).repaired).toEqual(['focus', 'focusin']); expect(handler).toHaveBeenCalledOnce();
});

it('does not send a second focusin when the page already delivered it', () => {
  document.body.innerHTML = '<input id="first"><input id="second">';
  const [first, second] = [...document.querySelectorAll('input')]; first.focus();
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const handler = vi.fn(); second.addEventListener('focusin', handler);
  expect(focusElement(second).repaired).toEqual([]); expect(handler).toHaveBeenCalledOnce();
});

it('does not fake DOM focus when focus is blocked', () => {
  document.body.innerHTML = '<input>';
  const field = document.querySelector('input')!; vi.spyOn(field, 'focus').mockImplementation(() => undefined);
  const handler = vi.fn(); field.addEventListener('focusin', handler);
  expect(focusElement(field).ok).toBe(false); expect(handler).not.toHaveBeenCalled();
});

it('stops event repair if a blur handler removes the target', () => {
  document.body.innerHTML = '<input id="first"><input id="second">';
  const [first, second] = [...document.querySelectorAll('input')]; let active: Element = first;
  vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => active);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  vi.spyOn(second, 'focus').mockImplementation(() => { active = second; });
  first.addEventListener('blur', () => second.remove());
  const handler = vi.fn(); second.addEventListener('focusin', handler);
  expect(focusElement(second).ok).toBe(false); expect(handler).not.toHaveBeenCalled();
});
