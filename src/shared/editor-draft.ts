import type { WorkflowEdge, WorkflowNode } from '@/types/workflow';
export const EDITOR_DRAFT_KEY = 'pageAgentEditorDraftV1';
export interface EditorDraft {
  nodes: WorkflowNode[]; edges: WorkflowEdge[];
  editing: { type: 'script'; id: string; name: string; updatedAt?: number } | null;
  savedSignature: string; savedAt: number;
}
export function isEditorDraft(value: unknown): value is EditorDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as EditorDraft;
  return Array.isArray(draft.nodes) && draft.nodes.length > 0 && draft.nodes.every(node => node && typeof node.id === 'string' && typeof node.kind === 'string') && Array.isArray(draft.edges) && typeof draft.savedSignature === 'string' && typeof draft.savedAt === 'number' && (draft.editing === null || typeof draft.editing?.id === 'string');
}
