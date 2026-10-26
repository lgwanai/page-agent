// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@/types/messages';
import { createStartNode, type ScriptDefinition, type StepResult, type WorkflowEdge, type WorkflowNode, type WorkspaceState } from '@/types/workflow';
import { EMPTY_WORKSPACE } from '@/shared/storage';
import { exportWorkflow } from '@/shared/workflow-file';
import { ensureWorkflowKey } from '@/shared/workflow-key-client';
import { App } from './App';
import type { CanvasLayoutControls } from './canvas-layout';

type CanvasProps = {
  onZoomChange?: (zoom: number) => void;
  onRegisterLayout?: (scope: string, controls: CanvasLayoutControls) => () => void;
  onInteractionStart?: () => void;
  onRegisterViewport?: (ids:string[],getter:()=>{x:number;y:number})=>()=>void;
  onAddFromPort: (nodeId: string, port: WorkflowEdge['sourcePort'], point: { x: number; y: number }) => void;
  activeNodeId?: string | null;
  nodeLogs?: Record<string, StepResult[]>;
  onShowLogs?: (id: string) => void;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  onChange: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  onSelect: (id: string | null) => void;
};
let canvasProps: CanvasProps;
vi.mock('./WorkflowCanvas', () => ({
  WorkflowCanvas: (props: CanvasProps) => {
    canvasProps = props;
    return <div data-testid="canvas">{props.nodes.map((node) => <button key={node.id} onClick={() => props.onSelect(node.id)}>{node.name}</button>)}</div>;
  },
}));
vi.mock('./NodeInspector', () => ({
  NodeInspector: ({ node, onChange, onClose, onDelete, onRun }: { node?: WorkflowNode; onChange: (node: WorkflowNode) => void; onClose: () => void; onDelete: () => void; onRun: () => void }) => node
    ? <aside data-testid="inspector"><strong>{node.name}</strong><button onClick={() => onChange({ ...node, name: '已修改' })}>修改节点</button><button onClick={onDelete}>删除节点</button><button onClick={onRun}>单节点运行</button><button onClick={onClose}>关闭属性</button></aside>
    : null,
}));
vi.mock('./ProviderSettings', () => ({ ProviderSettings: () => <div>AI 配置</div> }));
vi.mock('./McpSettings', () => ({ McpSettings: ({ instanceId }: { instanceId: string }) => <div>MCP 配置 · {instanceId}</div> }));
vi.mock('@/shared/workflow-key-client', () => ({ ensureWorkflowKey: vi.fn().mockResolvedValue('local-key'), rotateWorkflowKey: vi.fn().mockResolvedValue('import-key') }));

let root: Root;
let container: HTMLDivElement;
let listeners: Array<(message: RuntimeMessage) => void>;
let workspace: WorkspaceState;
let localValues: Record<string, unknown>;
const send = vi.fn();

