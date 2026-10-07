import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkspace, migrateGraph, saveWorkspace } from './storage';

afterEach(() => { vi.unstubAllGlobals(); });

describe('workspace graph migration', () => {
  it('rewires legacy condition branches to predecessor outcomes', () => {
    const nodes = [
      { id: 'ai', kind: 'ai', name: '识别结果', instruction: '', inputs: [], event: { type: 'click' } },
      { id: 'condition', kind: 'condition', name: '状态判断', left: '{{识别结果.output.status}}', operator: 'equals', right: 'ready' },
      { id: 'success', kind: 'wait', name: '继续', durationMs: 10 },
      { id: 'failure', kind: 'wait', name: '恢复', durationMs: 10 },
    ];
    const edges = [
      { id: 'in', sourceNodeId: 'ai', targetNodeId: 'condition', sourcePort: 'success' },
      { id: 'yes', sourceNodeId: 'condition', targetNodeId: 'success', sourcePort: 'true' },
      { id: 'no', sourceNodeId: 'condition', targetNodeId: 'failure', sourcePort: 'false' },
    ];

    const migrated = migrateGraph(nodes, edges);

    expect(migrated.nodes.map((node) => node.id)).toEqual(['start', 'ai', 'success', 'failure']);
    expect(migrated.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeId: 'start', targetNodeId: 'ai', sourcePort: 'success' }),
      expect.objectContaining({ sourceNodeId: 'ai', targetNodeId: 'success', sourcePort: 'success' }),
      expect.objectContaining({ sourceNodeId: 'ai', targetNodeId: 'failure', sourcePort: 'failure' }),
    ]));
    expect(migrated.edges.some((edge) => edge.sourceNodeId === 'condition' || edge.targetNodeId === 'condition')).toBe(false);
  });

  it('adds one configured Start entry to legacy graphs', () => {
    const migrated = migrateGraph([{ id: 'wait', kind: 'wait', name: '旧流程', durationMs: 10 }], []);
    const start = migrated.nodes.find((node) => node.kind === 'start');

    expect(start).toMatchObject({
      id: 'start', inputs: [], targetUrl: '', strictValidation: false, waitForLogin: false,
      loadTimeoutMs: 30_000, loginTimeoutMs: 300_000, settleDelayMs: 500,
    });
    expect(migrated.edges).toContainEqual(expect.objectContaining({ sourceNodeId: 'start', targetNodeId: 'wait', sourcePort: 'success' }));
  });

  it('persists only the versioned library and always opens a blank editor', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      pageAgentLibraryV2: {
        schemaVersion: 2,
        actions: [],
        scripts: [{ id: 'saved', name: '已保存', nodes: [], edges: [], createdAt: 1, updatedAt: 1 }],
      },
    });
    vi.stubGlobal('chrome', {
      storage: { local: { get, set, remove: vi.fn().mockResolvedValue(undefined) } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    });

    await saveWorkspace({ actions: [], scripts: [], draft: [{ id: 'wait', kind: 'wait', name: '未保存', durationMs: 1 }], draftEdges: [] });
    const saved = set.mock.calls[0][0].pageAgentLibraryV2;
    expect(saved).toEqual({ schemaVersion: 2, actions: [], scripts: [] });
    expect(saved).not.toHaveProperty('draft');

    const workspace = await loadWorkspace();
    expect(workspace.scripts).toHaveLength(1);
    expect(workspace.draft).toEqual([]);
    expect(workspace.draftEdges).toEqual([]);
  });

  it('migrates saved definitions and removes the legacy key containing drafts', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      storage: { local: {
        get: vi.fn().mockResolvedValue({
          pageAgentWorkspaceV1: {
            actions: [],
            scripts: [{ id: 'saved', name: '保留脚本', nodes: [], edges: [], createdAt: 1, updatedAt: 1 }],
            draft: [{ id: 'wait', kind: 'wait', name: '丢弃草稿', durationMs: 1 }],
            draftEdges: [],
          },
        }),
        set,
        remove,
      } },
      runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    });

    const workspace = await loadWorkspace();

    expect(workspace.scripts[0].name).toBe('保留脚本');
    expect(workspace.draft).toEqual([]);
    expect(set.mock.calls[0][0].pageAgentLibraryV2).not.toHaveProperty('draft');
    expect(remove).toHaveBeenCalledWith('pageAgentWorkspaceV1');
  });
});
