import type { ExecutionVerification } from '@/types/workflow';
import { executeEvent } from './executor';
import { focusElement } from './focus';
import { findCalendarFields, hasUnboundCalendarFields, normalizeCalendarField, readCalendarFields, type CalendarFields } from './calendar-fields';
import { selectCalendarDateTime } from './calendar-datetime';

export function parseCalendarDate(value: string): { year: number; month: number; day: number; iso: string } {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) throw new Error('目标日期需要 YYYY-MM-DD 格式');
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) throw new Error('目标日期无效');
  return { year: y, month: m, day: d, iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

export function calendarMonth(text: string): number | undefined {
  const ym = /(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*月?/.exec(text);
  const my = /(\d{1,2})\s*月\s*(\d{4})/.exec(text);
  const match = ym ? [Number(ym[1]), Number(ym[2])] : my ? [Number(my[2]), Number(my[1])] : undefined;
  if (match && match[1] >= 1 && match[1] <= 12) return match[0] * 12 + match[1] - 1;
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const year = /\b(\d{4})\b/.exec(text)?.[1];
  const month = names.findIndex((name) => new RegExp(`\\b${name}(?:\\b)|\\b${name.slice(0, 3)}\\b`, 'i').test(text));
  return year && month >= 0 ? Number(year) * 12 + month : undefined;
}

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (!element.isConnected || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const ancestor = getComputedStyle(parent);
    if (ancestor.display === 'none' || ancestor.visibility === 'hidden' || ancestor.opacity === '0') return false;
  }
  return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}
function actionable(element: HTMLElement): boolean {
  return visible(element) && getComputedStyle(element).pointerEvents !== 'none' && !disabled(element);
}

export function resolveCalendarContainer(selector: string): HTMLElement {
  const raw = Array.from(document.querySelectorAll<HTMLElement>(selector));
  // Some popup roots have a zero-size positioning box while their absolutely
  // positioned calendar panels are visible. This is not a clickable target:
  // retain strict visibility checks for every arrow and date cell.
  const matches = raw.filter((element) => visible(element) || Array.from(element.querySelectorAll<HTMLElement>('table, [role="grid"], [class*="header-view"]')).some(visible));
  if (matches.length === 1) return matches[0];
  const diagnostics = raw.map((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return `display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity}, 尺寸=${Math.round(rect.width)}×${Math.round(rect.height)}`;
  });
  throw new Error(`日历容器尚未唯一可见：Selector 原始匹配 ${raw.length} 个，可用 ${matches.length} 个${diagnostics.length ? `（${diagnostics.join('；')}）` : ''}；请检查点击节点是否打开日历及容器 Selector`);
}

function calendarViews(container: HTMLElement): Array<{ scope: HTMLElement; month: number | undefined }> {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>('[class*="picker-panel"], [class*="calendar-panel"]')).filter((panel) => visible(panel) && !!panel.querySelector('table, [role="grid"]'));
  // Frameworks wrap both panels in a "picker-panels" element. Only retain
  // innermost panels so the right header is not mistaken for the left one.
  const panels = candidates.filter((panel) => !candidates.some((child) => child !== panel && panel.contains(child)));
  return (panels.length ? panels : [container]).map((scope) => {
    const headers = Array.from(scope.querySelectorAll<HTMLElement>('[class*="header-view"]')).filter(visible);
    const header = headers[0] ?? scope.querySelector<HTMLElement>('[class*="calendar-header"], [class*="datepicker-header"], [class*="picker-header"]');
    return { scope, month: calendarMonth(header?.textContent ?? '') };
  });
}
function disabled(element: HTMLElement): boolean {
  return !!element.closest('[aria-disabled="true"], [disabled], [class*="disabled"]');
}
function identity(element: HTMLElement): string {
  return [element.getAttribute('title'), element.getAttribute('aria-label'), element.getAttribute('data-date'), element.className, element.textContent,
    ...Array.from(element.querySelectorAll('svg, use, i, span, title')).map((icon) => [icon.getAttribute('class'), icon.getAttribute('aria-label'), icon.getAttribute('href'), icon.getAttribute('xlink:href'), icon.textContent].join(' ')),
  ].join(' ');
}

function navigationHint(button: HTMLElement): number | undefined {
  const text = identity(button);
  const left = /prev|previous|上一|上个|前一|left|chevron-left|[‹«←❮◀⏪]/i.test(text) || /^\s*<+\s*$/.test(button.textContent ?? '');
  const right = /next|下一|下个|后一|right|chevron-right|[›»→❯▶⏩]/i.test(text) || /^\s*>+\s*$/.test(button.textContent ?? '');
  if (left === right) return undefined;
  const year = /super|year|年|double|[«»]/i.test(text) || /^\s*(?:<<|>>)\s*$/.test(button.textContent ?? '');
  return (left ? -1 : 1) * (year ? 12 : 1);
}

