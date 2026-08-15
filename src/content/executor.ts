import type { EventDefinition } from '@/types/workflow';

function dispatch(element: Element, type: string, init: EventInit = {}): void {
  element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
}

export async function executeEvent(element: HTMLElement, event: EventDefinition): Promise<unknown> {
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  switch (event.type) {
    case 'click':
      element.click();
      return 'clicked';
    case 'doubleClick':
      element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      return 'double clicked';
    case 'input': {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
        throw new Error('该节点不支持输入内容');
      }
      element.focus();
      const value = event.value ?? '';
      if (element.isContentEditable) element.textContent = value;
      else setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, value);
      dispatch(element, 'input');
      dispatch(element, 'change');
      element.blur();
      return value;
    }
    case 'select': {
      if (!(element instanceof HTMLSelectElement)) throw new Error('该节点不是下拉选择框');
      const value = event.value ?? '';
      const option = [...element.options].find((item) => item.value === value || item.text.trim() === value);
      if (!option) throw new Error(`找不到选项：${value}`);
      element.value = option.value;
      dispatch(element, 'input');
      dispatch(element, 'change');
      return option.text;
    }
    case 'check': {
      if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type)) {
        throw new Error('该节点不是勾选框或单选框');
      }
      const desired = event.value === undefined ? !element.checked : !['false', '0', '否', '取消'].includes(event.value);
      if (element.checked !== desired) element.click();
      dispatch(element, 'change');
      return desired;
    }
    case 'hover':
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
      return 'hovered';
    case 'focus': element.focus(); return 'focused';
    case 'blur': element.blur(); return 'blurred';
    case 'pressKey': {
      const key = event.value || 'Enter';
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
      return key;
    }
    case 'submit': {
      const form = element instanceof HTMLFormElement ? element : element.closest('form');
      if (!form) throw new Error('没有找到所属表单');
      form.requestSubmit();
      return 'submitted';
    }
    case 'scrollIntoView': return 'scrolled';
    case 'custom': {
      const type = event.customEvent?.trim();
      if (!type) throw new Error('请输入自定义事件名称');
      element.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: event.value }));
      return type;
    }
  }
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function tokens(instruction: string): string[] {
  const noise = /点击|双击|输入|选择|找到|查找|定位|按钮|列表|内容|然后|执行|打开|关闭|中的|一个|please|click|find|select|input/gi;
  const cleaned = instruction.replace(noise, ' ');
  return cleaned.split(/[\s,，。:："'“”‘’]+/).map(normalized).filter((part) => part.length > 1);
}

function accessibleText(element: HTMLElement): string {
  const id = element.id;
  const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : '';
  const rowContext = element.closest('tr,li,[role="row"],[role="listitem"]');
  const values = [
    element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('placeholder'),
    element.getAttribute('name'), element.getAttribute('value'), explicitLabel, element.closest('label')?.textContent,
    element.innerText, element.textContent, rowContext && rowContext !== element ? rowContext.textContent : '',
  ];
  return normalized(values.filter(Boolean).join(' '));
}

export function resolveSemanticTarget(instruction: string, scopeSelector?: string): HTMLElement {
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!scope) throw new Error(`AI 节点范围不存在：${scopeSelector}`);
  const candidates = [...scope.querySelectorAll<HTMLElement>(
    'button, a, input, textarea, select, [role="button"], [role="option"], [role="menuitem"], [tabindex], label, li, tr',
  )].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
  const queryTokens = tokens(instruction);
  let best: { element: HTMLElement; score: number } | undefined;
  for (const element of candidates) {
    const text = accessibleText(element);
    let score = queryTokens.reduce((sum, token) => sum + (text.includes(token) ? token.length + 2 : 0), 0);
    if (/点击|click/i.test(instruction) && (element.matches('button,a,[role="button"]'))) score += 2;
    if (/输入|input|填写/i.test(instruction) && element.matches('input,textarea,[contenteditable]')) score += 3;
    if (/选择|select/i.test(instruction) && element.matches('select,[role="option"]')) score += 3;
    if (!best || score > best.score) best = { element, score };
  }
  if (!best || best.score <= 0) throw new Error(`AI 节点没有找到匹配元素：${instruction}`);
  return best.element;
}
