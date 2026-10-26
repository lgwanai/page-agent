import type { PaginationState } from '@/types/workflow';
import { executeEvent } from './executor';

type Control = { element: HTMLElement; key: string; direction?: number; disabled: boolean };
function visible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}
function disabled(element: HTMLElement): boolean {
  return !!element.closest('[disabled],[aria-disabled="true"],[class*="disabled"]');
}
function identity(element: HTMLElement): string {
  return [element.id, element.className, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('rel'), element.textContent,
    ...Array.from(element.querySelectorAll('svg,use,i,span,img,title')).map((icon) => [icon.getAttribute('class'), icon.getAttribute('aria-label'), icon.getAttribute('alt'), icon.getAttribute('src'), icon.getAttribute('href'), icon.getAttribute('xlink:href'), icon.textContent].join(' ')),
  ].join(' ').toLowerCase();
}
export function resolvePagination(selector: string): HTMLElement {
  const matches = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => visible(el) || Array.from(el.querySelectorAll<HTMLElement>('button,a,[role="button"],li')).some(visible));
  if (matches.length !== 1) throw new Error(`分页容器需要唯一且可见，当前匹配 ${matches.length} 个；请重新选择分页控件容器`);
  return matches[0];
}
function controls(container: HTMLElement): Control[] {
  const raw = Array.from(container.querySelectorAll<HTMLElement>('button,a,[role="button"],li,[class*="prev"],[class*="next"]')).filter((el) => visible(el) && !el.closest('[class*="size-changer"],[class*="jumper"],[class*="options"]'));
  // Prefer clickable leaf controls over their wrapping li; never include quick-jump ellipses.
  const result = raw.filter((el) => !raw.some((child) => child !== el && el.contains(child))).map((element, index) => {
    const hint = identity(element);
    const direction = /jump|ellipsis|more|first|last|首页|末页|尾页|首[页]/.test(hint) ? undefined
      : /prev|previous|\bleft\b|chevron[_-]left|arrow[_-]left|angle[_-]left|left[_-]arrow|上一页|上页|向左|‹|←|«/.test(hint) ? -1
      : /next|\bright\b|chevron[_-]right|arrow[_-]right|angle[_-]right|right[_-]arrow|下一页|下页|向右|›|→|»/.test(hint) ? 1 : undefined;
    return { element, key: `${element.tagName}:${hint.replace(/\b\d+\b/g, '#')}:${index}`, direction, disabled: disabled(element) };
  });
  // A lone icon on either side of the numeric page list is a useful tentative
  // direction hint, not proof: navigation still checks the observed page change.
  const icons = result.filter((c) => positive(c.element.textContent) === undefined && !/jump|ellipsis|more|first|last|首页|末页|尾页|首[页]/.test(identity(c.element)));
  if (icons.length === 2 && icons.every((c) => c.direction === undefined) && icons.every((c) => c.element.querySelector('svg,img,i') || !(c.element.textContent ?? '').trim())) {
    icons[0].direction = -1; icons[1].direction = 1;
  }
  return result;
}
function positive(value: string | null): number | undefined {
  if (value && /^\s*\d+\s*$/.test(value)) { const n = Number(value); if (Number.isSafeInteger(n) && n > 0) return n; }
  return undefined;
}
export function readPagination(selector: string): PaginationState {
  const container = resolvePagination(selector);
  const declared = positive(container.getAttribute('data-current-page')) ?? positive(container.getAttribute('data-page'));
  const active = Array.from(container.querySelectorAll<HTMLElement>('[aria-current="page"],[aria-current="true"],[data-current="true"],[class*="active"],[class*="current"],[class*="selected"]')).filter(visible);
  const pages = [...new Set(active.flatMap((el) => {
    const n = positive(el.getAttribute('data-page')) ?? positive(el.textContent) ?? (/第?\s*(\d+)\s*页/.exec(el.getAttribute('aria-label') ?? '') ? Number(/(\d+)/.exec(el.getAttribute('aria-label')!)![1]) : undefined);
    return n ? [n] : [];
  }))];
  const status = /(?:第\s*)?(\d+)\s*(?:\/|of)\s*(\d+)\s*(?:页|pages)?/i.exec(container.textContent ?? '');
  const page = declared ?? (pages.length === 1 ? pages[0] : pages.length === 0 && status ? Number(status[1]) : undefined);
  if (!page || !Number.isSafeInteger(page) || page < 1) throw new Error(`无法唯一识别分页当前页（发现 ${pages.length} 个选中页码）；请选中完整分页容器`);
  const totalText = /(?:共|总计|total)\s*(\d+)\s*(?:页|pages)/i.exec(container.textContent ?? '');
  const totalPages = positive(container.getAttribute('data-total-pages')) ?? (totalText ? Number(totalText[1]) : status ? Number(status[2]) : undefined);
  if (totalPages !== undefined && (!Number.isSafeInteger(totalPages) || totalPages < page)) throw new Error('分页总页数与当前页不相符');
  const next = controls(container).filter((control) => control.direction === 1);
  const hasNext = totalPages !== undefined ? page < totalPages : next.length ? next.some((control) => !control.disabled) : null;
  return { page, ...(totalPages !== undefined ? { totalPages } : {}), hasNext };
}

function numericControl(selector: string, page: number): HTMLElement | undefined {
  const found = controls(resolvePagination(selector)).filter((control) => !control.disabled && positive(control.element.textContent) === page);
  if (found.length > 1) throw new Error(`分页页码 ${page} 有多个可点击目标，停止以避免误操作`);
  return found[0]?.element;
}