async function navigateCalendar(root: () => HTMLElement, wanted: number, evidence: string[], click: (element: HTMLElement) => Promise<void>, learned: Map<string, number>): Promise<void> {
  const months = () => calendarViews(root()).flatMap((view) => view.month === undefined ? [] : [view.month]);
  const format = (values: number[]) => values.map((value) => `${Math.floor(value / 12)}年${value % 12 + 1}月`).join(' / ');
  const original = months();
  const distance = (values: number[]) => Math.min(...values.map((value) => Math.abs(value - wanted)));
  const candidates = () => Array.from(root().querySelectorAll<HTMLElement>('button, [role="button"], a')).filter(actionable)
    .filter((button) => navigationHint(button) !== undefined || (!!button.closest('[class*="header"]') && !!button.querySelector('svg, i, [class*="icon"], span') && !/\d|今天|today|确定|确认|关闭/i.test(button.textContent ?? '')))
    .map((button, index) => ({ button, key: `${button.id}|${button.className}|${index}`, hint: navigationHint(button) }));
  const waitChange = async (before: number[]) => {
    const deadline = Date.now() + 1200;
    do {
      const after = months();
      if (after.length === before.length && after.some((value, index) => value !== before[index])) return after;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    return months();
  };
  const attempted = new Set<string>();
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = months();
    const nearest = before.reduce((best, value) => Math.abs(value - wanted) < Math.abs(best - wanted) ? value : best, before[0]);
    const direction = Math.sign(wanted - nearest);
    const options = candidates().filter((candidate) => !attempted.has(candidate.key) && learned.get(candidate.key) !== 0);
    options.sort((a, b) => {
      const score = (item: typeof a) => {
        const delta = learned.get(item.key) ?? item.hint;
        if (delta === undefined) return 2;
        if (Math.sign(delta) !== direction) return 4;
        return Math.abs(nearest + delta - wanted) < Math.abs(nearest - wanted) ? 0 : 3;
      };
      return score(a) - score(b);
    });
    const candidate = options[0];
    if (!candidate) break;
    attempted.add(candidate.key);
    try { await click(candidate.button); }
    catch (error) { evidence.push(`候选按钮点击异常：${(error as Error).message}；重新检查年月`); }
    const after = await waitChange(before);
    if (after.length !== before.length || !after.length) throw new Error('翻页后无法识别年月面板，已停止以避免误选');
    const movedIndex = before.findIndex((value, index) => value !== after[index]);
    const delta = movedIndex < 0 ? 0 : after[movedIndex] - before[movedIndex];
    learned.set(candidate.key, delta);
    evidence.push(`图标翻页校验：${format(before)} → ${format(after)}（实际变化 ${delta} 个月）`);
    if (distance(after) < distance(before)) {
      evidence.push(`翻页：${delta < 0 ? '向前' : '向后'}`);
      return;
    }
    if (!delta) { evidence.push('按钮未改变年月，尝试其他候选'); continue; }
    evidence.push('翻页未向目标靠近，尝试恢复原年月');
    const recoveryTried = new Set<string>([candidate.key]);
    let restored = false;
    for (let recovery = 0; recovery < 4; recovery++) {
      const current = months();
      const difference = original.map((value, index) => value - current[index]).find((value) => value !== 0) ?? 0;
      const alternatives = candidates().filter((item) => !recoveryTried.has(item.key) && learned.get(item.key) !== 0);
      alternatives.sort((a, b) => {
        const score = (item: typeof a) => {
          const estimate = learned.get(item.key) ?? item.hint;
          return estimate === difference ? 0 : estimate !== undefined && Math.sign(estimate) === Math.sign(difference) ? 1 : estimate === undefined ? 2 : 3;
        };
        return score(a) - score(b);
      });
      const reverse = alternatives[0];
      if (!reverse) break;
      recoveryTried.add(reverse.key);
      await click(reverse.button);
      const recovered = await waitChange(current);
      if (recovered.length !== original.length) break;
      const index = current.findIndex((value, i) => value !== recovered[i]);
      learned.set(reverse.key, index < 0 ? 0 : recovered[index] - current[index]);
      evidence.push(`恢复校验：${format(current)} → ${format(recovered)}`);
      if (recovered.every((value, i) => value === original[i])) { restored = true; break; }
      if (recovered.reduce((sum, value, i) => sum + Math.abs(value - original[i]), 0) > current.reduce((sum, value, i) => sum + Math.abs(value - original[i]), 0)) break;
    }
    if (!restored) throw new Error(`日历图标翻页方向错误且未能确认恢复（原始：${format(original)}，当前：${format(months())}），已停止`);
    evidence.push('已确认恢复原年月，重新选择翻页按钮');
  }
  throw new Error('点击翻页按钮后年月未变化或没有安全的候选按钮，已停止');
}
function selected(element: HTMLElement): boolean {
  return !!element.closest('[aria-selected="true"], [class*="cell-selected"], [class*="range-start"], [class*="range-end"], [class*="selected-day"]');
}

