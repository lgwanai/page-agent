import type { WorkflowNode } from '@/types/workflow';
import { nodeBody } from '@/shared/nested-graph';

export const CANVAS_PADDING = 32;
export const CONTAINER_HEADER = 108;
export const CONTAINER_INSET = 26;
export interface CanvasBox { x: number; y: number; width: number; height: number }
export interface CanvasNodeGeometry extends CanvasBox { body?: CanvasGeometry }
export interface CanvasGeometry extends CanvasBox { nodes: Record<string, CanvasNodeGeometry> }

const intersects = (a: CanvasBox, b: CanvasBox) => a.x < b.x + b.width + 24 && a.x + a.width + 24 > b.x && a.y < b.y + b.height + 24 && a.y + a.height + 24 > b.y;

/** Compute sizes from the innermost body outwards, in unscaled canvas units.
 * Display-only collision clearance accommodates old workflows whose fixed-size
 * containers did not reserve enough room. Persisted positions stay untouched.
 */
export function canvasGeometry(nodes: WorkflowNode[], containerId?: string): CanvasGeometry {
  const entries = nodes.map((node, index) => {
    const body = nodeBody(node);
    const geometry = body ? canvasGeometry(body.nodes, node.id) : undefined;
    const position = node.position ?? { x: 60 + (index % 3) * 290, y: 70 + Math.floor(index / 3) * 190 };
    const width = geometry ? Math.max(480, geometry.width + CONTAINER_INSET) : 220;
    const box: CanvasNodeGeometry = {
      // FlowGram's position uses the horizontal center and the top edge.
      x: position.x - width / 2, y: position.y, width,
      height: geometry ? CONTAINER_HEADER + geometry.height + 14 : 112,
      ...(geometry ? { body: geometry } : {}),
    };
    return [node.id, box] as const;
  });
  const placed: Array<CanvasBox & { anchorX: number; anchorY: number }> = containerId ? [{ x: 8, y: 65, width: 44, height: 44, anchorX: 30, anchorY: 65 }] : [];
  for (const [, box] of [...entries].sort((a, b) => a[1].x + a[1].width / 2 - b[1].x - b[1].width / 2 || a[1].y - b[1].y)) {
    const anchorX = box.x + box.width / 2, anchorY = box.y;
    // Only move forward, so clearance terminates even for coincident nodes.
    let collision: typeof placed[number] | undefined;
    while ((collision = placed.find(other => intersects(box, other)))) {
      const dx = collision.x + collision.width + 60 - box.x;
      const dy = collision.y + collision.height + 60 - box.y;
      if ((anchorX > collision.anchorX + 110 && Math.abs(anchorY - collision.anchorY) < 112) || dx < dy) box.x += dx; else box.y += dy;
    }
    placed.push({ ...box, anchorX, anchorY });
  }
  const x = Math.min(0, ...placed.map(box => box.x - CANVAS_PADDING));
  const y = Math.min(0, ...placed.map(box => box.y - CANVAS_PADDING));
  return {
    x, y,
    width: Math.max(454, ...placed.map(box => box.x + box.width + CANVAS_PADDING - x)),
    height: Math.max(180, ...placed.map(box => box.y + box.height + CANVAS_PADDING - y)),
    nodes: Object.fromEntries(entries),
  };
}
