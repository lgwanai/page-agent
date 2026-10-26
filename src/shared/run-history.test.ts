import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadRunHistory, recordRun, RUN_HISTORY_KEY } from './run-history';
let values: Record<string, unknown>;
beforeEach(() => {
  values = {};
  vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => structuredClone(values)), set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(values, structuredClone(patch))) } } });
});
afterEach(() => { vi.unstubAllGlobals(); });
it('persists bounded history, excludes input values and binary outputs, and serializes concurrent writes', async () => {
  await Promise.all(Array.from({ length: 23 }, (_, index) => recordRun({ runId: String(index), ok: true, steps: [], output: 'secret output' }, Date.now() - 50, { password: 'SECRET', rows: [{ secret: 'SECRET' }] }, { id: 'workflow', name: '测试' })));
  const entries = await loadRunHistory();
  expect(entries).toHaveLength(20);
  expect(entries[0].runId).toBe('22');
  expect(entries[0].inputs).toEqual([{ name: 'password', type: 'string' }, { name: 'rows', type: 'array', size: 1 }]);
  expect(JSON.stringify(values[RUN_HISTORY_KEY])).not.toContain('SECRET');
  expect(JSON.stringify(values[RUN_HISTORY_KEY])).not.toContain('secret output');
});
it('distinguishes cancelled execution and business failure from technical success', async () => {
  await recordRun({ runId: 'cancelled', ok: false, cancelled: true, error: '已停止', steps: [] }, Date.now(), {});
  await recordRun({ runId: 'business', ok: true, businessOk: false, steps: [] }, Date.now(), {});
  expect((await loadRunHistory()).map(entry => [entry.status, entry.businessOk])).toEqual([['success', false], ['cancelled', undefined]]);
});

it('prunes older summaries before exceeding the reserved storage budget', async () => {
  const steps = Array.from({ length: 500 }, (_, index) => ({ nodeId: String(index), ok: true, message: '摘要'.repeat(150) }));
  for (let index = 0; index < 15; index++) await recordRun({ runId: String(index), ok: true, steps }, Date.now(), {});
  const entries = await loadRunHistory();
  expect(entries[0].runId).toBe('14');
  expect(entries.length).toBeLessThan(15);
  expect(new TextEncoder().encode(JSON.stringify(entries)).byteLength).toBeLessThanOrEqual(2_000_000);
});
