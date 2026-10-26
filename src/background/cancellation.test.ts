import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import { cancelExecution, executionStatus } from './execution-control';
import type { WorkflowNode, WorkflowEdge } from '@/types/workflow';
const wait: WorkflowNode = { id: 'wait', kind: 'wait', name: '等待', durationMs: 60000 };
const after: WorkflowNode = { id: 'after', kind: 'output', name: '后续', source: 'text', value: 'should not run' };
const edges: WorkflowEdge[] = [ { id: 'success', sourceNodeId: 'wait', targetNodeId: 'after', sourcePort: 'success' }, { id: 'failure', sourceNodeId: 'wait', targetNodeId: 'after', sourcePort: 'failure' } ];
beforeEach(() => { vi.stubGlobal('chrome', { tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]) }, storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } } }); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('interrupts a long wait and never follows the success or failure edge', async () => {
  const progress = vi.fn();
  const running = runGraph([wait, after], edges, {}, progress);
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith('wait', 'running'));
  const id = executionStatus()!.runId;
  expect(cancelExecution('different-run')).toBe(false);
  expect(cancelExecution(id)).toBe(true);
  const result = await running;
  expect(result).toMatchObject({ ok: false, cancelled: true, runId: id });
  expect(result.steps.some(step => step.nodeId === 'after')).toBe(false);
  expect(executionStatus()).toBeNull();
  expect((await runGraph([after], [])).ok).toBe(true);
  expect(cancelExecution(id)).toBe(false);
});
it('propagates cancellation out of a nested loop without taking its failure exit', async () => {
  const loop: WorkflowNode = { id: 'loop', kind: 'loop', name: '循环', items: '[1,2]', itemVariable: 'item', indexVariable: 'index', maxIterations: 10, body: { nodes: [wait], edges: [] } };
  const progress = vi.fn();
  const running = runGraph([loop, after], [{ ...edges[1], sourceNodeId: 'loop' }], {}, progress);
  await vi.waitFor(() => expect(progress).toHaveBeenCalledWith('wait', 'running'));
  cancelExecution(executionStatus()!.runId);
  const result = await running;
  expect(result.cancelled).toBe(true);
  expect(result.steps.filter(step => step.nodeId === 'wait')).toHaveLength(1);
  expect(result.steps.some(step => step.nodeId === 'after')).toBe(false);
});

it('returns the completed operation even when history storage fails', async () => {
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota exceeded'));
  const result = await runGraph([after], []);
  expect(result.ok).toBe(true);
  expect(result.output).toBe('should not run');
  expect(result.historyWarning).toContain('历史保存失败');
});
it('returns a traceable failed run when no operational tab is available', async () => {
  vi.mocked(chrome.tabs.query).mockResolvedValueOnce([]);
  const result = await runGraph([after], []);
  expect(result).toMatchObject({ ok: false, steps: [], error: '没有可操作的活动网页' });
  expect(result.runId).toBeTruthy();
  expect(executionStatus()).toBeNull();
});
