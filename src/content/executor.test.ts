// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeEvent } from './executor';

function prepareField(markup: string) {
  document.body.innerHTML = markup;
  const field = document.querySelector<HTMLElement>('#query')!;
  const form = document.querySelector<HTMLFormElement>('form')!;
  field.style.opacity = '1';
  field.scrollIntoView = vi.fn();
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 30));
  document.elementFromPoint = vi.fn(() => field);
  const submitted = vi.fn((event: Event) => event.preventDefault());
  form.addEventListener('submit', submitted);
  return { field, form, submitted };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (document as Partial<Document>).elementFromPoint;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('expanded semantic web events', () => {
  it('checks a transparent design-system radio through its visible label and verifies input.checked', async () => {
    const { field } = prepareField('<form><label><input id="query" type="radio" style="opacity:0"><span>选择</span></label></form>');
    const label = field.closest('label')!;
    label.style.opacity = '1'; field.style.opacity = '0';
    vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 30));
    document.elementFromPoint = vi.fn(() => label);
    expect((await executeEvent(field, { type: 'check', value: 'true' })).verification).toMatchObject({ ok: true, actual: true });
    expect((field as HTMLInputElement).checked).toBe(true);
  });
  it('replays focusin/focusout using native focus transitions without double firing handlers', async () => {
    const { field } = prepareField('<form><input id="query"></form>');
    const entered = vi.fn(), left = vi.fn(); field.addEventListener('focusin', entered); field.addEventListener('focusout', left);
    expect((await executeEvent(field, { type: 'focusin' })).verification.ok).toBe(true);
    await executeEvent(field, { type: 'focusin' });
    expect((await executeEvent(field, { type: 'focusout' })).verification.ok).toBe(true);
    await executeEvent(field, { type: 'focusout' });
    expect(entered).toHaveBeenCalledOnce(); expect(left).toHaveBeenCalledOnce();
  });
  it('sends mouse and pointer enter/leave plus independent change notifications', async () => {
    // jsdom rejects Vitest's Window proxy as UIEvent.view. Keep real DOM event
    // dispatch/bubbling here; the test does not assert this browser-only field.
    const NativeMouse = MouseEvent;
    class TestMouse extends NativeMouse { constructor(type: string, init: MouseEventInit = {}) { super(type, { ...init, view: null }); } }
    vi.stubGlobal('MouseEvent', TestMouse); vi.stubGlobal('PointerEvent', TestMouse);
    const { field } = prepareField('<form><input id="query"></form>');
    const seen: string[] = [];
    for (const name of ['pointerover','pointerenter','mouseover','mouseenter','pointerout','pointerleave','mouseout','mouseleave','change']) field.addEventListener(name, () => seen.push(name));
    await executeEvent(field, { type: 'hover' }); await executeEvent(field, { type: 'mouseLeave' }); await executeEvent(field, { type: 'change' });
    expect(seen).toEqual(['pointerover','pointerenter','mouseover','mouseenter','pointerout','pointerleave','mouseout','mouseleave','change']);
  });
  it('defers recorded input blur and preserves the next target on the native focusout event', async () => {
    const { field } = prepareField('<form><input id="query"><input id="next"></form>');
    const next = document.querySelector<HTMLInputElement>('#next')!;
    const related: EventTarget[] = []; field.addEventListener('focusout', event => related.push((event as FocusEvent).relatedTarget!));
    await executeEvent(field, { type: 'input', value: 'abc', keepFocus: true });
    expect(related).toHaveLength(0); expect(document.activeElement).toBe(field);
    expect((await executeEvent(field, { type: 'focusout', relatedSelector: '#next' })).verification.ok).toBe(true);
    expect(related).toEqual([next]); expect(document.activeElement).toBe(next);
  });
  it('retains modifiers and the physical code across keydown/keypress/keyup', async () => {
    const { field } = prepareField('<form><input id="query"></form>');
    const seen: KeyboardEvent[] = [];
    for (const type of ['keydown','keypress','keyup']) field.addEventListener(type, event => seen.push(event as KeyboardEvent));
    await executeEvent(field, { type: 'pressKey', value: 's', code: 'KeyS', modifiers: { ctrl: true, shift: true } });
    expect(seen).toHaveLength(3);
    expect(seen.every(event => event.ctrlKey && event.shiftKey && event.code === 'KeyS')).toBe(true);
  });
  it('supplies missing Space activation only once and respects prevention', async () => {
    const { field } = prepareField('<form><input id="query" type="checkbox"></form>');
    const clicked = vi.fn(); field.addEventListener('click', clicked);
    await executeEvent(field, { type: 'pressKey', value: 'Space' });
    expect((field as HTMLInputElement).checked).toBe(true); expect(clicked).toHaveBeenCalledOnce();
    field.addEventListener('keydown', event => event.preventDefault());
    await executeEvent(field, { type: 'pressKey', value: 'Space' });
    expect(clicked).toHaveBeenCalledOnce();
  });
  it('verifies real reset values, not merely the arrival of a reset event', async () => {
    const { field, form } = prepareField('<form id="query"><input value="default"><input type="checkbox"></form>');
    const input = form.querySelector('input')!; input.value = 'changed';
    expect((await executeEvent(field, { type: 'reset' })).verification.ok).toBe(true);
    expect(input.value).toBe('default');
    input.value = 'changed'; form.addEventListener('reset', event => event.preventDefault());
    expect((await executeEvent(field, { type: 'reset' })).verification.ok).toBe(false);
    expect(input.value).toBe('changed');
  });
});

