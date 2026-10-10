import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureWorkflowKey, rotateWorkflowKey, verifyWorkflowKey } from './workflow-keys';

afterEach(() => { vi.unstubAllGlobals(); });

describe('workflow access keys', () => {
  it('creates stable keys and rotates them explicitly', async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: { local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: Record<string, unknown>) => Object.assign(storage, value)),
      } },
    });

    const first = await ensureWorkflowKey('workflow-id');
    expect(first).toHaveLength(43);
    expect(await ensureWorkflowKey('workflow-id')).toBe(first);
    expect(await verifyWorkflowKey('workflow-id', first)).toBe(true);
    expect(await verifyWorkflowKey('workflow-id', 'wrong')).toBe(false);

    const rotated = await rotateWorkflowKey('workflow-id');
    expect(rotated).not.toBe(first);
    expect(await verifyWorkflowKey('workflow-id', first)).toBe(false);
    expect(await verifyWorkflowKey('workflow-id', rotated)).toBe(true);
  });
});
