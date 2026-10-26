// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import manifest from '../../manifest.json';

type Installation = { version: string; alive?: () => boolean; dispose: () => void };
const page = window as Window & { __pageAgentInstallation?: Installation; __pageAgentLoaded?: boolean };
afterEach(() => { page.__pageAgentInstallation?.dispose(); delete page.__pageAgentInstallation; delete page.__pageAgentLoaded; vi.unstubAllGlobals(); });
const runtime = () => {
  const api = { id: 'test-extension' as string | undefined, onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue({ result: null }) };
  vi.stubGlobal('chrome', { runtime: api }); return api;
};
it('installs a fresh listener even if the invalidated previous installation throws during disposal', async () => {
  const api = runtime();
  page.__pageAgentInstallation = { version: 'old', dispose: () => { throw new Error('Extension context invalidated'); } };
  vi.resetModules(); await import('./index');
  expect(api.onMessage.addListener).toHaveBeenCalledOnce();
  const sendResponse = vi.fn();
  api.onMessage.addListener.mock.calls[0][0]({ type: 'PAGE_AGENT_PING' }, {}, sendResponse);
  expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, contentVersion: `nodes-v${manifest.version}` }));
});
it('reinstalls the same content version after its runtime is invalidated', async () => {
  const oldRuntime = runtime(); vi.resetModules(); await import('./index');
  const previous = page.__pageAgentInstallation;
  oldRuntime.id = undefined;
  oldRuntime.onMessage.removeListener.mockImplementation(() => { throw new Error('Extension context invalidated'); });
  const next = runtime(); vi.resetModules(); await import('./index');
  expect(next.onMessage.addListener).toHaveBeenCalledOnce();
  expect(page.__pageAgentInstallation).not.toBe(previous);
});
it('does not add duplicate listeners when the same live bundle is reinjected', async () => {
  const api = runtime(); vi.resetModules(); await import('./index');
  vi.resetModules(); await import('./index');
  expect(api.onMessage.addListener).toHaveBeenCalledOnce();
});
