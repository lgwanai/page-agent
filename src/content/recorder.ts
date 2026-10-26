import type { EventDefinition, RecordedPageEvent } from '@/types/workflow';
import { createId } from '@/types/workflow';
import { describeElement, selectionTarget, selectorFor } from './selector';
import { recordingEffects } from './recording-effects';

const HOST_ID = '__page_agent_recording__';
const LONG_PRESS_MS = 650;
const SUBMIT_RESPONSE_MS = 1000;
let cleanupRecording: (() => void) | null = null;

function actionableTarget(raw: EventTarget | null): HTMLElement | null {
  if (!(raw instanceof Element)) return null;
  if (raw.closest(`#${HOST_ID}`)) return null;
  const target = selectionTarget(raw);
  return target instanceof HTMLElement ? target : null;
}

function valueFor(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return element.type === 'password' ? '' : element.value;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return element.isContentEditable ? element.textContent ?? '' : '';
}

function associatedForm(element: HTMLElement): HTMLFormElement | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element instanceof HTMLButtonElement) return element.form;
  return element instanceof HTMLFormElement ? element : element.closest('form');
}

function isSubmitControl(element: HTMLElement): boolean {
  return (element instanceof HTMLButtonElement && element.type === 'submit')
    || (element instanceof HTMLInputElement && ['submit', 'image'].includes(element.type));
}

export function isRecording(): boolean {
  return Boolean(cleanupRecording);
}

export function stopRecording(): void {
  cleanupRecording?.();
  cleanupRecording = null;
}

