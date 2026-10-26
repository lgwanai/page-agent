import { exportWorkflow, importWorkflow } from './workflow-file';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createStartNode, type ScriptDefinition } from '@/types/workflow';
import { loadWorkspace, renameWorkflow, deleteWorkflow, restoreWorkflow, purgeWorkflow, replaceWorkspace, updateWorkflowTags } from './storage';
import { verifyWorkflowKey } from './workflow-keys';
const id = 'aabbccdd-1111-4111-8111-aabbccddeeff';
const other = '11223344-1111-4111-8111-aabbccddeeff';
let values: Record<string, unknown>;
let workflow: ScriptDefinition;
const set = vi.fn();
beforeEach(() => {
  workflow = { id, name: '原名称', nodes: [createStartNode('start')], edges: [], createdAt: 1, updatedAt: 2, lastRunAt: 3 };
  values = { pageAgentLibraryV2: { schemaVersion: 2, scripts: [structuredClone(workflow), { ...structuredClone(workflow), id: other, name: '另一工作流' }], actions: [] }, pageAgentWorkflowKeysV1: { [id]: 'EXISTING-KEY' } };
  set.mockImplementation(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)); });
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => structuredClone(values)), set, remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key]; }) } }, runtime: { sendMessage: vi.fn().mockResolvedValue({}) } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('persists a metadata-only rename and preserves graph, IDs, keys, inputs and run history', async () => {
  const before = (await loadWorkspace()).scripts[0];
  const result = await renameWorkflow(id, '  新名称  ', 2);
  const after = (await loadWorkspace()).scripts[0];
  expect(after).toEqual({ ...before, name: '新名称', updatedAt: result.updatedAt });
  expect(result.updatedAt).toBeGreaterThan(2);
  expect(values.pageAgentWorkflowKeysV1).toEqual({ [id]: 'EXISTING-KEY' });
  expect(await verifyWorkflowKey(id, 'EXISTING-KEY')).toBe(true);
  expect(set.mock.calls.every(([patch]) => !Object.hasOwn(patch, 'pageAgentWorkflowKeysV1'))).toBe(true);
  expect((await loadWorkspace()).scripts[1].name).toBe('另一工作流');
});
it('rejects empty, invalid, overlong and stale requests without writing or overwriting external edits', async () => {
  for (const name of ['', '  ', 'a'.repeat(121), 'name\nnext']) await expect(renameWorkflow(id, name, 2)).rejects.toThrow('名称');
  await expect(renameWorkflow(id, 'changed', 1)).rejects.toThrow('其他客户端更新');
  await expect(renameWorkflow('missing', 'changed', 2)).rejects.toThrow('已不存在');
  expect(set).not.toHaveBeenCalled();
});
it('serializes concurrent renames and refuses the stale second request', async () => {
  const result = await Promise.allSettled([renameWorkflow(id, '第一请求', 2), renameWorkflow(id, '第二请求', 2)]);
  expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
  expect((await loadWorkspace()).scripts[0].name).toBe('第一请求');
});

it('deletes only the selected workflow and persists after reloading', async () => {
  const retained = (await loadWorkspace()).scripts[1];
  await deleteWorkflow(id, 2);
  expect((await loadWorkspace()).scripts).toEqual([retained]);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_AGENT_STATE_CHANGED' });
});
it('refuses stale, missing and invalid deletion requests without writing', async () => {
  await expect(deleteWorkflow(id, 1)).rejects.toThrow('其他客户端更新');
  await expect(deleteWorkflow('missing', 2)).rejects.toThrow('已不存在');
  await expect(deleteWorkflow(id, NaN)).rejects.toThrow('版本');
  expect(set).not.toHaveBeenCalled();
});
it('serializes deletion with concurrent updates without losing unrelated changes', async () => {
  await Promise.all([renameWorkflow(other, '并发改名', 2), deleteWorkflow(id, 2)]);
  expect((await loadWorkspace()).scripts).toMatchObject([{ id: other, name: '并发改名' }]);
});

it('restores a recycled workflow with its original ID/key and a new revision', async () => {
  await deleteWorkflow(id, 2);
  expect((await loadWorkspace()).trash?.[0].workflow.id).toBe(id);
  await restoreWorkflow(id);
  const restored = (await loadWorkspace()).scripts.find(item => item.id === id)!;
  expect(restored.name).toBe(workflow.name);
  expect(restored.updatedAt).toBeGreaterThan(2);
  expect(await verifyWorkflowKey(id, 'EXISTING-KEY')).toBe(true);
  expect((await loadWorkspace()).trash).toBeUndefined();
});
it('permanently removes the workflow, key, manual inputs and run history without touching others', async () => {
  values[`pageAgentRunInputs:${id}`] = { secret: 'saved' };
  values.pageAgentRunHistoryV1 = [{ workflowId: id, runId: 'deleted' }, { workflowId: other, runId: 'retained' }];
  await deleteWorkflow(id, 2); await purgeWorkflow(id);
  expect((await loadWorkspace()).scripts.map(item => item.id)).toEqual([other]);
  expect((await loadWorkspace()).trash).toBeUndefined();
  expect(await verifyWorkflowKey(id, 'EXISTING-KEY')).toBe(false);
  expect(values[`pageAgentRunInputs:${id}`]).toBeUndefined();
  expect(values.pageAgentRunHistoryV1).toEqual([{ workflowId: other, runId: 'retained' }]);
  await expect(restoreWorkflow(id)).rejects.toThrow('未找到');
});
it('requires revisions for whole-library writes and prevents stale or recycled resurrection', async () => {
  const snapshot = await loadWorkspace();
  await expect(replaceWorkspace(snapshot)).rejects.toThrow('expectedRevisions');
  await renameWorkflow(id, '外部修改', 2);
  await expect(replaceWorkspace(snapshot, { [id]: 2, [other]: 2 })).rejects.toThrow('其他客户端更新');
  await deleteWorkflow(id, (await loadWorkspace()).scripts[0].updatedAt);
  await expect(replaceWorkspace(snapshot, { [other]: 2 })).rejects.toThrow('回收站');
});
it('bumps the revision even when a legacy caller changes content but reuses the timestamp', async () => {
  const snapshot = await loadWorkspace(); snapshot.scripts[0].name = '旧接口修改';
  await replaceWorkspace(snapshot, { [id]: 2, [other]: 2 });
  expect((await loadWorkspace()).scripts[0].updatedAt).toBeGreaterThan(2);
  await expect(renameWorkflow(id, '过期请求', 2)).rejects.toThrow('其他客户端更新');
});
it('validates tags and keeps them through export and import', async () => {
  await updateWorkflowTags(id, ['报表', '报表', '日常'], 2);
  const tagged = (await loadWorkspace()).scripts[0];
  expect(tagged.tags).toEqual(['报表', '日常']);
  expect(importWorkflow(exportWorkflow(tagged), []).workflow.tags).toEqual(tagged.tags);
  await expect(updateWorkflowTags(id, ['x'.repeat(31)], tagged.updatedAt)).rejects.toThrow('标签');
});
