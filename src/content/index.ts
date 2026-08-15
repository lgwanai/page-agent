import type { RuntimeMessage } from '@/types/messages';
import { executeEvent, resolveSemanticTarget } from './executor';
import { startSelecting, stopSelecting } from './selector';

if (!(window as Window & { __pageAgentLoaded?: boolean }).__pageAgentLoaded) {
  (window as Window & { __pageAgentLoaded?: boolean }).__pageAgentLoaded = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'PAGE_AGENT_PING') {
      sendResponse({ ok: true, href: location.href, title: document.title });
      return false;
    }
    if (message.type === 'PAGE_AGENT_START_SELECT') {
      startSelecting((target) => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_SELECTED', target }).catch(() => undefined));
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAGE_AGENT_STOP_SELECT') {
      stopSelecting();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PAGE_AGENT_EXECUTE_EVENT') {
      const element = document.querySelector<HTMLElement>(message.selector);
      if (!element) {
        sendResponse({ ok: false, error: `节点不存在：${message.selector}` });
        return false;
      }
      void executeEvent(element, message.event)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_EXECUTE_AI') {
      try {
        const element = resolveSemanticTarget(message.instruction, message.scopeSelector);
        void executeEvent(element, message.event)
          .then((data) => sendResponse({ ok: true, data, selector: element.tagName.toLowerCase(), text: element.innerText?.slice(0, 120) }))
          .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return true;
    }
    return false;
  });
}
