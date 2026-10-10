import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
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
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, start.targetUrl, 30000, start.targetUrl);
    expect(result.steps[0].data).toMatchObject({ navigated: true, requestedUrl: start.targetUrl, previousUrl: start.targetUrl, url: start.targetUrl });
  });

  it('does not let non-strict URL comparison skip a different query parameter', async () => {
    const { start } = setup();
    const result = await runGraph([start], []);
    expect(result.ok).toBe(true);
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, start.targetUrl, 30000, 'https://example.com/app?view=wrong');
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
    expect(navigateToStartUrl).toHaveBeenCalledWith(1, 'https://example.com/app?view=report', 30000, 'https://example.com/app?view=wrong');
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
