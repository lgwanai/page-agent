export interface CanvasViewSnapshot {
  width: number; height: number;
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  visible: boolean;
}
/** Wait for a synchronized document and nonzero viewport, then verify the fit.
 * Stops after initialization so later edits never reset the user's pan or zoom.
 */
export function initializeCanvasView(read: () => CanvasViewSnapshot | undefined, fit: () => Promise<void>): () => void {
  let stopped = false, frame = 0, previous = '', fitted = '', stable = 0, attempts = 0;
  const schedule = () => { if (!stopped) frame = requestAnimationFrame(() => { void tick(); }); };
  const tick = async () => {
    if (stopped) return;
    let snapshot: CanvasViewSnapshot | undefined;
    try { snapshot = read(); } catch { schedule(); return; }
    if (!snapshot || snapshot.width <= 0 || snapshot.height <= 0 || !snapshot.nodes.length
      || snapshot.nodes.some(node => ![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0)) {
      previous = ''; stable = 0; schedule(); return;
    }
    const key = JSON.stringify([snapshot.width, snapshot.height, snapshot.nodes]);
    if (key !== previous) { previous = key; stable = 0; }
    if (++stable < 2) { schedule(); return; }
    if (fitted === key && (snapshot.visible || attempts >= 2)) { stopped = true; return; }
    if (fitted !== key) attempts = 0;
    try { await fit(); fitted = key; attempts++; stable = 0; }
    catch { previous = ''; stable = 0; }
    schedule();
  };
  schedule();
  return () => { stopped = true; cancelAnimationFrame(frame); };
}
