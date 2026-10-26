import type { ReactNode } from 'react';
import { NODE_KIND_LABELS, NODE_KIND_ENGLISH, type WorkflowNode } from '@/types/workflow';
export function PropertyDock({ node, expanded, onToggle, children }: { node?: WorkflowNode; expanded: boolean; onToggle: () => void; children: ReactNode }) {
  if (!node) return null;
  return <section className={`property-dock${expanded ? ' expanded' : ''}`} aria-label="节点属性">
    <button className="property-handler" type="button" aria-expanded={expanded} aria-controls="node-property-details" aria-label={expanded ? '收起节点属性' : '展开节点属性'} onClick={onToggle}>
      <span className="property-grip" aria-hidden="true">{expanded ? '⌄' : '⌃'}</span><span className="property-node-name">{node.name}</span><small>{NODE_KIND_LABELS[node.kind]}<span lang="en">{NODE_KIND_ENGLISH[node.kind]}</span></small><span className="property-handler-action">{expanded ? '收起属性' : '展开属性'}</span>
    </button>
    {expanded && <div id="node-property-details" className="property-details">{children}</div>}
  </section>;
}
