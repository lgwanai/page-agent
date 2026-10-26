import { initializeCanvasView, type CanvasViewSnapshot } from './initial-canvas-view';
import { readLayoutPositions, type CanvasLayoutControls } from './canvas-layout';
import { createContext, useContext, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import {
  EditorRenderer, Field, FlowNodeMeta, FreeLayoutEditorProvider, type FreeLayoutPluginContext,
  type FreeLayoutProps, type WorkflowJSON, type WorkflowNodeProps, WorkflowNodeRenderer, type WorkflowPort,
  useClientContext, useNodeRender, TransformData,
} from '@flowgram.ai/free-layout-editor';
import '@flowgram.ai/free-layout-editor/index.css';
import { createId, NODE_KIND_LABELS, NODE_KIND_ENGLISH, type EdgePort, type StepResult, type WorkflowEdge, type WorkflowNode } from '@/types/workflow';
import { selectedWorkflowNodeId, type SelectableEntity } from './canvas-selection';
import { nodeBody } from '@/shared/nested-graph';
import { canvasGeometry, CANVAS_PADDING } from './canvas-geometry';

interface CanvasProps {
  onRegisterLayout?: (scope: string, controls: CanvasLayoutControls) => () => void;
  fitRequest?: number;
  onInteractionStart?: () => void;
  onZoomChange?: (zoom: number) => void;
  onRegisterViewport?: (ids: string[], center: () => { x: number; y: number }) => () => void;
  containerId?: string;
  entryNodeId?: string;
  activeNodeId?: string | null;
  nodeLogs?: Record<string, StepResult[]>;
  onShowLogs?: (nodeId: string) => void;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onChange: (nodes: WorkflowNode[], edges: WorkflowEdge[], entryNodeId?: string) => void;
  onSelect: (nodeId: string | null) => void;
  onAddFromPort: (nodeId: string, port: EdgePort, point: { x: number; y: number }) => void;
}

const inputPort: WorkflowPort = { type: 'input', location: 'left', locationConfig: { left: 0, top: '50%' } };
const successFailurePorts: WorkflowPort[] = [
  { type: 'output', portID: 'success', location: 'right', locationConfig: { right: 0, top: '36%' } },
  { type: 'output', portID: 'failure', location: 'right', locationConfig: { right: 0, top: '72%' } },
];

const PORTS: Record<WorkflowNode['kind'], WorkflowPort[]> = {
  start: [...successFailurePorts],
  dom: [inputPort, ...successFailurePorts],
  dialog: [inputPort, ...successFailurePorts],
  query: [inputPort, ...successFailurePorts],
  output: [inputPort, ...successFailurePorts],
  watch: [inputPort, ...successFailurePorts],
  screenshot: [inputPort, ...successFailurePorts],
  datatable: [inputPort, ...successFailurePorts],
  tableFill: [inputPort, ...successFailurePorts],
  email: [inputPort, ...successFailurePorts],
  request: [inputPort, ...successFailurePorts],
  calendar: [inputPort, ...successFailurePorts],
  pagination: [inputPort,
    { type: 'output', portID: 'done', location: 'right', locationConfig: { right: 0, top: '20%' } },
    { type: 'output', portID: 'failure', location: 'right', locationConfig: { right: 0, top: '80%' } },
  ],
  ai: [inputPort, ...successFailurePorts],
  action: [inputPort, ...successFailurePorts],
  wait: [inputPort, ...successFailurePorts],
  loop: [
    inputPort,
    { type: 'output', portID: 'body', location: 'right', locationConfig: { right: 0, top: '25%' } },
    { type: 'output', portID: 'done', location: 'right', locationConfig: { right: 0, top: '50%' } },
    { type: 'output', portID: 'failure', location: 'right', locationConfig: { right: 0, top: '75%' } },
  ],
};

const PortActionContext = createContext<CanvasProps['onAddFromPort']>(() => undefined);
const NodeSelectContext = createContext<CanvasProps['onSelect']>(() => undefined);
const RunContext = createContext<Pick<CanvasProps, 'activeNodeId' | 'nodeLogs' | 'onShowLogs'>>({});
const GraphContext = createContext<Pick<CanvasProps, 'nodes' | 'edges' | 'onChange' | 'onRegisterViewport' | 'onRegisterLayout' | 'fitRequest'>>({ nodes: [], edges: [], onChange: () => undefined });

function nodeSummary(node: WorkflowNode): string {
  let summary: string;
  if (node.kind === 'start') summary = `${node.inputs?.length ?? 0} 个参数 · ${node.targetUrl || '使用当前页面'}`;
  else if (node.kind === 'dialog') summary = `${node.dialogType} · ${node.action === 'accept' ? '确定' : '取消'} · ${node.target.label || node.target.selector || '未选择触发控件'}`;
  else if (node.kind === 'dom') summary = `${node.event.type} · ${node.target.tagName}`;
  else if (node.kind === 'output') summary = `${node.source === 'dom' ? node.target?.selector || '未选择 DOM' : node.source === 'node' ? '返回前序节点输出' : node.value || '未配置输出'}${node.outcome === 'failure' ? ' · 业务未成功' : node.outcome === 'success' ? ' · 业务成功' : ''}`;
  else if (node.kind === 'watch') summary = `监控 ${node.source === 'attribute' ? node.attributeName || '属性' : node.source === 'text' ? '文本' : '值'} · ${node.expected || node.match} · ${node.timeoutMs / 1000} 秒`;
  else if (node.kind === 'datatable') summary = `表格数据 · ${node.target.selector || '未选择表格'}`;
  else if (node.kind === 'tableFill') summary = `按 ${node.keyColumns.join(' + ') || '未配置 key'} 匹配填充 · ${node.target.selector || '未选择表格'}`;
  else if (node.kind === 'screenshot') summary = node.mode + ' · ' + node.fileName;
  else if (node.kind === 'email') summary = node.to + ' · ' + node.subject;
  else if (node.kind === 'request') summary = `${node.method} · ${node.url || '未配置链接'} · ${node.responseType === 'json' ? 'JSON' : 'Text'}`;
  else if (node.kind === 'calendar') summary = `${node.date || '未配置日期'}${node.mode === 'range' ? ` 至 ${node.endDate || '未配置结束日期'}` : ''}`;
  else if (node.kind === 'pagination') summary = node.mode === 'all' ? node.stopAtPage !== undefined ? `遍历第 1 页至 ${node.stopAtPage || '未配置'} 页 · 内部子流程` : '遍历每一页 · 内部子流程' : `到第 ${node.page || '未配置'} 页`;
  else if (node.kind === 'query') summary = `${node.query.source === 'attribute' ? node.query.attributeName || '属性' : node.query.source === 'text' ? '文本' : 'DOM 值'} · ${node.target.selector || '未选择检索范围'}`;
  else if (node.kind === 'ai') summary = `${node.inputs.length} 个输入 · ${node.instruction || '未填写指令'}`;
  else if (node.kind === 'loop') summary = `遍历 ${node.items || '未配置数组'}`;
  else if (node.kind === 'wait') summary = node.mode === 'random' ? `随机 ${node.minDurationMs}–${node.maxDurationMs}ms` : `${node.durationMs}ms`;
  else summary = '调用已保存 Action';
  return summary;
}

function CanvasNodeForm() {
  return (
    <Field<WorkflowNode> name="config">
      {({ field }) => {
        const config = field.value;
        if (!config) return <div className="canvas-node-body">节点数据不可用</div>;
        return <>
          <div className="canvas-node-head"><span>{config.kind === 'start' ? '▶' : config.kind === 'ai' ? '✦' : config.kind === 'dom' ? '⌖' : config.kind === 'query' ? '⌕' : config.kind === 'loop' ? '↻' : '●'}</span><strong>{config.name}</strong></div>
          <div className="canvas-node-body"><em>{NODE_KIND_LABELS[config.kind]}<small lang="en">{NODE_KIND_ENGLISH[config.kind]}</small></em><p>{nodeSummary(config)}</p></div>
        </>;
      }}
    </Field>
  );
}

function CanvasNode(props: WorkflowNodeProps) {
  const { node, form } = useNodeRender();
  const onAddFromPort = useContext(PortActionContext);
  const onSelect = useContext(NodeSelectContext);
  const { activeNodeId, nodeLogs, onShowLogs } = useContext(RunContext);
  const graph = useContext(GraphContext);
  const config = graph.nodes.find((item) => item.id === node.id);
  const body = config && nodeBody(config);
  const logs = nodeLogs?.[node.id] ?? [];
  const failed = logs.some((step) => !step.ok);
  const meta = node.getNodeMeta<FlowNodeMeta>();
  return (
    <WorkflowNodeRenderer
      className={`pa-canvas-node canvas-${String(node.flowNodeType)}${body ? ' canvas-with-body' : ''}${activeNodeId === node.id ? ' node-running' : ''}${failed ? ' node-failed' : ''}`}
      node={props.node}
      style={meta.wrapperStyle}
      portClassName="pa-workflow-port"
      onPortClick={(port, event) => {
        if (port.portType !== 'output') return;
        const mouseEvent = event as React.MouseEvent<HTMLDivElement>;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();
        onAddFromPort(node.id, port.portID as EdgePort, { x: mouseEvent.clientX, y: mouseEvent.clientY });
      }}
    >
      <div className="canvas-node-content" onClick={() => onSelect(node.id)}>
        {String(node.flowNodeType) === 'entry' ? <span className="body-entry-icon" title="子流程入口">▶</span> : form?.render() ?? <div className="canvas-node-body">节点数据不可用</div>}
      </div>
      {body && <div className="container-subcanvas" onDragStart={event => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <WorkflowCanvas nodes={body.nodes} edges={body.edges} containerId={node.id} entryNodeId={body.entryNodeId}
          onRegisterViewport={graph.onRegisterViewport} onRegisterLayout={graph.onRegisterLayout} fitRequest={graph.fitRequest}
          onChange={(nodes, edges, entryNodeId) => { if (config) graph.onChange(graph.nodes.map((item) => item.id === config.id ? { ...config, body: { ...body, nodes, edges, entryNodeId } } as WorkflowNode : item), graph.edges); }}
          onSelect={onSelect} onAddFromPort={onAddFromPort} activeNodeId={activeNodeId} nodeLogs={nodeLogs} onShowLogs={onShowLogs}/>
        {!body.nodes.length && <button className="body-add-node" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAddFromPort(`${node.id}::entry`, 'success', { x: event.clientX, y: event.clientY }); }}>＋ 添加内部节点</button>}
      </div>}
      {logs.length > 0 && <button className={`canvas-node-log ${failed ? 'log-failure' : 'log-success'}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onShowLogs?.(node.id); }}><strong>{failed ? '执行失败' : '执行成功'} · {logs.length} 条日志</strong><span>{logs[logs.length - 1].message}</span><small>点击查看详情</small></button>}
    </WorkflowNodeRenderer>
  );
}

const nodeRegistries = (Object.keys(PORTS) as WorkflowNode['kind'][]).map((kind) => ({
  type: kind,
  meta: { defaultPorts: PORTS[kind], size: { width: 220, height: 112 } },
})).concat([{ type: 'entry' as WorkflowNode['kind'], meta: { defaultPorts: [{ type: 'output', portID: 'success', location: 'right' }], size: { width: 44, height: 44 } } }]);

function toCanvas(nodes: WorkflowNode[], edges: WorkflowEdge[], containerId?: string): WorkflowJSON {
  const geometry = canvasGeometry(nodes, containerId);
  return {
    nodes: nodes.map(node => ({
      id: node.id,
      type: node.kind,
      meta: { position: { x: geometry.nodes[node.id].x + geometry.nodes[node.id].width / 2, y: geometry.nodes[node.id].y }, size: { width: geometry.nodes[node.id].width, height: geometry.nodes[node.id].height },
        ...(geometry.nodes[node.id].body ? { wrapperStyle: { width: geometry.nodes[node.id].width, height: geometry.nodes[node.id].height, '--subcanvas-height': `${geometry.nodes[node.id].body!.height}px` }, defaultPorts: PORTS.pagination } : {}) },
      data: { title: node.name, config: node },
    })),
    edges: edges.map((edge) => ({
      sourceNodeID: edge.sourceNodeId,
      targetNodeID: edge.targetNodeId,
      sourcePortID: edge.sourcePort,
    })),
  };
}

function fromCanvas(json: WorkflowJSON, reference: WorkflowJSON): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes = json.nodes.map(item => {
    const config = item.data?.config as WorkflowNode;
    const position = item.meta?.position as { x: number; y: number } | undefined;
    const displayed = reference.nodes.find(node => node.id === item.id)?.meta?.position as typeof position;
    // Clearance is a view projection, not a workflow edit. Only persist a new
    // position for a node the user actually moved.
    const moved = position && (!displayed || Math.abs(position.x - displayed.x) > 0.01 || Math.abs(position.y - displayed.y) > 0.01);
    return moved ? { ...config, position } : config;
  });
  const edges = (json.edges ?? []).map((edge) => ({
    id: createId('edge'),
    sourceNodeId: edge.sourceNodeID,
    targetNodeId: edge.targetNodeID,
    sourcePort: (edge.sourcePortID || 'success') as EdgePort,
  }));
  return { nodes, edges };
}

function CanvasBridge({ graph, lastInternal, onChange, onSelect, containerId, onRegisterViewport, onRegisterLayout, fitRequest, surface, onZoomChange }: {
  surface: MutableRefObject<HTMLDivElement | null>;
  onZoomChange?: CanvasProps['onZoomChange'];
  onRegisterViewport?: CanvasProps['onRegisterViewport'];
  onRegisterLayout?: CanvasProps['onRegisterLayout'];
  fitRequest?: number;
  graph: WorkflowJSON;
  lastInternal: MutableRefObject<string>;
  onChange: CanvasProps['onChange'];
  onSelect: CanvasProps['onSelect'];
  containerId?: string;
}) {
  const context = useClientContext();
  const applyingGraph = useRef(false);
  const signature = JSON.stringify(graph);
  const graphRef = useRef(graph); graphRef.current = graph;
  const cancelInitialView = useRef<() => void>(() => undefined);
  const fitToDocument = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!containerId) return;
    const config = context.playground.config;
    const getPos = config.getPosFromMouseEvent;
    const toFixedPos = config.toFixedPos;
    const parentScale = () => {
      const element = surface.current;
      return element?.clientWidth ? element.getBoundingClientRect().width / element.clientWidth || 1 : 1;
    };
    // FlowGram assumes its playground is not inside another CSS transform.
    // Convert pointer coordinates as well as sizes, so child dragging/ports
    // remain accurate when the outer canvas is zoomed out.
    config.getPosFromMouseEvent = (event, withScale = true) => {
      const position = getPos.call(config, event, withScale);
      const viewport = config.getViewport(withScale);
      const scale = parentScale();
      return { x: (position.x - viewport.x) / scale + viewport.x, y: (position.y - viewport.y) / scale + viewport.y };
    };
    config.toFixedPos = position => {
      const fixed = toFixedPos.call(config, position);
      const rect = surface.current?.getBoundingClientRect();
      const scale = parentScale();
      return rect ? { x: rect.x + (fixed.x - rect.x) * scale, y: rect.y + (fixed.y - rect.y) * scale } : fixed;
    };
    let syncing = false;
    const sync = () => {
      const element = surface.current;
      if (syncing || !element?.clientWidth || !element.clientHeight) return;
      syncing = true;
      try {
        // Parent CSS transforms must never become the child's engine size.
        // The container already reserves all content at 1:1; no independent fit.
        const viewport = config.getViewport(false);
        if (viewport.width !== element.clientWidth || viewport.height !== element.clientHeight) context.playground.resize({ width: element.clientWidth, height: element.clientHeight }, false);
        const positions = graphRef.current.nodes.map(node => {
          const position = node.meta?.position as { x: number; y: number };
          const size = node.meta?.size as { width: number };
          return { x: position.x - size.width / 2, y: position.y };
        });
        config.zoomDisable = false; config.scrollDisable = false;
        void config.scroll({ zoom: 1, scrollX: Math.min(0, ...positions.map(p => p.x - CANVAS_PADDING)), scrollY: Math.min(0, ...positions.map(p => p.y - CANVAS_PADDING)) }, false);
        config.zoomDisable = true; config.scrollDisable = true; config.grabDisable = true;
      } finally { syncing = false; }
    };
    fitToDocument.current = sync;
    sync();
    const observer = new ResizeObserver(sync);
    if (surface.current) observer.observe(surface.current);
    const subscription = config.onConfigChanged(sync);
    return () => { observer.disconnect(); subscription.dispose(); config.getPosFromMouseEvent = getPos; config.toFixedPos = toFixedPos; };
  }, [context, surface, containerId, signature]);
  useEffect(() => {
    if (containerId) return;
    const config = context.playground.config;
    const read = (): CanvasViewSnapshot | undefined => {
      const viewport = surface.current?.getBoundingClientRect();
      const engineViewport = config.getViewport(false);
      // The DOM can be visible before FlowGram's resize observer updates its viewport.
      if (!viewport?.width || !viewport.height || !engineViewport.width || !engineViewport.height) return;
      // A nested canvas is physically scaled by its parent; its engine owns its
      // local viewport dimensions. Only the main canvas compares physical size.
      if (!containerId && (Math.abs(viewport.width - engineViewport.width) > 4 || Math.abs(viewport.height - engineViewport.height) > 4)) return;
      const expected = graphRef.current.nodes;
      const live = context.document.getAllNodes();
      if (!expected.length || live.length !== expected.length) return;
      const nodes = expected.map(node => {
        const entity = live.find(item => item.id === node.id);
        if (!entity) return;
        const bounds = entity.getData(TransformData).bounds;
        return { id: node.id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });
      if (nodes.some(node => !node)) return;
      const bounds = nodes as CanvasViewSnapshot['nodes'];
      const visible = config.getViewport();
      return { width: engineViewport.width, height: engineViewport.height, nodes: bounds, visible: bounds.every(node => node.x >= visible.x - 1 && node.y >= visible.y - 1 && node.x + node.width <= visible.x + visible.width + 1 && node.y + node.height <= visible.y + visible.height + 1) };
    };
    const fit = () => { cancelInitialView.current(); cancelInitialView.current = initializeCanvasView(read, () => context.tools.fitView(false)); };
    fitToDocument.current = fit;
    fit();
    const stop = () => cancelInitialView.current();
    const element = surface.current;
    element?.addEventListener('pointerdown', stop, true);
    element?.addEventListener('wheel', stop, { capture: true, passive: true });
    return () => { stop(); element?.removeEventListener('pointerdown', stop, true); element?.removeEventListener('wheel', stop, true); };
  }, [context, surface, containerId]);
  useEffect(() => {
    if (!onZoomChange) return;
    const config = context.playground.config;
    const update = () => onZoomChange(Math.round(config.zoom * 100));
    update();
    const subscription = config.onConfigChanged(update);
    return () => subscription.dispose();
  }, [context, onZoomChange]);

  useEffect(() => {
    if (!onRegisterLayout) return;
    return onRegisterLayout(containerId ?? '__main__', {
      view: command => {
        cancelInitialView.current();
        const config = context.playground.config;
        if (command === 'fitView') fitToDocument.current();
        else if (command === 'zoomIn') config.zoomin(false);
        else if (command === 'zoomOut') config.zoomout(false);
        else if (containerId) fitToDocument.current();
        else config.updateZoom(1, false);
      },
      arrange: async () => {
        cancelInitialView.current();
        applyingGraph.current = true;
        try {
          await context.tools.autoLayout({ enableAnimation: false, disableFitView: true, layoutConfig: { rankdir: 'LR', ranksep: 100, nodesep: 110 } });
          const positions = readLayoutPositions(context.document.toJSON(), containerId);
          if (containerId) context.operation.fromJSON(graphRef.current);
          return positions;
        } finally { applyingGraph.current = false; }
      },
      restore: () => {
        applyingGraph.current = true;
        try { context.operation.fromJSON(graphRef.current); lastInternal.current = JSON.stringify(context.document.toJSON()); }
        finally { applyingGraph.current = false; }
      },
    });
  }, [context, containerId, onRegisterLayout, lastInternal]);
  const fittedRequest = useRef(fitRequest ?? 0);
  useEffect(() => {
    if (!fitRequest || fitRequest === fittedRequest.current) return;
    fittedRequest.current = fitRequest;
    fitToDocument.current();
  }, [context, fitRequest]);

  useEffect(() => {
    if (!onRegisterViewport) return;
    return onRegisterViewport([...(containerId ? [] : ['__main__']), ...graph.nodes.map((node) => node.id)], () => {
      const viewport = context.playground.config.getViewport();
      return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
    });
  }, [context, graph.nodes, containerId, onRegisterViewport]);
  useEffect(() => {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const disposable = context.selection.onSelectionChanged((selection: SelectableEntity[]) => {
      const id = selectedWorkflowNodeId(selection, nodeIds);
      if (id?.endsWith('::entry')) return;
      onSelect(id);
    });
    return () => disposable.dispose();
  }, [context, graph.nodes, onSelect]);
  useEffect(() => {
    if (signature === lastInternal.current) return;
    // fromJSON emits intermediate content changes while old nodes still
    // exist. Those are synchronization events, not user edits: echoing them
    // into React resurrects deleted nodes and saves the wrong graph.
    applyingGraph.current = true;
    try {
      context.operation.fromJSON(graph);
      lastInternal.current = JSON.stringify(context.document.toJSON());
    } finally { applyingGraph.current = false; }
  }, [context, graph, signature, lastInternal]);
  useEffect(() => {
    const disposable = context.document.onContentChange(() => {
      if (applyingGraph.current) return;
      const json = context.document.toJSON();
      if (JSON.stringify(json) === lastInternal.current) return;
      lastInternal.current = JSON.stringify(json);
      const entry = containerId ? `${containerId}::entry` : undefined;
      const next = fromCanvas({ nodes: json.nodes.filter((item) => item.id !== entry), edges: json.edges?.filter((edge) => edge.sourceNodeID !== entry && edge.targetNodeID !== entry) }, graphRef.current);
      onChange(next.nodes, next.edges, entry ? json.edges?.find((edge) => edge.sourceNodeID === entry)?.targetNodeID : undefined);
    });
    return () => disposable.dispose();
  }, [context, lastInternal, onChange, containerId]);
  return null;
}

export function WorkflowCanvas({ nodes, edges, onChange, onSelect, onAddFromPort, activeNodeId, nodeLogs, onShowLogs, containerId, entryNodeId, onRegisterViewport, onRegisterLayout, fitRequest, onInteractionStart, onZoomChange }: CanvasProps) {
  const graph = useMemo(() => {
    const graph = toCanvas(nodes, edges, containerId);
    if (containerId) {
      const id = `${containerId}::entry`;
      graph.nodes.unshift({ id, type: 'entry', meta: { position: { x: 30, y: 65 }, size: { width: 44, height: 44 } }, data: {} });
      const root = entryNodeId ?? nodes.find((node) => !edges.some((edge) => edge.targetNodeId === node.id))?.id;
      if (root) graph.edges.push({ sourceNodeID: id, targetNodeID: root, sourcePortID: 'success' });
    }
    return graph;
  }, [nodes, edges, containerId, entryNodeId]);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const lastInternal = useRef('');
  const contextRef = useRef<FreeLayoutPluginContext>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const props = useMemo<FreeLayoutProps>(() => ({
    background: true,
    // FlowGram's mouse mode pans empty space and zooms around the wheel pointer.
    // `ineractiveType` is the spelling used by the installed FlowGram API.
    playground: { ineractiveType: 'MOUSE' },
    scroll: containerId ? { disableScrollBar: true } : undefined,
    initialData: graph,
    nodeRegistries,
    nodeEngine: { enable: true },
    history: { enable: true, enableChangeNode: true },
    twoWayConnection: false,
    canDeleteNode: (_context, node) => node.flowNodeType !== 'start' && node.flowNodeType !== 'entry',
    getNodeDefaultRegistry: (type) => ({ type, meta: { defaultExpanded: true }, formMeta: { render: () => <CanvasNodeForm /> } }),
    materials: { renderDefaultNode: CanvasNode },

  }), []);

  return (
    <div ref={surface} className={`workflow-canvas${containerId ? ' nested-canvas' : ''}`}
      onWheelCapture={event => {
        if (containerId || !(event.target instanceof Element) || !event.target.closest('.nested-canvas')) return;
        event.stopPropagation();
        // Route nested wheel input through the single outer zoom transform.
        contextRef.current?.playground.pipelineNode.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey }));
      }}
      onPointerDownCapture={event => { pointerStart.current = { x: event.clientX, y: event.clientY }; }}
      onPointerMoveCapture={event => { if (!event.buttons) { pointerStart.current = null; return; } const start = pointerStart.current; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) { pointerStart.current = null; onInteractionStart?.(); } }}
      onPointerUpCapture={() => { pointerStart.current = null; }} onPointerCancelCapture={() => { pointerStart.current = null; }}>
      {!containerId && <div className="canvas-interaction-hint">拖动空白处平移 · 滚轮缩放 · Shift + 拖动框选</div>}
      <GraphContext.Provider value={{ nodes, edges, onChange, onRegisterViewport, onRegisterLayout, fitRequest }}>
      <PortActionContext.Provider value={onAddFromPort}>
        <RunContext.Provider value={{ activeNodeId, nodeLogs, onShowLogs }}>
        <NodeSelectContext.Provider value={onSelect}>
          <FreeLayoutEditorProvider ref={contextRef} {...props}>
            <EditorRenderer className="workflow-editor" />
            <CanvasBridge graph={graph} lastInternal={lastInternal} onChange={onChange} onSelect={onSelect} containerId={containerId} onRegisterViewport={onRegisterViewport} onRegisterLayout={onRegisterLayout} fitRequest={fitRequest} surface={surface} onZoomChange={onZoomChange}/>
          </FreeLayoutEditorProvider>
        </NodeSelectContext.Provider>
        </RunContext.Provider>
      </PortActionContext.Provider>
      </GraphContext.Provider>
    </div>
  );
}
