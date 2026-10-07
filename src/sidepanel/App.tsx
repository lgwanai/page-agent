import 'reflect-metadata';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import type { AiProviderConfig } from '@/types/provider';
import {
  createId, createStartNode, defaultEventForTarget, type ActionDefinition, type AiInputBinding, type PageTarget, type RunResult,
  type ScriptDefinition, type WorkflowEdge, type WorkflowNode, type WorkspaceState,
} from '@/types/workflow';
import { EMPTY_WORKSPACE } from '@/shared/storage';
import { WorkflowCanvas } from './WorkflowCanvas';
import { NodeInspector } from './NodeInspector';
import { ProviderSettings } from './ProviderSettings';
import './styles.css';

type Mode = 'run' | 'compose';
type SelectPurpose = { kind: 'node'; source?: { nodeId: string; port: WorkflowEdge['sourcePort'] } } | { kind: 'ai-input'; nodeId: string };
type EditingDefinition = { type: 'action' | 'script'; id: string; name: string };
type CreatableNodeKind = 'dom' | 'ai' | 'loop' | 'wait';
type PortMenu = { nodeId: string; port: WorkflowEdge['sourcePort']; x: number; y: number };

async function send<T = RuntimeResponse>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function RunReport({ result }: { result: RunResult }) {
  return <div className={`run-report ${result.ok ? 'success' : 'failed'}`}><strong>{result.ok ? '流程执行完成' : '流程执行失败'}</strong><span>{result.steps.filter((step) => step.ok).length}/{result.steps.length} 步成功</span>{result.error && <p>{result.error}</p>}<ul className="run-steps">{result.steps.map((step, index) => <li key={`${step.nodeId}_${index}`} className={step.ok ? 'ok' : 'bad'}><i>{step.ok ? '✓' : '!'}</i><span>{step.message}</span><small>{step.outputPort === 'failure' ? '失败出口' : step.outputPort === 'success' ? '成功出口' : step.outputPort}</small></li>)}</ul></div>;
}

function RunView({ state, onRun, running, lastRun }: { state: WorkspaceState; onRun: (script: ScriptDefinition) => void; running: string | null; lastRun: RunResult | null }) {
  return <section className="run-view">
    <div className="section-title"><div><h2>执行脚本</h2><p>直接运行已验证流程，不再抓取整页 DOM</p></div><span>{state.scripts.length} 个</span></div>
    {!state.scripts.length && <div className="empty"><div className="empty-icon">▷</div><strong>还没有 Script</strong><p>进入编排模式，在画布中连通流程后保存为 Script。</p></div>}
    <div className="script-list">{state.scripts.map((script) => <article className="script-card" key={script.id}><div><strong>{script.name}</strong><p>{script.description || `${script.nodes.length} 个节点 · ${script.edges.length} 条连线`}</p></div><button className="primary compact" disabled={Boolean(running)} onClick={() => onRun(script)}>{running === script.id ? '执行中…' : '运行'}</button></article>)}</div>
    {lastRun && <RunReport result={lastRun} />}
  </section>;
}

function uniqueName(nodes: WorkflowNode[], seed: string): string {
  const base = seed.replace(/\s+/g, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24) || '网页节点';
  let name = base;
  let index = 2;
  while (nodes.some((node) => node.name === name)) name = `${base}_${index++}`;
  return name;
}

