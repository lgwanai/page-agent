// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectCombobox } from './combobox';
import { executeEvent } from './executor';

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<span class="next-select"><span class="next-select-values"><em></em><span aria-hidden="true">镜像</span></span><input id="combo" role="combobox" aria-controls="options"></span>';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 30));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
function setup(commit = true, duplicate = false) {
  const field = document.getElementById('combo')!;
  const click = vi.fn((element: HTMLElement) => {
    if (element === field) {
      field.setAttribute('aria-expanded', 'true');
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', `<ul role="listbox" id="options"><li role="option" title="茶">茶</li><li role="option">茶具</li>${duplicate ? '<li role="option">茶</li>' : ''}</ul>`);
      }, 120);
    } else if (commit) {
      document.querySelector('.next-select-values > em')!.textContent = element.textContent;
      document.getElementById('options')!.remove();
    }
  });
  return { field, click };
}
describe('asynchronous custom combobox', () => {
  it('waits after opening, selects the exact label and verifies the committed display, not the search value', async () => {
    const { field, click } = setup();
    const pending = selectCombobox(field, { type: 'select', value: '茶', minWaitMs: 1000, maxWaitMs: 1000 }, click);
    await vi.advanceTimersByTimeAsync(999); expect(click).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).verification).toMatchObject({ ok: true, expected: '茶', actual: '茶' });
    expect(click.mock.calls[1][0].textContent).toBe('茶');
    expect((field as HTMLInputElement).value).toBe('');
  });
  it('skips empty optional input without opening or dispatching anything', async () => {
    const { field, click } = setup(); field.addEventListener('click', () => click(field));
    expect((await executeEvent(field, { type: 'select', value: '', optionalValue: true })).output).toEqual({ skipped: true });
    expect(click).not.toHaveBeenCalled();
  });
  it('does not report success when only a click happened but the selection never committed', async () => {
    const { field, click } = setup(false);
    const pending = expect(selectCombobox(field, { type: 'select', value: '茶', minWaitMs: 1000, maxWaitMs: 1000 }, click)).rejects.toThrow('无法验证选中值');
    await vi.runAllTimersAsync(); await pending;
  });
  it('rejects duplicate exact labels and never clicks an ambiguous option', async () => {
    const { field, click } = setup(true, true);
    const pending = expect(selectCombobox(field, { type: 'select', value: '茶', minWaitMs: 1000, maxWaitMs: 1000 }, click)).rejects.toThrow('多个同名');
    await vi.runAllTimersAsync(); await pending; expect(click).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid waiting ranges before touching the page', async () => {
    const { field, click } = setup();
    await expect(selectCombobox(field, { type: 'select', value: '茶', minWaitMs: 2000, maxWaitMs: 1000 }, click)).rejects.toThrow('等待区间');
    expect(click).not.toHaveBeenCalled();
  });
});
