import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBridgeRequest } from './bridge';
import { getInstanceId } from '@/shared/instance';
import { loadWorkspace } from '@/shared/storage';
import { verifyWorkflowKey } from '@/shared/workflow-keys';
import { runScript } from './runner';

vi.mock('@/shared/instance', () => ({ getInstanceId: vi.fn().mockResolvedValue('instance-A') }));
vi.mock('@/shared/storage', () => ({ loadWorkspace: vi.fn(), replaceWorkspace: vi.fn() }));
vi.mock('@/shared/workflow-keys', () => ({ ensureWorkflowKeys: vi.fn(), verifyWorkflowKey: vi.fn() }));
vi.mock('./runner', () => ({ runScript: vi.fn().mockResolvedValue({ ok: true, steps: [] }), runAction: vi.fn() }));

beforeEach(() => {
  vi.mocked(loadWorkspace).mockResolvedValue({ actions: [], scripts: [{ id: 'workflow-A', name: '测试', nodes: [], edges: [], createdAt: 1, updatedAt: 1 }], draft: [], draftEdges: [] });
  vi.mocked(verifyWorkflowKey).mockResolvedValue(true);
});
afterEach(() => { vi.clearAllMocks(); });

describe('instance-scoped workflow authorization', () => {
  it('rejects another instance id before reading state or executing a workflow', async () => {
    await expect(handleBridgeRequest({ id: '1', instanceId: 'instance-B', method: 'run_workflow', params: { workflowId: 'workflow-A', key: 'valid' } })).rejects.toThrow('实例 ID 不匹配');
    expect(getInstanceId).toHaveBeenCalledOnce();
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(runScript).not.toHaveBeenCalled();
  });

  it('still requires the workflow key inside the correct instance', async () => {
    vi.mocked(verifyWorkflowKey).mockResolvedValue(false);
    await expect(handleBridgeRequest({ id: '1', instanceId: 'instance-A', method: 'run_workflow', params: { workflowId: 'workflow-A', key: 'wrong' } })).rejects.toThrow('密钥无效');
    expect(runScript).not.toHaveBeenCalled();
  });

  it('executes only after matching both instance and workflow credentials', async () => {
    await handleBridgeRequest({ id: '1', instanceId: 'instance-A', method: 'run_workflow', params: { workflowId: 'workflow-A', key: 'valid', data: { name: '客户' } } });
    expect(verifyWorkflowKey).toHaveBeenCalledWith('workflow-A', 'valid');
    expect(runScript).toHaveBeenCalledWith('workflow-A', { name: '客户' });
  });
});
