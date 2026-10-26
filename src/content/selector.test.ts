// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectorFor, startSelecting, stopSelecting } from './selector';
import { startRecording, stopRecording } from './recorder';
import { selectedPageTarget } from '@/background/selection-target';

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML = '<button id="button"><span id="child">内容</span></button>';
  document.elementFromPoint = vi.fn(() => document.querySelector('#child'));
});
afterEach(() => { stopSelecting(); stopRecording(); history.replaceState(null, '', '/'); document.body.innerHTML = ''; delete (document as Partial<Document>).elementFromPoint; vi.unstubAllGlobals(); });

describe('DOM scope selection', () => {
  it('manual selection and recording retain the same live SPA URL and button identity', () => {
    history.replaceState(null, '', '/apply?activityId=123&puCode=base&processId=fresh');
    const selected = vi.fn(); startSelecting(selected);
    document.querySelector('#child')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const recorded = vi.fn(); startRecording(recorded, vi.fn(), false);
    document.querySelector<HTMLElement>('#child')!.click(); stopRecording();
    const manual = selectedPageTarget(selected.mock.calls[0][0], { frameId: 0, url: `${location.origin}/apply?activityId=123&bizData=stale` });
    expect(manual).toEqual({ ...recorded.mock.calls[0][0].target, frameId: 0 });
    expect(manual).toMatchObject({ selector: '#button', frameUrl: location.href, frameQueryKeys: ['activityId', 'puCode'] });
  });
  it('rechecks the clicked position instead of recording a stale hovered element', () => {
    document.body.innerHTML = '<button id="old">旧</button><button id="new"><span>新</span></button>';
    const atPoint = vi.mocked(document.elementFromPoint);
    atPoint.mockReturnValueOnce(document.querySelector('#old')).mockReturnValueOnce(document.querySelector('#new span'));
    const selected = vi.fn(); startSelecting(selected);
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(selected).toHaveBeenCalledWith(expect.objectContaining({ selector: '#new', text: '新' }));
  });
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
