export interface DragGesture { startX?: number; startY?: number; dx: number; dy: number; durationMs?: number; points?: Array<{ x: number; y: number }> }

export async function replayDrag(element: HTMLElement, value: string | undefined): Promise<{ moved: boolean; dx: number; dy: number }> {
  let gesture: DragGesture;
  try { gesture = JSON.parse(value || '{}') as DragGesture; } catch { throw new Error('拖拽参数不是有效 JSON'); }
  if (![gesture.dx, gesture.dy].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 50000)) throw new Error('拖拽需配置有效的水平和垂直位移');
  if (gesture.points !== undefined && (!Array.isArray(gesture.points) || gesture.points.length > 80 || gesture.points.some(p => !p || ![p.x, p.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 50000)))) throw new Error('拖拽轨迹无效或超过 80 个采样点');
  const before = element.getBoundingClientRect(), parent = element.parentNode, next = element.nextSibling;
  const fraction = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
  const x = before.left + before.width * fraction(gesture.startX), y = before.top + before.height * fraction(gesture.startY);
  const mouse = (target: Element, type: string, px: number, py: number, buttons = 1) => {
    const init = { bubbles: true, cancelable: true, clientX: px, clientY: py, button: 0, buttons };
    if (typeof PointerEvent !== 'undefined') element.dispatchEvent(new PointerEvent(type.replace('mouse', 'pointer'), { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent(type, init));
  };
  const data = typeof DataTransfer !== 'undefined' ? new DataTransfer() : undefined;
  const htmlDrag = element.draggable && typeof DragEvent !== 'undefined' && Boolean(data);
  const drag = (target: Element, type: string, px: number, py: number) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: px, clientY: py, dataTransfer: data }));
  mouse(element, 'mousedown', x, y);
  if (htmlDrag) drag(element, 'dragstart', x, y);
  const points = [...(gesture.points ?? []), { x: gesture.dx, y: gesture.dy }];
  if (points.length === 1) for (let i = 1; i < 12; i++) points.splice(i - 1, 0, { x: gesture.dx * i / 12, y: gesture.dy * i / 12 });
  const duration = Math.max(100, Math.min(5000, Number(gesture.durationMs) || 500));
  let drop: Element = element;
  const previousDrop = new Map<Element, string>();
  try {
    for (const point of points) {
      const px = x + point.x, py = y + point.y;
      drop = document.elementFromPoint(px, py) ?? document.documentElement;
      if (!previousDrop.has(drop)) previousDrop.set(drop, drop.outerHTML);
      mouse(drop, 'mousemove', px, py);
      if (htmlDrag) { drag(element, 'drag', px, py); drag(drop, 'dragenter', px, py); drag(drop, 'dragover', px, py); }
      await new Promise(resolve => setTimeout(resolve, duration / points.length));
    }
    if (htmlDrag) drag(drop, 'drop', x + gesture.dx, y + gesture.dy);
  } finally {
    mouse(drop, 'mouseup', x + gesture.dx, y + gesture.dy, 0);
    if (htmlDrag) drag(element, 'dragend', x + gesture.dx, y + gesture.dy);
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const after = element.getBoundingClientRect();
  const moved = Math.hypot(after.left - before.left, after.top - before.top) >= 2 || element.parentNode !== parent || element.nextSibling !== next || (htmlDrag && [...previousDrop].some(([target, html]) => target.outerHTML !== html));
  return { moved, dx: gesture.dx, dy: gesture.dy };
}