/** Navigate with an observed page-number postcondition; icon hints never count as proof. */
export async function navigatePagination(selector: string, desired: number, options: { timeoutMs?: number; settleMs?: number; maxSteps?: number } = {}) {
  if (!Number.isSafeInteger(desired) || desired < 1) throw new Error('分页目标页必须是大于 0 的整数');
  const timeout = Math.min(30_000, Math.max(100, options.timeoutMs ?? 5000));
  const settle = Math.min(10_000, Math.max(0, options.settleMs ?? 300));
  const maxSteps = Math.min(1000, Math.max(1, options.maxSteps ?? 100));
  const evidence: string[] = [];
  const learned = new Map<string, number>();
  let distrustHints = false;
  const click = async (element: HTMLElement, before: number): Promise<PaginationState> => {
    // A semantic page change is stronger evidence than the generic click verification.
    await executeEvent(element, { type: 'click' });
    const deadline = Date.now() + timeout;
    while (Date.now() <= deadline) {
      let state: PaginationState | undefined;
      try { state = readPagination(selector); } catch { /* React may replace the control during render. */ }
      if (state && state.page !== before) {
        const observed = state.page;
        if (settle) await new Promise((resolve) => setTimeout(resolve, settle));
        const stable = readPagination(selector);
        if (stable.page !== observed) throw new Error('分页页码在等待后再次变化，结果不稳定；请检查页面，不要盲目重试');
        return stable;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`分页点击后 ${timeout}ms 内当前页仍为 ${before}，没有验证到翻页成功；操作可能已经发送，请检查页面`);
  };
  let operations = 0;
  const perform = async (control: Control | HTMLElement, before: number) => {
    if (++operations > maxSteps) throw new Error(`分页导航超过 ${maxSteps} 次操作上限，当前目标 ${desired} 未完成`);
    return click('element' in control ? control.element : control, before);
  };
  let state = readPagination(selector);
  try {
  while (state.page !== desired) {
    if (state.totalPages !== undefined && desired > state.totalPages) throw new Error(`分页目标 ${desired} 超过总页数 ${state.totalPages}`);
    const direct = numericControl(selector, desired);
    if (direct) {
      const before = state.page;
      state = await perform(direct, before);
      evidence.push(`点击页码 ${desired}：${before} → ${state.page}`);
      if (state.page !== desired) throw new Error(`分页数字按钮的实际结果 ${state.page} 与目标 ${desired} 不符`);
      break;
    }
    const origin = state.page;
    const direction = Math.sign(desired - origin);
    const candidates = controls(resolvePagination(selector)).filter((control) => !control.disabled && positive(control.element.textContent) === undefined && !/jump|ellipsis|more|first|last|首页|末页|尾页|首[页]/.test(identity(control.element)))
      .sort((a, b) => Number((learned.get(b.key) ?? b.direction) === direction) - Number((learned.get(a.key) ?? a.direction) === direction));
    let advanced = false;
    // Unknown icons may be probed, but must recover an adverse direction before another try.
    for (const candidate of candidates.slice(0, 8)) {
      if ((learned.get(candidate.key) ?? (distrustHints ? undefined : candidate.direction)) === -direction) continue;
      state = await perform(candidate, origin);
      const delta = state.page - origin;
      learned.set(candidate.key, Math.sign(delta));
      evidence.push(`翻页尝试：${origin} → ${state.page}（${identity(candidate.element).trim().slice(0, 80)}）`);
      if (Math.abs(desired - state.page) < Math.abs(desired - origin)) { advanced = true; break; }
      distrustHints = true;
      const originButton = numericControl(selector, origin);
      if (originButton) state = await perform(originButton, state.page);
      else {
        const reverse = controls(resolvePagination(selector)).filter((control) => !control.disabled && control.key !== candidate.key && positive(control.element.textContent) === undefined && !/jump|ellipsis|more|first|last|首页|末页|尾页|首[页]/.test(identity(control.element)))
          .sort((a, b) => Number(learned.get(b.key) === -Math.sign(delta)) - Number(learned.get(a.key) === -Math.sign(delta)));
        for (const back of reverse.slice(0, 4)) {
          const before = state.page;
          state = await perform(back, before);
          learned.set(back.key, Math.sign(state.page - before));
          if (state.page === origin) break;
          if (Math.abs(state.page - origin) >= Math.abs(before - origin)) throw new Error(`分页恢复按钮方向错误，实际停在 ${state.page} 页；停止避免进一步偏离`);
        }
      }
      evidence.push(`恢复：当前 ${state.page}，预期 ${origin}`);
      if (state.page !== origin) throw new Error(`分页恢复失败：预期 ${origin}，实际 ${state.page}；停止后续动作`);
      // DOM may be re-created after restoration; re-resolve the remaining candidates.
      break;
    }
    if (!advanced && !distrustHints) throw new Error(`无法识别可到达目标 ${desired} 的分页按钮，当前页 ${state.page}`);
    if (!advanced && !candidates.some((c) => learned.get(c.key) !== -direction && (distrustHints || c.direction !== -direction))) throw new Error(`无法识别可到达目标 ${desired} 的分页按钮，当前页 ${state.page}`);
  }
  return { output: state, verification: { ok: true, summary: `分页已到达第 ${state.page} 页`, expected: desired, actual: state.page, evidence } };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    let actual = state.page;
    try { actual = readPagination(selector).page; } catch { /* preserve the last observed page */ }
    throw Object.assign(failure, { verification: { ok: false, summary: failure.message, expected: desired, actual, evidence } });
  }
}
