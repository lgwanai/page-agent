import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleBridgeRequest } from './bridge';
import { handleAuthoring } from './authoring';
import { runScript } from './runner';
import { saveWorkspace } from '@/shared/storage';
import { createStartNode, type RunResult } from '@/types/workflow';

vi.mock('@/shared/instance', () => ({ getInstanceId: vi.fn().mockResolvedValue('instance') }));
vi.mock('@/shared/workflow-keys', () => ({ verifyWorkflowKey: vi.fn().mockResolvedValue(true), ensureWorkflowKeys: vi.fn() }));
vi.mock('./dialogs', () => ({ withAlertConfirmation: async (_tab: number, run: () => Promise<unknown>) => run() }));
let stored: Record<string, unknown>;
const workflowId = '12345678-1234-4234-8234-123456789012';
const historyKey = `pageAgentRunInputs:${workflowId}`;
beforeEach(async () => {
  stored = { [historyKey]: {
    name: { type: 'string', value: 'manual-only-secret' },
    detail: { type: 'object', value: '{"source":"manual"}' },
  } };
  const area = { get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(stored[key])]))), set: vi.fn(async (values: Record<string, unknown>) => Object.assign(stored, structuredClone(values))) };
  vi.stubGlobal('chrome', { storage: { local: area, session: area }, runtime: { sendMessage: vi.fn().mockResolvedValue({}) },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]), get: vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com', status: 'complete' }) } });
  const start = { ...createStartNode('start'), keepCurrentPage: true, settleDelayMs: 0, inputs: [
    { id: 'name', name: 'name', type: 'string' as const, required: true },
    { id: 'detail', name: 'detail', type: 'object' as const, required: false },
  ] };
  await saveWorkspace({ actions: [], scripts: [{ id: workflowId, name: '隔离测试', createdAt: 1, updatedAt: 1, nodes: [start], edges: [] }], draft: [], draftEdges: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('does not fill missing API parameters from local manual history', async () => {
  const result = await handleBridgeRequest({ id: 'request', instanceId: 'instance', method: 'run_workflow', params: { workflowId, key: 'valid' } }) as RunResult;
  expect(result.ok).toBe(false); expect(result.error).toContain('缺少必填参数：name');
  expect(JSON.stringify(result)).not.toContain('manual-only-secret');
  expect(chrome.storage.local.get).not.toHaveBeenCalledWith(historyKey);
});
it('uses only supplied API values and leaves manual history untouched', async () => {
  const result = await handleBridgeRequest({ id: 'request', instanceId: 'instance', method: 'run_workflow', params: { workflowId, key: 'valid', data: { name: 'from-api' } } }) as RunResult;
  expect(result.ok).toBe(true); expect(result.steps[0].data).toMatchObject({ inputs: { name: 'from-api' } });
  expect((result.steps[0].data as { inputs: unknown }).inputs).toEqual({ name: 'from-api' });
  expect(stored[historyKey]).toMatchObject({ name: { value: 'manual-only-secret' } });
  expect(chrome.storage.local.get).not.toHaveBeenCalledWith(historyKey);
});
it('keeps the same isolation for MCP workflow debugging and direct backend runs', async () => {
  const direct = await runScript(workflowId, {});
  expect(direct.ok).toBe(false); expect(direct.error).toContain('缺少必填参数');
  const report = await handleAuthoring('debug_workflow', { workflowId, key: 'valid', data: { name: 'debug-api', detail: { source: 'api' } } }) as { result: RunResult };
  expect(report.result.ok).toBe(true);
  expect(report.result.steps[0].data).toMatchObject({ inputs: { name: 'debug-api', detail: { source: 'api' } } });
  expect(JSON.stringify(report)).not.toContain('manual-only-secret');
  expect(chrome.storage.local.get).not.toHaveBeenCalledWith(historyKey);
});