function workflow(id: string, name: string): ScriptDefinition {
  return { id, name, nodes: [createStartNode(`${id}-start`)], edges: [], createdAt: 1, updatedAt: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureWorkflowKey).mockResolvedValue('local-key');
  workspace = structuredClone(EMPTY_WORKSPACE);
  localValues = {};
  listeners = [];
  send.mockImplementation(async (message: RuntimeMessage) => {
    switch (message.type) {
      case 'PAGE_AGENT_GET_STATE': return { ok: true, state: workspace };
      case 'PAGE_AGENT_GET_PROVIDER': return { ok: true, result: { configured: false } };
      case 'PAGE_AGENT_GET_RECORDING': return { ok: true, result: { active: false, eventCount: 0 } };
      case 'PAGE_AGENT_GET_INSTANCE': return { ok: true, result: { instanceId: 'instance-A', connected: false } };
      case 'PAGE_AGENT_SET_STATE': workspace = structuredClone(message.state); return { ok: true };
      case 'PAGE_AGENT_DELETE_WORKFLOW': {
        const workflow = workspace.scripts.find(item => item.id === message.workflowId);
        if (!workflow || workflow.updatedAt !== message.expectedUpdatedAt) return { ok: false, error: '工作流已被其他客户端更新，请刷新后重新删除' };
        workspace.scripts = workspace.scripts.filter(item => item.id !== message.workflowId);
        return { ok: true };
      }
      case 'PAGE_AGENT_RENAME_WORKFLOW': {
        const workflow = workspace.scripts.find(item => item.id === message.workflowId);
        if (!workflow || workflow.updatedAt !== message.expectedUpdatedAt) return { ok: false, error: '工作流已被其他客户端更新，请刷新后重新命名' };
        workflow.name = message.name; workflow.updatedAt++;
        return { ok: true, result: structuredClone(workflow) };
      }
      case 'PAGE_AGENT_RUN_SCRIPT': return { ok: true, result: { ok: true, steps: [] } };
      default: return { ok: true };
    }
  });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: localValues[key] })),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(localValues, data); }),
  } }, runtime: { getManifest: () => ({ version: '0.10.3' }), sendMessage: send, onMessage: {
    addListener: (listener: (message: RuntimeMessage) => void) => listeners.push(listener),
    removeListener: (listener: (message: RuntimeMessage) => void) => { listeners = listeners.filter((item) => item !== listener); },
  } } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'prompt').mockReturnValue('新工作流');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<App />));
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === text) ?? [...container.querySelectorAll('button')].find(item => item.textContent === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(text: string) {
  if (['修改节点', '删除节点', '单节点运行'].includes(text) && !container.querySelector('[data-testid="inspector"]')) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="展开节点属性"]')!.click());
  if (['表格填充', '循环', '等待', '日历选择器', '请求'].includes(text) && !container.querySelector('.node-picker-grid')) await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="新增节点"]')!.click());
  if (['删除工作流', '编辑', '重命名', '复制运行 Prompt', '复制密钥', '导出'].includes(text) && !container.querySelector('[role="menu"]')) await act(async () => container.querySelector<HTMLButtonElement>('.more')!.click());
  await act(async () => button(text.replace('＋ ', '')).click());
}
async function emit(message: RuntimeMessage) { await act(async () => listeners.forEach((listener) => listener(message))); }
function canvas() { return container.querySelector('[data-testid="canvas"]'); }
async function renameInput(name: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="工作流名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('renames from the overflow menu, retains the ID/key and persists after reopening the panel', async () => {
  workspace.scripts = [workflow('rename-id', '旧名称')];
  await render(); await click('重命名'); await renameInput('  新名称  '); await click('确认重命名');
  expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_RENAME_WORKFLOW', workflowId: 'rename-id', name: '新名称', expectedUpdatedAt: 1 });
  expect(workspace.scripts[0]).toMatchObject({ id: 'rename-id', name: '新名称' });
  expect(ensureWorkflowKey).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-labelledby="rename-workflow-title"]')).toBeNull();
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.querySelector('.workflow-name')?.textContent).toBe('新名称');
});
it('allows cancelling and blocks whitespace-only rename without any write', async () => {
  workspace.scripts = [workflow('rename-id', '原名')];
  await render(); await click('重命名'); await renameInput('   ');
  expect(button('确认重命名').disabled).toBe(true);
  await click('取消');
  expect(send.mock.calls.some(([message]) => message.type === 'PAGE_AGENT_RENAME_WORKFLOW')).toBe(false);
});
it('renames from the editor without clearing unsaved graph changes, then saves with the new title', async () => {
  workspace.scripts = [workflow('rename-id', '原名')];
  await render(); await click('编辑');
  await act(async () => canvasProps.onSelect(canvasProps.nodes[0].id)); await click('修改节点');
  const graph = structuredClone(canvasProps.nodes);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="重命名工作流"]')!.click());
  await renameInput('编辑中改名'); await click('确认重命名');
  expect(canvasProps.nodes).toEqual(graph);
  expect(container.querySelector('.document-title strong')?.textContent).toBe('编辑中改名');
  expect(container.querySelector('.document-title span')?.textContent).toBe('尚未保存');
  await click('更新工作流');
  expect(workspace.scripts[0].name).toBe('编辑中改名');
  expect(workspace.scripts[0].nodes).toEqual(graph);
});
it('keeps the rename dialog and reports a revision conflict instead of overwriting remote edits', async () => {
  workspace.scripts = [workflow('rename-id', '原名')]; await render(); await click('重命名');
  workspace.scripts = [{ ...workspace.scripts[0], name: '外部更新', updatedAt: 2 }];
  await renameInput('本地改名'); await click('确认重命名');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('其他客户端更新');
  expect(workspace.scripts[0].name).toBe('外部更新');
  expect(container.querySelector('[aria-labelledby="rename-workflow-title"]')).not.toBeNull();
});
async function createManual() {
  await click('＋ 创建工作流');
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.creation-choice')[1].click());
}

it('creates a table fill node with editable configuration and preserves it after saving/reopening', async () => {
  await render(); await createManual(); await click('表格填充');
  const node = canvasProps.nodes.find(n => n.kind === 'tableFill')!;
  const structure = { headerSelector: 'thead th', rowSelector: '.body > li', cellSelector: ':scope > span' };
  await act(async () => canvasProps.onChange(canvasProps.nodes.map(n => n.id === node.id ? { ...node, target: { ...node.target, selector: '#editable' }, keyColumns: ['SKU', '仓库'], data: '{{data}}', structure } : n), canvasProps.edges));
  await click('保存工作流'); await click('‹ 返回列表'); await click('编辑');
  expect(canvasProps.nodes.find(n => n.id === node.id)).toMatchObject({ kind: 'tableFill', keyColumns: ['SKU', '仓库'], data: '{{data}}', target: { selector: '#editable' }, structure });
});

