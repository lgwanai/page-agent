// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectorFor, startSelecting, stopSelecting } from './selector';

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML = '<button id="button"><span id="child">内容</span></button>';
  document.elementFromPoint = vi.fn(() => document.querySelector('#child'));
});
afterEach(() => { stopSelecting(); document.body.innerHTML = ''; delete (document as Partial<Document>).elementFromPoint; vi.unstubAllGlobals(); });

describe('DOM scope selection', () => {
  it.each([[false, '#button'], [true, '#child']] as const)('selects the correct element with exact mode %s and blocks page clicks', (exact, expected) => {
    const selected = vi.fn();
    const clicked = vi.fn();
    document.querySelector('#button')!.addEventListener('click', clicked);
    startSelecting(selected, exact);
    document.querySelector('#child')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, cancelable: true }));
    document.querySelector('#child')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ selector: expected }));
    expect(clicked).not.toHaveBeenCalled();
    expect(document.querySelector('#__page_agent_select_overlay__')).toBeNull();
  });
});

describe('stable recorded selectors', () => {
  it('prefers a unique placeholder over the focused date-picker classes', () => {
    document.body.innerHTML = '<div class="dt-oui-picker-input dt-oui-picker-input-active"><input placeholder="结束日期"></div>';
    const input = document.querySelector('input')!;
    const selector = selectorFor(input);
    document.querySelector('div')!.classList.remove('dt-oui-picker-input-active');
    expect(selector).toBe('input[placeholder="结束日期"]');
    expect(document.querySelector(selector)).toBe(input);
  });

  it('does not record framework-prefixed transient state classes', () => {
    document.body.innerHTML = '<div class="dt-oui-picker-input-active field dt-oui-picker-input-focused selected"><input></div>';
    const input = document.querySelector('input')!;
    const selector = selectorFor(input);
    expect(selector).not.toMatch(/active|focused|selected/);
    document.querySelector('div')!.className = 'field';
    expect(document.querySelector(selector)).toBe(input);
  });
});
