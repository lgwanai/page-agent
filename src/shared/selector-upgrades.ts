import { structuralJson } from './structural-json';
import type { SelectorUpgradeReport, WorkflowNode } from '@/types/workflow';
import { mapNodes } from './nested-graph';

/** Apply verified results to a still-open draft only if its target was not edited. */
export function applySelectorUpgradeReports(nodes: WorkflowNode[], reports: SelectorUpgradeReport[], workflowId?: string): WorkflowNode[] {
  return mapNodes(nodes, node => {
    let next = node;
    for (const report of reports) {
      if (report.nodeId !== node.id || !report.previous || !report.target || report.status === 'unresolved'
        || (report.workflowId && (report.workflowKind !== 'script' || report.workflowId !== workflowId))) continue;
      const equal = (value: unknown) => structuralJson(value) === structuralJson(report.previous);
      if (report.inputId && next.kind === 'ai') next = { ...next, inputs: next.inputs.map(input => input.id === report.inputId && equal(input.target) ? { ...input, target: structuredClone(report.target!) } : input) };
      else if ('target' in next && equal(next.target)) next = { ...next, target: structuredClone(report.target) } as WorkflowNode;
    }
    return next;
  });
}
