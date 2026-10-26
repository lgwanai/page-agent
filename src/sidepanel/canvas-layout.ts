import type { WorkflowJSON } from '@flowgram.ai/free-layout-editor';
import type { WorkflowNode } from '@/types/workflow';
import { mapNodes } from '@/shared/nested-graph';
export type LayoutPositions = Record<string, { x: number; y: number }>;
export type CanvasViewCommand = 'zoomIn' | 'zoomOut' | 'resetZoom' | 'fitView';
export interface CanvasLayoutControls {
  view?: (command: CanvasViewCommand) => void;
  arrange: () => Promise<LayoutPositions>;
  restore: () => void;
}
/** Child entry is virtual and stays fixed; translate its arranged children as a group. */
export function readLayoutPositions(json: WorkflowJSON, containerId?: string): LayoutPositions {
  const entry = containerId ? json.nodes.find(node => node.id === `${containerId}::entry`) : undefined;
  const origin = entry?.meta?.position as { x: number; y: number } | undefined;
  const offset = origin ? { x: 30 - origin.x, y: 65 - origin.y } : { x: 0, y: 0 };
  return Object.fromEntries(json.nodes.filter(node => node !== entry).map(node => {
    const position = node.meta?.position as { x: number; y: number } | undefined;
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error('自动整理未返回有效节点位置');
    return [node.id, { x: Math.round(position.x + offset.x), y: Math.round(position.y + offset.y) }];
  }));
}
export function applyLayoutPositions(nodes: WorkflowNode[], positions: LayoutPositions): WorkflowNode[] {
  return mapNodes(nodes, node => Object.hasOwn(positions, node.id) ? { ...node, position: positions[node.id] } : node);
}