it('adds internal nodes to a loop, edits them and saves the complete body', async () => {
  await render(); await createManual(); await click('循环');
  const loop = canvasProps.nodes.find((n) => n.kind === 'loop')!;
  await act(async () => canvasProps.onAddFromPort(`${loop.id}::entry`, 'success', { x: 150, y: 180 }));
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.node-picker button')].find((b) => b.textContent?.includes('等待'))!.click());
  await click('修改节点'); await click('保存工作流');
  const savedLoop = workspace.scripts[0].nodes.find((n) => n.kind === 'loop');
  expect(savedLoop?.kind === 'loop' && savedLoop.body?.nodes).toEqual([expect.objectContaining({ kind: 'wait', name: '已修改' })]);
  expect(workspace.scripts[0].nodes).toHaveLength(2);
});

it('prompts for canvas parameters, supports cancel, and sends validated values only on confirmation', async () => {
  await render();
  await createManual();
  const start = createStartNode('parameter-start');
  start.inputs = [{ id: 'date', name: 'start_time', type: 'string', required: true }];
  await act(async () => canvasProps.onChange([start], []));
  await click('▶ 运行画布');
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('填写运行参数');
  expect(send.mock.calls.some(([message]) => message.type === 'PAGE_AGENT_RUN_GRAPH')).toBe(false);
  await click('开始运行');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('必填');
  await click('取消');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('▶ 运行画布');
  const input = container.querySelector<HTMLInputElement>('input[aria-label="start_time"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-10-01');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('开始运行');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_RUN_GRAPH', variables: { start_time: '2026-10-01' } }));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('runs a canvas without parameters immediately', async () => {
  await render();
  await createManual();
  await click('▶ 运行画布');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_RUN_GRAPH' }));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('prompts before running a saved workflow from the list and shares its manual history with the editor', async () => {
  const saved = workflow('list-run', '带参数流程');
  if (saved.nodes[0].kind !== 'start') throw new Error('missing start');
  saved.nodes[0].inputs = [{ id: 'count', name: 'count', type: 'number', required: true }];
  workspace.scripts = [saved];
  localValues['pageAgentRunInputs:list-run'] = { count: { type: 'number', value: '0' } };
  await render(); await click('运行');
  expect(send.mock.calls.some(([message]) => message.type === 'PAGE_AGENT_RUN_SCRIPT')).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[aria-label="count"]')?.type).toBe('number');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="count"]')?.value).toBe('0');
  await click('取消');
  expect(send.mock.calls.some(([message]) => message.type === 'PAGE_AGENT_RUN_SCRIPT')).toBe(false);
  await click('运行'); await click('开始运行');
  expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: 'list-run', variables: { count: 0 } });
  await click('编辑'); await click('▶ 运行画布');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="count"]')?.value).toBe('0');
  expect(workspace.scripts[0].nodes[0]).not.toHaveProperty('lastInputs');
});

it('prompts even for optional list-run parameters, while workflows with no declarations still run immediately', async () => {
  const saved = workflow('optional', '可选参数');
  if (saved.nodes[0].kind !== 'start') throw new Error('missing start');
  saved.nodes[0].inputs = [{ id: 'text', name: 'text', type: 'string', required: false }];
  workspace.scripts = [saved];
  await render(); await click('运行');
  expect(container.querySelector('[aria-labelledby="run-inputs-title"]')).not.toBeNull();
  await click('开始运行');
  expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: 'optional', variables: {} });
  send.mockClear();
  workspace.scripts[0].nodes = [createStartNode('without-inputs')];
  await emit({ type: 'PAGE_AGENT_STATE_CHANGED' });
  await click('运行');
  expect(container.querySelector('[aria-labelledby="run-inputs-title"]')).toBeNull();
  expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: 'optional' });
});

it('never restores another workflow history after returning from an editor', async () => {
  const first = workflow('first', '第一个');
  const second = workflow('second', '第二个');
  for (const script of [first, second]) {
    if (script.nodes[0].kind !== 'start') throw new Error('missing start');
    script.nodes[0].inputs = [{ id: 'input', name: 'name', type: 'string', required: true }];
  }
  workspace.scripts = [first, second];
  localValues['pageAgentRunInputs:first'] = { name: { type: 'string', value: '第一份数据' } };
  localValues['pageAgentRunInputs:second'] = { name: { type: 'string', value: '第二份数据' } };
  await render(); await click('编辑'); await click('‹ 返回列表');
  const secondRow = [...container.querySelectorAll('.script-card')].find(row => row.textContent?.includes('第二个'))!;
  await act(async () => secondRow.querySelector<HTMLButtonElement>('.primary.compact')!.click());
  expect(container.querySelector<HTMLInputElement>('input[aria-label="name"]')?.value).toBe('第二份数据');
});

