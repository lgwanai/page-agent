// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectCalendarDate } from './calendar';
import { parseCalendarDateTime } from './calendar-datetime';
import { executeEvent } from './executor';
vi.mock('./executor', () => ({ executeEvent: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  vi.mocked(executeEvent).mockImplementation(async element => { element.click(); return { verification: { ok: true, summary: 'clicked' } }; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); document.body.innerHTML = ''; });
async function finish<T>(promise: Promise<T>): Promise<T> {
  const pending = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const result = await pending;
  if ('error' in result) throw result.error;
  return result.value;
}
function fixture(options: { commit?: 'none' | 'overwrite' | 'rollback'; badSeconds?: boolean; disabledHour?: boolean; sameDay?: boolean; ambiguousOwner?: boolean } = {}) {
  const fields = (side: string) => `<span class="next-range-picker-panel-input-${side}-date"><input value=""></span><span class="next-range-picker-panel-input-${side}-time"><input value="${side === 'start' ? '00:00:00' : '23:59:59'}"></span>`;
  const time = (side: string) => `<div class="next-range-picker-panel-time-${side}">${['hour', 'minute', 'second'].map((part, index) => `<ul class="next-time-picker-menu-${part}">${Array.from({ length: index === 0 ? 24 : 60 }, (_, n) => `<li role="option" class="next-time-picker-menu-item${options.disabledHour && side === 'start' && part === 'hour' && n === 9 ? ' next-disabled' : ''}">${n}</li>`).join('')}</ul>`).join('')}</div>`;
  document.body.innerHTML = `<div id="owner" class="next-range-picker"><div class="next-range-picker-trigger" aria-expanded="true"><span class="next-range-picker-trigger-input"><input id="start" placeholder="起始日期"></span><span class="next-range-picker-trigger-input"><input id="end" placeholder="结束日期"></span></div></div>
    <div id="popup" class="next-range-picker-body-show-time"><div class="next-range-picker-panel-input">${fields('start')}${fields('end')}</div>
    <div class="next-calendar"><div class="next-calendar-panel-header-left">十月2026</div><div class="next-calendar-panel-header-right">十一月2026</div><button class="next-calendar-btn-next-month">›</button><button class="next-calendar-btn-prev-month">‹</button><div class="next-calendar-body-left"><table><tbody><tr><td title="2026-10-17">17</td></tr></tbody></table></div><div class="next-calendar-body-right"><table><tbody><tr><td title="2026-11-17">17</td></tr></tbody></table></div></div>
    <div id="time-panels" style="display:none">${time('start')}${time('end')}</div><div class="next-date-picker-panel-footer"><button id="toggle" type="button">选择时间</button><button id="confirm" type="button">确定</button></div></div>`;
  const root = document.getElementById('popup')!;
  let active = 'start';
  const read = (side: string, part: string) => root.querySelector<HTMLInputElement>(`.next-range-picker-panel-input-${side}-${part} input`)!;
  ['start', 'end'].forEach(side => read(side, 'date').addEventListener('focusin', () => { active = side; }));
  root.querySelectorAll<HTMLElement>('td').forEach(cell => cell.addEventListener('click', () => { read(active, 'date').value = cell.title; }));
  root.querySelectorAll<HTMLElement>('li').forEach(item => item.addEventListener('click', () => {
    const side = item.closest('.next-range-picker-panel-time-start') ? 'start' : 'end';
    const index = ['hour', 'minute', 'second'].findIndex(part => item.parentElement!.classList.contains(`next-time-picker-menu-${part}`));
    const parts = read(side, 'time').value.split(':');
    if (!(options.badSeconds && side === 'end' && index === 2)) parts[index] = item.textContent!.padStart(2, '0');
    read(side, 'time').value = parts.join(':');
    item.parentElement!.querySelectorAll('.next-selected').forEach(el => el.classList.remove('next-selected')); item.classList.add('next-selected');
  }));
  document.getElementById('toggle')!.addEventListener('click', event => {
    const button = event.currentTarget as HTMLElement;
    const dates = button.textContent === '选择日期';
    root.querySelector<HTMLElement>('.next-calendar')!.style.display = dates ? '' : 'none';
    document.getElementById('time-panels')!.style.display = dates ? 'none' : '';
    button.textContent = dates ? '选择时间' : '选择日期';
  });
  const main = ['start', 'end'].map(id => document.getElementById(id) as HTMLInputElement);
  document.getElementById('confirm')!.addEventListener('click', () => {
    if (options.commit !== 'none') main.forEach((field, index) => { const side = index === 0 ? 'start' : 'end'; field.value = `${read(side, 'date').value} ${read(side, 'time').value}`; });
    if (options.commit === 'overwrite') main[0].value = main[1].value;
    if (options.commit === 'rollback') setTimeout(() => { main[0].value = main[1].value; }, 250);
    root.style.display = 'none';
    document.querySelector('.next-range-picker-trigger')!.setAttribute('aria-expanded', 'false');
  });
  if (options.ambiguousOwner) document.body.insertAdjacentHTML('beforeend', '<div class="next-range-picker"><div class="next-range-picker-trigger" aria-expanded="true"><span class="next-range-picker-trigger-input"><input></span><span class="next-range-picker-trigger-input"><input></span></div></div>');
  read('start', 'date').focus();
  return { root, main, read };
}

describe('strict date-time values', () => {
  it('accepts local wall-clock values without discarding seconds or converting timezones', () => {
    expect(parseCalendarDateTime('2026-10-17T09:10:11').value).toBe('2026-10-17 09:10:11');
    expect(parseCalendarDateTime('2026/10/17 09:10').value).toBe('2026-10-17 09:10:00');
  });
  it.each(['2026-02-29 12:00:00', '2026-10-17 24:00:00', '2026-10-17 12:60:00', '2026-10-17 12:00:60', '2026-10-17 12:00:00Z', '2026-10-17'])('rejects invalid or ambiguous input %s', value => { expect(() => parseCalendarDateTime(value)).toThrow(); });
});

describe('Fusion Next date-time range adapter', () => {
  it('clicks calendar dates and all six time components, then confirms and verifies main fields to seconds', async () => {
    const { main } = fixture();
    const result = await finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'));
    expect(result.output).toEqual(['2026-10-17 09:10:11', '2026-11-17 18:20:21']);
    expect(main.map(field => field.value)).toEqual(result.output);
    expect(vi.mocked(executeEvent).mock.calls.filter(([el]) => el.tagName === 'LI')).toHaveLength(6);
    expect(vi.mocked(executeEvent).mock.calls.every(([, event]) => event.type === 'click')).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls.at(-1)![0].id).toBe('confirm');
  });
  it('supports same-day ranges without overwriting start while focusing end', async () => {
    fixture();
    const result = await finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-10-17 18:20:21'));
    expect(result.verification.actual).toEqual(['2026-10-17 09:10:11', '2026-10-17 18:20:21']);
  });
  it('reads Chinese compact headers and verifies actual month changes when navigating beyond displayed months', async () => {
    const { root } = fixture();
    root.querySelector('.next-calendar-btn-next-month')!.addEventListener('click', () => {
      root.querySelector('.next-calendar-panel-header-left')!.textContent = '十一月2026';
      root.querySelector('.next-calendar-panel-header-right')!.textContent = '十二月2026';
      root.querySelector<HTMLElement>('.next-calendar-body-left td')!.title = '2026-11-17';
      root.querySelector<HTMLElement>('.next-calendar-body-right td')!.title = '2026-12-17';
    });
    expect((await finish(selectCalendarDate('#popup', '2026-11-17 09:10:11', '2026-12-17 18:20:21'))).output).toEqual(['2026-11-17 09:10:11', '2026-12-17 18:20:21']);
    expect(vi.mocked(executeEvent).mock.calls.some(([el]) => el.classList.contains('next-calendar-btn-next-month'))).toBe(true);
  });
  it('detects a wrong-direction icon, attempts restoration and never confirms an unverified date', async () => {
    const { root } = fixture();
    root.querySelector('.next-calendar-btn-next-month')!.addEventListener('click', () => {
      root.querySelector('.next-calendar-panel-header-left')!.textContent = '九月2026';
      root.querySelector('.next-calendar-panel-header-right')!.textContent = '十月2026';
    });
    root.querySelector('.next-calendar-btn-prev-month')!.addEventListener('click', () => {
      root.querySelector('.next-calendar-panel-header-left')!.textContent = '十月2026';
      root.querySelector('.next-calendar-panel-header-right')!.textContent = '十一月2026';
    });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-12-17 18:20:21'))).rejects.toThrow('未向目标靠近');
    expect(root.querySelector('.next-calendar-panel-header-left')!.textContent).toBe('十月2026');
    expect(vi.mocked(executeEvent).mock.calls.some(([el]) => el.id === 'confirm')).toBe(false);
  });
  it('does not claim success on correct popup drafts when main form never commits', async () => {
    fixture({ commit: 'none' });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toThrow('最终日期时间校验失败');
  });
  it.each(['overwrite', 'rollback'] as const)('detects main start overwritten by end (%s), including asynchronous rollback', async commit => {
    fixture({ commit });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toMatchObject({ verification: { ok: false, actual: { values: ['2026-11-17 18:20:21', '2026-11-17 18:20:21'] } } });
  });
  it('checks seconds rather than accepting selected list items alone', async () => {
    fixture({ badSeconds: true });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toThrow('内部起止时间核验失败');
    expect(vi.mocked(executeEvent).mock.calls.some(([el]) => el.id === 'confirm')).toBe(false);
  });
  it('refuses disabled time options before confirmation', async () => {
    fixture({ disabledHour: true });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toThrow('不可选');
    expect(vi.mocked(executeEvent).mock.calls.some(([el]) => el.id === 'confirm')).toBe(false);
  });
  it('refuses ambiguous openers instead of taking values from another picker', async () => {
    fixture({ ambiguousOwner: true });
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toThrow('无法唯一关联');
    expect(executeEvent).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-10-17 12:00:00', '2026-10-17 09:00:00'],
    ['2026-10-17 12:00:00', '2026-11-17'],
    ['2026-10-17 12:00:00', undefined],
  ])('rejects an invalid range before any operation: %s, %s', async (start, end) => {
    fixture(); await expect(finish(selectCalendarDate('#popup', start!, end))).rejects.toThrow(); expect(executeEvent).not.toHaveBeenCalled();
  });
  it('refuses unsupported datetime widgets instead of silently falling back to dates', async () => {
    document.body.innerHTML = '<div id="popup"><table><tr><td title="2026-10-17">17</td></tr></table></div>';
    await expect(finish(selectCalendarDate('#popup', '2026-10-17 09:10:11', '2026-11-17 18:20:21'))).rejects.toThrow('尚未适配');
    expect(executeEvent).not.toHaveBeenCalled();
  });
});
