interface CaptureSession {
  token: string; x: number; y: number; timer: ReturnType<typeof setTimeout>;
  styles: Array<{ element: HTMLElement; property: string; value: string; priority: string }>;
}
let session: CaptureSession | undefined;

function geometry() {
  const root = document.documentElement; const body = document.body;
  return { url: location.href, title: document.title, viewportWidth: innerWidth, viewportHeight: innerHeight,
    pageWidth: Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth ?? 0),
    pageHeight: Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight ?? 0), x: scrollX, y: scrollY };
}

function setStyle(element: HTMLElement, property: string, value: string) {
  session!.styles.push({ element, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
  element.style.setProperty(property, value, 'important');
}

export function restoreScreenshot(token?: string) {
  if (!session || (token && session.token !== token)) return { ok: true, restored: false };
  const previous = session; clearTimeout(previous.timer);
  // Restore the position while smooth scrolling and scroll snapping are still disabled.
  window.scrollTo({ left: previous.x, top: previous.y, behavior: 'instant' as ScrollBehavior });
  for (const style of previous.styles.reverse()) {
    if (style.value) style.element.style.setProperty(style.property, style.value, style.priority);
    else style.element.style.removeProperty(style.property);
  }
  session = undefined;
  return { ok: true, restored: Math.abs(scrollX - previous.x) <= 1 && Math.abs(scrollY - previous.y) <= 1, x: scrollX, y: scrollY };
}

export async function screenshotControl(message: { operation: 'begin' | 'scroll' | 'end' | 'info'; token: string; selector?: string; x?: number; y?: number; hideFixed?: boolean; settleMs?: number }) {
  if (message.operation === 'end') return restoreScreenshot(message.token);
  if (message.operation === 'begin') {
    if (session) throw new Error('截图会话正在执行');
    let region;
    if (message.selector) {
      const elements = document.querySelectorAll(message.selector);
      if (elements.length !== 1) throw new Error(`截图区域 Selector 必须唯一，当前匹配 ${elements.length} 个`);
      const bounds = elements[0].getBoundingClientRect();
      if (!bounds.width || !bounds.height) throw new Error('截图区域节点不可见');
      region = { x: bounds.left + scrollX, y: bounds.top + scrollY, width: bounds.width, height: bounds.height };
    }
    session = { token: message.token, x: scrollX, y: scrollY, styles: [], timer: setTimeout(() => restoreScreenshot(message.token), 120000) };
    for (const element of [document.documentElement, document.body].filter(Boolean)) {
      setStyle(element, 'scroll-behavior', 'auto'); setStyle(element, 'scroll-snap-type', 'none');
    }
    return { ok: true, ...geometry(), region };
  }
  if (!session || session.token !== message.token) throw new Error('截图会话不存在或已过期');
  if (message.operation === 'info') return { ok: true, ...geometry() };
  if (message.hideFixed) {
    // Prevent repeated fixed/sticky headers in stitched pages; only hide once per session.
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *')).slice(0, 10000)) {
      const position = getComputedStyle(element).position;
      if ((position === 'fixed' || position === 'sticky') && !session.styles.some((s) => s.element === element && s.property === 'visibility')) setStyle(element, 'visibility', 'hidden');
    }
  }
  window.scrollTo({ left: message.x ?? 0, top: message.y ?? 0, behavior: 'instant' as ScrollBehavior });
  await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(50, message.settleMs ?? 200))));
  return { ok: true, ...geometry() };
}
