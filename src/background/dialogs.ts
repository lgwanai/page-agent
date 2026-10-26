import { hasConfiguredDialog } from './browser-dialog';
// Reserve the scope before navigating too: nested calls must not race to attach.
const ownedTabs = new Set<number>();
/** Nested nodes reuse our debugger; explicit dialog nodes override the alert default. */
export async function withAlertConfirmation<T>(tabId: number, action: () => Promise<T>): Promise<T> {
  if (!chrome.debugger?.attach) return action(); // Test/non-Chrome environments.
  if (ownedTabs.has(tabId)) return action();
  const target = { tabId };
  let attached = false;
  let attaching: Promise<void> | undefined;
  let rejectGuard: (error: unknown) => void = () => undefined;
  const guardFailure = new Promise<never>((_resolve, reject) => { rejectGuard = reject; });
  void guardFailure.catch(() => undefined);
  const attach = () => attaching ??= (async () => {
    try { await chrome.debugger.attach(target, '1.3'); }
    catch (error) { throw new Error(`无法启用 alert 自动处理：${(error as Error).message}。请确认插件已更新并授权调试权限，且目标标签页未被其他调试器占用。`); }
    attached = true;
    await chrome.debugger.sendCommand(target, 'Page.enable');
  })();
  const committed = (event: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
    if (event.tabId === tabId && event.frameId === 0 && /^https?:\/\//i.test(event.url)) void attach().catch(rejectGuard);
  };
  const updated = (id: number, change: chrome.tabs.TabChangeInfo) => {
    if (!chrome.webNavigation?.onCommitted && id === tabId && change.url && /^https?:\/\//i.test(change.url)) void attach().catch(rejectGuard);
  };
  const listener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
    if (source.tabId !== tabId || method !== 'Page.javascriptDialogOpening' || (params as { type?: string })?.type !== 'alert' || hasConfiguredDialog(tabId)) return;
    void chrome.debugger.sendCommand(source, 'Page.handleJavaScriptDialog', { accept: true })
      .catch(() => console.warn('[page-agent] 自动关闭 alert 失败，请检查浏览器调试连接'));
  };
  chrome.debugger.onEvent.addListener(listener);
  ownedTabs.add(tabId);
  try {
    // Chrome rejects debugger.attach on chrome:// pages. Let Start navigate first,
    // and arm the debugger on the new document, not after waiting for page load
    // (an alert during load could otherwise block Start indefinitely).
    chrome.webNavigation?.onCommitted?.addListener(committed);
    chrome.tabs?.onUpdated?.addListener(updated);
    const tab = chrome.tabs?.get ? await chrome.tabs.get(tabId) : undefined;
    if (!tab || /^https?:\/\//i.test(tab.url ?? '')) await attach();
    const result = await Promise.race([action(), guardFailure]);
    if (attaching) await attaching;
    return result;
  } finally {
    chrome.webNavigation?.onCommitted?.removeListener(committed);
    chrome.tabs?.onUpdated?.removeListener(updated);
    chrome.debugger.onEvent.removeListener(listener);
    // A failed action may finish while a navigation-triggered attach is pending.
    // Wait before cleanup so that it cannot leak a debugger into the next run.
    if (attaching) await attaching.catch(() => undefined);
    ownedTabs.delete(tabId);
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}
