// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { selectCalendarDate } from './calendar';
import { executeEvent } from './executor';
import { findCalendarFields, normalizeCalendarField, readCalendarFields } from './calendar-fields';
vi.mock('./executor', () => ({ executeEvent: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  vi.mocked(executeEvent).mockImplementation(async element => { element.click(); return { verification: { ok: true, summary: 'clicked' } }; });
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.clearAllMocks(); });

function rangePicker(onDate?: (iso: string, start: HTMLInputElement, end: HTMLInputElement) => void) {
  document.body.innerHTML = '<div class="aurora-picker" id="picker"><div class="aurora-picker-input aurora-picker-input-active"><input id="date_range" placeholder="开始日期"></div><div class="aurora-picker-input"><input id="end" placeholder="结束日期" readonly></div></div><div id="calendar" class="aurora-picker-panel-layout"><div class="picker-header-view">2026年10月</div><table><tr><td title="2026-10-01">1</td><td title="2026-10-11">11</td></tr></table></div>';
  const start = document.querySelector<HTMLInputElement>('#date_range')!;
  const end = document.querySelector<HTMLInputElement>('#end')!;
  let active: HTMLInputElement = start;
  for (const field of [start, end]) field.addEventListener('focusin', () => { active = field; });
  start.focus();
  const clicks: Array<{ date: string; field: HTMLInputElement }> = [];
  document.querySelectorAll<HTMLElement>('td').forEach(cell => cell.addEventListener('click', () => {
    const iso = cell.title;
    clicks.push({ date: iso, field: active });
    cell.setAttribute('aria-selected', 'true');
    if (onDate) onDate(iso, start, end); else active.value = iso.replaceAll('-', '/');
  }));
  return { start, end, clicks };
}
async function finish<T>(promise: Promise<T>): Promise<T> {
  // Attach handlers before advancing timers to avoid unhandled test rejections.
  const result = promise.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  const settled = await result;
  if ('error' in settled) throw settled.error;
  return settled.value;
}

it('switches focus to the end field before the second date and verifies actual input values', async () => {
  const { start, end, clicks } = rangePicker();
  const result = await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'));
  expect(clicks).toEqual([{ date: '2026-10-01', field: start }, { date: '2026-10-11', field: end }]);
  expect(vi.mocked(executeEvent).mock.calls.map(([element]) => element.id || element.tagName)).toEqual(['TD', 'end', 'TD']);
  expect([start.value, end.value]).toEqual(['2026/10/01', '2026/10/11']);
  expect(result.verification).toMatchObject({ ok: true, actual: ['2026-10-01', '2026-10-11'] });
  expect(result.verification.evidence).toContain('实际输入框 start：2026/10/01');
});

it('selects the correct range from a side panel when Chrome suppresses native focus lifecycle events', async () => {
  const { start, end, clicks } = rangePicker();
  let active: Element = start;
  vi.spyOn(document, 'activeElement', 'get').mockImplementation(() => active);
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  // Browser focus remains in the extension; .focus() changes DOM state only.
  vi.spyOn(start, 'focus').mockImplementation(() => { active = start; });
  vi.spyOn(end, 'focus').mockImplementation(() => { active = end; });
  const result = await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'));
  expect(clicks).toEqual([{ date: '2026-10-01', field: start }, { date: '2026-10-11', field: end }]);
  expect([start.value, end.value]).toEqual(['2026/10/01', '2026/10/11']);
  expect(result.verification.evidence?.some(value => value.includes('网页焦点=false') && value.includes('focusin'))).toBe(true);
});

it('fails the exact regression: both clicks update start and end remains empty despite selected cells', async () => {
  rangePicker((iso, start) => { start.value = iso.replaceAll('-', '/'); });
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({
    message: expect.stringContaining('最终日期校验失败'), verification: { ok: false, expected: ['2026-10-01', '2026-10-11'], actual: { dates: ['2026-10-11', ''], fields: { start: '2026/10/11', end: '' } } },
  });
  expect(vi.mocked(executeEvent).mock.calls.filter(([element]) => element.tagName === 'TD')).toHaveLength(2);
});

it('re-reads start after end selection and fails even if the end field itself is correct', async () => {
  rangePicker((iso, start, end) => { if (iso.endsWith('01')) start.value = iso; else { end.value = iso; start.value = iso; } });
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({ verification: { ok: false, actual: { dates: ['2026-10-11', '2026-10-11'] } } });
});

it('detects an asynchronous rollback instead of accepting a transient correct range', async () => {
  rangePicker((iso, start, end) => {
    if (iso.endsWith('01')) start.value = iso;
    else { end.value = iso; setTimeout(() => { start.value = '2026/10/11'; }, 250); }
  });
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({ verification: { ok: false, actual: { fields: { start: '2026/10/11', end: '2026-10-11' } } } });
});

it('waits for asynchronous input commits and supports a closing popup', async () => {
  rangePicker((iso, start, end) => {
    if (iso.endsWith('01')) start.value = iso;
    else { document.querySelector('#calendar')!.remove(); setTimeout(() => { end.value = iso; }, 450); }
  });
  const result = await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'));
  expect(result.verification.actual).toEqual(['2026-10-01', '2026-10-11']);
});

it('stops before clicking the end date if the end input cannot gain focus', async () => {
  const { end } = rangePicker();
  vi.spyOn(end, 'focus').mockImplementation(() => undefined);
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toThrow('结束日期输入框未获得焦点');
  expect(vi.mocked(executeEvent).mock.calls.filter(([element]) => element.tagName === 'TD')).toHaveLength(1);
});

it('does not use another picker with the same placeholder to prove success', async () => {
  const { start, end } = rangePicker();
  document.body.insertAdjacentHTML('afterbegin', '<div class="aurora-picker"><input id="other-start" placeholder="开始日期" value="2026/10/01"><input id="other-end" placeholder="结束日期" value="2026/10/11"></div>');
  start.focus();
  const result = await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'));
  expect(end.value).toBe('2026/10/11'); expect(result.verification.ok).toBe(true);
  expect(vi.mocked(executeEvent).mock.calls.some(([element]) => element.id.startsWith('other'))).toBe(false);
});

it('handles re-rendered fields inside the same picker and verifies current elements, not detached ones', async () => {
  const { start, end } = rangePicker((iso, first, last) => {
    (iso.endsWith('01') ? first : last).value = iso;
    if (iso.endsWith('11')) { last.outerHTML = '<input id="end" placeholder="结束日期" value="">'; }
  });
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({ verification: { ok: false, actual: { fields: { start: '2026-10-01', end: '' } } } });
  expect(start.value).toBe('2026-10-01'); expect(end.isConnected).toBe(false);
});

it('supports same-day ranges by activating and verifying both inputs', async () => {
  const { start, end } = rangePicker();
  const result = await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-01'));
  expect([start.value, end.value]).toEqual(['2026/10/01', '2026/10/01']);
  expect(result.output).toEqual(['2026-10-01', '2026-10-01']);
});

it('reads both dates from a combined input rather than synthesizing the expected range', async () => {
  document.body.innerHTML = '<div class="ant-picker"><input id="combined"></div><div id="calendar"><table><tr><td title="2026-10-01">1</td><td title="2026-10-11">11</td></tr></table></div>';
  const input = document.querySelector<HTMLInputElement>('input')!; input.focus();
  document.querySelectorAll<HTMLElement>('td').forEach(cell => cell.addEventListener('click', () => {
    cell.setAttribute('aria-selected', 'true'); input.value = cell.title.endsWith('01') ? '2026/10/01' : '2026/10/01 ~ 2026/10/11';
  }));
  expect((await finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).verification.actual).toEqual(['2026-10-01', '2026-10-11']);
});

it('fails a combined field that contains only the last clicked date', async () => {
  document.body.innerHTML = '<div class="ant-picker"><input id="combined"></div><div id="calendar"><table><tr><td title="2026-10-01">1</td><td title="2026-10-11">11</td></tr></table></div>';
  const input = document.querySelector<HTMLInputElement>('input')!; input.focus();
  document.querySelectorAll<HTMLElement>('td').forEach(cell => cell.addEventListener('click', () => { cell.setAttribute('aria-selected', 'true'); input.value = cell.title; }));
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({ verification: { actual: { dates: ['2026-10-11'] } } });
});

it('rejects a stale inline first-date receipt when only the end remains selected', async () => {
  document.body.innerHTML = '<div id="calendar"><table><tr><td title="2026-10-01">1</td><td title="2026-10-11">11</td></tr></table></div>';
  document.querySelectorAll('td').forEach(cell => cell.addEventListener('click', () => { document.querySelectorAll('td').forEach(other => other.removeAttribute('aria-selected')); cell.setAttribute('aria-selected', 'true'); }));
  await expect(finish(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11'))).rejects.toMatchObject({ verification: { actual: { dates: ['2026-10-11'] } } });
});

it('resolves reversed DOM order by start/end roles and explicit popup ownership without focus', () => {
  document.body.innerHTML = '<div class="range"><input id="end" placeholder="结束日期" value="2026/10/11"><input id="start" placeholder="开始日期" value="2026/10/01" aria-controls="popup"></div><div id="popup"><div id="calendar"></div></div>';
  const binding = findCalendarFields(document.querySelector('#calendar')!, true)!;
  expect(binding.kind).toBe('pair'); expect(binding.read().map(field => field.id)).toEqual(['start', 'end']);
  expect(readCalendarFields(binding).dates).toEqual(['2026-10-01', '2026-10-11']);
});

it('normalizes actual date formats without accepting substrings or invalid dates', () => {
  for (const value of ['2026/10/1', '2026-10-01', '2026年10月1日', '2026-10-01 00:00:00']) expect(normalizeCalendarField(value)).toBe('2026-10-01');
  for (const value of ['', '2026-02-29', 'x2026-10-01', '2026-10-011']) expect(normalizeCalendarField(value)).toBeUndefined();
});

it('fails safely when date inputs exist but cannot be associated with the popup', async () => {
  document.body.innerHTML = '<input placeholder="开始日期"><input placeholder="结束日期"><div id="calendar"><table><tr><td title="2026-10-01" aria-selected="true">1</td><td title="2026-10-11" aria-selected="true">11</td></tr></table></div>';
  await expect(selectCalendarDate('#calendar', '2026-10-01', '2026-10-11')).rejects.toMatchObject({ message: expect.stringContaining('无法唯一关联'), verification: { ok: false } });
  expect(executeEvent).not.toHaveBeenCalled();
});

it('does not accept two date substrings embedded in an invalid combined value', () => {
  document.body.innerHTML = '<div class="ant-picker"><input id="combined" value="错误：2026-10-01 ~ 2026-10-11"></div><div id="calendar"></div>';
  document.querySelector<HTMLInputElement>('input')!.focus();
  const binding = findCalendarFields(document.querySelector('#calendar')!, true)!;
  expect(readCalendarFields(binding)).toEqual({ dates: [], fields: { range: '错误：2026-10-01 ~ 2026-10-11' } });
});