function App() {
  const [mode, setMode] = useState<Mode>('run');
  const [state, setState] = useState<WorkspaceState>(() => ({ ...EMPTY_WORKSPACE, draft: [createStartNode()] }));
  const [selectPurpose, setSelectPurpose] = useState<SelectPurpose | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingDefinition | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const [portMenu, setPortMenu] = useState<PortMenu | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    void Promise.all([
      send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_STATE' }),
      send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_PROVIDER' }),
    ]).then(([workspace, provider]) => {
      if (workspace.state) setState((current) => ({ ...current, actions: workspace.state!.actions, scripts: workspace.state!.scripts }));
      if (provider.result) setProviderConfigured((provider.result as AiProviderConfig).configured);
    });
  }, []);

  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type === 'PAGE_AGENT_BRIDGE_STATUS') setBridgeConnected(message.connected);
      if (message.type !== 'PAGE_AGENT_SELECTION') return;
      const target = message.target;
      const name = uniqueName(state.draft, target.label || target.tagName);
      const namedTarget: PageTarget = { ...target, name };
      if (selectPurpose?.kind === 'ai-input') {
        const input: AiInputBinding = { id: createId('input'), name, type: 'selector', target: namedTarget, attribute: 'text' };
        setState((current) => ({ ...current, draft: current.draft.map((node) => node.id === selectPurpose.nodeId && node.kind === 'ai' ? { ...node, inputs: [...node.inputs, input] } : node) }));
        setSelectedId(selectPurpose.nodeId);
        notify(`已添加 AI 输入：${name} · ${target.tagName}`);
      } else {
        const source = selectPurpose?.kind === 'node' ? selectPurpose.source : undefined;
        const sourceNode = source ? state.draft.find((item) => item.id === source.nodeId) : undefined;
        const offsetY = source?.port === 'failure' ? 150 : source?.port === 'done' ? 130 : source?.port === 'body' ? -30 : 0;
        const node: WorkflowNode = {
          id: createId('node'),
          kind: 'dom',
          name,
          target: namedTarget,
          event: defaultEventForTarget(namedTarget),
          position: sourceNode
            ? { x: (sourceNode.position?.x ?? 80) + 300, y: (sourceNode.position?.y ?? 80) + offsetY }
            : { x: 80 + state.draft.length * 50, y: 80 + state.draft.length * 30 },
        };
        setState((current) => ({
          ...current,
          draft: [...current.draft, node],
          draftEdges: source && current.draft.some((item) => item.id === source.nodeId)
            ? [...current.draftEdges, { id: createId('edge'), sourceNodeId: source.nodeId, targetNodeId: node.id, sourcePort: source.port }]
            : current.draftEdges,
        }));
        setSelectedId(node.id);
        notify(source ? `已创建并连接 Selector：${name}` : `已记录 Selector：${name}`);
      }
      setSelectPurpose(null);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [notify, selectPurpose, state.draft]);

  useEffect(() => {
    if (!portMenu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPortMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [portMenu]);

  const startSelector = async (purpose: SelectPurpose) => {
    if (selectPurpose) {
      await send({ type: 'PAGE_AGENT_STOP_SELECT' });
      setSelectPurpose(null);
      return;
    }
    const response = await send<RuntimeResponse>({ type: 'PAGE_AGENT_START_SELECT' });
    if (!response.ok) return notify(response.error ?? '无法启动 Selector');
    setSelectPurpose(purpose);
  };

  const addFromPort = (nodeId: string, port: WorkflowEdge['sourcePort'], point: { x: number; y: number }) => {
    const existing = state.draftEdges.find((edge) => edge.sourceNodeId === nodeId && edge.sourcePort === port);
    if (existing) {
      setSelectedId(existing.targetNodeId);
      notify('这个路径已经连接了后续节点');
      return;
    }
    if (selectPurpose) {
      void send({ type: 'PAGE_AGENT_STOP_SELECT' });
      setSelectPurpose(null);
    }
    setPortMenu({ nodeId, port, x: point.x, y: point.y });
  };

  const addNode = (kind: Exclude<CreatableNodeKind, 'dom'>, source?: { nodeId: string; port: WorkflowEdge['sourcePort'] }) => {
    const id = createId(kind);
    setState((current) => {
      const sourceNode = source ? current.draft.find((item) => item.id === source.nodeId) : undefined;
      const offsetY = source?.port === 'failure' ? 150 : source?.port === 'done' ? 130 : source?.port === 'body' ? -30 : 0;
      const position = sourceNode
        ? { x: (sourceNode.position?.x ?? 80) + 300, y: (sourceNode.position?.y ?? 80) + offsetY }
        : { x: 80 + (current.draft.length % 3) * 280, y: 80 + Math.floor(current.draft.length / 3) * 180 };
      const name = uniqueName(current.draft, { ai: 'AI节点', wait: '等待', loop: '循环' }[kind]);
      let node: WorkflowNode;
      if (kind === 'ai') node = { id, kind, name, instruction: '', inputs: [], event: { type: 'click' }, position };
      else if (kind === 'loop') node = { id, kind, name, items: '', itemVariable: 'item', indexVariable: 'index', maxIterations: 100, position };
      else node = { id, kind, name, durationMs: 500, position };
      const edge = source && sourceNode
        ? { id: createId('edge'), sourceNodeId: source.nodeId, targetNodeId: id, sourcePort: source.port }
        : null;
      return { ...current, draft: [...current.draft, node], draftEdges: edge ? [...current.draftEdges, edge] : current.draftEdges };
    });
    setSelectedId(id);
  };

  const choosePortNode = (kind: CreatableNodeKind) => {
    if (!portMenu) return;
    const source = { nodeId: portMenu.nodeId, port: portMenu.port };
    setPortMenu(null);
    if (kind === 'dom') void startSelector({ kind: 'node', source });
    else addNode(kind, source);
  };

  const updateGraph = useCallback((nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
    setState((current) => ({ ...current, draft: nodes, draftEdges: edges }));
  }, []);
  const updateNode = (node: WorkflowNode) => setState({ ...state, draft: state.draft.map((item) => item.id === node.id ? node : item) });
  const deleteNode = () => {
    if (!selectedId) return;
    if (state.draft.find((node) => node.id === selectedId)?.kind === 'start') return notify('Start 是流程入口，不能删除');
    setState({ ...state, draft: state.draft.filter((node) => node.id !== selectedId), draftEdges: state.draftEdges.filter((edge) => edge.sourceNodeId !== selectedId && edge.targetNodeId !== selectedId) });
    setSelectedId(null);
  };

  const runGraph = async (nodes = state.draft, edges = state.draftEdges, id = 'draft') => {
    if (!nodes.length) return notify('画布中还没有节点');
    setRunning(id); setLastRun(null);
    const response = await send<RuntimeResponse>({ type: 'PAGE_AGENT_RUN_GRAPH', nodes, edges });
    const result = response.result as RunResult;
    setRunning(null); setLastRun(result);
    notify(result.ok ? '流程运行成功' : result.error || '流程运行失败');
  };
  const runScript = async (script: ScriptDefinition) => {
    setRunning(script.id); setLastRun(null);
    const response = await send<RuntimeResponse>({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: script.id });
    const result = response.result as RunResult;
    setRunning(null); setLastRun(result); notify(result.ok ? `${script.name} 执行完成` : result.error || '执行失败');
  };
  const persistLibrary = (next: WorkspaceState) => {
    setState(next);
    void send<RuntimeResponse>({ type: 'PAGE_AGENT_SET_STATE', state: { ...next, draft: [], draftEdges: [] } })
      .then((response) => { if (!response.ok) notify(response.error ?? '保存失败'); });
  };
  const newDraft = () => {
    if (selectPurpose) void send({ type: 'PAGE_AGENT_STOP_SELECT' });
    setState((current) => ({ ...current, draft: [createStartNode()], draftEdges: [] }));
    setSelectPurpose(null);
    setPortMenu(null);
    setSelectedId(null);
    setEditing(null);
    setLastRun(null);
    notify('已新建流程，未保存内容不会持久化');
  };
  const openDefinition = (definition: ActionDefinition | ScriptDefinition, type: EditingDefinition['type']) => {
    setState((current) => ({ ...current, draft: structuredClone(definition.nodes), draftEdges: structuredClone(definition.edges) }));
    setEditing({ type, id: definition.id, name: definition.name });
    setSelectedId(null);
    setLastRun(null);
    setShowLibrary(false);
    setMode('compose');
    notify(`已打开${type === 'action' ? ' Action' : ' Script'}：${definition.name}`);
  };
  const saveDefinition = (type: 'action' | 'script') => {
    if (!state.draft.length) return notify('画布中还没有节点');
    const label = type === 'action' ? 'Action' : 'Script';
    const now = Date.now();
    if (editing?.type === type) {
      const next = type === 'action'
        ? { ...state, actions: state.actions.map((item) => item.id === editing.id ? { ...item, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), updatedAt: now } : item) }
        : { ...state, scripts: state.scripts.map((item) => item.id === editing.id ? { ...item, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), updatedAt: now } : item) };
      persistLibrary(next);
      notify(`已更新 ${label}：${editing.name}`);
      return;
    }
    const name = window.prompt(`${label} 名称`, `新 ${label}`)?.trim();
    if (!name) return;
    if (type === 'action') {
      const action: ActionDefinition = { id: createId('action'), name, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), createdAt: now, updatedAt: now };
      persistLibrary({ ...state, actions: [...state.actions, action] });
      setEditing({ type, id: action.id, name });
    } else {
      const script: ScriptDefinition = { id: createId('script'), name, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), createdAt: now, updatedAt: now };
      persistLibrary({ ...state, scripts: [...state.scripts, script] });
      setEditing({ type, id: script.id, name });
    }
    notify(`已保存 ${label}：${name}`);
  };

  const selectedNode = state.draft.find((node) => node.id === selectedId);
  return <div className="app">
    <header className="app-head"><div className="brand"><span className="logo">P</span><div><strong>Page Agent</strong><small>网页能力编排器</small></div></div><div className="head-actions"><button className={`provider-chip ${providerConfigured ? 'online' : ''}`} onClick={() => setShowProvider(true)}><i />{providerConfigured ? 'AI 已配置' : '配置 AI'}</button><div className={`bridge ${bridgeConnected ? 'online' : ''}`}><i />MCP</div></div></header>
    <nav className="mode-tabs"><button className={mode === 'run' ? 'active' : ''} onClick={() => { setMode('run'); setPortMenu(null); }}>执行模式</button><button className={mode === 'compose' ? 'active' : ''} onClick={() => setMode('compose')}>画布编排</button></nav>
    <main className={mode === 'compose' ? 'compose-main' : ''}>
      {mode === 'run' ? <RunView state={state} onRun={runScript} running={running} lastRun={lastRun} /> : <section className="compose-view">
        <div className="compose-document-bar"><div><strong>{editing?.name ?? '未命名流程'}</strong><span>{editing ? `正在编辑 ${editing.type === 'action' ? 'Action' : 'Script'}` : '新建 · 尚未保存'}</span></div><div><button className="secondary compact" onClick={newDraft}>新建</button><button className="secondary compact" onClick={() => setShowLibrary(true)}>打开</button></div></div>
        <div className="canvas-toolbar"><button className={`tool select-tool ${selectPurpose?.kind === 'node' ? 'active' : ''}`} onClick={() => void startSelector({ kind: 'node' })}><span>⌖</span>{selectPurpose ? '退出选择' : 'Selector'}</button><button className="tool" onClick={() => addNode('ai')}><span>✦</span>AI</button><button className="tool" onClick={() => addNode('loop')}><span>↻</span>循环</button><button className="tool" onClick={() => addNode('wait')}><span>◷</span>等待</button></div>
        {selectPurpose && <div className="select-hint"><strong>Selector 已开启</strong><span>{selectPurpose.kind === 'ai-input' ? '在网页中选择一个元素作为 AI 输入。' : '页面事件已暂停；点击元素创建具名网页节点。'}</span></div>}
        <div className={`canvas-layout${selectedNode ? ' has-selection' : ''}`}><WorkflowCanvas nodes={state.draft} edges={state.draftEdges} onChange={updateGraph} onSelect={setSelectedId} onAddFromPort={addFromPort} /><NodeInspector node={selectedNode} nodes={state.draft} actions={state.actions} onChange={updateNode} onDelete={deleteNode} onRun={() => selectedNode && void runGraph([selectedNode], [], selectedNode.id)} onClose={() => setSelectedId(null)} onPickAiSelector={() => selectedNode && void startSelector({ kind: 'ai-input', nodeId: selectedNode.id })} notify={notify} /></div>
        {lastRun && <RunReport result={lastRun} />}
      </section>}
    </main>
    {mode === 'compose' && <footer className="compose-footer"><button className="secondary" onClick={() => saveDefinition('action')}>{editing?.type === 'action' ? '更新 Action' : '保存 Action'}</button><button className="secondary" onClick={() => saveDefinition('script')}>{editing?.type === 'script' ? '更新 Script' : '保存 Script'}</button><button className="primary" disabled={Boolean(running) || !state.draft.length} onClick={() => void runGraph()}>{running === 'draft' ? '运行中…' : '▶ 运行画布'}</button></footer>}
    {showLibrary && <div className="library-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowLibrary(false); }}><section className="library-panel"><div className="library-head"><div><strong>打开已保存流程</strong><span>选择后才会载入编辑画布</span></div><button className="icon-btn" onClick={() => setShowLibrary(false)}>×</button></div><div className="library-group"><strong>Scripts</strong>{state.scripts.length ? state.scripts.map((script) => <button key={script.id} onClick={() => openDefinition(script, 'script')}><span>{script.name}</span><small>{script.nodes.length} 个节点</small></button>) : <p>暂无 Script</p>}</div><div className="library-group"><strong>Actions</strong>{state.actions.length ? state.actions.map((action) => <button key={action.id} onClick={() => openDefinition(action, 'action')}><span>{action.name}</span><small>{action.nodes.length} 个节点</small></button>) : <p>暂无 Action</p>}</div></section></div>}
    {showProvider && <ProviderSettings onClose={() => { setShowProvider(false); void send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_PROVIDER' }).then((response) => setProviderConfigured(Boolean((response.result as AiProviderConfig | undefined)?.configured))); }} notify={notify} />}
    {portMenu && <div className="node-picker-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setPortMenu(null); }}><section className="node-picker" style={{ left: Math.max(8, Math.min(portMenu.x + 12, window.innerWidth - 196)), top: Math.max(8, Math.min(portMenu.y - 42, window.innerHeight - 166)) }}><div><strong>添加后续节点</strong><small>{portMenu.port === 'failure' ? '失败路径' : portMenu.port === 'body' ? '遍历路径' : portMenu.port === 'done' ? '完成路径' : '成功路径'}</small></div><div className="node-picker-grid"><button onClick={() => choosePortNode('dom')}><i>⌖</i><span>Selector</span></button><button onClick={() => choosePortNode('ai')}><i>✦</i><span>AI</span></button><button onClick={() => choosePortNode('loop')}><i>↻</i><span>循环</span></button><button onClick={() => choosePortNode('wait')}><i>◷</i><span>等待</span></button></div></section></div>}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
