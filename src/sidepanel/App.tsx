import 'reflect-metadata';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import type { AiProviderConfig } from '@/types/provider';
import {
  createId, type ActionDefinition, type AiInputBinding, type PageTarget, type RunResult,
  type ScriptDefinition, type WorkflowEdge, type WorkflowNode, type WorkspaceState,
} from '@/types/workflow';
import { EMPTY_WORKSPACE } from '@/shared/storage';
import { WorkflowCanvas } from './WorkflowCanvas';
import { NodeInspector } from './NodeInspector';
import { ProviderSettings } from './ProviderSettings';
import './styles.css';

type Mode = 'run' | 'compose';
type SelectPurpose = { kind: 'node' } | { kind: 'ai-input'; nodeId: string };

async function send<T = RuntimeResponse>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function RunReport({ result }: { result: RunResult }) {
  return <div className={`run-report ${result.ok ? 'success' : 'failed'}`}><strong>{result.ok ? '流程执行完成' : '流程执行失败'}</strong><span>{result.steps.filter((step) => step.ok).length}/{result.steps.length} 步成功</span>{result.error && <p>{result.error}</p>}</div>;
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
  const [state, setState] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const [loaded, setLoaded] = useState(false);
  const [selectPurpose, setSelectPurpose] = useState<SelectPurpose | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [showProvider, setShowProvider] = useState(false);
  const saveTimer = useRef<number>();

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    void Promise.all([
      send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_STATE' }),
      send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_PROVIDER' }),
    ]).then(([workspace, provider]) => {
      if (workspace.state) setState(workspace.state);
      if (provider.result) setProviderConfigured((provider.result as AiProviderConfig).configured);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void send({ type: 'PAGE_AGENT_SET_STATE', state }); }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [loaded, state]);

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
        const node: WorkflowNode = { id: createId('node'), kind: 'dom', name, target: namedTarget, event: { type: 'click' }, position: { x: 80 + state.draft.length * 50, y: 80 + state.draft.length * 30 } };
        setState((current) => ({ ...current, draft: [...current.draft, node] }));
        setSelectedId(node.id);
        notify(`已记录 Selector：${name}`);
      }
      setSelectPurpose(null);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [notify, selectPurpose, state.draft]);

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

  const addNode = (kind: WorkflowNode['kind']) => {
    const position = { x: 80 + (state.draft.length % 3) * 280, y: 80 + Math.floor(state.draft.length / 3) * 180 };
    const name = uniqueName(state.draft, { ai: 'AI判断', action: '调用Action', wait: '等待', loop: '循环', dom: '网页节点' }[kind]);
    let node: WorkflowNode;
    if (kind === 'ai') node = { id: createId('ai'), kind, name, instruction: '', inputs: [], event: { type: 'click' }, position };
    else if (kind === 'loop') node = { id: createId('loop'), kind, name, items: '', itemVariable: 'item', indexVariable: 'index', maxIterations: 100, position };
    else if (kind === 'wait') node = { id: createId('wait'), kind, name, durationMs: 500, position };
    else if (kind === 'action') node = { id: createId('action-node'), kind, name, actionId: state.actions[0]?.id ?? '', position };
    else return;
    setState({ ...state, draft: [...state.draft, node] });
    setSelectedId(node.id);
  };

  const updateGraph = useCallback((nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
    setState((current) => ({ ...current, draft: nodes, draftEdges: edges }));
  }, []);
  const updateNode = (node: WorkflowNode) => setState({ ...state, draft: state.draft.map((item) => item.id === node.id ? node : item) });
  const deleteNode = () => {
    if (!selectedId) return;
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
  const saveDefinition = (type: 'action' | 'script') => {
    if (!state.draft.length) return notify('画布中还没有节点');
    const label = type === 'action' ? 'Action' : 'Script';
    const name = window.prompt(`${label} 名称`, `新 ${label}`)?.trim();
    if (!name) return;
    const now = Date.now();
    if (type === 'action') {
      const action: ActionDefinition = { id: createId('action'), name, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), createdAt: now, updatedAt: now };
      setState({ ...state, actions: [...state.actions, action] });
    } else {
      const script: ScriptDefinition = { id: createId('script'), name, nodes: structuredClone(state.draft), edges: structuredClone(state.draftEdges), createdAt: now, updatedAt: now };
      setState({ ...state, scripts: [...state.scripts, script] });
    }
    notify(`已保存 ${label}：${name}`);
  };

  const selectedNode = state.draft.find((node) => node.id === selectedId);
  return <div className="app">
    <header className="app-head"><div className="brand"><span className="logo">P</span><div><strong>Page Agent</strong><small>网页能力编排器</small></div></div><div className="head-actions"><button className={`provider-chip ${providerConfigured ? 'online' : ''}`} onClick={() => setShowProvider(true)}><i />{providerConfigured ? 'AI 已配置' : '配置 AI'}</button><div className={`bridge ${bridgeConnected ? 'online' : ''}`}><i />MCP</div></div></header>
    <nav className="mode-tabs"><button className={mode === 'run' ? 'active' : ''} onClick={() => setMode('run')}>执行模式</button><button className={mode === 'compose' ? 'active' : ''} onClick={() => setMode('compose')}>画布编排</button></nav>
    <main className={mode === 'compose' ? 'compose-main' : ''}>
      {mode === 'run' ? <RunView state={state} onRun={runScript} running={running} lastRun={lastRun} /> : <section className="compose-view">
        <div className="canvas-toolbar"><button className={`tool select-tool ${selectPurpose?.kind === 'node' ? 'active' : ''}`} onClick={() => void startSelector({ kind: 'node' })}><span>⌖</span>{selectPurpose ? '退出选择' : 'Selector'}</button><button className="tool" onClick={() => addNode('ai')}><span>✦</span>AI</button><button className="tool" onClick={() => addNode('loop')}><span>↻</span>循环</button><button className="tool" onClick={() => addNode('wait')}><span>◷</span>等待</button><button className="tool" disabled={!state.actions.length} onClick={() => addNode('action')}><span>↗</span>Action</button></div>
        {selectPurpose && <div className="select-hint"><strong>Selector 已开启</strong><span>{selectPurpose.kind === 'ai-input' ? '在网页中选择一个元素作为 AI 输入。' : '页面事件已暂停；点击元素创建具名网页节点。'}</span></div>}
        <div className="canvas-layout"><WorkflowCanvas nodes={state.draft} edges={state.draftEdges} onChange={updateGraph} onSelect={setSelectedId} /><NodeInspector node={selectedNode} nodes={state.draft} actions={state.actions} onChange={updateNode} onDelete={deleteNode} onRun={() => selectedNode && void runGraph([selectedNode], [], selectedNode.id)} onPickAiSelector={() => selectedNode && void startSelector({ kind: 'ai-input', nodeId: selectedNode.id })} notify={notify} /></div>
        {lastRun && <RunReport result={lastRun} />}
      </section>}
    </main>
    {mode === 'compose' && <footer className="compose-footer"><button className="secondary" onClick={() => saveDefinition('action')}>保存 Action</button><button className="secondary" onClick={() => saveDefinition('script')}>保存 Script</button><button className="primary" disabled={Boolean(running) || !state.draft.length} onClick={() => void runGraph()}>{running === 'draft' ? '运行中…' : '▶ 运行画布'}</button></footer>}
    {showProvider && <ProviderSettings onClose={() => { setShowProvider(false); void send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_PROVIDER' }).then((response) => setProviderConfigured(Boolean((response.result as AiProviderConfig | undefined)?.configured))); }} notify={notify} />}
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
