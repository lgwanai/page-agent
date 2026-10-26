import { activeTabId } from './runner';
import { readyFrame } from './frame-messaging';
import { diagnosticError } from '@/shared/diagnostics';

export interface CaptureRegion { x: number; y: number; width: number; height: number }
interface Geometry { viewportWidth: number; viewportHeight: number; pageWidth: number; pageHeight: number; x: number; y: number; region?: CaptureRegion; url: string; title: string }
interface ImageBand { data: string; mimeType: 'image/png'; width: number; height: number; offsetY: number }

export function capturePositions(start: number, length: number, viewport: number): number[] {
  if (![start, length, viewport].every(Number.isFinite) || viewport <= 0 || length <= 0) throw new Error('截图页面尺寸无效');
  const result: number[] = [];
  for (let offset = 0; offset < length && result.length < 101; offset += viewport) result.push(start + offset);
  return result;
}

export function captureIntersection(region: CaptureRegion, viewport: CaptureRegion): CaptureRegion | undefined {
  const x = Math.max(region.x, viewport.x); const y = Math.max(region.y, viewport.y);
  const width = Math.min(region.x + region.width, viewport.x + viewport.width) - x;
  const height = Math.min(region.y + region.height, viewport.y + viewport.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function validateRegion(region: CaptureRegion, page: Geometry): CaptureRegion {
  if (!region || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0) throw new Error('截图区域需要非负 x/y 和大于 0 的 width/height（CSS 像素）');
  const clipped = captureIntersection(region, { x: 0, y: 0, width: page.pageWidth, height: page.pageHeight });
  if (!clipped) throw new Error('截图区域超出页面范围');
  return clipped;
}

/** Capture only the pinned active tab; never activate a different tab or use CDP. */
export async function capturePage(params: Record<string, unknown>) {
  const mode = String(params.mode ?? 'viewport');
  if (!['viewport', 'region', 'fullPage'].includes(mode)) throw new Error('截图模式无效');
  const tabId = await activeTabId(); const tab = await chrome.tabs.get(tabId);
  const frame = (await chrome.webNavigation.getAllFrames({ tabId }))?.find((f) => f.frameId === 0);
  if (!frame || !await readyFrame(tabId, 0)) throw new Error('页面脚本不可用，无法截图');
  const target = { frameId: 0, ...(frame.documentId ? { documentId: frame.documentId } : {}) };
  const token = crypto.randomUUID();
  let pageChanged = false;
  const onActivated = (info: chrome.tabs.TabActiveInfo) => { if (info.windowId === tab.windowId && info.tabId !== tabId) pageChanged = true; };
  const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => { if (id === tabId && (info.status === 'loading' || (info.url !== undefined && info.url !== tab.url))) pageChanged = true; };
  let viewport: { width: number; height: number } | undefined;
  const control = async (operation: 'begin' | 'scroll' | 'end' | 'info', extra: Record<string, unknown> = {}) => {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_SCREENSHOT_CONTROL', operation, token, ...extra }, target);
    if (!response?.ok) throw new Error(response?.error ?? '截图页面控制失败');
    return response as Geometry & { restored?: boolean };
  };
  const checkTab = async () => {
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const current = await chrome.tabs.get(tabId);
    const currentFrame = (await chrome.webNavigation.getAllFrames({ tabId }))?.find((f) => f.frameId === 0);
    if (pageChanged || active?.id !== tabId || current.url !== tab.url || (frame.documentId && currentFrame?.documentId !== frame.documentId)) throw new Error('截图期间活动标签页或网址发生变化，已停止以避免截取其他页面');
    if (viewport) {
      const metrics = await control('info');
      if (metrics.viewportWidth !== viewport.width || metrics.viewportHeight !== viewport.height) throw new Error('截图期间可视窗口尺寸改变，请保持窗口大小不变后重试');
    }
  };
  let lastCapture = 0; let began = false; let restored = false;
  let metadata: Record<string, unknown> | undefined;
  const startedAt = Date.now();
  const warnings: string[] = []; const images: ImageBand[] = [];
  chrome.tabs.onActivated?.addListener(onActivated);
  chrome.tabs.onUpdated?.addListener(onUpdated);
  try {
    const page = await control('begin', { ...(mode === 'region' && params.selector ? { selector: String(params.selector) } : {}) }); began = true;
    if (!(page.viewportWidth > 0 && page.viewportHeight > 0)) throw new Error('页面可视窗口尺寸无效');
    viewport = { width: page.viewportWidth, height: page.viewportHeight };
    const originalRegion = mode === 'viewport' ? { x: page.x, y: page.y, width: page.viewportWidth, height: page.viewportHeight }
      : mode === 'fullPage' ? { x: 0, y: 0, width: page.pageWidth, height: page.pageHeight }
      : validateRegion(page.region ?? params.region as CaptureRegion, page);
    const capture = async () => {
      await checkTab();
      // Chrome captureVisibleTab is limited to two calls per second.
      const delay = 550 - (Date.now() - lastCapture);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      await checkTab(); lastCapture = Date.now();
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      await checkTab();
      if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('截图返回的图片格式无效');
      const binary = atob(dataUrl.slice('data:image/png;base64,'.length));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (Math.abs(bitmap.width / page.viewportWidth - bitmap.height / page.viewportHeight) > 0.02) { bitmap.close(); throw new Error('截图期间可视窗口尺寸改变，请保持窗口大小不变后重试'); }
      return bitmap;
    };
    if (mode === 'viewport') {
      const bitmap = await capture();
      try {
        const scale = Math.min(Number(params.scale) || 1, bitmap.width / page.viewportWidth, bitmap.height / page.viewportHeight, 8192 / page.viewportWidth);
        const canvas = new OffscreenCanvas(Math.ceil(page.viewportWidth * scale), Math.ceil(page.viewportHeight * scale)); canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        images.push(await encodeBand(canvas, 0));
      } finally { bitmap.close(); }
      metadata = { mode, tabId, url: page.url, title: page.title, region: originalRegion, complete: true, tileCount: 1, warnings };
      return { images, metadata };
    }
    const maxTiles = Math.min(100, Math.max(1, Number(params.maxTiles) || 40));
    const xs = capturePositions(originalRegion.x, originalRegion.width, page.viewportWidth);
    const ys = capturePositions(originalRegion.y, originalRegion.height, page.viewportHeight);
    let tileCount = 0; let pixelScale = 0; let nextY = 0; let filledBottom = 0;
    const bands = new Map<number, OffscreenCanvas>();
    // Band images avoid browser canvas height/memory limits on very long pages.
    const scaledWidth = (scale: number) => Math.ceil(originalRegion.width * scale);
    let bytes = 0; let complete = true;
    outer: for (const y of ys) {
      for (const x of xs) {
        if (tileCount >= maxTiles) { complete = false; warnings.push(`达到 maxTiles=${maxTiles}，返回已截取区域；可提高上限或使用分段 region。`); break outer; }
        if (Date.now() - startedAt > 90000) { complete = false; warnings.push('达到 90 秒截图时间上限，返回已截取区域，请分段截图。'); break outer; }
        const position = await control('scroll', { x, y, hideFixed: tileCount > 0 && params.hideFixed !== false, settleMs: params.settleMs });
        if (position.viewportWidth !== page.viewportWidth || position.viewportHeight !== page.viewportHeight) throw new Error('截图期间可视窗口尺寸改变，请保持窗口大小不变后重试');
        if (position.pageHeight !== page.pageHeight || position.pageWidth !== page.pageWidth) { complete = false; warnings.push('滚动时页面尺寸变化，仅截取开始时的范围；动态/无限滚动页面建议分段区域截图。'); }
        const bitmap = await capture();
        try {
          tileCount++;
          if (!pixelScale) pixelScale = Math.min(bitmap.width / page.viewportWidth, bitmap.height / page.viewportHeight, 8192 / originalRegion.width, Number(params.scale) || 1);
          const width = scaledWidth(pixelScale);
          const maxBandHeight = Math.max(1, Math.min(8192, Math.floor(16000000 / width)));
          const intersection = captureIntersection(originalRegion, { x: position.x, y: position.y, width: page.viewportWidth, height: page.viewportHeight });
          if (!intersection) throw new Error('页面未滚动到截图区域，无法完成拼接');
          const expectedRight = Math.min(x + page.viewportWidth, originalRegion.x + originalRegion.width);
          const expectedBottom = Math.min(y + page.viewportHeight, originalRegion.y + originalRegion.height);
          if (intersection.x > x + 1 || intersection.y > y + 1 || intersection.x + intersection.width < expectedRight - 1 || intersection.y + intersection.height < expectedBottom - 1) throw new Error('页面滚动受到限制，截图区域不能完整覆盖，请选择更小区域或检查滚动容器');
          // Slice each captured viewport across output bands, accounting for clamped final scroll.
          const top = Math.max(nextY, Math.round((intersection.y - originalRegion.y) * pixelScale));
          const bottom = Math.min(Math.ceil(originalRegion.height * pixelScale), Math.round((intersection.y + intersection.height - originalRegion.y) * pixelScale));
          filledBottom = Math.max(filledBottom, bottom);
          let destinationY = top;
          while (destinationY < bottom) {
            const bandTop = Math.floor(destinationY / maxBandHeight) * maxBandHeight;
            const bandHeight = Math.min(maxBandHeight, Math.ceil(originalRegion.height * pixelScale) - bandTop);
            let band = bands.get(bandTop);
            if (!band) { band = new OffscreenCanvas(width, bandHeight); bands.set(bandTop, band); }
            const end = Math.min(bottom, bandTop + bandHeight);
            const nativeX = bitmap.width / page.viewportWidth; const nativeY = bitmap.height / page.viewportHeight;
            const cssTop = originalRegion.y + destinationY / pixelScale;
            band.getContext('2d')!.drawImage(bitmap, (intersection.x - position.x) * nativeX, (cssTop - position.y) * nativeY,
              intersection.width * nativeX, (end - destinationY) / pixelScale * nativeY,
              Math.round((intersection.x - originalRegion.x) * pixelScale), destinationY - bandTop, Math.ceil(intersection.width * pixelScale), end - destinationY);
            destinationY = end;
          }
        } finally { bitmap.close(); }
      }
      nextY = Math.min(Math.ceil(originalRegion.height * pixelScale), Math.round((y - originalRegion.y + page.viewportHeight) * pixelScale));
      for (const [offset, canvas] of bands) if (offset + canvas.height <= nextY) {
        const image = await encodeBand(canvas, offset); bytes += image.data.length;
        if (bytes > 24 * 1024 * 1024) throw new Error('截图超过传输大小上限，请降低 scale 或使用更小的区域');
        images.push(image); bands.delete(offset);
      }
    }
    for (const [offset, canvas] of bands) {
      const height = Math.min(canvas.height, filledBottom - offset);
      if (height <= 0) continue;
      const cropped = new OffscreenCanvas(canvas.width, height); cropped.getContext('2d')!.drawImage(canvas, 0, 0);
      const image = await encodeBand(cropped, offset); bytes += image.data.length;
      if (bytes > 24 * 1024 * 1024) throw new Error('截图超过传输大小上限，请降低 scale 或使用更小的区域');
      images.push(image);
    }
    warnings.splice(0, warnings.length, ...new Set(warnings));
    metadata = { mode, tabId, url: page.url, title: page.title, region: originalRegion, scale: pixelScale, complete, tileCount, requestedTiles: Math.ceil(originalRegion.width / page.viewportWidth) * Math.ceil(originalRegion.height / page.viewportHeight), warnings };
    return { images, metadata };
  } catch (error) {
    throw diagnosticError(error, { phase: 'screenshot', tabId, mode, scrollingMayHaveOccurred: began });
  } finally {
    if (began) {
      try { restored = (await control('end')).restored === true; } catch { warnings.push('原页面文档已改变或无法通信，滚动位置未能确认恢复；页面内超时清理会自动释放临时样式。'); }
    }
    if (!restored && began) warnings.push('请检查截图后的页面滚动位置。');
    if (metadata) metadata.scrollRestored = restored;
    chrome.tabs.onActivated?.removeListener(onActivated);
    chrome.tabs.onUpdated?.removeListener(onUpdated);
  }
}

async function encodeBand(canvas: OffscreenCanvas, offsetY: number): Promise<ImageBand> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > 18 * 1024 * 1024) throw new Error('截图超过传输大小上限，请降低 scale 或使用更小的区域');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { data: btoa(binary), mimeType: 'image/png', width: canvas.width, height: canvas.height, offsetY };
}
