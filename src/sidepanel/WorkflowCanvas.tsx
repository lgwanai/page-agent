import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  EditorRenderer, Field, FlowNodeMeta, FreeLayoutEditorProvider, type FreeLayoutPluginContext,
  type FreeLayoutProps, type WorkflowJSON, type WorkflowNodeProps, WorkflowNodeRenderer,
  useClientContext, useNodeRender,
} from '@flowgram.ai/free-layout-editor';
import '@flowgram.ai/free-layout-editor/index.css';
import { createId, NODE_KIND_LABELS, type EdgePort, type WorkflowEdge, type WorkflowNode } from '@/types/workflow';

interface CanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onChange: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  onSelect: (nodeId: string | null) => void;
}

const PORTS: Record<WorkflowNode['kind'], Array<{ type: 'input' | 'output'; portID?: EdgePort }>> = {
  dom: [{ type: 'input' }, { type: 'output', portID: 'success' }, { type: 'output', portID: 'failure' }],
  ai: [{ type: 'input' }, { type: 'output', portID: 'success' }, { type: 'output', portID: 'failure' }],
  action: [{ type: 'input' }, { type: 'output', portID: 'success' }, { type: 'output', portID: 'failure' }],
  wait: [{ type: 'input' }, { type: 'output', portID: 'success' }, { type: 'output', portID: 'failure' }],
  loop: [{ type: 'input' }, { type: 'output', portID: 'body' }, { type: 'output', portID: 'done' }, { type: 'output', portID: 'failure' }],
};

const PORT_LABELS: Partial<Record<EdgePort, string>> = { success: '成功', failure: '失败', body: '遍历', done: '完成' };

function nodeSummary(node: WorkflowNode): string {
  let summary: string;
  if (node.kind === 'dom') summary = `${node.event.type} · ${node.target.tagName}`;
  else if (node.kind === 'ai') summary = `${node.inputs.length} 个输入 · ${node.instruction || '未填写指令'}`;
  else if (node.kind === 'loop') summary = `遍历 ${node.items || '未配置数组'}`;
  else if (node.kind === 'wait') summary = `${node.durationMs}ms`;
  else summary = '调用已保存 Action';
  return summary;
}

function CanvasNodeForm() {
  return (
    <Field<WorkflowNode> name="config">
      {({ field }) => {
        const config = field.value;
        if (!config) return <div className="canvas-node-body">节点数据不可用</div>;
        const outputs = PORTS[config.kind].filter((port) => port.type === 'output');
        return <>
          <div className="canvas-node-head"><span>{config.kind === 'ai' ? '✦' : config.kind === 'dom' ? '⌖' : config.kind === 'loop' ? '↻' : '●'}</span><strong>{config.name}</strong></div>
          <div className="canvas-node-body"><em>{NODE_KIND_LABELS[config.kind]}</em><p>{nodeSummary(config)}</p></div>
          <div className="canvas-node-ports">{outputs.map((port) => <span key={port.portID} className={`port-${port.portID}`}>{PORT_LABELS[port.portID!]}</span>)}</div>
        </>;
      }}
    </Field>
  );
}

function CanvasNode(props: WorkflowNodeProps) {
  const { node, form } = useNodeRender();
  const meta = node.getNodeMeta<FlowNodeMeta>();
  return (
    <WorkflowNodeRenderer className={`pa-canvas-node canvas-${String(node.flowNodeType)}`} node={props.node} style={meta.wrapperStyle}>
      {form?.render() ?? <div className="canvas-node-body">节点数据不可用</div>}
    </WorkflowNodeRenderer>
  );
}

const nodeRegistries = (Object.keys(PORTS) as WorkflowNode['kind'][]).map((kind) => ({
  type: kind,
  meta: { defaultPorts: PORTS[kind], size: { width: 220, height: 112 } },
}));

function toCanvas(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowJSON {
  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      type: node.kind,
      meta: { position: node.position ?? { x: 60 + (index % 3) * 290, y: 70 + Math.floor(index / 3) * 190 } },
      data: { title: node.name, config: node },
    })),
    edges: edges.map((edge) => ({
      sourceNodeID: edge.sourceNodeId,
      targetNodeID: edge.targetNodeId,
      sourcePortID: edge.sourcePort,
    })),
  };
}

function fromCanvas(json: WorkflowJSON): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = json.nodes.map((item) => ({
    ...(item.data?.config as WorkflowNode),
    position: item.meta?.position as { x: number; y: number } | undefined,
  }));
  const edges = (json.edges ?? []).map((edge) => ({
    id: createId('edge'),
    sourceNodeId: edge.sourceNodeID,
    targetNodeId: edge.targetNodeID,
    sourcePort: (edge.sourcePortID || 'success') as EdgePort,
  }));
  return { nodes, edges };
}

function CanvasBridge({ graph, lastInternal, onChange, onSelect }: {
  graph: WorkflowJSON;
  lastInternal: MutableRefObject<string>;
  onChange: CanvasProps['onChange'];
  onSelect: CanvasProps['onSelect'];
}) {
  const context = useClientContext();
  const signature = JSON.stringify(graph);
  useEffect(() => {
    const disposable = context.selection.onSelectionChanged(() => onSelect(context.selection.selection[0]?.id ?? null));
    return () => disposable.dispose();
  }, [context, onSelect]);
  useEffect(() => {
    if (signature === lastInternal.current) return;
    context.operation.fromJSON(graph);
  }, [context, graph, signature, lastInternal]);
  useEffect(() => {
    const disposable = context.document.onContentChange(() => {
      const json = context.document.toJSON();
      lastInternal.current = JSON.stringify(json);
      const next = fromCanvas(json);
      onChange(next.nodes, next.edges);
    });
    return () => disposable.dispose();
  }, [context, lastInternal, onChange]);
  return null;
}

export function WorkflowCanvas({ nodes, edges, onChange, onSelect }: CanvasProps) {
  const graph = useMemo(() => toCanvas(nodes, edges), [nodes, edges]);
  const lastInternal = useRef('');
  const contextRef = useRef<FreeLayoutPluginContext>(null);
  const props = useMemo<FreeLayoutProps>(() => ({
    background: true,
    initialData: graph,
    nodeRegistries,
    nodeEngine: { enable: true },
    history: { enable: true, enableChangeNode: true },
    twoWayConnection: false,
    getNodeDefaultRegistry: (type) => ({ type, meta: { defaultExpanded: true }, formMeta: { render: () => <CanvasNodeForm /> } }),
    materials: { renderDefaultNode: CanvasNode },
    onAllLayersRendered: (context) => context.tools.fitView(false),
  }), []);

  return (
    <div className="workflow-canvas">
      <FreeLayoutEditorProvider ref={contextRef} {...props}>
        <EditorRenderer className="workflow-editor" />
        <CanvasBridge graph={graph} lastInternal={lastInternal} onChange={onChange} onSelect={onSelect} />
      </FreeLayoutEditorProvider>
    </div>
  );
}
