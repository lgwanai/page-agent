// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigatePagination, readPagination } from './pagination';
import { executeEvent } from './executor';
vi.mock('./executor', () => ({ executeEvent: vi.fn() }));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  vi.mocked(executeEvent).mockImplementation(async (element) => { element.click(); return { verification: { ok: true, summary: 'clicked' } }; });
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.clearAllMocks(); });
function setup(page = 5, total = 10, wrong = false, numbers = false) {
  document.body.innerHTML = `<div id="pages" data-current-page="${page}" data-total-pages="${total}"><button id="left"><img src="arrow-left.svg"></button><span>…</span><button id="right"><svg class="arrow-right"></svg></button>${numbers ? '<button id="three">3</button>' : ''}</div>`;
  const root = document.querySelector<HTMLElement>('#pages')!;
  const change = (delta: number) => { page = Math.max(1, Math.min(total, page + delta)); root.dataset.currentPage = String(page); };
  document.querySelector('#left')!.addEventListener('click', () => change(wrong ? 1 : -1));
  document.querySelector('#right')!.addEventListener('click', () => change(wrong ? -1 : 1));
  document.querySelector('#three')?.addEventListener('click', () => { page = 3; root.dataset.currentPage = '3'; });
  return root;
}
const options = { settleMs: 0, timeoutMs: 100, maxSteps: 30 };
describe('pagination semantic navigation', () => {
  it('uses visible numeric targets and verifies the actual selected page', async () => {
    setup(5, 10, false, true);
    expect((await navigatePagination('#pages', 3, options)).output.page).toBe(3);
    expect(vi.mocked(executeEvent).mock.calls.map(([el]) => el.id)).toEqual(['three']);
  });
  it('recognizes nested image and svg arrows across omitted page numbers', async () => {
    setup();
    expect((await navigatePagination('#pages', 2, options)).output.page).toBe(2);
    expect(vi.mocked(executeEvent).mock.calls.map(([el]) => el.id)).toEqual(['left','left','left']);
    expect((await navigatePagination('#pages', 8, options)).output.page).toBe(8);
  });
  it('recovers mislabeled arrows and learns their observed direction', async () => {
    setup(5, 10, true);
    const result = await navigatePagination('#pages', 3, options);
    expect(result.output.page).toBe(3);
    expect(result.verification.evidence.some((item) => item.startsWith('恢复'))).toBe(true);
    expect(vi.mocked(executeEvent).mock.calls.map(([el]) => el.id)).toEqual(['left','right','right','right']);
  });
  it('rejects invalid and out-of-range pages without clicking', async () => {
    setup();
    await expect(navigatePagination('#pages', 11, options)).rejects.toThrow('超过总页数');
    await expect(navigatePagination('#pages', 1.5, options)).rejects.toThrow('整数');
    expect(executeEvent).not.toHaveBeenCalled();
  });
  it('reports a dispatched click with no observed change as a failure', async () => {
    setup(); vi.mocked(executeEvent).mockResolvedValue({ verification: { ok: true, summary: 'event sent' } });
    await expect(navigatePagination('#pages', 4, options)).rejects.toThrow('没有验证到翻页成功');
  });
  it('enforces operation limits rather than silently returning partial success', async () => {
    setup(); await expect(navigatePagination('#pages', 1, { ...options, maxSteps: 2 })).rejects.toThrow('操作上限');
  });
  it('detects terminal pages through disabled next controls without a total count', () => {
    document.body.innerHTML = '<div id="pages"><button class="active">9</button><button class="next" disabled><img src="right.svg"></button></div>';
    expect(readPagination('#pages')).toEqual({ page: 9, hasNext: false });
  });
  it('does not claim completion when next-page availability is unknown', () => {
    document.body.innerHTML = '<div id="pages"><button aria-current="page">9</button></div>';
    expect(readPagination('#pages').hasNext).toBeNull();
  });
  it('rejects ambiguous containers and active page indicators', () => {
    document.body.innerHTML = '<div class="pages"><button class="active">1</button><button class="active">2</button></div>';
    expect(() => readPagination('.pages')).toThrow('无法唯一识别');
    document.body.innerHTML += '<div class="pages"></div>';
    expect(() => readPagination('.pages')).toThrow('匹配 2 个');
  });
  it('never operates hidden pagination containers', () => {
    setup().style.display = 'none'; expect(() => readPagination('#pages')).toThrow('匹配 0 个');
  });
  it('infers unlabeled image arrows by order and confirms their actual movement', async () => {
    setup();
    document.querySelector('img')!.removeAttribute('src'); document.querySelector('svg')!.removeAttribute('class');
    expect((await navigatePagination('#pages', 7, options)).output.page).toBe(7);
  });
});
