import type { StartNode } from '@/types/workflow';
import { interpolate } from './runtime-values';
import { navigateToStartUrl } from './start-navigation';
import { checkCancellation, pauseExecution, RunCancelled, executionSignal } from './execution-control';
type Variables = Record<string, unknown>;
type RuntimeContext = Record<string, unknown>;
function comparablePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function matchesTargetUrl(currentUrl: string | undefined, targetUrl: string, strict: boolean): boolean {
  if (!currentUrl) return false;
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.protocol !== target.protocol || current.host !== target.host) return false;
    if (comparablePath(current.pathname) !== comparablePath(target.pathname)) return false;
    return !strict || current.search === target.search;
  } catch {
    return false;
  }
}

function duration(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, max)) : fallback;
}

async function waitForTab(
  tabId: number,
  predicate: (tab: chrome.tabs.Tab) => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<chrome.tabs.Tab> {
  checkCancellation();
  const current = await chrome.tabs.get(tabId);
  checkCancellation();
  if (predicate(current)) return current;
  return new Promise((resolve, reject) => {
    const signal = executionSignal();
    const abort = () => { cleanup(); reject(new RunCancelled()); };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const finish = (tab: chrome.tabs.Tab) => {
      cleanup();
      resolve(tab);
    };
    const onUpdated = (updatedTabId: number, _change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId === tabId && predicate(tab)) finish(tab);
    };
    const onRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error('目标页面已关闭'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

export async function prepareStart(
  tabId: number,
  node: StartNode,
  variables: Variables,
  context: RuntimeContext,
): Promise<{ url: string; navigated: boolean; previousUrl?: string; requestedUrl: string }> {
  const targetUrl = node.keepCurrentPage ? '' : interpolate(node.targetUrl, variables, context)?.trim() ?? '';
  if (targetUrl) {
    let parsed: URL;
    try { parsed = new URL(targetUrl); } catch { throw new Error(`目标页面 URL 无效：${targetUrl}`); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Start 只支持 http/https 目标页面');
  }

  const loadTimeout = duration(node.loadTimeoutMs, 30_000, 300_000);
  const loginTimeout = duration(node.loginTimeoutMs, 300_000, 1_800_000);
  let tab = await chrome.tabs.get(tabId);
  checkCancellation();
  const previousUrl = tab.url;
  let navigated = false;
  if (targetUrl) {
    // A matching address is not a clean workflow entry state (SPA state, forms, iframes).
    // A configured Start URL means open it on EVERY run; only an empty URL reuses the page.
    tab = await navigateToStartUrl(tabId, targetUrl, loadTimeout, previousUrl, executionSignal());
    navigated = true;
  } else if (tab.status !== 'complete') {
    tab = await waitForTab(tabId, (candidate) => candidate.status === 'complete', loadTimeout, '当前页面加载超时');
  }

  if (targetUrl && !matchesTargetUrl(tab.url, targetUrl, node.strictValidation)) {
    if (!node.waitForLogin) throw new Error(`页面未到达目标 URL：${tab.url ?? '未知地址'}`);
    tab = await waitForTab(
      tabId,
      (candidate) => candidate.status === 'complete' && matchesTargetUrl(candidate.url, targetUrl, node.strictValidation),
      loginTimeout,
      '等待登录完成超时',
    );
  }

  const settleDelay = duration(node.settleDelayMs, 500, 60_000);
  if (settleDelay) await pauseExecution(settleDelay);
  const finalTab = await chrome.tabs.get(tabId);
  if (!/^https?:/i.test(finalTab.url ?? '')) throw new Error('Start 最终页面不是可操作的 http/https 网页');
  if (targetUrl && !matchesTargetUrl(finalTab.url, targetUrl, node.strictValidation)) {
    throw new Error(`页面校验失败：${finalTab.url ?? '未知地址'}`);
  }
  return { url: finalTab.url!, navigated, previousUrl, requestedUrl: targetUrl };
}

