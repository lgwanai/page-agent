import { useEffect, useRef, useState } from 'react';
import type { WorkflowEdge, WorkflowNode } from '@/types/workflow';
type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
export function useGraphHistory(scope: string, graph: Graph, signature: string, apply: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void) {
  const history = useRef<{ scope: string; past: Graph[]; present: Graph; signature: string; future: Graph[] }>({ scope, past: [], present: structuredClone(graph), signature, future: [] });
  const [, refresh] = useState(0);
  useEffect(() => {
    const current = history.current;
    if (current.scope !== scope) history.current = { scope, past: [], present: structuredClone(graph), signature, future: [] };
    else if (current.signature !== signature) history.current = { scope, past: [...current.past, current.present].slice(-50), present: structuredClone(graph), signature, future: [] };
    refresh(value => value + 1);
  }, [scope, signature]); // Graph identity alone is not a user edit (canvas edge IDs can change).
  const move = (direction: 'undo' | 'redo') => {
    const current = history.current;
    const source = direction === 'undo' ? current.past : current.future;
    const next = source.at(-1); if (!next) return;
    const snapshot = structuredClone(next);
    history.current = { ...current, present: snapshot, signature: '', past: direction === 'undo' ? current.past.slice(0, -1) : [...current.past, current.present], future: direction === 'redo' ? current.future.slice(0, -1) : [...current.future, current.present] };
    apply(snapshot.nodes, snapshot.edges);
    // Updated by acceptSignature before the next effect so undo itself isn't a new edit.
  };
  // A history move already installed this graph. Accept its canonical signature.
  if (history.current.signature === '' && history.current.present.nodes === graph.nodes) history.current.signature = signature;
  return { canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0, undo: () => move('undo'), redo: () => move('redo') };
}
