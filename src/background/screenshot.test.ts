import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureIntersection, capturePage, capturePositions } from './screenshot';

let pageWidth: number; let pageHeight: number; let switched: boolean;
const controls: Array<Record<string, unknown>> = [];
class CanvasMock {
  constructor(public width: number, public height: number) {}
  getContext() { return { drawImage: vi.fn() }; }
  async convertToBlob() { return new Blob([JSON.stringify({ width: this.width, height: this.height })], { type: 'image/png' }); }
}
beforeEach(() => {
  vi.useFakeTimers(); controls.length = 0; pageWidth = 800; pageHeight = 1500; switched = false;
  vi.stubGlobal('OffscreenCanvas', CanvasMock);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => new Blob(['png']) }));
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1600, height: 1200, close: vi.fn() }));
  vi.stubGlobal('chrome', {
    tabs: {
      query: vi.fn(async () => [{ id: switched ? 2 : 1, windowId: 7, url: 'https://example.com' }]),
      get: vi.fn(async () => ({ id: 1, windowId: 7, url: 'https://example.com' })),
      captureVisibleTab: vi.fn().mockResolvedValue('data:image/png;base64,cG5n'),
      sendMessage: vi.fn(async (_id, msg, target) => {
        if (msg.type === 'PAGE_AGENT_PING') return { ok: true, frameLocator: true };
        expect(target).toEqual({ frameId: 0, documentId: 'document1' }); controls.push(msg);
        if (msg.operation === 'end') return { ok: true, restored: true };
        return { ok: true, url: 'https://example.com', title: '测试页', viewportWidth: 800, viewportHeight: 600, pageWidth, pageHeight,
          x: msg.operation === 'begin' ? 50 : Math.min(msg.x, pageWidth - 800),
          y: msg.operation === 'begin' ? 100 : Math.min(msg.y, pageHeight - 600),
          ...(msg.selector ? { region: { x: 100, y: 200, width: 300, height: 400 } } : {}),
        };
      }),
    },
    webNavigation: { getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0, documentId: 'document1' }]) },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function finish(params: Record<string, unknown>) {
  const pending = capturePage(params).then((result) => ({ result }), (error: Error) => ({ error }));
  await vi.runAllTimersAsync(); const settled = await pending;
  if ('error' in settled) throw settled.error;
  return settled.result;
}
describe('screenshot capture and stitching', () => {
  it('captures the viewport without scroll and respects scale', async () => {
    const result = await finish({ mode: 'viewport', scale: 0.5 });
    expect(result.images).toMatchObject([{ width: 400, height: 300 }]);
    expect(controls.filter((msg) => msg.operation !== 'info').map((msg) => msg.operation)).toEqual(['begin', 'end']);
    expect(result.metadata).toMatchObject({ complete: true, scrollRestored: true });
  });
  it('captures full pages, handles bottom clamping and restores original position', async () => {
    const result = await finish({ mode: 'fullPage' });
    expect(result.images).toMatchObject([{ width: 800, height: 1500, offsetY: 0 }]);
    expect(result.metadata).toMatchObject({ complete: true, tileCount: 3, scrollRestored: true });
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
    expect(controls.filter((m) => m.operation === 'scroll').map((m) => m.y)).toEqual([0, 600, 1200]);
    expect(controls[controls.length - 1].operation).toBe('end');
  });
  it('captures document-coordinate regions spanning several windows', async () => {
    pageHeight = 1800;
    const result = await finish({ mode: 'region', region: { x: 100, y: 700, width: 200, height: 900 } });
    expect(result.images).toMatchObject([{ width: 200, height: 900 }]);
    expect(result.metadata).toMatchObject({ tileCount: 2, complete: true });
  });
  it('supports a unique CSS selector region', async () => {
    const result = await finish({ mode: 'region', selector: '#calendar' });
    expect(controls[0].selector).toBe('#calendar');
    expect(result.images).toMatchObject([{ width: 300, height: 400 }]);
  });
  it('splits long pages into height bands, including horizontal scrolling', async () => {
    pageWidth = 1700; pageHeight = 9000;
    const result = await finish({ mode: 'fullPage', maxTiles: 100 });
    expect(result.images).toMatchObject([{ width: 1700, height: 8192, offsetY: 0 }, { width: 1700, height: 808, offsetY: 8192 }]);
    expect(result.metadata).toMatchObject({ complete: true, tileCount: 45 });
  });
  it('returns explicit partial output when maxTiles is exceeded', async () => {
    const result = await finish({ mode: 'fullPage', maxTiles: 1 });
    expect(result.metadata).toMatchObject({ complete: false, tileCount: 1 });
    expect(result.images[0].height).toBe(600);
  });
  it('stops rather than capturing a switched tab, and still restores the capture session', async () => {
    vi.mocked(chrome.tabs.captureVisibleTab).mockImplementationOnce(async () => { switched = true; return 'data:image/png;base64,cG5n'; });
    await expect(finish({ mode: 'fullPage' })).rejects.toThrow('标签页');
    expect(controls[controls.length - 1].operation).toBe('end');
  });
  it('restores after invalid coordinates or capture permission errors', async () => {
    await expect(finish({ mode: 'region', region: { x: -1, y: 0, width: 10, height: 10 } })).rejects.toThrow('截图区域');
    expect(controls[controls.length - 1].operation).toBe('end');
    vi.mocked(chrome.tabs.captureVisibleTab).mockRejectedValueOnce(new Error('截图权限不足'));
    await expect(finish({ mode: 'viewport' })).rejects.toThrow('权限');
    expect(controls[controls.length - 1].operation).toBe('end');
  });
});
describe('screenshot geometry', () => {
  it('calculates positions and clipped intersections', () => {
    expect(capturePositions(100, 900, 600)).toEqual([100, 700]);
    expect(captureIntersection({ x: 100, y: 700, width: 200, height: 900 }, { x: 0, y: 1200, width: 800, height: 600 })).toEqual({ x: 100, y: 1200, width: 200, height: 400 });
    expect(capturePositions(0, 100000000, 1)).toHaveLength(101);
    expect(() => capturePositions(0, 1, 0)).toThrow();
  });
});