it('prompts with workflow parameters for single-node testing without running the Start or navigating', async () => {
  const saved = workflow('single', '单步测试');
  if (saved.nodes[0].kind !== 'start') throw new Error('missing start');
  saved.nodes[0].inputs = [{ id: 'title', name: 'title', type: 'string', required: true }];
  saved.nodes.push({ id: 'input-node', name: '输入', kind: 'dom', target: { name: '输入', selector: '#input', tagName: 'input', label: '输入', frameId: 0 }, event: { type: 'input', value: '{{title}}' } });
  workspace.scripts = [saved];
  localValues['pageAgentRunInputs:single'] = { title: { type: 'string', value: '本机标题' } };
  await render(); await click('编辑');
  await act(async () => canvasProps.onSelect('input-node')); await click('单节点运行');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="title"]')?.value).toBe('本机标题');
  await click('开始运行');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_RUN_GRAPH', nodes: [saved.nodes[1]], edges: [], variables: { title: '本机标题' } }));
});

it('creates an editable calendar node from the toolbar', async () => {
  await render();
  await createManual();
  await click('日历选择器');
  expect(canvasProps.nodes).toContainEqual(expect.objectContaining({ kind: 'calendar', mode: 'single', date: '', endDate: '', target: expect.objectContaining({ selector: '' }) }));
});

it('remembers manual parameters after reopening the editor and keeps workflows isolated', async () => {
  const saved = workflow('first', '第一个流程');
  const start = saved.nodes[0];
  if (start.kind !== 'start') throw new Error('missing start');
  start.inputs = [{ id: 'text', name: 'table_name', type: 'string', required: true }];
  workspace.scripts = [saved];
  localValues['pageAgentRunInputs:first'] = { table_name: { type: 'string', value: '上次报表' } };
  await render();
  await click('编辑');
  await click('▶ 运行画布');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="table_name"]')?.value).toBe('上次报表');
  const input = container.querySelector<HTMLInputElement>('input[aria-label="table_name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '本次报表');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('开始运行');
  expect(localValues['pageAgentRunInputs:first']).toEqual({ table_name: { type: 'string', value: '本次报表' } });
  expect(workspace.scripts[0].nodes[0]).not.toHaveProperty('lastInputs');
  await click('‹ 返回列表');
  await click('编辑');
  await click('▶ 运行画布');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="table_name"]')?.value).toBe('本次报表');
  await click('取消');
  await click('‹ 返回列表');
  await createManual();
  const other = createStartNode('other');
  other.inputs = start.inputs;
  await act(async () => canvasProps.onChange([other], []));
  await click('▶ 运行画布');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="table_name"]')?.value).toBe('');
});

it('shows live node progress, rejects stale events and resets logs between runs', async () => {
  await render();
  await createManual();
  let resolveRun!: (value: unknown) => void;
  send.mockImplementation((message: RuntimeMessage) => message.type === 'PAGE_AGENT_RUN_GRAPH'
    ? new Promise((resolve) => { resolveRun = resolve; }) : Promise.resolve({ ok: true }));
  await click('▶ 运行画布');
  const request = send.mock.calls.find(([message]) => message.type === 'PAGE_AGENT_RUN_GRAPH')![0];
  const nodeId = canvasProps.nodes[0].id;
  await emit({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: 'stale', nodeId, phase: 'running' });
  expect(canvasProps.activeNodeId).toBeNull();
  await emit({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: request.runId, nodeId, phase: 'running' });
  expect(canvasProps.activeNodeId).toBe(nodeId);
  const step = { nodeId, ok: false, message: '测试失败', verification: { ok: false, summary: '实际值不匹配', expected: 'abc', actual: '' } };
  await emit({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: request.runId, nodeId, phase: 'completed', steps: [step] });
  expect(canvasProps.activeNodeId).toBeNull();
  expect(canvasProps.nodeLogs?.[nodeId]).toEqual([step]);
  await act(async () => canvasProps.onShowLogs?.(nodeId));
  expect(container.querySelector('.node-log-detail .log-failure')?.textContent).toContain('测试失败');
  await act(async () => resolveRun({ ok: false, result: { ok: false, steps: [step], error: '测试失败' } }));
  expect(container.querySelector('.compose-view .run-report')).toBeNull();
  expect(container.querySelector('.canvas-run-summary.failed')).not.toBeNull();
  await click('关闭日志');
  await act(async () => container.querySelector<HTMLButtonElement>('.canvas-run-summary')!.click());
  expect(container.querySelector('[aria-label="本次运行结果"] .run-report.failed')).not.toBeNull();
  await click('关闭运行结果');
  await click('▶ 运行画布');
  expect(container.querySelector('.canvas-run-summary')).toBeNull();
  expect(canvasProps.nodeLogs).toEqual({});
  expect(canvasProps.activeNodeId).toBeNull();
  await emit({ type: 'PAGE_AGENT_RUN_PROGRESS', runId: request.runId, nodeId, phase: 'completed', steps: [step] });
  expect(canvasProps.nodeLogs).toEqual({});
  await act(async () => resolveRun({ ok: true, result: { ok: true, steps: [] } }));
});

