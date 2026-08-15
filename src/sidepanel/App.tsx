import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import {
  createId, EVENT_LABELS, type ActionDefinition, type EventDefinition, type PageTarget,
  type RunResult, type ScriptDefinition, type WorkflowNode, type WorkspaceState,
} from '@/types/workflow';
import { EMPTY_WORKSPACE } from '@/shared/storage';
import './styles.css';

type Mode = 'run' | 'compose';

const eventOptions = Object.entries(EVENT_LABELS) as Array<[EventDefinition['type'], string]>;

async function send<T = RuntimeResponse>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function eventNeedsValue(type: EventDefinition['type']): boolean {
  return ['input', 'select', 'check', 'pressKey', 'custom'].includes(type);
}

function defaultNodeName(target: PageTarget): string {
  return target.label || `${target.tagName} 节点`;
}

function NodeCard({ node, index, actions, selected, onSelect, onChange, onDelete, onMove, onRun }: {
  node: WorkflowNode;
  index: number;
  actions: ActionDefinition[];
  selected: boolean;
  onSelect: () => void;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onRun: () => void;
}) {
  const kindLabel = { dom: '网页节点', ai: 'AI 节点', action: 'Action', wait: '等待' }[node.kind];
  const updateEvent = (patch: Partial<EventDefinition>) => {
    if (node.kind !== 'dom' && node.kind !== 'ai') return;
    onChange({ ...node, event: { ...node.event, ...patch } });
  };
  return (
    <article className={`node-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="node-index">{index + 1}</div>
      <div className="node-main">
        <div className="node-head">
          <span className={`kind kind-${node.kind}`}>{kindLabel}</span>
          <input className="node-name" value={node.name} onChange={(event) => onChange({ ...node, name: event.target.value })} />
          <button className="icon-btn run-node" title="运行此节点" onClick={(event) => { event.stopPropagation(); onRun(); }}>▶</button>
        </div>
        {node.kind === 'dom' && <div className="target-summary"><strong>{node.target.label}</strong><code title={node.target.selector}>{node.target.selector}</code></div>}
        {node.kind === 'ai' && (
          <>
            <textarea value={node.instruction} placeholder="例如：找到包含 {{客户名}} 的列表行，点击编辑按钮" onChange={(event) => onChange({ ...node, instruction: event.target.value })} />
            <input value={node.scopeSelector ?? ''} placeholder="查找范围 selector（可选）" onChange={(event) => onChange({ ...node, scopeSelector: event.target.value || undefined })} />
          </>
        )}
        {(node.kind === 'dom' || node.kind === 'ai') && (
          <div className="event-row">
            <select value={node.event.type} onChange={(event) => updateEvent({ type: event.target.value as EventDefinition['type'] })}>
              {eventOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            {eventNeedsValue(node.event.type) && <input value={node.event.value ?? ''} placeholder={node.event.type === 'input' ? '输入内容，支持 {{变量}}' : '值'} onChange={(event) => updateEvent({ value: event.target.value })} />}
            {node.event.type === 'custom' && <input value={node.event.customEvent ?? ''} placeholder="事件名，如 mouseleave" onChange={(event) => updateEvent({ customEvent: event.target.value })} />}
          </div>
        )}
        {node.kind === 'ai' && (
          <select value={node.actionId ?? ''} onChange={(event) => onChange({ ...node, actionId: event.target.value || undefined })}>
            <option value="">匹配后不调用 Action</option>
            {actions.map((action) => <option key={action.id} value={action.id}>匹配后：{action.name}</option>)}
          </select>
        )}
        {node.kind === 'action' && (
          <select value={node.actionId} onChange={(event) => onChange({ ...node, actionId: event.target.value })}>
            <option value="">请选择 Action</option>
            {actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
          </select>
        )}
        {node.kind === 'wait' && <div className="event-row"><input type="number" min="0" max="60000" value={node.durationMs} onChange={(event) => onChange({ ...node, durationMs: Number(event.target.value) })} /><span>毫秒</span></div>}
        <label className="continue"><input type="checkbox" checked={Boolean(node.continueOnError)} onChange={(event) => onChange({ ...node, continueOnError: event.target.checked })} />失败后继续</label>
      </div>
      <div className="node-actions">
        <button className="icon-btn" title="上移" onClick={(event) => { event.stopPropagation(); onMove(-1); }}>↑</button>
        <button className="icon-btn" title="下移" onClick={(event) => { event.stopPropagation(); onMove(1); }}>↓</button>
        <button className="icon-btn danger" title="删除" onClick={(event) => { event.stopPropagation(); onDelete(); }}>×</button>
      </div>
    </article>
  );
}

function RunView({ state, onRun, running, lastRun }: { state: WorkspaceState; onRun: (script: ScriptDefinition) => void; running: string | null; lastRun: RunResult | null }) {
  return (
    <section className="run-view">
      <div className="section-title"><div><h2>执行脚本</h2><p>已固化的流程无需再次分析页面</p></div><span>{state.scripts.length} 个</span></div>
      {state.scripts.length === 0 && <div className="empty"><div className="empty-icon">▷</div><strong>还没有 Script</strong><p>进入编排模式，跑通一个流程后保存为 Script。</p></div>}
      <div className="script-list">
        {state.scripts.map((script) => (
          <article className="script-card" key={script.id}>
            <div><strong>{script.name}</strong><p>{script.description || `${script.nodes.length} 个步骤`}</p>{script.urlPattern && <code>{script.urlPattern}</code>}</div>
            <button className="primary compact" disabled={Boolean(running)} onClick={() => onRun(script)}>{running === script.id ? '执行中…' : '运行'}</button>
          </article>
        ))}
      </div>
      {lastRun && <RunReport result={lastRun} />}
    </section>
  );
}

function RunReport({ result }: { result: RunResult }) {
  return <div className={`run-report ${result.ok ? 'success' : 'failed'}`}><strong>{result.ok ? '流程执行完成' : '流程执行失败'}</strong><span>{result.steps.filter((step) => step.ok).length}/{result.steps.length} 步成功</span>{result.error && <p>{result.error}</p>}</div>;
}

function App() {
  const [mode, setMode] = useState<Mode>('run');
  const [state, setState] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const [loaded, setLoaded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const saveTimer = useRef<number>();

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    void send<RuntimeResponse>({ type: 'PAGE_AGENT_GET_STATE' }).then((response) => {
      if (response.state) setState(response.state);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void send({ type: 'PAGE_AGENT_SET_STATE', state }); }, 180);
    return () => window.clearTimeout(saveTimer.current);
  }, [loaded, state]);

  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type === 'PAGE_AGENT_SELECTION') {
        const node: WorkflowNode = { id: createId('node'), kind: 'dom', name: defaultNodeName(message.target), target: message.target, event: { type: 'click' } };
        setState((current) => ({ ...current, draft: [...current.draft, node] }));
        setSelectedId(node.id);
        setSelecting(false);
        flash(`已记录：${message.target.label}`);
      }
      if (message.type === 'PAGE_AGENT_BRIDGE_STATUS') setBridgeConnected(message.connected);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [flash]);

  const addAi = () => {
    const node: WorkflowNode = { id: createId('ai'), kind: 'ai', name: 'AI 查找并操作', instruction: '', event: { type: 'click' } };
    setState({ ...state, draft: [...state.draft, node] }); setSelectedId(node.id);
  };
  const addWait = () => {
    const node: WorkflowNode = { id: createId('wait'), kind: 'wait', name: '等待页面响应', durationMs: 500 };
    setState({ ...state, draft: [...state.draft, node] }); setSelectedId(node.id);
  };
  const addAction = () => {
    const node: WorkflowNode = { id: createId('call'), kind: 'action', name: '调用 Action', actionId: state.actions[0]?.id ?? '' };
    setState({ ...state, draft: [...state.draft, node] }); setSelectedId(node.id);
  };
  const startSelect = async () => {
    const response = await send<RuntimeResponse>({ type: selecting ? 'PAGE_AGENT_STOP_SELECT' : 'PAGE_AGENT_START_SELECT' });
    if (!response.ok) return flash(response.error ?? '无法在当前网页启动选择工具');
    setSelecting(!selecting);
  };
  const updateNode = (node: WorkflowNode) => setState({ ...state, draft: state.draft.map((item) => item.id === node.id ? node : item) });
  const moveNode = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.draft.length) return;
    const draft = [...state.draft]; [draft[index], draft[nextIndex]] = [draft[nextIndex], draft[index]];
    setState({ ...state, draft });
  };
  const runDraft = async (nodes = state.draft) => {
    if (!nodes.length) return flash('请先添加节点');
    setRunning('draft'); setLastRun(null);
    const response = await send<RuntimeResponse>({ type: 'PAGE_AGENT_RUN_NODES', nodes });
    const result = response.result as RunResult;
    setRunning(null); setLastRun(result); flash(result.ok ? '流程运行成功' : result.error || '流程运行失败');
  };
  const runScriptDefinition = async (script: ScriptDefinition) => {
    setRunning(script.id); setLastRun(null);
    const response = await send<RuntimeResponse>({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: script.id });
    const result = response.result as RunResult;
    setRunning(null); setLastRun(result); flash(result.ok ? `${script.name} 执行完成` : result.error || '执行失败');
  };
  const saveAsAction = () => {
    if (!state.draft.length) return flash('当前流程没有节点');
    const name = window.prompt('Action 名称', '新 Action')?.trim();
    if (!name) return;
    const now = Date.now();
    const action: ActionDefinition = { id: createId('action'), name, nodes: structuredClone(state.draft), createdAt: now, updatedAt: now };
    setState({ ...state, actions: [...state.actions, action] }); flash(`已保存 Action：${name}`);
  };
  const saveAsScript = () => {
    if (!state.draft.length) return flash('当前流程没有节点');
    const name = window.prompt('Script 名称', '新 Script')?.trim();
    if (!name) return;
    const now = Date.now();
    const script: ScriptDefinition = { id: createId('script'), name, nodes: structuredClone(state.draft), createdAt: now, updatedAt: now };
    setState({ ...state, scripts: [...state.scripts, script] }); flash(`已保存 Script：${name}`);
  };

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand"><span className="logo">P</span><div><strong>Page Agent</strong><small>网页能力编排器</small></div></div>
        <div className={`bridge ${bridgeConnected ? 'online' : ''}`} title="本地 MCP Bridge 状态"><i />MCP</div>
      </header>
      <nav className="mode-tabs">
        <button className={mode === 'run' ? 'active' : ''} onClick={() => setMode('run')}>执行模式</button>
        <button className={mode === 'compose' ? 'active' : ''} onClick={() => setMode('compose')}>编排模式</button>
      </nav>
      <main>
        {mode === 'run' ? <RunView state={state} onRun={runScriptDefinition} running={running} lastRun={lastRun} /> : (
          <section className="compose-view">
            <div className="toolbox">
              <button className={`tool select-tool ${selecting ? 'active' : ''}`} onClick={startSelect}><span>⌖</span>{selecting ? '退出选择' : '选择网页节点'}</button>
              <button className="tool" onClick={addAi}><span>✦</span>AI 节点</button>
              <button className="tool" onClick={addWait}><span>◷</span>等待</button>
              <button className="tool" disabled={!state.actions.length} onClick={addAction}><span>↗</span>调用 Action</button>
            </div>
            {selecting && <div className="select-hint"><strong>选择工具已开启</strong><span>网页事件已暂停；移动鼠标查看节点，点击选中，Esc 退出。</span></div>}
            <div className="flow-head"><div><h2>当前流程</h2><span>{state.draft.length} 个节点</span></div>{state.draft.length > 0 && <button className="text-btn danger" onClick={() => { if (window.confirm('清空当前流程？')) setState({ ...state, draft: [] }); }}>清空</button>}</div>
            {state.draft.length === 0 && <div className="empty compose-empty"><div className="empty-icon">⌖</div><strong>从网页上选择第一个节点</strong><p>也可以添加 AI 节点，处理动态列表和变化的 DOM。</p></div>}
            <div className="flow-list">
              {state.draft.map((node, index) => (
                <NodeCard key={node.id} node={node} index={index} actions={state.actions} selected={selectedId === node.id} onSelect={() => setSelectedId(node.id)}
                  onChange={updateNode} onDelete={() => setState({ ...state, draft: state.draft.filter((item) => item.id !== node.id) })}
                  onMove={(direction) => moveNode(index, direction)} onRun={() => void runDraft([node])} />
              ))}
            </div>
            {lastRun && <RunReport result={lastRun} />}
          </section>
        )}
      </main>
      {mode === 'compose' && <footer className="compose-footer"><button className="secondary" onClick={saveAsAction}>保存为 Action</button><button className="secondary" onClick={saveAsScript}>保存 Script</button><button className="primary" disabled={Boolean(running) || !state.draft.length} onClick={() => void runDraft()}>{running === 'draft' ? '运行中…' : '▶ 运行流程'}</button></footer>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
