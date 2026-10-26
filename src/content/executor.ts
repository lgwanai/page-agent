import type { EventDefinition, ExecutionVerification } from '@/types/workflow';
import { replayDrag } from './drag';
import { focusElement } from './focus';
import { selectCombobox } from './combobox';

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
  const mouse = { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView, button: 0, buttons: 1, detail };
  element.dispatchEvent(new PointerEvent('pointerdown', { ...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mousedown', mouse));
  element.focus({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', { ...mouse, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }));
  element.click();
}

const IMPLICIT_SUBMIT_INPUT_TYPES = new Set(['text', 'search', 'tel', 'url', 'email', 'password', 'date', 'month', 'week', 'time', 'datetime-local', 'number']);

function pressKeyAsUser(element: HTMLElement, key: string, definition: EventDefinition): void {
  const form = element instanceof HTMLInputElement || element instanceof HTMLButtonElement
    ? element.form : element.closest('form');
  let submitted = false;
  let activated = false;
  const observeClick = () => { activated = true; };
  element.addEventListener('click', observeClick, true);
  const modifiers = definition.modifiers ?? {};
  const init = { key, code: definition.code || (key === ' ' ? 'Space' : key), bubbles: true, cancelable: true, altKey: Boolean(modifiers.alt), ctrlKey: Boolean(modifiers.ctrl), metaKey: Boolean(modifiers.meta), shiftKey: Boolean(modifiers.shift) };
  const observeSubmit = () => { submitted = true; };
  form?.addEventListener('submit', observeSubmit, true);
  try {
    element.focus();
    const keydownAllowed = element.dispatchEvent(new KeyboardEvent('keydown', init));
    const keypressAllowed = keydownAllowed
      ? element.dispatchEvent(new KeyboardEvent('keypress', init))
      : false;
    const keyupAllowed = element.dispatchEvent(new KeyboardEvent('keyup', init));
    if (!keydownAllowed || !keypressAllowed || submitted || activated || !element.isConnected || modifiers.alt || modifiers.ctrl || modifiers.meta) return;
    if (key === ' ' && keyupAllowed && (element instanceof HTMLButtonElement || element instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(element.type))) {
      element.click(); return;
    }
    if (key !== 'Enter') return;
    // Synthetic keyboard events do not perform native Enter activation/implicit submission.
    // Respect page handlers first, then provide only the missing browser default action.
    if (element instanceof HTMLButtonElement || (element instanceof HTMLInputElement && ['submit', 'image', 'button', 'reset'].includes(element.type))) {
      element.click();
    } else if (form && element instanceof HTMLInputElement && IMPLICIT_SUBMIT_INPUT_TYPES.has(element.type)) {
      const controls = [...form.elements];
      const submitter = controls.find((control) => (control instanceof HTMLButtonElement && control.type === 'submit')
        || (control instanceof HTMLInputElement && ['submit', 'image'].includes(control.type))) as HTMLButtonElement | HTMLInputElement | undefined;
      if (submitter) {
        if (!submitter.disabled) submitter.click();
      } else if (controls.filter((control) => control instanceof HTMLInputElement && IMPLICIT_SUBMIT_INPUT_TYPES.has(control.type)).length === 1) {
        form.requestSubmit();
      }
    }
  } finally {
    form?.removeEventListener('submit', observeSubmit, true);
    element.removeEventListener('click', observeClick, true);
  }
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
  if (event.type === 'mouseLeave') return 'mouseout';
  if (event.type === 'scrollIntoView') return undefined;
  if (event.type === 'scrollPage') return 'scroll';
  if (event.type === 'contextMenu') return 'contextmenu';
  if (event.type === 'longPress') return 'pointerup';
  if (event.type === 'drag') return 'pointerdown';
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
  if (event.type === 'select' && event.optionalValue && !event.value?.trim()) return {
    output: { skipped: true }, verification: { ok: true, summary: '可选筛选值为空，保持控件不变并跳过选择' },
  };
  if (!['blur', 'focusout', 'mouseLeave'].includes(event.type)) element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  const nativeCheck = event.type === 'check' && element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type);
  const checkLabel = nativeCheck ? (element as HTMLInputElement).labels?.[0] : undefined;
  // Design-system radios often make the native input transparent. Operate its
  // visible associated label, while still verifying the actual input.checked.
  const interactionTarget = nativeCheck && checkLabel && getComputedStyle(element).opacity === '0' ? checkLabel : element;
  const rect = interactionTarget.getBoundingClientRect();
  const style = getComputedStyle(interactionTarget);
  const userOperation = ['click', 'doubleClick', 'input', 'select', 'check', 'hover', 'focus', 'focusin', 'pressKey', 'submit', 'reset', 'contextMenu', 'longPress', 'drag'].includes(event.type);
  if (userOperation && (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0)) {
    throw new Error('Selector 找到的节点当前不可见，无法按用户方式操作');
  }
  if (userOperation) {
    const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const topElement = document.elementFromPoint(centerX, centerY);
    if (topElement && topElement !== interactionTarget && !interactionTarget.contains(topElement) && !topElement.contains(interactionTarget)) {
      throw new Error(`目标节点被其他元素遮挡：${topElement.tagName.toLowerCase()}`);
    }
  }
  if (isDisabled(element) && ['click', 'doubleClick', 'input', 'select', 'check', 'pressKey', 'submit'].includes(event.type)) {
    throw new Error('目标节点当前处于禁用状态');
  }
  if (event.type === 'select' && !(element instanceof HTMLSelectElement)) return selectCombobox(element, event, clickAsUser);

  const expectedEvent = eventName(event);
  let observed = false;
  let mutationCount = 0;
  const observeEvent = (native: Event) => { if (native.target === element || native.target instanceof Node && element.contains(native.target)) observed = true; };
  if (expectedEvent) document.addEventListener(expectedEvent, observeEvent, true);
  const observer = new MutationObserver((records) => { mutationCount += records.length; });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  try {
    let output: unknown;
    const inputEvidence: string[] = [];
    let resetExpected: unknown;
    let resetForm: HTMLFormElement | undefined;
    const formValues = (form: HTMLFormElement) => [...form.elements].filter(el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement).map(el => {
      if (el instanceof HTMLInputElement && el.type === 'password') return { passwordAtDefault: el.value === el.defaultValue };
      if (el instanceof HTMLSelectElement && el.multiple) return [...el.selectedOptions].map(option => option.value);
      return currentValue(el as HTMLElement);
    });
    switch (event.type) {
      case 'upload': throw new Error('上传文件需要通过工作流后台读取本机路径，不能直接在页面执行');
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
        // Opening a controlled picker can schedule a render with the previous
        // value. Complete that focus transition before writing a new draft.
        await settle();
        if (!element.isConnected) throw new Error('聚焦后页面替换了输入节点，请重新定位后执行');
        inputEvidence.push(`聚焦更新后：${String(currentValue(element) ?? '')}`);
        const value = event.value ?? '';
        if (element.isContentEditable) element.textContent = value;
        else setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, value);
        inputEvidence.push(`设置值后：${String(currentValue(element) ?? '')}`);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
        // Controlled inputs can update their draft state asynchronously. Blurring in
        // the same task lets date pickers restore their previous committed value.
        await settle();
        inputEvidence.push(`input 更新后：${String(currentValue(element) ?? '')}`);
        const datePicker = element instanceof HTMLInputElement && element.type === 'text'
          && /^\d{4}-\d{2}-\d{2}$/.test(value)
          && !!element.closest('[class*="picker-input"], [class*="datepicker"], [class*="date-picker"]');
        if (datePicker && element.value === value) {
          // Only notify the date widget; do not invoke the generic Enter helper,
          // which deliberately supplies native form submission as a fallback.
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          await settle();
          inputEvidence.push(`日期确认后：${element.value}`);
        }
        dispatch(element, 'change');
        await settle();
        inputEvidence.push(`change 更新后：${String(currentValue(element) ?? '')}`);
        if (!event.keepFocus) element.blur();
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
        if (element.checked !== desired) interactionTarget.click();
        dispatch(element, 'change');
        output = desired;
        break;
      }
      case 'hover':
        element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: element.ownerDocument.defaultView }));
        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: element.ownerDocument.defaultView }));
        output = 'hovered';
        break;
      case 'mouseLeave':
        element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
        element.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
        element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, view: element.ownerDocument.defaultView }));
        element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, view: element.ownerDocument.defaultView }));
        output = 'mouse left'; break;
      case 'focus': case 'focusin': {
        const receipt = focusElement(element);
        inputEvidence.push(`网页焦点=${receipt.documentFocused}；原生 focusin=${receipt.nativeFocusIn}；补齐焦点事件=${receipt.repaired.join(',') || '无'}`);
        output = 'focused'; break;
      }
      case 'blur': case 'focusout': {
        if (document.activeElement === element && event.relatedSelector) {
          let matches: Element[];
          try { matches = [...document.querySelectorAll(event.relatedSelector)]; } catch { throw new Error('焦点转移目标 Selector 无效'); }
          if (matches.length !== 1 || !(matches[0] instanceof HTMLElement) || matches[0] === element) throw new Error('焦点转移目标不唯一或不存在，请更新关联 Selector');
          matches[0].focus();
        } else element.blur();
        output = 'blurred'; break;
      }
      case 'change': dispatch(element, 'change'); output = 'change notified'; break;
      case 'reset': {
        const form = element instanceof HTMLFormElement ? element : element.closest('form');
        if (!form) throw new Error('没有找到需要重置的表单');
        const clone = form.cloneNode(true) as HTMLFormElement;
        HTMLFormElement.prototype.reset.call(clone);
        resetExpected = formValues(clone); resetForm = form;
        HTMLFormElement.prototype.reset.call(form); output = 'form reset'; break;
      }
      case 'pressKey': {
        const key = ['Space', 'Spacebar'].includes(event.value ?? '') ? ' ' : event.value || 'Enter';
        pressKeyAsUser(element, key, event);
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
      case 'scrollPage': {
        let position = { x: 0, y: 0 };
        try { position = JSON.parse(event.value || '{}') as { x: number; y: number }; } catch { /* use origin */ }
        if (element === document.documentElement || element === document.body) {
          window.scrollTo({ left: Number(position.x) || 0, top: Number(position.y) || 0, behavior: 'auto' });
        } else {
          element.scrollTo({ left: Number(position.x) || 0, top: Number(position.y) || 0, behavior: 'auto' });
        }
        output = position;
        break;
      }
      case 'contextMenu':
        element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, button: 2, buttons: 2 }));
        output = 'context menu';
        break;
      case 'drag': {
        const result = await replayDrag(element, event.value);
        return { output: result, verification: verification(result.moved, result.moved ? '拖拽后已检测到元素位置或拖放内容变化' : '拖拽事件已发送，但未检测到移动或拖放结果，操作失败', { dx: result.dx, dy: result.dy }, result, []) };
      }
      case 'longPress': {
        const duration = Math.max(650, Math.min(5000, Number(event.value) || 650));
        const mouse = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
        element.dispatchEvent(new PointerEvent('pointerdown', { ...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        element.dispatchEvent(new MouseEvent('mousedown', mouse));
        await new Promise((resolve) => window.setTimeout(resolve, duration));
        element.dispatchEvent(new PointerEvent('pointerup', { ...mouse, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }));
        output = duration;
        break;
      }
      case 'custom': {
        const type = event.customEvent?.trim();
        if (!type) throw new Error('请输入自定义事件名称');
        element.dispatchEvent(new CustomEvent(type, { bubbles: true, cancelable: true, detail: event.value }));
        output = type;
        break;
      }
    }

    await settle();
    const evidence = [...inputEvidence, observed ? `已捕获 ${expectedEvent} 事件` : '', mutationCount ? `页面发生 ${mutationCount} 处变化` : '']
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
    if (['focus', 'blur', 'focusin', 'focusout'].includes(event.type)) {
      const expected = event.type === 'focus' || event.type === 'focusin';
      const actual = document.activeElement === element;
      const ok = actual === expected;
      return { output, verification: verification(ok, ok ? `${expected ? '聚焦' : '失焦'}状态已验证` : `${expected ? '聚焦' : '失焦'}没有生效`, expected, actual, evidence) };
    }
    if (event.type === 'reset' && resetForm) {
      const actual = formValues(resetForm);
      const ok = observed && JSON.stringify(actual) === JSON.stringify(resetExpected);
      return { output, verification: verification(ok, ok ? '表单已恢复默认值' : '表单未恢复默认值，可能被页面取消或重置后恢复', resetExpected, actual, evidence) };
    }
    if (event.type === 'scrollIntoView') {
      const rect = element.getBoundingClientRect();
      const actual = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      return { output, verification: verification(actual, actual ? '节点已进入可视区域' : '滚动后节点仍不在可视区域', true, actual, evidence) };
    }
    if (event.type === 'scrollPage') {
      let expected = { x: 0, y: 0 };
      try { expected = JSON.parse(event.value || '{}') as { x: number; y: number }; } catch { /* use origin */ }
      const page = element === document.documentElement || element === document.body;
      const actual = { x: Math.round(page ? scrollX : element.scrollLeft), y: Math.round(page ? scrollY : element.scrollTop) };
      const ok = Math.abs(actual.x - (Number(expected.x) || 0)) <= 2 && Math.abs(actual.y - (Number(expected.y) || 0)) <= 2;
      return { output, verification: verification(ok, ok ? '页面滚动位置已验证' : '页面没有滚动到录制位置', expected, actual, evidence) };
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