describe('workflow-first side panel', () => {
  it('shows the extension version actually loaded by Chrome', async () => {
    await render();
    expect(container.querySelector('.brand small')?.textContent).toContain('v0.10.3');
  });

  it('starts with a list and creation/import entry points, without initializing the canvas', async () => {
    workspace.scripts = [workflow('one', '已有工作流')];
    await render();
    expect(container.querySelectorAll('.script-card')).toHaveLength(1);
    expect(container.textContent).toContain('已有工作流');
    expect(canvas()).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(container.querySelector('.mode-tabs')).toBeNull();
    expect(button('导入 JSON')).toBeDefined();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_SET_STATE' }));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="MCP 连接配置"]')!.click());
    expect(container.textContent).toContain('MCP 配置 · instance-A');
  });

  it('offers two creation methods and opens a fresh, focused canvas only after choosing manual creation', async () => {
    await render();
    await click('＋ 创建工作流');
    expect(container.querySelectorAll('.creation-choice')).toHaveLength(2);
    expect(container.textContent).toContain('录制网页操作');
    expect(container.textContent).toContain('手动画布编辑');
    expect(canvas()).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await createManual();
    expect(canvas()).not.toBeNull();
    expect(canvasProps.nodes).toHaveLength(1);
    expect(canvasProps.nodes[0].kind).toBe('start');
    expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
    expect(container.querySelector('[aria-label="展开节点属性"]')).not.toBeNull();
    expect(container.querySelector('.script-list')).toBeNull();
    expect(container.querySelector('.workflow-actions')).toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
    expect([...container.querySelectorAll('button')].some((item) => item.textContent === '打开' || item.textContent === '新建')).toBe(false);
  });

  it('can cancel discarding changes, and does not restore an unsaved draft on the next creation', async () => {
    await render();
    await createManual();
    const originalId = canvasProps.nodes[0].id;
    await click('修改节点');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click('‹ 返回列表');
    expect(canvas()).not.toBeNull();
    expect(canvasProps.nodes[0].name).toBe('已修改');
    await click('‹ 返回列表');
    expect(canvas()).toBeNull();
    expect(container.textContent).toContain('还没有工作流');
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_SET_STATE' }));
    await createManual();
    expect(canvasProps.nodes).toHaveLength(1);
    expect(canvasProps.nodes[0].name).toBe('开始');
    expect(canvasProps.nodes[0].id).not.toBe(originalId);
  });

  it('opens only the selected workflow, and discarding edits leaves the saved workflow intact', async () => {
    workspace.scripts = [workflow('one', '流程一'), workflow('two', '流程二')];
    await render();
    await click('编辑');
    expect(canvasProps.nodes[0].id).toBe('one-start');
    expect(container.querySelector('.script-list')).toBeNull();
    await click('开始');
    await click('修改节点');
    await click('‹ 返回列表');
    expect(container.querySelectorAll('.script-card')).toHaveLength(2);
    await click('编辑');
    expect(canvasProps.nodes[0].name).toBe('开始');
    await click('‹ 返回列表');
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });

  it('explicitly saves a workflow, returns to its list, and updates it without changing its ID', async () => {
    await render();
    await createManual();
    await click('保存工作流');
    expect(workspace.scripts).toHaveLength(1);
    const id = workspace.scripts[0].id;
    expect(workspace.draft).toEqual([]);
    expect(workspace.draftEdges).toEqual([]);
    expect(container.querySelector('.script-list')).toBeNull();
    expect(button('更新工作流')).toBeDefined();
    await click('‹ 返回列表');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.script-card')).toHaveLength(1);
    await click('编辑');
    await click('开始');
    await click('修改节点');
    await click('更新工作流');
    expect(workspace.scripts).toHaveLength(1);
    expect(workspace.scripts[0].id).toBe(id);
    expect(workspace.scripts[0].nodes[0].name).toBe('已修改');
    expect(window.prompt).toHaveBeenCalledTimes(1);
    await click('‹ 返回列表');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('persists deletion and removes connected edges after updating and reopening', async () => {
    const saved=workflow('delete-test','删除测试');
    saved.nodes.push({id:'remove-me',kind:'wait',name:'待删除节点',durationMs:0});
    saved.edges=[{id:'edge',sourceNodeId:saved.nodes[0].id,targetNodeId:'remove-me',sourcePort:'success'}];
    workspace.scripts=[saved];
    await render();await click('编辑');await click('待删除节点');await click('删除节点');
    expect(canvasProps.nodes.map(n=>n.id)).not.toContain('remove-me');
    await click('更新工作流');
    expect(workspace.scripts[0].nodes.map(n=>n.id)).not.toContain('remove-me');
    expect(workspace.scripts[0].edges).toEqual([]);
    await click('‹ 返回列表');await click('编辑');
    expect(canvasProps.nodes.map(n=>n.id)).not.toContain('remove-me');
    expect(canvasProps.edges).toEqual([]);
  });

  it('copies the full workflow ID without reading a key or running the workflow', async () => {
    const id = '4ccfb46b-5849-4ecd-aa93-00ae59dd6178';
    workspace.scripts = [workflow(id, 'ID 复制测试')];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await render();
    send.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('.copy-id')!.click());
    expect(writeText).toHaveBeenCalledWith(id);
    expect(container.textContent).toContain('工作流 ID 已复制');
    expect(send).not.toHaveBeenCalled();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes the overflow menu with Escape and returns focus to its trigger', async () => {
    workspace.scripts = [workflow('one', '流程一')];
    await render();
    const trigger = container.querySelector<HTMLButtonElement>('.more')!;
    await act(async () => trigger.click());
    expect(document.activeElement).toBe(button('编辑'));
    await act(async () => container.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('copies a runnable prompt for the chosen workflow without exposing the key in the list',async()=>{
    workspace.scripts=[workflow('prompt-flow','复制测试')];
    const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
    await render();expect(container.textContent).not.toContain('local-key');
    await click('复制运行 Prompt');
    expect(writeText).toHaveBeenCalledOnce();const prompt=writeText.mock.calls[0][0];
    expect(prompt).toContain('"instanceId": "instance-A"');expect(prompt).toContain('"workflowId": "prompt-flow"');expect(prompt).toContain('"key": "local-key"');
    expect(send.mock.calls.some(([message])=>message.type==='PAGE_AGENT_RUN_SCRIPT')).toBe(false);
  });

  it('creates toolbar nodes at the current visible center instead of the tail', async () => {
    await render();await createManual();
    let center={x:1800,y:750};
    canvasProps.onRegisterViewport?.(['__main__'],()=>center);
    await click('等待');
    expect(canvasProps.nodes.at(-1)?.position).toEqual(center);
    center={x:300,y:160};
    await click('等待');
    expect(canvasProps.nodes.at(-1)?.position).toEqual(center);
  });

  it('does not mark a failed save as saved or add it to the list', async () => {
    await render();
    await createManual();
    send.mockImplementationOnce(async () => ({ ok: false, error: '磁盘已满' }));
    await click('保存工作流');
    expect(container.textContent).toContain('保存失败：磁盘已满');
    expect(button('保存工作流')).toBeDefined();
    await click('‹ 返回列表');
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('.script-card')).toHaveLength(0);
  });

  it('ignores regenerated edge IDs for the unsaved-change check', async () => {
    const saved = workflow('one', '流程一');
    saved.nodes.push({ id: 'wait', kind: 'wait', name: '等待', durationMs: 500, position: { x: 360, y: 80 } });
    saved.edges = [{ id: 'original-edge', sourceNodeId: saved.nodes[0].id, targetNodeId: 'wait', sourcePort: 'success' }];
    workspace.scripts = [saved];
    await render();
    await click('编辑');
    await act(async () => canvasProps.onChange(canvasProps.nodes, canvasProps.edges.map((edge) => ({ ...edge, id: 'canvas-edge' }))));
    await click('‹ 返回列表');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('removes Action saving and listing without deleting legacy data', async () => {
    workspace.scripts = [workflow('one', '流程一')];
    workspace.actions = [{ id: 'legacy-action', name: '旧 Action', nodes: [], edges: [], createdAt: 1, updatedAt: 1 }];
    await render();
    expect(container.querySelector('.saved-actions')).toBeNull();
    await click('编辑');
    expect([...container.querySelectorAll('button')].some((item) => item.textContent?.includes('Action'))).toBe(false);
    await click('更新工作流');
    expect(workspace.actions).toHaveLength(1);
    expect(button('更新工作流')).toBeDefined();
    await click('‹ 返回列表');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(container.querySelector('.saved-actions')).toBeNull();
    expect(container.querySelectorAll('.script-card')).toHaveLength(1);
  });

  it('imports a saved workflow and opens it without exposing the list in the editor', async () => {
    await render();
    const saved = workflow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '导入流程');
    const json = JSON.stringify(exportWorkflow(saved));
    const file = new File([json], 'workflow.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => json });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(canvas()).not.toBeNull();
    expect(container.textContent).toContain('导入流程');
    expect(container.querySelector('.script-list')).toBeNull();
    expect(workspace.scripts).toHaveLength(1);
    expect(workspace.draft).toEqual([]);
    await click('‹ 返回列表');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.script-card')).toHaveLength(1);
  });

  it('does not lock navigation when running a saved workflow fails to return a result', async () => {
    workspace.scripts = [workflow('one', '流程一')];
    await render();
    send.mockRejectedValueOnce(new Error('连接已断开'));
    await click('运行');
    expect(container.textContent).toContain('运行失败：连接已断开');
    expect(container.querySelector<HTMLButtonElement>('.workflow-name')!.disabled).toBe(false);
    expect(button('创建工作流').disabled).toBe(false);
  });

  it('shows only recording controls until stopping produces an editable draft', async () => {
    workspace.scripts = [workflow('one', '已有工作流')];
    await render();
    await click('＋ 创建工作流');
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.creation-choice')[0].click());
    expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_START_RECORDING' });
    expect(container.querySelector('.recording-view')).not.toBeNull();
    expect(container.querySelector('.script-list')).toBeNull();
    expect(canvas()).toBeNull();
    await emit({ type: 'PAGE_AGENT_RECORDING_STATUS', active: true, eventCount: 3 });
    expect(container.textContent).toContain('已记录 3 个操作');
    await click('停止录制并编辑');
    expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_STOP_RECORDING' });
    const start = { ...createStartNode(), url: 'https://example.com/' };
    const recorded = { id: 'recorded', kind: 'wait' as const, name: '录制操作', durationMs: 100 };
    await emit({ type: 'PAGE_AGENT_RECORDING_COMPLETE', recording: { startUrl: start.url, startedAt: 1, stoppedAt: 2, eventCount: 1, nodes: [start, recorded], edges: [] } });
    expect(canvas()).not.toBeNull();
    expect(canvasProps.nodes).toHaveLength(2);
    expect(canvasProps.nodes[0]).toMatchObject({ kind: 'start', url: 'https://example.com/' });
    expect(container.querySelector('.recording-view')).toBeNull();
    expect(container.querySelector('.script-list')).toBeNull();
    expect(button('保存工作流')).toBeDefined();
  });

  it('keeps the creation choices available when recording cannot start', async () => {
    await render();
    await click('＋ 创建工作流');
    send.mockImplementationOnce(async () => ({ ok: false, error: '请先打开网页' }));
    await act(async () => container.querySelectorAll<HTMLButtonElement>('.creation-choice')[0].click());
    expect(container.textContent).toContain('请先打开网页');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('.recording-view')).toBeNull();
    expect(canvas()).toBeNull();
  });

  it('resumes an active recording in the status screen when the side panel is reopened', async () => {
    const originalSend = send.getMockImplementation()!;
    send.mockImplementation(async (message: RuntimeMessage) => message.type === 'PAGE_AGENT_GET_RECORDING'
      ? { ok: true, result: { active: true, eventCount: 5 } }
      : originalSend(message));
    await render();
    expect(container.querySelector('.recording-view')).not.toBeNull();
    expect(container.textContent).toContain('已记录 5 个操作');
    expect(canvas()).toBeNull();
    expect(container.querySelector('.script-list')).toBeNull();
  });

  it('does not accept stray selector messages on the list screen', async () => {
    await render();
    await emit({ type: 'PAGE_AGENT_SELECTION', target: { name: 'Unexpected', selector: '#unexpected', frameId: 0, tagName: 'input', label: 'Unexpected' } });
    await createManual();
    expect(canvasProps.nodes).toHaveLength(1);
  });
});

it('deletes from the overflow menu and stays deleted after reopening', async () => {
  workspace.scripts = [workflow('delete-id', '待删除'), workflow('keep-id', '保留')];
  await render(); await click('删除工作流');
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('待删除'));
  expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_DELETE_WORKFLOW', workflowId: 'delete-id', expectedUpdatedAt: 1 });
  expect(workspace.scripts.map(item => item.id)).toEqual(['keep-id']);
  expect(container.querySelectorAll('.script-card')).toHaveLength(1);
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.querySelector('.workflow-name')?.textContent).toBe('保留');
});
it('cancels deletion without writing and retains the workflow on failure', async () => {
  workspace.scripts = [workflow('delete-id', '待删除')];
  await render(); vi.mocked(window.confirm).mockReturnValueOnce(false);
  await click('删除工作流');
  expect(send.mock.calls.some(([message]) => message.type === 'PAGE_AGENT_DELETE_WORKFLOW')).toBe(false);
  workspace.scripts = [{ ...workspace.scripts[0], updatedAt: 2 }];
  await click('删除工作流');
  expect(container.querySelector('.workflow-name')?.textContent).toBe('待删除');
  expect(container.querySelector('.toast')?.textContent).toContain('其他客户端更新');
});

