import type { EventDefinition, ExecutionVerification } from '@/types/workflow';

export interface EventExecutionResult {
  output?: unknown;
  verification: ExecutionVerification;
}

function dispatch(element: Element, type: string, init: EventInit = {}): void {
  element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, ...init }));
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
}

function clickAsUser(element: HTMLElement, detail = 1): void {
  const mouse = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1, detail };
  element.dispatchEvent(new PointerEvent('pointerdown', { ...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mousedown', mouse));
  element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', { ...mouse, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }));
  element.click();
}

function isDisabled(element: HTMLElement): boolean {
  return (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
    ? element.disabled
    : element.getAttribute('aria-disabled') === 'true';
}

function currentValue(element: HTMLElement): unknown {
  if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) return element.checked;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? '';
  return undefined;
}

function eventName(event: EventDefinition): string | undefined {
  if (event.type === 'doubleClick') return 'dblclick';
  if (event.type === 'pressKey') return 'keydown';
  if (event.type === 'hover') return 'mouseover';
  if (event.type === 'scrollIntoView') return undefined;
  if (event.type === 'custom') return event.customEvent?.trim();
  return event.type === 'check' || event.type === 'select' ? 'change' : event.type;
}

function verification(ok: boolean, summary: string, expected?: unknown, actual?: unknown, evidence: string[] = []): ExecutionVerification {
  return { ok, summary, expected, actual, evidence };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 80));
}

export async function executeEvent(element: HTMLElement, event: EventDefinition): Promise<EventExecutionResult> {
  if (!element.isConnected) throw new Error('目标节点已不在当前页面中');
  element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const userOperation = ['click', 'doubleClick', 'input', 'select', 'check', 'hover', 'focus', 'pressKey', 'submit'].includes(event.type);
  if (userOperation && (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0)) {
    throw new Error('Selector 找到的节点当前不可见，无法按用户方式操作');
  }
  if (userOperation) {
    const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const topElement = document.elementFromPoint(centerX, centerY);
    if (topElement && topElement !== element && !element.contains(topElement) && !topElement.contains(element)) {
      throw new Error(`目标节点被其他元素遮挡：${topElement.tagName.toLowerCase()}`);
    }
  }
  if (isDisabled(element) && ['click', 'doubleClick', 'input', 'select', 'check', 'pressKey', 'submit'].includes(event.type)) {
    throw new Error('目标节点当前处于禁用状态');
  }

  const expectedEvent = eventName(event);
  let observed = false;
  let mutationCount = 0;
  const observeEvent = () => { observed = true; };
  if (expectedEvent) document.addEventListener(expectedEvent, observeEvent, true);
  const observer = new MutationObserver((records) => { mutationCount += records.length; });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  try {
    let output: unknown;
    switch (event.type) {
      case 'click':
        clickAsUser(element);
        output = 'clicked';
        break;
      case 'doubleClick':
        clickAsUser(element, 1);
        clickAsUser(element, 2);
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        output = 'double clicked';
        break;
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
        output = value;
        break;
      }
      case 'select': {
        if (!(element instanceof HTMLSelectElement)) throw new Error('该节点不是下拉选择框');
        const value = event.value ?? '';
        const option = [...element.options].find((item) => item.value === value || item.text.trim() === value);
        if (!option) throw new Error(`找不到选项：${value}`);
        element.value = option.value;
        dispatch(element, 'input');
        dispatch(element, 'change');
        output = option.value;
        break;
      }
      case 'check': {
        if (!(element instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(element.type)) {
          throw new Error('该节点不是勾选框或单选框');
        }
        const desired = event.value === undefined ? !element.checked : !['false', '0', '否', '取消'].includes(event.value);
        if (element.checked !== desired) element.click();
        dispatch(element, 'change');
        output = desired;
        break;
      }
      case 'hover':
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
        output = 'hovered';
        break;
      case 'focus': element.focus(); output = 'focused'; break;
      case 'blur': element.blur(); output = 'blurred'; break;
      case 'pressKey': {
        const key = event.value || 'Enter';
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, bubbles: true, cancelable: true }));
        element.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
        output = key;
        break;
      }
      case 'submit': {
        const form = element instanceof HTMLFormElement ? element : element.closest('form');
        if (!form) throw new Error('没有找到所属表单');
        form.requestSubmit();
        output = 'submitted';
        break;
      }
      case 'scrollIntoView': output = 'scrolled'; break;
      case 'custom': {
        const type = event.customEvent?.trim();
        if (!type) throw new Error('请输入自定义事件名称');
        element.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: event.value }));
        output = type;
        break;
      }
    }

    await settle();
    const evidence = [observed ? `已捕获 ${expectedEvent} 事件` : '', mutationCount ? `页面发生 ${mutationCount} 处变化` : '']
      .filter(Boolean);

    if (event.type === 'input') {
      const expected = event.value ?? '';
      const actual = currentValue(element);
      const ok = actual === expected;
      return { output, verification: verification(ok, ok ? `输入已验证：实际值与「${expected}」一致` : `输入失败：期望「${expected}」，实际为「${String(actual ?? '')}」`, expected, actual, evidence) };
    }
    if (event.type === 'select') {
      const select = element as HTMLSelectElement;
      const requested = event.value ?? '';
      const option = [...select.options].find((item) => item.value === requested || item.text.trim() === requested);
      const expected = option?.value ?? requested;
      const actual = select.value;
      const ok = actual === expected && observed;
      return { output, verification: verification(ok, ok ? `选项已验证：${option?.text.trim() || actual}` : `选择失败：期望「${expected}」，实际为「${actual}」`, expected, actual, evidence) };
    }
    if (event.type === 'check') {
      const expected = output;
      const actual = currentValue(element);
      const ok = actual === expected;
      return { output, verification: verification(ok, ok ? `勾选状态已验证：${actual ? '已勾选' : '未勾选'}` : '勾选状态与预期不符', expected, actual, evidence) };
    }
    if (event.type === 'focus' || event.type === 'blur') {
      const expected = event.type === 'focus';
      const actual = document.activeElement === element;
      const ok = actual === expected;
      return { output, verification: verification(ok, ok ? `${event.type === 'focus' ? '聚焦' : '失焦'}状态已验证` : `${event.type === 'focus' ? '聚焦' : '失焦'}没有生效`, expected, actual, evidence) };
    }
    if (event.type === 'scrollIntoView') {
      const rect = element.getBoundingClientRect();
      const actual = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      return { output, verification: verification(actual, actual ? '节点已进入可视区域' : '滚动后节点仍不在可视区域', true, actual, evidence) };
    }

    const ok = observed;
    return {
      output,
      verification: verification(
        ok,
        ok ? `${event.type === 'click' ? '点击' : event.type === 'doubleClick' ? '双击' : event.type === 'submit' ? '提交' : '操作'}事件已真实触发` : '页面没有收到预期事件',
        expectedEvent,
        observed ? expectedEvent : undefined,
        evidence,
      ),
    };
  } finally {
    observer.disconnect();
    if (expectedEvent) document.removeEventListener(expectedEvent, observeEvent, true);
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
