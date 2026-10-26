import { RunCancelled } from './execution-control';
/** Wait for a NEW main-document navigation, never the previous tab's cached complete status. */
export function navigateToStartUrl(tabId: number, url: string, timeoutMs: number, previousUrl?: string, signal?: AbortSignal): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    let committed = false;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const complete = (tab: chrome.tabs.Tab) => {
      if (finished || !committed || tab.status !== 'complete') return;
      finished = true;
      cleanup();
      resolve(tab);
    };
    const onUpdated = (updatedId: number, _change: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedId === tabId) complete(tab);
    };
    const onRemoved = (removedId: number) => {
      if (removedId === tabId) fail(new Error('目标页面已关闭'));
    };
    const onCommitted = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
      if (details.tabId !== tabId || details.frameId !== 0 || finished) return;
      committed = true;
      void chrome.tabs.get(tabId).then(complete).catch((error: Error) => fail(error));
    };
    const abort = () => fail(new RunCancelled());
    const timer = setTimeout(() => fail(new Error(`目标页面加载超时：${url}`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    // Register before update: a fast load can commit before tabs.update resolves.
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    const navigate = async () => {
      let sameDocument = false;
      try {
        const current = new URL(previousUrl ?? '');
        const target = new URL(url);
        current.hash = '';
        target.hash = '';
        sameDocument = current.href === target.href;
      } catch { /* A missing/invalid current URL requires normal navigation. */ }
      if (sameDocument) {
        // A hash-only update is a same-document navigation. Reload explicitly so
        // Start still gets a fresh main document and a real onCommitted event.
        if (previousUrl !== url) await chrome.tabs.update(tabId, { url });
        if (signal?.aborted) throw new RunCancelled();
        await chrome.tabs.reload(tabId);
      } else await chrome.tabs.update(tabId, { url });
    };
    void navigate().catch((error: Error) => fail(error));
  });
}
