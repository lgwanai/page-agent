import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugNode, runGraph } from './runner';
import { navigateToStartUrl } from './start-navigation';
import { createStartNode, type WorkflowNode } from '@/types/workflow';

vi.mock('./start-navigation', () => ({ navigateToStartUrl: vi.fn() }));

function setup(url = 'https://example.com/app?view=wrong') {
  let current = { id: 1, url, status: 'complete' } as chrome.tabs.Tab;
  const send = vi.fn();
  vi.stubGlobal('chrome', {
    tabs: { query: vi.fn().mockResolvedValue([current]), get: vi.fn(async () => current), sendMessage: send },
    storage: { local: { get: vi.fn().mockResolvedValue({}) } },
  });
  vi.mocked(navigateToStartUrl).mockImplementation(async (_tabId, target) => {
    current = { ...current, url: target };
    return current;
  });
  const start = { ...createStartNode('start'), targetUrl: 'https://example.com/app?view=correct', settleDelayMs: 0 };
  return { start, send };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Start always opens its configured URL', () => {
  it.each(['run', 'debug'])('navigates from chrome:// before attaching the alert debugger (%s)', async mode => {
    const { start } = setup('chrome://extensions/');
    const committed = new Set<(event: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => void>();
    Object.assign(chrome, {
      debugger: { attach: vi.fn(async () => { if ((await chrome.tabs.get(1)).url?.startsWith('chrome:')) throw new Error('Cannot access a chrome:// URL'); }), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn().mockResolvedValue(undefined), onEvent: { addListener: vi.fn(), removeListener: vi.fn() } },
      webNavigation: { onCommitted: { addListener: vi.fn(fn => committed.add(fn)), removeListener: vi.fn(fn => committed.delete(fn)) } },
    });
    const navigate = vi.mocked(navigateToStartUrl).getMockImplementation()!;
    vi.mocked(navigateToStartUrl).mockImplementation(async (...args) => {
      expect(chrome.debugger.attach).not.toHaveBeenCalled();
      const tab = await navigate(...args);
      committed.forEach(fn => fn({ tabId: 1, frameId: 0, url: tab.url } as chrome.webNavigation.WebNavigationTransitionCallbackDetails));
      return tab;
    });
    const result = mode === 'run' ? await runGraph([start], []) : await debugNode([start], start.id, {});
    expect(result.ok).toBe(true);
    expect(result.steps[0].data).toMatchObject({ navigated: true, previousUrl: 'chrome://extensions/', url: start.targetUrl });
    expect(chrome.debugger.attach).toHaveBeenCalledOnce(); expect(chrome.debugger.detach).toHaveBeenCalledOnce(); expect(committed.size).toBe(0);
  });
  it.each(['run', 'debug'])('reports debugger setup errors against Start instead of throwing outside the node (%s)', async mode => {
    const { start } = setup();
    Object.assign(chrome, { debugger: { attach: vi.fn().mockRejectedValue(new Error('Another debugger is attached')), onEvent: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const result = mode === 'run' ? await runGraph([start], []) : await debugNode([start], start.id, {});
    expect(result.ok).toBe(false);
    expect(result.steps[0]).toMatchObject({ ok: false, nodeId: start.id, diagnostic: { context: { nodeId: start.id, nodeKind: 'start' } } });
    expect(result.error).toContain('Another debugger');
    if (mode === 'run') expect(result.runId).toBeTruthy();
    expect(navigateToStartUrl).not.toHaveBeenCalled();
  });
  it('preserves the manually prepared page even when a different URL and login checks are configured', async () => {
    const { start } = setup();
    const result = await runGraph([{ ...start, keepCurrentPage: true, strictValidation: true, waitForLogin: true }], []);
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('view=wrong');
  });
  it('emits live start and completed progress before returning the result', async () => {
    const { start } = setup();
    const progress = vi.fn();
    const result = await runGraph([start], [], {}, progress);
    expect(progress.mock.calls).toEqual([
      ['start', 'running'],
      ['start', 'completed', result.steps],
    ]);
  });

  it('emits the failed step even when execution terminates without a failure edge', async () => {
    const { start } = setup();
    vi.mocked(navigateToStartUrl).mockRejectedValue(new Error('navigation failed'));
    const progress = vi.fn();
    const result = await runGraph([start], [], {}, progress);
    expect(result.ok).toBe(false);
    expect(progress).toHaveBeenLastCalledWith('start', 'completed', [expect.objectContaining({ ok: false, message: 'navigation failed' })]);
  });

  it('opens the URL even when the current address is exactly the same', async () => {
    const { start } = setup('https://example.com/app?view=correct');
    const result = await runGraph([start], []);
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, start.targetUrl, 30000, start.targetUrl, expect.any(AbortSignal));
    expect(result.steps[0].data).toMatchObject({ navigated: true, requestedUrl: start.targetUrl, previousUrl: start.targetUrl, url: start.targetUrl });
  });

  it('does not let non-strict URL comparison skip a different query parameter', async () => {
    const { start } = setup();
    const result = await runGraph([start], []);
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, start.targetUrl, 30000, 'https://example.com/app?view=wrong', expect.any(AbortSignal));
    expect(result.steps[0].data).toMatchObject({ previousUrl: 'https://example.com/app?view=wrong', url: start.targetUrl, navigated: true });
  });

  it('only reuses the current page when the Start URL is empty', async () => {
    const { start } = setup();
    const result = await runGraph([{ ...start, targetUrl: '' }], []);
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).not.toHaveBeenCalled();
    expect(result.steps[0].data).toMatchObject({ navigated: false, requestedUrl: '' });
  });

  it('resolves input variables before opening the URL', async () => {
    const { start } = setup();
    const result = await runGraph([{ ...start, targetUrl: 'https://example.com/app?view={{view}}' }], [], { view: 'report' });
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, 'https://example.com/app?view=report', 30000, 'https://example.com/app?view=wrong', expect.any(AbortSignal));
  });

  it('stops before any DOM operation when navigation fails', async () => {
    const { start, send } = setup();
    vi.mocked(navigateToStartUrl).mockRejectedValue(new Error('目标页面加载超时'));
    const dom: WorkflowNode = { id: 'input', name: '输入', kind: 'dom', target: { name: '日期', label: '日期', tagName: 'input', selector: '#datePeriod', frameId: 33 }, event: { type: 'input', value: '2026-10-01' } };
    const result = await runGraph([start, dom], [{ id: 'edge', sourceNodeId: start.id, sourcePort: 'success', targetNodeId: dom.id }]);
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });
});
