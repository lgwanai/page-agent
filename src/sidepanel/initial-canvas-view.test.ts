import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeCanvasView, type CanvasViewSnapshot } from './initial-canvas-view';
let frames: Map<number, FrameRequestCallback>, nextId: number;
const ready = (): CanvasViewSnapshot => ({ width: 400, height: 500, nodes: [{ id: 'one', x: 5000, y: -3000, width: 220, height: 112 }], visible: false });
async function step(count = 1) {
  for (let n = 0; n < count; n++) {
    const next = frames.entries().next().value;
    if (!next) break;
    frames.delete(next[0]); next[1](0);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
beforeEach(() => {
  frames = new Map(); nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextId, fn); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});
afterEach(() => { vi.unstubAllGlobals(); });
it('waits for real document and viewport dimensions, then fits once and leaves later pan/zoom alone', async () => {
  let snapshot: CanvasViewSnapshot | undefined;
  const fit = vi.fn(async () => { snapshot!.visible = true; });
  initializeCanvasView(() => snapshot, fit);
  await step(3); expect(fit).not.toHaveBeenCalled();
  snapshot = { ...ready(), width: 0 }; await step(3); expect(fit).not.toHaveBeenCalled();
  snapshot = { ...ready(), nodes: [] }; await step(3); expect(fit).not.toHaveBeenCalled();
  snapshot = ready(); await step(4);
  expect(fit).toHaveBeenCalledOnce(); expect(frames.size).toBe(0);
  snapshot = { ...ready(), width: 900 }; await step(4); expect(fit).toHaveBeenCalledOnce();
});
it('refits if node measurements or the viewport settle after the first fit', async () => {
  const snapshot = ready();
  const fit = vi.fn(async () => { if (fit.mock.calls.length === 1) snapshot.nodes[0].height = 400; else snapshot.visible = true; });
  initializeCanvasView(() => snapshot, fit); await step(7);
  expect(fit).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
});
it('does not commit a fit for zero-size or nonfinite node measurements', async () => {
  const snapshot = ready(); snapshot.nodes[0].width = 0;
  const fit = vi.fn().mockResolvedValue(undefined);
  const stop = initializeCanvasView(() => snapshot, fit);
  await step(5); snapshot.nodes[0].width = NaN; await step(5); expect(fit).not.toHaveBeenCalled();
  stop(); expect(frames.size).toBe(0);
});
it('stops retries once zoom limits prevent complete containment', async () => {
  const fit = vi.fn().mockResolvedValue(undefined);
  initializeCanvasView(ready, fit); await step(10);
  expect(fit).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
});
it('does not recenter after the user interrupts initialization or unmounts the canvas', async () => {
  const fit = vi.fn().mockResolvedValue(undefined);
  const stop = initializeCanvasView(ready, fit); await step(); stop(); await step(5);
  expect(fit).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
});
it('cleans up an asynchronous fit without scheduling another frame after cancellation', async () => {
  let release = () => {};
  const fit = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const stop = initializeCanvasView(ready, fit); await step(2); expect(fit).toHaveBeenCalledOnce();
  stop(); release(); await Promise.resolve(); await Promise.resolve(); expect(frames.size).toBe(0);
});