function readInlineCalendar(container: HTMLElement | undefined): { dates: string[]; fields: Record<string, string> } {
  if (!container?.isConnected) return { dates: [], fields: {} };
  const cells = Array.from(container.querySelectorAll<HTMLElement>('[title], [data-date], [aria-label]')).filter(visible)
    .flatMap(cell => {
      const date = ['title', 'data-date', 'aria-label'].map(attr => normalizeCalendarField(cell.getAttribute(attr) ?? '')).find(Boolean);
      return date && selected(cell) ? [{ cell, date }] : [];
    });
  const starts = cells.filter(({ cell }) => cell.closest('[class*="range-start"]'));
  const ends = cells.filter(({ cell }) => cell.closest('[class*="range-end"]'));
  const dates = starts.length === 1 && ends.length === 1 ? [starts[0].date, ends[0].date] : [...new Set(cells.map(item => item.date))].sort();
  return { dates, fields: {} };
}

export async function selectCalendarDate(selector: string, date: string, endDate?: string): Promise<{ output: unknown; verification: ExecutionVerification }> {
  if (/[T ]\d{2}:/.test(date.trim()) || endDate && /[T ]\d{2}:/.test(endDate.trim())) return selectCalendarDateTime(selector, date, endDate, { resolve: resolveCalendarContainer, month: calendarMonth });
  const dates = [parseCalendarDate(date), ...(endDate ? [parseCalendarDate(endDate)] : [])];
  if (dates.length === 2 && dates[1].iso < dates[0].iso) throw new Error('结束日期不能早于开始日期');
  const evidence: string[] = [];
  const learned = new Map<string, number>();
  let recoveryAttempted = false;
  const root = () => resolveCalendarContainer(selector);
  const deadline = Date.now() + 8000;
  while (true) {
    try { root(); break; }
    catch (error) {
      if (Date.now() >= deadline) throw Object.assign(error as Error, { verification: { ok: false, summary: (error as Error).message, expected: selector, evidence: ['已等待日历弹层最多 8 秒', `当前文档：${location.href}`] } });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  evidence.push('日历容器已等待并确认可见');
  let binding: CalendarFields | undefined = findCalendarFields(root(), dates.length === 2);
  let lastContainer: HTMLElement | undefined = root();
  const click = async (element: HTMLElement) => {
    if (disabled(element)) throw new Error('目标日期或翻页按钮被禁用');
    const result = await executeEvent(element, { type: 'click' });
    if (!result.verification.ok) throw new Error(result.verification.summary);
    await new Promise((resolve) => setTimeout(resolve, 120));
  };
  const fail = (message: string, actual: unknown): never => {
    throw Object.assign(new Error(message), { verification: { ok: false, summary: message, expected: dates.map(item => item.iso), actual, evidence: [...evidence] } });
  };
  if (dates.length === 2 && !binding && hasUnboundCalendarFields()) fail('无法唯一关联当前日历的开始和结束输入框，不能核验实际区间，已停止', { fields: '无法唯一关联' });
  for (const [index, target] of dates.entries()) {
    let pickerFocusRepaired = false;
    if (binding?.kind === 'pair') {
      const field = binding.read()[index];
      const label = index === 0 ? '开始日期' : '结束日期';
      if (!field || !visible(field) || disabled(field)) fail(`无法切换到${label}输入框，已停止，未点击目标日期`, readCalendarFields(binding));
      const changed = document.activeElement !== field;
      const focus = focusElement(field);
      evidence.push(`${label}焦点事件：网页焦点=${focus.documentFocused}，原生 focusin=${focus.nativeFocusIn}，补齐事件=${focus.repaired.join(',') || '无需补齐'}`);
      if (!focus.ok) fail(`${label}输入框未获得焦点，已停止，未点击目标日期`, readCalendarFields(binding));
      if (changed) await click(field);
      if (!field.isConnected || document.activeElement !== field) fail(`${label}输入框未获得焦点，已停止，未点击目标日期`, readCalendarFields(binding));
      evidence.push(`已确认${label}输入框获得焦点（${field.id || field.placeholder || field.name || label}）`);
    }
    let confirmed = false;
    const disabledDeadline = Date.now() + 8000;
    for (let turn = 0; turn < 240; turn++) {
      const container = root();
      lastContainer = container;
      const views = calendarViews(container);
      const known = views.filter((item) => item.month !== undefined);
      const exact = Array.from(container.querySelectorAll<HTMLElement>('[title], [data-date], [aria-label]')).filter((cell) => visible(cell) && ['title', 'data-date', 'aria-label'].some((attr) => cell.getAttribute(attr)?.replace(/\//g, '-') === target.iso));
      const view = views.find((item) => item.month === target.year * 12 + target.month - 1);
      let cells = exact.filter((cell) => (!known.length || !!view?.scope.contains(cell)) && !/prev-month|next-month|outside|other-month/.test(cell.className) && !cell.parentElement?.closest(`[title="${target.iso}"], [data-date="${target.iso}"]`));
      if (!cells.length && view) cells = Array.from(view.scope.querySelectorAll<HTMLElement>('td, [role="gridcell"], button')).filter((cell) => visible(cell) && cell.textContent?.trim() === String(target.day) && !/prev-month|next-month|outside|other-month/.test(cell.className));
      if (cells.length && cells.every(disabled)) {
        // Aurora can cache disabledDate while the business page is still
        // initializing. Observe first; never click or remove disabled flags.
        if (container.matches('.aurora-picker-panel-layout') || container.querySelector('.aurora-picker-date-panel')) {
          if (!pickerFocusRepaired) {
            pickerFocusRepaired = true;
            const active = document.activeElement;
            const inputs = binding ? binding.read() : Array.from(document.querySelectorAll<HTMLInputElement>('.aurora-picker-input-active input')).filter(visible);
            const input = binding?.kind === 'pair' ? inputs[index] : active instanceof HTMLInputElement && active.closest('.aurora-picker') && visible(active) ? active : inputs.length === 1 ? inputs[0] : undefined;
            if (input) {
              // An already-focused input does not emit another native focusin.
              // Aurora's range active-index can remain stale after scripted
              // opening. Synchronize its handler, then re-read enabled state.
              input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
              evidence.push('已同步 Aurora 日期输入框 focusin，重新检查日期可选状态');
              await new Promise((resolve) => setTimeout(resolve, 150));
              continue;
            }
          }
          if (Date.now() < disabledDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }
          if (!recoveryAttempted) {
            recoveryAttempted = true;
            const trigger = document.activeElement;
            const original = known.map((item) => item.month!);
            if (trigger instanceof HTMLInputElement && trigger.closest('.aurora-picker') && visible(trigger)) {
              evidence.push('日期状态未就绪，尝试一次失焦并重新打开日历');
              trigger.blur();
              await new Promise((resolve) => setTimeout(resolve, 150));
              await click(trigger);
              await new Promise((resolve) => setTimeout(resolve, 150));
              const restored = calendarViews(root()).flatMap((item) => item.month === undefined ? [] : [item.month]);
              if (restored.length !== original.length || restored.some((month, index) => month !== original[index])) throw new Error('日历重新打开后年月不一致，已停止以避免误选');
              evidence.push('已确认重新打开后年月一致，重新检查日期状态');
              continue;
            }
            const monthArrows = Array.from(container.querySelectorAll<HTMLElement>('button')).filter(actionable);
            if (original.length && monthArrows.some((button) => navigationHint(button) === -1) && monthArrows.some((button) => navigationHint(button) === 1)) {
              evidence.push('尝试一次上个月再返回，刷新日历可选状态');
              await navigateCalendar(root, Math.min(...original) - 1, evidence, click, learned);
              await navigateCalendar(root, Math.max(...original), evidence, click, learned);
              const restored = calendarViews(root()).flatMap((item) => item.month === undefined ? [] : [item.month]);
              if (restored.length !== original.length || restored.some((month, index) => month !== original[index])) throw new Error('日历刷新后未恢复原年月，已停止以避免误选');
              evidence.push('已校验恢复原年月，重新检查日期禁用状态');
              continue;
            }
          }
        }
        const message = `日期 ${target.iso} 被页面禁用，不能选择；请检查数据范围、账号/维度等前置配置和页面允许的日期范围，不要更换 Selector 或强制点击`;
        throw Object.assign(new Error(message), { verification: { ok: false, summary: message, expected: target.iso, actual: 'disabled', evidence: [...evidence, ...cells.map((cell) => `日期格：${cell.getAttribute('title') ?? cell.textContent}；class=${cell.className}；aria-disabled=${cell.getAttribute('aria-disabled')}`)] } });
      }
      cells = cells.filter(actionable);
      if (cells.length) {
        // Two-panel ranges repeat spillover dates; prefer the in-month cell.
        const inMonth = cells.filter((cell) => /in-view|current-month/.test(cell.className));
        if (inMonth.length) cells = inMonth;
        if (cells.length !== 1) throw new Error(`日期 ${target.iso} 匹配多个日期格，无法安全选择`);
        const cell = cells[0];
        const fields = binding ? binding.read() : Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(visible);
        const before = new Map(fields.map((field) => [field, field.value]));
        await click(cell);
        const values = fields.filter((field) => field.value !== before.get(field)).map((field) => field.value);
        if (!binding && dates.length === 2 && values.some(value => normalizeCalendarField(value))) fail('区间日历改变了未关联的输入框，不能核验实际起止值，已停止', { changedDates: values.filter(value => normalizeCalendarField(value)) });
        // Single-date popups can disappear on click. Adopt only a unique field
        // changed by this click; range fields require an established owner.
        if (!binding && dates.length === 1) {
          const changed = fields.filter(field => field.value !== before.get(field) && normalizeCalendarField(field.value) === target.iso);
          if (changed.length === 1) {
            const field = changed[0];
            binding = { kind: 'single', read: () => field.isConnected ? [field] : [] };
          }
        }
        confirmed = binding?.kind === 'pair' ? selected(cell) || normalizeCalendarField(binding.read()[index]?.value ?? '') === target.iso
          : selected(cell) || values.some((value) => normalizeCalendarField(value) === target.iso || binding?.kind === 'combined' && readCalendarFields(binding).dates.includes(target.iso));
        evidence.push(`点击日期 ${target.iso}`, ...values.map((value) => `输入框更新：${value}`));
        if (!confirmed && !binding) {
          const replacement = Array.from(container.querySelectorAll<HTMLElement>('[title], [data-date]')).find((item) => visible(item) && (item.title === target.iso || item.dataset.date === target.iso) && selected(item));
          confirmed = !!replacement;
        }
        if (!confirmed) fail(`已点击 ${target.iso}，但未检测到对应日期字段更新或选中标记，不能确认选择成功`, binding ? readCalendarFields(binding) : readInlineCalendar(container));
        break;
      }
      if (!known.length) throw new Error('无法识别日历年月标题；支持中文年月、数字年月和英文月份，请提供此日历截图用于适配');
      const wanted = target.year * 12 + target.month - 1;
      const nearest = known.sort((a, b) => Math.abs(a.month! - wanted) - Math.abs(b.month! - wanted))[0];
      if (nearest.month === wanted) throw new Error(`当前月份中找不到可选日期 ${target.iso}，日期可能被限制`);
      try { await navigateCalendar(root, wanted, evidence, click, learned); }
      catch (error) {
        throw Object.assign(error as Error, { verification: { ok: false, summary: (error as Error).message, expected: target.iso, evidence: [...evidence] } });
      }
    }
    if (!confirmed) throw new Error('日历翻页超过 240 次，已停止');
  }
  // Verify the CURRENT range together after asynchronous handlers settle. A
  // click receipt or old selected cell is not proof that the start survived.
  const expected = dates.map(item => item.iso);
  const readActual = () => {
    if (binding) return readCalendarFields(binding);
    try { return readInlineCalendar(root()); } catch { return readInlineCalendar(lastContainer); }
  };
  const verifyDeadline = Date.now() + 2000;
  let matchedSince: number | undefined;
  let actual = readActual();
  while (true) {
    actual = readActual();
    const matches = actual.dates.length === expected.length && actual.dates.every((value, index) => value === expected[index]);
    if (matches) matchedSince ??= Date.now(); else matchedSince = undefined;
    if (matchedSince !== undefined && Date.now() - matchedSince >= 300) break;
    if (Date.now() >= verifyDeadline) fail(`日历最终日期校验失败：预期 ${expected.join(' 至 ')}，实际 ${actual.dates.map(value => value || '空').join(' 至 ') || '无法读取'}；不会将点击成功当作选择成功`, actual);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  evidence.push(`最终实际日期核验：${actual.dates.join(' 至 ')}`, ...Object.entries(actual.fields).map(([name, value]) => `实际输入框 ${name}：${value || '空'}`));
  return { output: actual.dates, verification: { ok: true, summary: `日历日期已验证：${actual.dates.join(' 至 ')}`, expected, actual: actual.dates, evidence } };
}
