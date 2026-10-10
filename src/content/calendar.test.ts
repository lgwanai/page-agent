// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarMonth, parseCalendarDate, resolveCalendarContainer, selectCalendarDate } from './calendar';
import { executeEvent } from './executor';
vi.mock('./executor', () => ({ executeEvent: vi.fn() }));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  vi.mocked(executeEvent).mockImplementation(async (element) => {
    element.click();
    return { verification: { ok: true, summary: 'clicked' } };
  });
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('calendar rules', () => {
  it('recognizes a zero-size positioning root with a visible calendar child', () => {
    document.body.innerHTML = '<div id="calendar"><table><tr><td>1</td></tr></table></div>';
    const root = document.querySelector<HTMLElement>('#calendar')!;
    vi.spyOn(root, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
    expect(resolveCalendarContainer('#calendar')).toBe(root);
  });

  it('does not accept descendants of a hidden calendar root', () => {
    document.body.innerHTML = '<div id="calendar" style="display:none"><table><tr><td>1</td></tr></table></div>';
    expect(() => resolveCalendarContainer('#calendar')).toThrow('原始匹配 1 个，可用 0 个');
  });

  it('reports missing and ambiguous containers distinctly', () => {
    expect(() => resolveCalendarContainer('.calendar')).toThrow('原始匹配 0 个');
    document.body.innerHTML = '<div class="calendar"></div><div class="calendar"></div>';
    expect(() => resolveCalendarContainer('.calendar')).toThrow('可用 2 个');
  });

  it('waits for a calendar opening animation before selecting a date', async () => {
    document.body.innerHTML = '<div id="calendar" style="opacity:0"><div class="picker-header-view">2026年8月</div><table><tr><td title="2026-08-01">1</td></tr></table></div>';
    document.querySelector('td')!.addEventListener('click', (event) => (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true'));
    setTimeout(() => { document.querySelector<HTMLElement>('#calendar')!.style.opacity = '1'; }, 150);
    expect((await selectCalendarDate('#calendar', '2026-08-01')).verification.ok).toBe(true);
    expect(executeEvent).toHaveBeenCalledOnce();
  });
  function setupIcons(buttons: string, month = 9) {
    document.body.innerHTML = `<div id="calendar"><div class="picker-header">${buttons}<div class="picker-header-view">2026年${month}月</div></div><table></table></div>`;
    let current = 2026 * 12 + month - 1;
    return (id: string, delta: number) => document.querySelector(`#${id}`)!.addEventListener('click', () => {
      current += delta;
      document.querySelector('.picker-header-view')!.textContent = `${Math.floor(current / 12)}年${current % 12 + 1}月`;
      document.querySelector('table')!.innerHTML = current === 2026 * 12 + 7 ? '<tr><td title="2026-08-01">1</td></tr>' : '';
      document.querySelector('td')?.addEventListener('click', (event) => (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true'));
    });
  }

  it('reads directions from descendant icon classes without button text', async () => {
    const bind = setupIcons('<button id="left"><svg class="chevron-left"></svg></button><button id="right"><svg class="chevron-right"></svg></button>');
    bind('left', -1); bind('right', 1);
    expect((await selectCalendarDate('#calendar', '2026-08-01')).verification.ok).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls[0][0].id).toBe('left');
  });

  it('self-corrects mislabeled icon directions, restores the original month and uses the learned direction', async () => {
    const bind = setupIcons('<button id="wrong" class="prev"><svg></svg></button><button id="correct" class="next"><svg></svg></button>');
    bind('wrong', 1); bind('correct', -1);
    const result = await selectCalendarDate('#calendar', '2026-08-01');
    expect(result.verification.ok).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls.map(([element]) => element.id || element.tagName)).toEqual(['wrong', 'correct', 'correct', 'TD']);
    expect(result.verification.evidence).toContain('已确认恢复原年月，重新选择翻页按钮');
  });

  it('recovers when an alleged month arrow actually changes a year', async () => {
    const bind = setupIcons('<button id="wrong" class="prev"><svg></svg></button><button id="month" class="prev-month"><svg></svg></button><button id="reverse" class="next-year"><svg></svg></button>');
    bind('wrong', -12); bind('month', -1); bind('reverse', 12);
    expect((await selectCalendarDate('#calendar', '2026-08-01')).verification.ok).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls.map(([element]) => element.id || element.tagName)).toEqual(['wrong', 'reverse', 'month', 'TD']);
  });

  it('tries another header icon when the first does nothing', async () => {
    const bind = setupIcons('<button id="noop"><svg></svg></button><button id="works"><svg></svg></button>');
    bind('works', -1);
    expect((await selectCalendarDate('#calendar', '2026-08-01')).verification.ok).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls[0][0].id).toBe('noop');
  });

  it('stops if a wrong navigation cannot be recovered instead of selecting a date', async () => {
    const bind = setupIcons('<button id="wrong" class="prev"><svg></svg></button>');
    bind('wrong', 1);
    await expect(selectCalendarDate('#calendar', '2026-08-01')).rejects.toThrow('未能确认恢复');
    expect(executeEvent).toHaveBeenCalledOnce();
  });
  it('validates dates including leap years', () => {
    expect(parseCalendarDate('2024/2/29').iso).toBe('2024-02-29');
    expect(() => parseCalendarDate('2026-02-29')).toThrow('无效');
    expect(() => parseCalendarDate('abc')).toThrow('格式');
  });
  it('recognizes numeric, Chinese and English headers', () => {
    for (const header of ['2026年10月', '2026-10', '10月 2026', 'October 2026', 'Oct 2026']) expect(calendarMonth(header)).toBe(2026 * 12 + 9);
    expect(calendarMonth('unknown')).toBeUndefined();
  });
  it('selects and verifies a single date', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年10月</div><table><tr><td title="2026-10-01">1</td></tr></table></div>';
    document.querySelector('td')!.addEventListener('click', (event) => (event.currentTarget as HTMLElement).classList.add('picker-cell-selected'));
    const result = await selectCalendarDate('#calendar', '2026-10-01');
    expect(result.verification.ok).toBe(true);
    expect(result.output).toEqual(['2026-10-01']);
  });
  it('navigates months before clicking the date', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年9月</div><button class="picker-header-next-btn">›</button><table></table></div>';
    document.querySelector('button')!.addEventListener('click', () => {
      document.querySelector('.picker-header-view')!.textContent = '2026年10月';
      document.querySelector('table')!.innerHTML = '<tr><td title="2026-10-01">1</td></tr>';
      document.querySelector('td')!.addEventListener('click', (event) => (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true'));
    });
    const result = await selectCalendarDate('#calendar', '2026-10-01');
    expect(result.verification.evidence).toContain('翻页：向后');
    expect(executeEvent).toHaveBeenCalledTimes(2);
  });
  it('selects both ends of a range', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年10月</div><table><tr><td title="2026-10-01">1</td><td title="2026-10-10">10</td></tr></table></div>';
    document.querySelectorAll('td').forEach((cell) => cell.addEventListener('click', () => cell.setAttribute('aria-selected', 'true')));
    expect((await selectCalendarDate('#calendar', '2026-10-01', '2026-10-10')).output).toEqual(['2026-10-01', '2026-10-10']);
  });
  it('turns a September/October range back to August, ignoring hidden arrows and spillover cells', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-panels"><div class="picker-panel"><button class="picker-header-prev-btn" style="opacity:0">hidden</button><button id="previous" class="picker-header-prev-btn">‹</button><div class="picker-header-view">2026年9月</div><table><tr><td title="2026-08-31" class="prev-month">31</td></tr></table></div><div class="picker-panel"><button class="picker-header-prev-btn" style="pointer-events:none">inactive</button><div class="picker-header-view">2026年10月</div><table><tr><td title="2026-10-01">1</td></tr></table></div></div></div>';
    const spillover = document.querySelector('[title="2026-08-31"]')!;
    const wrongClick = vi.fn(); spillover.addEventListener('click', wrongClick);
    document.querySelector('#previous')!.addEventListener('click', () => {
      const headers = document.querySelectorAll('.picker-header-view');
      headers[0].textContent = '2026年8月'; headers[1].textContent = '2026年9月';
      document.querySelector('table')!.innerHTML = '<tr><td title="2026-08-01" class="picker-cell-in-view">1</td><td title="2026-08-31" class="picker-cell-in-view">31</td></tr>';
      document.querySelectorAll('td').forEach((cell) => cell.addEventListener('click', () => cell.setAttribute('aria-selected', 'true')));
    });
    const result = await selectCalendarDate('#calendar', '2026-08-01', '2026-08-31');
    expect(result.output).toEqual(['2026-08-01', '2026-08-31']);
    expect(executeEvent).toHaveBeenCalledTimes(3);
    expect(vi.mocked(executeEvent).mock.calls[0][0].id).toBe('previous');
    expect(wrongClick).not.toHaveBeenCalled();
  });

  it('does not click an August spillover cell until the month header is August', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年9月</div><button id="previous" aria-label="Previous month">‹</button><table><tr><td title="2026-08-31">31</td></tr></table></div>';
    document.querySelector('#previous')!.addEventListener('click', () => { document.querySelector('.picker-header-view')!.textContent = '2026年8月'; });
    document.querySelector('td')!.addEventListener('click', (event) => (event.currentTarget as HTMLElement).setAttribute('aria-selected', 'true'));
    await selectCalendarDate('#calendar', '2026-08-31');
    expect(vi.mocked(executeEvent).mock.calls[0][0].id).toBe('previous');
    expect(executeEvent).toHaveBeenCalledTimes(2);
  });
  it('verifies a date when selection closes the popup and updates an input', async () => {
    document.body.innerHTML = '<input id="date"><div id="calendar"><table><tr><td title="2026-10-01">1</td></tr></table></div>';
    document.querySelector('td')!.addEventListener('click', () => {
      document.querySelector<HTMLInputElement>('#date')!.value = '2026-10-01';
      document.querySelector('#calendar')!.remove();
    });
    expect((await selectCalendarDate('#calendar', '2026-10-01')).verification.ok).toBe(true);
  });

  it('refuses ambiguous duplicate date cells', async () => {
    document.body.innerHTML = '<div id="calendar"><table><tr><td title="2026-10-01">1</td><td title="2026-10-01">1</td></tr></table></div>';
    await expect(selectCalendarDate('#calendar', '2026-10-01')).rejects.toThrow('多个');
    expect(executeEvent).not.toHaveBeenCalled();
  });
  it('rejects disabled dates and reversed ranges without clicks', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年10月</div><table><tr><td title="2026-10-01" aria-disabled="true">1</td></tr></table></div>';
    await expect(selectCalendarDate('#calendar', '2026-10-01')).rejects.toThrow('找不到可选日期');
    await expect(selectCalendarDate('#calendar', '2026-10-10', '2026-10-01')).rejects.toThrow('早于');
    expect(executeEvent).not.toHaveBeenCalled();
  });
  it('does not report success for a click with no observable selection', async () => {
    document.body.innerHTML = '<div id="calendar"><table><tr><td title="2026-10-01">1</td></tr></table></div>';
    await expect(selectCalendarDate('#calendar', '2026-10-01')).rejects.toThrow('不能确认');
  });
  it('fails instead of repeatedly clicking a nonfunctional arrow', async () => {
    document.body.innerHTML = '<div id="calendar"><div class="picker-header-view">2026年9月</div><button aria-label="Next month">›</button></div>';
    await expect(selectCalendarDate('#calendar', '2026-10-01')).rejects.toThrow('年月未变化');
    expect(executeEvent).toHaveBeenCalledOnce();
  });
});
