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
      const matched = document.querySelector(message.selector);
      const element = matched instanceof HTMLElement ? matched : undefined;
      if (!element) {
        sendResponse({ ok: false, error: matched ? `Selector 命中的节点不是可操作的 HTML 元素：${message.selector}` : `节点不存在：${message.selector}` });
        return false;
      }
      void executeEvent(element, message.event)
        .then(({ output, verification }) => sendResponse({ ok: verification.ok, data: output, verification, error: verification.ok ? undefined : verification.summary }))
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.type === 'PAGE_AGENT_EXECUTE_AI') {
      try {
        const element = resolveSemanticTarget(message.instruction, message.scopeSelector);
        void executeEvent(element, message.event)
          .then(({ output, verification }) => sendResponse({ ok: verification.ok, data: output, verification, selector: element.tagName.toLowerCase(), text: element.innerText?.slice(0, 120), error: verification.ok ? undefined : verification.summary }))
          .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return true;
    }
    if (message.type === 'PAGE_AGENT_READ_SELECTOR') {
      try {
        const elements = message.multiple
          ? [...document.querySelectorAll<HTMLElement>(message.selector)]
          : [document.querySelector<HTMLElement>(message.selector)].filter(Boolean) as HTMLElement[];
        if (!elements.length) throw new Error(`输入 selector 不存在：${message.selector}`);
        const values = elements.map((element) => {
          const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
            ? element.value : undefined;
          const attributes = Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value]));
          if (message.attribute === 'value') return value ?? '';
          if (message.attribute === 'html') return element.innerHTML;
          if (message.attribute === 'attributes') return attributes;
          return (element.innerText || element.textContent || value || '').trim();
        });
        sendResponse({ ok: true, data: message.multiple ? values : values[0], count: values.length });
      } catch (error) {
        sendResponse({ ok: false, error: (error as Error).message });
      }
      return false;
    }
    return false;
  });
}
