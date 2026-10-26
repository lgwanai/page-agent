import type { PageTarget } from '@/types/workflow';
import { matchesFrameUrl } from '@/shared/frame-context';

const canonical = (value: string) => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return value; } };

/** Follow only tabs created by this execution, never an arbitrary active/existing tab. */
export class WorkflowTabs {
  private root: number;
  private current: number;
  private armed = 0;
  private tabs = new Map<number, Set<string>>();
  private remember(id: number, url?: string) {
    const urls = this.tabs.get(id) ?? new Set<string>();
    if (url && /^https?:/.test(url)) urls.add(canonical(url));
    this.tabs.set(id, urls);
  }
  private opened = (event: chrome.webNavigation.WebNavigationSourceCallbackDetails) => {
    if (this.armed && this.tabs.has(event.sourceTabId)) this.remember(event.tabId, event.url);
  };
  private created = (tab: chrome.tabs.Tab) => {
    if (this.armed && tab.id !== undefined && tab.openerTabId !== undefined && this.tabs.has(tab.openerTabId)) this.remember(tab.id, tab.pendingUrl || tab.url);
  };
  private updated = (id: number, change: chrome.tabs.TabChangeInfo) => {
    if (this.tabs.has(id) && change.url) this.remember(id, change.url);
  };
  private history = (event: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
    if (event.frameId === 0 && this.tabs.has(event.tabId)) this.remember(event.tabId, event.url);
  };
  constructor(tabId: number) {
    this.root = tabId; this.current = tabId; this.remember(tabId);
    chrome.webNavigation?.onCreatedNavigationTarget?.addListener(this.opened);
    chrome.webNavigation?.onHistoryStateUpdated?.addListener(this.history);
    chrome.webNavigation?.onCommitted?.addListener(this.history);
    chrome.tabs.onCreated?.addListener(this.created);
    chrome.tabs.onUpdated?.addListener(this.updated);
  }
  dispose() {
    chrome.webNavigation?.onCreatedNavigationTarget?.removeListener(this.opened);
    chrome.webNavigation?.onHistoryStateUpdated?.removeListener(this.history);
    chrome.webNavigation?.onCommitted?.removeListener(this.history);
    chrome.tabs.onCreated?.removeListener(this.created);
    chrome.tabs.onUpdated?.removeListener(this.updated);
  }
  async during<T>(action: () => Promise<T>): Promise<T> {
    this.armed++;
    try { return await action(); } finally { this.armed--; }
  }
  async resolve(target?: PageTarget): Promise<{ tabId: number; frameUrl?: string }> {
    // iframe URLs are not top-level navigation destinations.
    if (!target?.frameUrl || target.frameId !== 0) return { tabId: this.current, frameUrl: target?.frameUrl };
    const wanted = canonical(target.frameUrl);
    const findMatches = () => [...this.tabs].filter(([, urls]) => [...urls].some(url => matchesFrameUrl(url, wanted, target.frameQueryKeys))).map(([id]) => id);
    let matches = findMatches();
    // A newly opened document can acquire its final SPA URL AFTER the click reply.
    // Observe only this execution's child tabs; never query/adopt arbitrary tabs.
    if (!matches.length && this.tabs.size > 1) {
      const deadline = Date.now() + 10_000;
      do {
        await Promise.all([...this.tabs.keys()].filter(id => id !== this.root).map(async id => {
          try { const tab = await chrome.tabs.get(id); this.remember(id, tab.url); this.remember(id, tab.pendingUrl); }
          catch { /* Closed child tabs are not candidates. */ }
        }));
        matches = findMatches();
        if (matches.length || Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      } while (!matches.length);
    }
    if (matches.length > 1) throw new Error('本次操作打开了多个匹配目标页面的标签页，无法安全选择；未发送操作');
    if (matches.length === 1) {
      const id = matches[0];
      const deadline = Date.now() + 10_000;
      let tab = await chrome.tabs.get(id);
      while (tab.status === 'loading' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100)); tab = await chrome.tabs.get(id);
      }
      if (tab.status === 'loading') throw new Error('工作流打开的新标签页加载超时；未发送操作');
      if (tab.url && canonical(tab.url) !== wanted) {
        const expected = new URL(target.frameUrl), actual = new URL(tab.url);
        const compatible = target.frameQueryKeys !== undefined
          ? matchesFrameUrl(tab.url, target.frameUrl, target.frameQueryKeys)
          : expected.origin === actual.origin && [...expected.searchParams].every(([key, value]) => actual.searchParams.getAll(key).includes(value));
        if (!compatible) {
          throw new Error(`目标标签页已跳转到不同站点或业务参数，无法安全定位；未发送操作：${tab.url}`);
        }
      }
      this.current = id;
      // The initial URL and final redirected/SPA URL belong to this observed tab.
      // This bypasses stale route strings, not frame uniqueness or element identity.
      return { tabId: id, frameUrl: tab.url && /^https?:/.test(tab.url) ? tab.url : target.frameUrl };
    }
    return { tabId: this.current, frameUrl: target.frameUrl };
  }
}
