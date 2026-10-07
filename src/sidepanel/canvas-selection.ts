export interface SelectableEntity {
  id: string;
}

/** Resolve only workflow nodes from FlowGram's mixed node/line selection. */
export function selectedWorkflowNodeId(
  selection: SelectableEntity[],
  nodeIds: ReadonlySet<string>,
): string | null {
  return selection.find((entity) => nodeIds.has(entity.id))?.id ?? null;
}