export function startRecording(
  onEvent: (event: Omit<RecordedPageEvent, 'target'> & { target: ReturnType<typeof describeElement> }) => void,
  onStop: () => void,
  showOverlay = true,
): void {
  stopRecording();
  if (!document.documentElement) throw new Error('页面尚未准备好，无法启动录制');

  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, { position: 'fixed', top: '14px', right: '14px', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'closed' });
  const panel = document.createElement('div');
  const dot = document.createElement('span');
  dot.className = 'dot';
  const title = document.createElement('strong');
  title.textContent = '正在录制';
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = '0 个操作';
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.textContent = '停止';
  panel.append(dot, title, count, stopButton);
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}.panel{display:flex;align-items:center;gap:8px;padding:8px 9px 8px 11px;color:#fff;background:#282336f2;border:1px solid #ffffff24;border-radius:11px;box-shadow:0 10px 30px #130f2045;font:12px/1.2 system-ui,-apple-system,sans-serif;backdrop-filter:blur(10px)}
    .dot{width:8px;height:8px;background:#ff5363;border-radius:50%;box-shadow:0 0 0 4px #ff536329;animation:pulse 1.2s infinite}.count{color:#c8c2d4;font-size:10px}button{margin-left:2px;padding:6px 10px;color:#fff;background:#e34e5d;border:0;border-radius:7px;font:600 11px system-ui;cursor:pointer}button:hover{background:#c93e4c}@keyframes pulse{50%{box-shadow:0 0 0 7px #ff53630d}}
  `;
  panel.className = 'panel';
  shadow.append(style, panel);
  // Observe the document, not its replaceable root: parsers and SPAs can remove the UI.
  const mountOverlay = () => {
    if (showOverlay && !host.isConnected && document.documentElement) document.documentElement.append(host);
  };
  const overlayObserver = new MutationObserver(mountOverlay);
  if (showOverlay) overlayObserver.observe(document, { childList: true, subtree: true });
  mountOverlay();
  let total = 0;
  const emit = (element: HTMLElement, event: EventDefinition, initialTarget?: ReturnType<typeof describeElement>) => {
    effects?.flush();
    total += 1;
    count.textContent = `${total} 个操作`;
    const target = initialTarget ?? describeElement(element);
    if (event.type === 'scrollPage') target.attributes = { ...target.attributes, _pageAgentScrollable: 'true' };
    onEvent({ id: createId('record'), timestamp: Date.now(), url: initialTarget?.frameUrl ?? location.href, target, event });
  };
  const effects = recordingEffects(emit);

  const inputValues = new WeakMap<HTMLElement, string>();
  const composing = new WeakSet<HTMLElement>();
  const sensitiveChanged = new WeakSet<HTMLElement>();
  const pendingValues = new Map<HTMLElement, number>();
  const recordInput = (element: HTMLElement) => {
    if (composing.has(element)) return;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) return;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(element.type)) return;
    const value = valueFor(element);
    // Password values stay out of messages, session storage and exports.
    const sensitive = element instanceof HTMLInputElement && element.type === 'password';
    if (sensitive && !sensitiveChanged.has(element)) return;
    if (inputValues.has(element) && inputValues.get(element) === value && !sensitive) return;
    inputValues.set(element, value);
    const parameter = sensitive ? (element.name || 'password').replace(/[^\p{L}\p{N}_-]/gu, '_') : '';
    emit(element, { type: 'input', value: parameter ? `{{${parameter}}}` : value, ...(document.activeElement === element ? { keepFocus: true } : {}) });
    if (sensitive) sensitiveChanged.delete(element);
  };

  let suppressClickUntil = 0;
  let recentInteraction: { kind: 'enter' | 'space' | 'click'; element: HTMLElement; form: HTMLFormElement | null; timestamp: number } | null = null;
  let keyActivation: { kind: 'enter' | 'space'; element: HTMLElement; form: HTMLFormElement | null; timestamp: number } | null = null;
  const activatedByKey = (element: HTMLElement) => Boolean(keyActivation?.element === element && Date.now() - keyActivation.timestamp <= SUBMIT_RESPONSE_MS);
  const respondsToInteraction = (form: HTMLFormElement | null) => Boolean(form && recentInteraction?.form === form
    && Date.now() - recentInteraction.timestamp <= SUBMIT_RESPONSE_MS);
  const click = (nativeEvent: MouseEvent) => {
    if (Date.now() < suppressClickUntil) return;
    const element = actionableTarget(nativeEvent.target);
    if (!element) return;
    if (element instanceof HTMLInputElement && element.type === 'file' || element instanceof HTMLLabelElement && element.control instanceof HTMLInputElement && element.control.type === 'file') return;
    if (nativeEvent.detail === 0 && activatedByKey(element)) return;
    const form = associatedForm(element);
    // Native implicit submission can synthesize a default-button click after Enter.
    if (nativeEvent.detail === 0 && isSubmitControl(element) && recentInteraction?.kind === 'enter' && respondsToInteraction(form)) return;
    recentInteraction = { kind: 'click', element, form, timestamp: Date.now() };
    emit(element, { type: 'click' });
  };
  const doubleClick = (nativeEvent: MouseEvent) => {
    const element = actionableTarget(nativeEvent.target);
    if (!element) return;
    emit(element, { type: 'doubleClick' });
  };
  const contextMenu = (nativeEvent: MouseEvent) => {
    const element = actionableTarget(nativeEvent.target);
    if (element) emit(element, { type: 'contextMenu' });
  };
  const change = (nativeEvent: Event) => {
    const element = actionableTarget(nativeEvent.target);
    if (!element) return;
    if (keyActivation?.kind === 'space' && activatedByKey(element)) return;
    sensitiveChanged.add(element);
    if (element instanceof HTMLInputElement && element.type === 'file') {
      if (!element.files?.length) return;
      const parameter = `upload_${(element.name || element.id || 'files').replace(/[^\p{L}\p{N}_-]/gu, '_')}`;
      emit(element, { type: 'upload', value: `{{${parameter}}}` });
    }
    else if (element instanceof HTMLSelectElement) emit(element, { type: 'select', value: element.value });
    else if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) emit(element, { type: 'check', value: String(element.checked) });
    else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable) recordInput(element);
    else emit(element, { type: 'change' });
  };
  const input = (nativeEvent: Event) => {
    recentInteraction = null;
    const element = actionableTarget(nativeEvent.target);
    if (element) { sensitiveChanged.add(element); recordInput(element); }
  };
  const focus = (nativeEvent: FocusEvent) => {
    const element = nativeEvent.target;
    if (!(element instanceof HTMLElement) || element.closest(`#${HOST_ID}`)) return;
    const entering = nativeEvent.type === 'focus' || nativeEvent.type === 'focusin';
    if (entering && !inputValues.has(element) && !(element instanceof HTMLInputElement && element.type === 'password')) inputValues.set(element, valueFor(element));
    if (!entering) recordInput(element);
    const related = nativeEvent.relatedTarget;
    effects!.queue(element, { type: nativeEvent.type as 'focus' | 'blur' | 'focusin' | 'focusout', ...(related instanceof HTMLElement && !related.closest(`#${HOST_ID}`) ? { relatedSelector: selectorFor(related) } : {}) });
  };
  const afterValueChange = (nativeEvent: Event) => {
    const element = actionableTarget(nativeEvent.target);
    if (!element) return;
    sensitiveChanged.add(element);
    const previous = pendingValues.get(element); if (previous !== undefined) window.clearTimeout(previous);
    pendingValues.set(element, window.setTimeout(() => { pendingValues.delete(element); recordInput(element); }, 0));
  };
  const compositionStart = (event: CompositionEvent) => { const el = actionableTarget(event.target); if (el) composing.add(el); };
  const compositionEnd = (event: CompositionEvent) => {
    const el = actionableTarget(event.target);
    if (el) { composing.delete(el); sensitiveChanged.add(el); recordInput(el); }
  };
  const hovered = new WeakSet<HTMLElement>();
  const hoverBoundary = (event: MouseEvent | PointerEvent) => {
    const element = actionableTarget(event.target);
    if (!element || element === document.body || element === document.documentElement || event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
    if (event.type.endsWith('enter') || event.type.endsWith('leave')) {
      // Non-bubbling enter/leave fire separately for every ancestor. The normal
      // over/out stream already covers generic wrappers without ancestor noise.
      if (!element.matches('button,a,input,textarea,select,[role],[tabindex],[onmouseenter],[onmouseleave],[onpointerenter],[onpointerleave]')) return;
    }
    const entering = event.type.endsWith('over') || event.type.endsWith('enter');
    if (entering && !hovered.has(element)) { hovered.add(element); effects!.queue(element, { type: 'hover' }); }
    else if (!entering && hovered.has(element)) { hovered.delete(element); effects!.queue(element, { type: 'mouseLeave' }); }
  };
  const keydown = (nativeEvent: KeyboardEvent) => {
    recentInteraction = null;
    keyActivation = null;
    const element = actionableTarget(nativeEvent.target);
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229 || element && composing.has(element)) return;
    const shortcut = (nativeEvent.ctrlKey || nativeEvent.metaKey || nativeEvent.altKey) && !['Control', 'Meta', 'Alt', 'Shift'].includes(nativeEvent.key);
    const spaceActivation = nativeEvent.key === ' ' && element?.matches('button,input[type="checkbox"],input[type="radio"],input[type="button"],input[type="submit"],input[type="reset"],[role="button"],[role="checkbox"],[role="switch"]');
    if (!shortcut && !spaceActivation && !/^F(?:[1-9]|1[0-2])$/.test(nativeEvent.key) && !['Enter', 'Escape', 'Tab', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(nativeEvent.key)) return;
    if (element) {
      // Search pages may navigate on keydown without ever firing change or blur.
      recordInput(element);
      const modifiers = { ...(nativeEvent.altKey ? { alt: true } : {}), ...(nativeEvent.ctrlKey ? { ctrl: true } : {}), ...(nativeEvent.metaKey ? { meta: true } : {}), ...(nativeEvent.shiftKey ? { shift: true } : {}) };
      emit(element, { type: 'pressKey', value: nativeEvent.key, ...(nativeEvent.code ? { code: nativeEvent.code } : {}), ...(Object.keys(modifiers).length ? { modifiers } : {}) });
      if (nativeEvent.key === 'Enter' || spaceActivation) {
        keyActivation = { kind: nativeEvent.key === 'Enter' ? 'enter' : 'space', element, form: associatedForm(element), timestamp: Date.now() };
        recentInteraction = keyActivation;
      }
    }
  };
  const submit = (nativeEvent: SubmitEvent) => {
    const form = nativeEvent.target;
    if (!(form instanceof HTMLFormElement)) return;
    // A submit event is the result of the already recorded Enter/click, not another user step.
    if (respondsToInteraction(form) || keyActivation?.form === form && Date.now() - keyActivation.timestamp <= SUBMIT_RESPONSE_MS) return;
    emit(form, { type: 'submit' });
  };
  const reset = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const control = recentInteraction?.element;
    if (respondsToInteraction(form) && control && (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) && control.type === 'reset') return;
    emit(form, { type: 'reset' });
  };
  let scrollTimer = 0;
  const scroll = (nativeEvent: Event) => {
    const element = nativeEvent.target instanceof HTMLElement ? nativeEvent.target : document.documentElement;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const page = element === document.documentElement || element === document.body;
      emit(element, { type: 'scrollPage', value: JSON.stringify({
        x: Math.round(page ? scrollX : element.scrollLeft),
        y: Math.round(page ? scrollY : element.scrollTop),
      }) });
    }, 300);
  };
  let pressed: { element: HTMLElement; target: ReturnType<typeof describeElement>; startedAt: number; x: number; y: number; startX: number; startY: number; points: Array<{ x: number; y: number }> } | null = null;
  const pointerDown = (nativeEvent: PointerEvent) => {
    const element = actionableTarget(nativeEvent.target);
    if (element) { recentInteraction = null; keyActivation = null; }
    if (element && nativeEvent.button === 0) {
      const source = nativeEvent.target instanceof HTMLElement ? nativeEvent.target : element;
      const rect = source.getBoundingClientRect();
      pressed = { element: source, target: describeElement(source), startedAt: Date.now(), x: nativeEvent.clientX, y: nativeEvent.clientY,
        startX: rect.width ? (nativeEvent.clientX - rect.left) / rect.width : 0.5,
        startY: rect.height ? (nativeEvent.clientY - rect.top) / rect.height : 0.5, points: [] };
    }
  };
  const pointerMove = (event: PointerEvent) => {
    if (!pressed) return;
    if (pressed.points.length >= 79) pressed.points.splice(1, 1);
    pressed.points.push({ x: event.clientX - pressed.x, y: event.clientY - pressed.y });
  };
  const pointerUp = (nativeEvent: PointerEvent) => {
    if (!pressed) return;
    const duration = Date.now() - pressed.startedAt;
    const distance = Math.hypot(nativeEvent.clientX - pressed.x, nativeEvent.clientY - pressed.y);
    if (distance >= 12 || pressed.points.some(point => Math.hypot(point.x, point.y) >= 12)) {
      suppressClickUntil = Date.now() + 400;
      emit(pressed.element, { type: 'drag', value: JSON.stringify({ startX: pressed.startX, startY: pressed.startY, dx: nativeEvent.clientX - pressed.x, dy: nativeEvent.clientY - pressed.y, durationMs: Math.min(5000, Math.max(150, duration)), points: pressed.points }) }, pressed.target);
    } else if (duration >= LONG_PRESS_MS && distance < 12) {
      suppressClickUntil = Date.now() + 400;
      emit(pressed.element, { type: 'longPress', value: String(duration) });
    }
    pressed = null;
  };
  let nativeDragging = false;
  const nativeDragStart = (event: DragEvent) => {
    nativeDragging = Boolean(pressed);
    if (pressed && event.target instanceof HTMLElement) {
      pressed.element = event.target; pressed.target = describeElement(event.target);
      const rect = event.target.getBoundingClientRect();
      pressed.startX = rect.width ? (pressed.x - rect.left) / rect.width : 0.5;
      pressed.startY = rect.height ? (pressed.y - rect.top) / rect.height : 0.5;
    }
  };
  const nativeDragOver = (event: DragEvent) => { if (nativeDragging) pointerMove(event as unknown as PointerEvent); };
  const nativeDragEnd = (event: DragEvent) => {
    if (nativeDragging && pressed) {
      const last = pressed.points.at(-1);
      pointerUp({ clientX: event.clientX || (pressed.x + (last?.x ?? 0)), clientY: event.clientY || (pressed.y + (last?.y ?? 0)) } as PointerEvent);
    }
    nativeDragging = false;
  };
  const cancelPointer = () => { if (!nativeDragging) pressed = null; };
  stopButton.addEventListener('click', (event) => { event.stopPropagation(); onStop(); });

  window.addEventListener('click', click, true);
  window.addEventListener('dblclick', doubleClick, true);
  window.addEventListener('contextmenu', contextMenu, true);
  window.addEventListener('input', input, true);
  window.addEventListener('change', change, true);
  window.addEventListener('focus', focus, true);
  window.addEventListener('blur', focus, true);
  window.addEventListener('focusin', focus, true);
  window.addEventListener('focusout', focus, true);
  window.addEventListener('beforeinput', afterValueChange, true);
  window.addEventListener('paste', afterValueChange, true);
  window.addEventListener('cut', afterValueChange, true);
  window.addEventListener('drop', afterValueChange, true);
  window.addEventListener('compositionstart', compositionStart, true);
  window.addEventListener('compositionend', compositionEnd, true);
  const boundaries = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave'] as const;
  boundaries.forEach(type => window.addEventListener(type, hoverBoundary, true));
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('submit', submit, true);
  window.addEventListener('reset', reset, true);
  window.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('pointerup', pointerUp, true);
  window.addEventListener('pointermove', pointerMove, true);
  window.addEventListener('pointercancel', cancelPointer, true);
  window.addEventListener('dragstart', nativeDragStart, true);
  window.addEventListener('dragover', nativeDragOver, true);
  window.addEventListener('dragend', nativeDragEnd, true);
  window.addEventListener('scroll', scroll, { capture: true, passive: true });

  cleanupRecording = () => {
    effects?.stop();
    overlayObserver.disconnect();
    window.clearTimeout(scrollTimer);
    window.removeEventListener('click', click, true);
    window.removeEventListener('dblclick', doubleClick, true);
    window.removeEventListener('contextmenu', contextMenu, true);
    window.removeEventListener('input', input, true);
    window.removeEventListener('change', change, true);
    window.removeEventListener('focus', focus, true);
    window.removeEventListener('blur', focus, true);
    window.removeEventListener('focusin', focus, true);
    window.removeEventListener('focusout', focus, true);
    window.removeEventListener('beforeinput', afterValueChange, true);
    window.removeEventListener('paste', afterValueChange, true);
    window.removeEventListener('cut', afterValueChange, true);
    window.removeEventListener('drop', afterValueChange, true);
    window.removeEventListener('compositionstart', compositionStart, true);
    window.removeEventListener('compositionend', compositionEnd, true);
    boundaries.forEach(type => window.removeEventListener(type, hoverBoundary, true));
    pendingValues.forEach((timer, element) => { window.clearTimeout(timer); recordInput(element); });
    pendingValues.clear();
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('submit', submit, true);
    window.removeEventListener('reset', reset, true);
    window.removeEventListener('pointerdown', pointerDown, true);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('pointermove', pointerMove, true);
    window.removeEventListener('pointercancel', cancelPointer, true);
    window.removeEventListener('dragstart', nativeDragStart, true);
    window.removeEventListener('dragover', nativeDragOver, true);
    window.removeEventListener('dragend', nativeDragEnd, true);
    window.removeEventListener('scroll', scroll, true);
    host.remove();
  };
}