it('recovers an unsaved editor draft after closing and reopening, then supports undo and redo', async () => {
  workspace.scripts = [workflow('draft-recovery', '草稿工作流')];
  await render(); await click('编辑');
  await act(async () => canvasProps.onSelect(canvasProps.nodes[0].id)); await click('修改节点');
  expect(canvasProps.nodes[0].name).toBe('已修改');
  await click('撤销'); expect(canvasProps.nodes[0].name).toBe('开始');
  await click('重做'); expect(canvasProps.nodes[0].name).toBe('已修改');
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(container.textContent).toContain('发现未保存草稿');
  await click('恢复草稿');
  expect(canvasProps.nodes[0].name).toBe('已修改');
  expect(workspace.scripts[0].nodes[0].name).toBe('开始');
  await click('更新工作流');
  expect(workspace.scripts[0].nodes[0].name).toBe('已修改');
  expect(localValues.pageAgentEditorDraftV1).toBeNull();
});

it('keeps node properties collapsed until explicitly expanded and preserves selection and edits on collapse', async () => {
  await render(); await createManual();
  expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
  expect(container.querySelector('[aria-label="展开节点属性"]')).not.toBeNull();
  const original = structuredClone(canvasProps.nodes);
  await click('展开节点属性'); expect(container.querySelector('[data-testid="inspector"]')).not.toBeNull();
  await click('修改节点'); await click('收起节点属性');
  expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
  expect(canvasProps.nodes[0].name).toBe('已修改');
  expect(canvasProps.nodes[0].position).toEqual(original[0].position);
  await click('展开节点属性'); expect(container.textContent).toContain('已修改');
  await act(async () => canvasProps.onInteractionStart?.());
  expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
  expect(container.querySelector('[aria-label="展开节点属性"]')).not.toBeNull();
});
it('selecting a different node closes details and adding uses the floating palette', async () => {
  await render(); await createManual(); await click('展开节点属性');
  await click('等待'); expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
  expect(container.querySelector('.canvas-toolbar')).toBeNull();
  expect(container.querySelector('[aria-label="新增节点类型"]')).toBeNull();
  expect(container.querySelector('.property-node-name')?.textContent).toBe('等待');
  await click('展开节点属性');
  await act(async () => canvasProps.onSelect(canvasProps.nodes[0].id));
  expect(container.querySelector('[data-testid="inspector"]')).toBeNull();
  await click('新增节点');
  expect(container.querySelector('[aria-label="新增节点类型"]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(container.querySelector('[aria-label="新增节点类型"]')).toBeNull();
});
it('applies all canvas layout scopes in a single undoable graph edit, without changing config or edges', async () => {
  await render(); await createManual(); await click('等待');
  const initial = structuredClone(canvasProps.nodes), edges = structuredClone(canvasProps.edges);
  const positions = Object.fromEntries(initial.map((node, index) => [node.id, { x: 100 + index * 320, y: 80 }]));
  const restore = vi.fn();
  canvasProps.onRegisterLayout?.('__main__', { arrange: vi.fn().mockResolvedValue(positions), restore });
  await click('自动整理画布');
  expect(canvasProps.nodes).toEqual(initial.map(node => ({ ...node, position: positions[node.id] })));
  expect(canvasProps.edges).toEqual(edges); expect(restore).not.toHaveBeenCalled();
  await click('撤销'); expect(canvasProps.nodes).toEqual(initial);
  await click('重做'); expect(canvasProps.nodes).toEqual(initial.map(node => ({ ...node, position: positions[node.id] })));
});
it('restores canvas views and leaves the graph unchanged if any layout scope fails', async () => {
  await render(); await createManual();
  const original = structuredClone(canvasProps.nodes), restore = vi.fn();
  canvasProps.onRegisterLayout?.('__main__', { arrange: vi.fn().mockResolvedValue({ [original[0].id]: { x: 1000, y: 900 } }), restore });
  canvasProps.onRegisterLayout?.('child', { arrange: vi.fn().mockRejectedValue(new Error('layout failed')), restore });
  await click('自动整理画布');
  expect(canvasProps.nodes).toEqual(original); expect(restore).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('自动整理失败：layout failed');
});

it('routes viewport controls without creating graph edits and displays the current zoom', async () => {
  await render(); await createManual();
  const original = structuredClone(canvasProps.nodes), view = vi.fn();
  canvasProps.onRegisterLayout?.('__main__', { view, arrange: vi.fn(), restore: vi.fn() });
  await click('放大画布'); await click('缩小画布'); await click('重置画布缩放为100%'); await click('适应全部节点');
  expect(view.mock.calls.map(call => call[0])).toEqual(['zoomIn', 'zoomOut', 'resetZoom', 'fitView']);
  await act(async () => canvasProps.onZoomChange?.(75));
  expect(button('重置画布缩放为100%').textContent).toBe('75%');
  expect(canvasProps.nodes).toEqual(original); expect(button('撤销').disabled).toBe(true);
});

it('resets every nested canvas to its neutral scale before the root, without compounding zoom in or out', async () => {
  await render(); await createManual();
  const calls: string[] = [];
  const register = (scope: string) => canvasProps.onRegisterLayout!(scope, { view: command => calls.push(`${scope}:${command}`), arrange: vi.fn(), restore: vi.fn() });
  register('__main__'); register('loop'); register('pages');
  const unregister = register('removed'); unregister();
  await click('重置画布缩放为100%');
  expect(calls).toEqual(['loop:resetZoom', 'pages:resetZoom', '__main__:resetZoom']);
  calls.length = 0;
  await click('放大画布'); await click('缩小画布');
  expect(calls).toEqual(['__main__:zoomIn', '__main__:zoomOut']);
  expect(button('撤销').disabled).toBe(true);
});
