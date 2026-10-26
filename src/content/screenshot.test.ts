// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreScreenshot, screenshotControl } from './screenshot';

beforeEach(() => {
  vi.useFakeTimers(); document.body.innerHTML = '<header style="position:fixed;visibility:visible!important">标题</header><div id="content">正文</div>';
  vi.stubGlobal('scrollX', 20); vi.stubGlobal('scrollY', 80);
  vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
    vi.stubGlobal('scrollX', (options as ScrollToOptions).left ?? 0); vi.stubGlobal('scrollY', (options as ScrollToOptions).top ?? 0);
  });
});
afterEach(() => { restoreScreenshot(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('screenshot page session', () => {
  it('disables smooth scrolling, hides repeated overlays, and restores exact inline styles and position', async () => {
    document.documentElement.style.setProperty('scroll-behavior', 'smooth');
    await screenshotControl({ operation: 'begin', token: 'a' });
    expect(document.documentElement.style.scrollBehavior).toBe('auto');
    const scroll = screenshotControl({ operation: 'scroll', token: 'a', x: 0, y: 600, hideFixed: true });
    await vi.advanceTimersByTimeAsync(200); await scroll;
    expect(document.querySelector<HTMLElement>('header')!.style.visibility).toBe('hidden');
    expect(restoreScreenshot('a')).toMatchObject({ restored: true, x: 20, y: 80 });
    expect(document.documentElement.style.scrollBehavior).toBe('smooth');
    expect(document.querySelector<HTMLElement>('header')!.style.getPropertyPriority('visibility')).toBe('important');
    expect(document.querySelector<HTMLElement>('header')!.style.visibility).toBe('visible');
  });
  it('rejects ambiguous selectors without starting a capture session', async () => {
    await expect(screenshotControl({ operation: 'begin', token: 'a', selector: 'div,header' })).rejects.toThrow('必须唯一');
    expect(restoreScreenshot('a')).toMatchObject({ restored: false });
  });
  it('does not allow another token to restore or scroll an active capture', async () => {
    await screenshotControl({ operation: 'begin', token: 'a' });
    expect(restoreScreenshot('b')).toMatchObject({ restored: false });
    await expect(screenshotControl({ operation: 'scroll', token: 'b' })).rejects.toThrow('不存在');
    expect(restoreScreenshot('a')).toMatchObject({ restored: true });
  });
  it('automatically restores abandoned sessions', async () => {
    await screenshotControl({ operation: 'begin', token: 'a' });
    await vi.advanceTimersByTimeAsync(120000);
    expect(restoreScreenshot('a')).toMatchObject({ restored: false });
    expect(scrollY).toBe(80);
  });
});