describe('recorded Enter replay', () => {
  it('submits a native single-input form exactly once', async () => {
    const { field, submitted } = prepareField('<form><input id="query" type="search"></form>');
    const result = await executeEvent(field, { type: 'pressKey', value: 'Enter' });
    expect(result.verification.ok).toBe(true);
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('activates the default submit button exactly once', async () => {
    const { field, submitted } = prepareField('<form><input id="query"><button id="send">搜索</button></form>');
    const clicked = vi.fn();
    document.querySelector('#send')!.addEventListener('click', clicked);
    await executeEvent(field, { type: 'pressKey', value: 'Enter' });
    expect(clicked).toHaveBeenCalledOnce();
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('does not submit again when the page already handles Enter', async () => {
    const { field, form, submitted } = prepareField('<form><input id="query"><button>搜索</button></form>');
    field.addEventListener('keydown', () => form.requestSubmit());
    await executeEvent(field, { type: 'pressKey', value: 'Enter' });
    expect(submitted).toHaveBeenCalledOnce();
  });

  it('honors a page handler that cancels Enter', async () => {
    const { field, submitted } = prepareField('<form><input id="query"><button>搜索</button></form>');
    field.addEventListener('keydown', (event) => event.preventDefault());
    await executeEvent(field, { type: 'pressKey', value: 'Enter' });
    expect(submitted).not.toHaveBeenCalled();
  });

  it('does not submit multiline inputs without a page submit handler', async () => {
    const { field, submitted } = prepareField('<form><textarea id="query"></textarea><button>搜索</button></form>');
    await executeEvent(field, { type: 'pressKey', value: 'Enter' });
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('controlled input replay', () => {
  it('waits for the focus render before setting the draft value', async () => {
    const { field } = prepareField('<form><input id="query"></form>');
    field.addEventListener('focus', () => {
      setTimeout(() => { (field as HTMLInputElement).value = ''; }, 0);
    });
    const result = await executeEvent(field, { type: 'input', value: '2026-10-01' });
    expect(result.verification.ok).toBe(true);
    expect((field as HTMLInputElement).value).toBe('2026-10-01');
  });

  it('allows asynchronous input state to update before blur', async () => {
    const { field, submitted } = prepareField('<form><input id="query"></form>');
    let committed = '';
    field.addEventListener('input', () => {
      setTimeout(() => { committed = (field as HTMLInputElement).value; }, 0);
    });
    field.addEventListener('blur', () => { (field as HTMLInputElement).value = committed; });
    const result = await executeEvent(field, { type: 'input', value: 'abc' });
    expect(result.verification.ok).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('commits a date picker draft with Enter before blur without native submission', async () => {
    const { field, submitted } = prepareField('<form><div class="dt-oui-picker-input"><input id="query" type="text"></div></form>');
    let draft = '';
    let committed = '';
    field.addEventListener('input', () => {
      setTimeout(() => { draft = (field as HTMLInputElement).value; }, 0);
    });
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') committed = draft;
    });
    field.addEventListener('blur', () => { (field as HTMLInputElement).value = committed; });
    const result = await executeEvent(field, { type: 'input', value: '2026-10-01' });
    expect(result.verification.ok).toBe(true);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('does not press Enter for an ordinary text input containing a date', async () => {
    const { field } = prepareField('<form><input id="query"></form>');
    const keydown = vi.fn();
    field.addEventListener('keydown', keydown);
    await executeEvent(field, { type: 'input', value: '2026-10-01' });
    expect(keydown).not.toHaveBeenCalled();
  });

  it('reports failure when a widget rejects the input instead of forcing its value', async () => {
    const { field } = prepareField('<form><input id="query"></form>');
    field.addEventListener('input', () => { (field as HTMLInputElement).value = ''; });
    const result = await executeEvent(field, { type: 'input', value: 'abc' });
    expect(result.verification.ok).toBe(false);
    expect(result.verification.evidence).toContain('input 更新后：');
  });
});
