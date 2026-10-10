// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@/types/messages';
import { createStartNode, type ScriptDefinition, type StepResult, type WorkflowEdge, type WorkflowNode, type WorkspaceState } from '@/types/workflow';
import { EMPTY_WORKSPACE } from '@/shared/storage';
import { exportWorkflow } from '@/shared/workflow-file';
import { App } from './App';

type CanvasProps = {
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
  NodeInspector: ({ node, onChange, onClose }: { node?: WorkflowNode; onChange: (node: WorkflowNode) => void; onClose: () => void }) => node
    ? <aside data-testid="inspector"><strong>{node.name}</strong><button onClick={() => onChange({ ...node, name: '已修改' })}>修改节点</button><button onClick={onClose}>关闭属性</button></aside>
    : null,
}));
vi.mock('./ProviderSettings', () => ({ ProviderSettings: () => <div>AI 配置</div> }));
vi.mock('./McpSettings', () => ({ McpSettings: ({ instanceId }: { instanceId: string }) => <div>MCP 配置 · {instanceId}</div> }));
vi.mock('@/shared/workflow-keys', () => ({ ensureWorkflowKey: vi.fn().mockResolvedValue('local-key'), rotateWorkflowKey: vi.fn().mockResolvedValue('import-key') }));

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
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function emit(message: RuntimeMessage) { await act(async () => listeners.forEach((listener) => listener(message))); }
function canvas() { return container.querySelector('[data-testid="canvas"]'); }
async function createManual() {
  await click('＋ 创建工作流');
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.creation-choice')[1].click());
}

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

it('creates an editable calendar node from the toolbar', async () => {
  await render();
  await createManual();
  await click('▦日历');
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
    expect(container.querySelector('[data-testid="inspector"]')).not.toBeNull();
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
    expect(button('编辑').disabled).toBe(false);
    expect(button('＋ 创建工作流').disabled).toBe(false);
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
