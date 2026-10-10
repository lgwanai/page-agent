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
