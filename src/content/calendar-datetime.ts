import type { ExecutionVerification } from '@/types/workflow';
import { executeEvent } from './executor';
import { focusElement } from './focus';

export interface CalendarDateTime {
  date: string; time: string; value: string; month: number; day: number;
}

/** Local wall-clock value: no timezone conversion and no silently discarded seconds. */
export function parseCalendarDateTime(value: string): CalendarDateTime {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) throw new Error('日期时间需要 YYYY-MM-DD HH:mm:ss 格式（也支持 T 分隔、分钟精度补零秒）');
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part ?? 0));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error('日期时间无效，请检查年月日和时分秒范围');
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const time = [hour, minute, second].map(part => String(part).padStart(2, '0')).join(':');
  return { date: iso, time, value: `${iso} ${time}`, month: year * 12 + month - 1, day };
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
  }
  return [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
}
function disabled(element: HTMLElement): boolean {
  return !!element.closest('[disabled],[aria-disabled="true"],.next-disabled,[class*="-disabled"]');
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const chineseMonths = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
function nextMonth(text: string, fallback: (text: string) => number | undefined): number | undefined {
  const result = fallback(text);
  if (result !== undefined) return result;
  const match = /^(\d{1,2}|[一二三四五六七八九十]+)月\s*(\d{4})$/.exec(text.replace(/\s+/g, ''));
  if (!match) return undefined;
  const month = /^\d+$/.test(match[1]) ? Number(match[1]) : chineseMonths.indexOf(match[1]) + 1;
  return month >= 1 && month <= 12 ? Number(match[2]) * 12 + month - 1 : undefined;
}

/** Isolated Fusion Next adapter. Date-only Aurora/Ant/inline selection stays on its legacy path. */
export async function selectCalendarDateTime(selector: string, start: string, end: string | undefined, helpers: {
  resolve: (selector: string) => HTMLElement;
  month: (text: string) => number | undefined;
}): Promise<{ output: string[]; verification: ExecutionVerification }> {
  const dates = [parseCalendarDateTime(start)];
  if (!end) throw new Error('日期时间区间需要同时配置开始和结束时间；当前适配 Fusion Next 日期时间区间控件');
  dates.push(parseCalendarDateTime(end));
  const expected = dates.map(date => date.value);
  if (expected[1] < expected[0]) throw new Error('结束时间不能早于开始时间（包含时分秒）');
  const evidence: string[] = [];
  const fail = (message: string, actual?: unknown): never => {
    throw Object.assign(new Error(message), { verification: { ok: false, summary: message, expected, actual, evidence: [...evidence] } });
  };
  const root = () => helpers.resolve(selector);
  const openedBy = Date.now() + 8000;
  let popup: HTMLElement;
  while (true) {
    try { popup = root(); break; } catch (error) {
      if (Date.now() >= openedBy) fail(`日期时间弹层未就绪：${(error as Error).message}`);
      await wait(100);
    }
  }
  if (!popup!.matches('.next-range-picker-body-show-time')) fail('当前日期时间控件尚未适配；请选择包含日期、时间和确定按钮的 Fusion Next 区间弹层，不会降级为只设置日期');
  const openers = [...document.querySelectorAll<HTMLElement>('.next-range-picker-trigger[aria-expanded="true"]')].filter(visible);
  const owners = [...new Set(openers.map(trigger => trigger.closest<HTMLElement>('.next-range-picker')).filter((owner): owner is HTMLElement => !!owner))];
  if (owners.length !== 1) fail(`无法唯一关联日期时间弹层的主表单输入框（发现 ${owners.length} 组），已停止`);
  const owner = owners[0];
  const ownerId = owner.id;
  const readOwner = () => {
    const current = ownerId ? document.getElementById(ownerId) : owner;
    if (!current?.isConnected || !current.matches('.next-range-picker')) return [];
    const fields = [...current.querySelectorAll<HTMLInputElement>('.next-range-picker-trigger-input input')].filter(visible);
    if (fields.length !== 2) return [];
    return fields.map(field => { try { return parseCalendarDateTime(field.value).value; } catch { return field.value; } });
  };
  if (readOwner().length !== 2) fail('关联的主表单必须有两个可见日期时间输入框');
  const input = (side: 'start' | 'end', type: 'date' | 'time'): HTMLInputElement => {
    const fields = [...root().querySelectorAll<HTMLInputElement>(`.next-range-picker-panel-input-${side}-${type} input`)].filter(visible);
    if (fields.length !== 1) fail(`日历内部 ${side}-${type} 输入框需要唯一且可见，实际 ${fields.length} 个`);
    return fields[0];
  };
  const click = async (element: HTMLElement) => {
    if (!visible(element) || disabled(element)) fail('日期时间操作目标不可见或被禁用，未强制点击', element.className);
    const result = await executeEvent(element, { type: 'click' });
    if (!result.verification.ok) fail(result.verification.summary);
    await wait(100);
  };
  const footer = (label: string): HTMLElement => {
    const found = [...root().querySelectorAll<HTMLElement>('.next-date-picker-panel-footer button')].filter(element => visible(element) && element.textContent?.trim() === label);
    if (found.length !== 1) fail(`日历内部「${label}」按钮不唯一或不存在；不会点击页面其他同名按钮`);
    return found[0];
  };
  const toggleDates = [...root().querySelectorAll<HTMLElement>('.next-date-picker-panel-footer button')].find(element => visible(element) && element.textContent?.trim() === '选择日期');
  if (toggleDates) await click(toggleDates);
  const panels = () => (['left', 'right'] as const).map(side => {
    const body = root().querySelector<HTMLElement>(`.next-calendar-body-${side}`);
    const header = root().querySelector<HTMLElement>(`.next-calendar-panel-header-${side}`);
    const month = nextMonth(header?.textContent ?? '', helpers.month);
    if (!body || !visible(body) || month === undefined) fail('无法识别 Fusion Next 日期时间日历的双面板年月，已停止');
    return { body: body!, month: month! };
  });
  for (const [index, date] of dates.entries()) {
    const side = index === 0 ? 'start' : 'end';
    const field = input(side, 'date');
    if (disabled(field)) fail(`${side} 日期输入框被禁用`);
    const focus = focusElement(field);
    if (!focus.ok) fail(`无法切换到${index === 0 ? '开始' : '结束'}日期输入框`);
    await click(field);
    evidence.push(`已切换到 ${side} 日期框；focusin 补齐：${focus.repaired.join(',') || '无'}`);
    let selected = false;
    for (let turn = 0; turn < 240; turn++) {
      const views = panels();
      const view = views.find(panel => panel.month === date.month);
      if (view) {
        const cells = [...view.body.querySelectorAll<HTMLElement>('td[title], [role="gridcell"][title]')].filter(cell => cell.title.replaceAll('/', '-') === date.date && visible(cell)
          && !/prev-month|next-month|other-month/.test(cell.className));
        if (cells.length !== 1) fail(`日期 ${date.date} 在对应月份中不唯一或不存在，已停止`);
        if (disabled(cells[0])) fail(`日期 ${date.date} 被页面禁用，不能选择`);
        await click(cells[0]);
        if (input(side, 'date').value !== date.date) fail(`日期点击后 ${side} 实际值不正确`, input(side, 'date').value);
        if (index === 1 && input('start', 'date').value !== dates[0].date) fail('设置结束日期覆盖了开始日期，已停止', [input('start', 'date').value, input('end', 'date').value]);
        evidence.push(`已点击并核验 ${side} 日期：${date.date}`);
        selected = true; break;
      }
      const before = views.map(panel => panel.month);
      const direction = date.month < Math.min(...before) ? -1 : 1;
      const arrow = root().querySelector<HTMLElement>(`.next-calendar-btn-${direction < 0 ? 'prev' : 'next'}-month`);
      if (!arrow) fail('日期时间日历缺少可识别的上一月/下一月图标按钮');
      await click(arrow!);
      const deadline = Date.now() + 1500;
      let after = panels().map(panel => panel.month);
      while (after.every((value, i) => value === before[i]) && Date.now() < deadline) { await wait(100); after = panels().map(panel => panel.month); }
      const distance = (months: number[]) => Math.min(...months.map(month => Math.abs(month - date.month)));
      if (distance(after) >= distance(before)) {
        if (after.some((value, i) => value !== before[i])) {
          const reverse = root().querySelector<HTMLElement>(`.next-calendar-btn-${direction < 0 ? 'next' : 'prev'}-month`);
          if (reverse) await click(reverse);
          evidence.push(`翻页方向异常，恢复校验：${panels().map(panel => panel.month).join(',')}，预期 ${before.join(',')}`);
        }
        fail('月份翻页未向目标靠近，已停止，不能根据图标点击回执假定翻页成功', after);
      }
      evidence.push(`年月翻页核验：${before.join('/')} → ${after.join('/')}`);
    }
    if (!selected) fail('日期时间日历翻页超过 240 次安全上限');
  }
  await click(footer('选择时间'));
  for (const [index, date] of dates.entries()) {
    const side = index === 0 ? 'start' : 'end';
    for (const [part, component] of ['hour', 'minute', 'second'].entries()) {
      const wanted = Number(date.time.split(':')[part]);
      const columns = [...root().querySelectorAll<HTMLElement>(`.next-range-picker-panel-time-${side} .next-time-picker-menu-${component}`)].filter(visible);
      if (columns.length !== 1) fail(`${side} 时间缺少唯一可见的 ${component} 选择列；不会忽略该精度`);
      const options = [...columns[0].querySelectorAll<HTMLElement>('li[role="option"],li.next-time-picker-menu-item')].filter(option => /^\d{1,2}$/.test(option.textContent?.trim() ?? '') && Number(option.textContent?.trim()) === wanted);
      if (options.length !== 1 || disabled(options[0])) fail(`${side} ${component}=${wanted} 不可选或匹配不唯一`);
      await click(options[0]);
      const selected = [...root().querySelectorAll<HTMLElement>(`.next-range-picker-panel-time-${side} .next-time-picker-menu-${component} .next-selected, .next-range-picker-panel-time-${side} .next-time-picker-menu-${component} [aria-selected="true"]`)];
      if (selected.length !== 1 || Number(selected[0].textContent?.trim()) !== wanted) fail(`${side} ${component} 实际选中值与预期不符`);
      evidence.push(`已点击并核验 ${side} ${component}：${wanted}`);
    }
  }
  const drafts = dates.map((_date, index) => {
    const side = index === 0 ? 'start' : 'end';
    try { return parseCalendarDateTime(`${input(side, 'date').value} ${input(side, 'time').value}`).value; }
    catch { return `${input(side, 'date').value} ${input(side, 'time').value}`; }
  });
  if (drafts.some((value, i) => value !== expected[i])) fail('日历内部起止时间核验失败，未点击确定', drafts);
  evidence.push(`内部草稿完整核验：${drafts.join(' 至 ')}`);
  await click(footer('确定'));
  const deadline = Date.now() + 3000;
  let actual = readOwner();
  let matchedSince: number | undefined;
  while (true) {
    actual = readOwner();
    const stillOpen = [...document.querySelectorAll<HTMLElement>(selector)].some(visible);
    const matches = !stillOpen && actual.length === 2 && actual.every((value, index) => value === expected[index]);
    if (matches) matchedSince ??= Date.now(); else matchedSince = undefined;
    if (matchedSince !== undefined && Date.now() - matchedSince >= 300) break;
    if (Date.now() >= deadline) fail(`日历最终日期时间校验失败：必须关闭弹层且主表单起止值精确到秒匹配；实际 ${actual.join(' 至 ')}`, { values: actual, popupOpen: stillOpen });
    await wait(100);
  }
  evidence.push(`主表单最终日期时间核验：${actual.join(' 至 ')}（稳定至少 300 毫秒）`);
  return { output: actual, verification: { ok: true, summary: `日期时间区间已核验（含时分秒）：${actual.join(' 至 ')}`, expected, actual, evidence } };
}
