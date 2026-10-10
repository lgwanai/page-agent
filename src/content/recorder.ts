import type { EventDefinition, RecordedPageEvent } from '@/types/workflow';
import { createId } from '@/types/workflow';
import { describeElement } from './selector';

const HOST_ID = '__page_agent_recording__';
const LONG_PRESS_MS = 650;
const SUBMIT_RESPONSE_MS = 1000;
let cleanupRecording: (() => void) | null = null;

function actionableTarget(raw: EventTarget | null): HTMLElement | null {
  if (!(raw instanceof Element)) return null;
  if (raw.closest(`#${HOST_ID}`)) return null;
  const target = raw.closest('button,a,input,textarea,select,option,label,summary,[contenteditable="true"],[role="button"],[role="link"],[role="option"],[role="menuitem"],[onclick]') ?? raw;
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
  const emit = (element: HTMLElement, event: EventDefinition) => {
    total += 1;
    count.textContent = `${total} 个操作`;
    const target = describeElement(element);
    if (event.type === 'scrollPage') target.attributes = { ...target.attributes, _pageAgentScrollable: 'true' };
    onEvent({ id: createId('record'), timestamp: Date.now(), url: location.href, target, event });
  };

  const inputValues = new WeakMap<HTMLElement, string>();
  const recordInput = (element: HTMLElement) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) return;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden'].includes(element.type)) return;
    const value = valueFor(element);
    // Password values stay out of messages, session storage and exports.
    const sensitive = element instanceof HTMLInputElement && element.type === 'password';
    if (inputValues.has(element) && inputValues.get(element) === value && !sensitive) return;
    inputValues.set(element, value);
    const parameter = sensitive ? (element.name || 'password').replace(/[^\p{L}\p{N}_-]/gu, '_') : '';
    emit(element, { type: 'input', value: parameter ? `{{${parameter}}}` : value });
  };

  let suppressClickUntil = 0;
  let recentInteraction: { kind: 'enter' | 'click'; form: HTMLFormElement | null; timestamp: number } | null = null;
  const respondsToInteraction = (form: HTMLFormElement | null) => Boolean(form && recentInteraction?.form === form
    && Date.now() - recentInteraction.timestamp <= SUBMIT_RESPONSE_MS);
  const click = (nativeEvent: MouseEvent) => {
    if (Date.now() < suppressClickUntil) return;
    const element = actionableTarget(nativeEvent.target);
    if (!element) return;
    const form = associatedForm(element);
    // Native implicit submission can synthesize a default-button click after Enter.
    if (nativeEvent.detail === 0 && isSubmitControl(element) && recentInteraction?.kind === 'enter' && respondsToInteraction(form)) return;
    recentInteraction = { kind: 'click', form, timestamp: Date.now() };
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
    if (element instanceof HTMLSelectElement) emit(element, { type: 'select', value: element.value });
    else if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) emit(element, { type: 'check', value: String(element.checked) });
    else recordInput(element);
  };
  const input = (nativeEvent: Event) => {
    recentInteraction = null;
    const element = actionableTarget(nativeEvent.target);
    if (element) recordInput(element);
  };
  const blur = (nativeEvent: FocusEvent) => {
    const element = actionableTarget(nativeEvent.target);
    if (element) recordInput(element);
  };
  const keydown = (nativeEvent: KeyboardEvent) => {
    recentInteraction = null;
    if (!['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(nativeEvent.key)) return;
    const element = actionableTarget(nativeEvent.target);
    if (element) {
      // Search pages may navigate on keydown without ever firing change or blur.
      recordInput(element);
      emit(element, { type: 'pressKey', value: nativeEvent.key });
      if (nativeEvent.key === 'Enter') recentInteraction = { kind: 'enter', form: associatedForm(element), timestamp: Date.now() };
    }
  };
  const submit = (nativeEvent: SubmitEvent) => {
    const form = nativeEvent.target;
    if (!(form instanceof HTMLFormElement)) return;
    // A submit event is the result of the already recorded Enter/click, not another user step.
    if (respondsToInteraction(form)) return;
    emit(form, { type: 'submit' });
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
  let pressed: { element: HTMLElement; startedAt: number; x: number; y: number } | null = null;
  const pointerDown = (nativeEvent: PointerEvent) => {
    const element = actionableTarget(nativeEvent.target);
    if (element) recentInteraction = null;
    if (element && nativeEvent.button === 0) pressed = { element, startedAt: Date.now(), x: nativeEvent.clientX, y: nativeEvent.clientY };
  };
  const pointerUp = (nativeEvent: PointerEvent) => {
    if (!pressed) return;
    const duration = Date.now() - pressed.startedAt;
    const distance = Math.hypot(nativeEvent.clientX - pressed.x, nativeEvent.clientY - pressed.y);
    if (duration >= LONG_PRESS_MS && distance < 12) {
      suppressClickUntil = Date.now() + 400;
      emit(pressed.element, { type: 'longPress', value: String(duration) });
    }
    pressed = null;
  };
  const cancelPointer = () => { pressed = null; };
  stopButton.addEventListener('click', (event) => { event.stopPropagation(); onStop(); });

  window.addEventListener('click', click, true);
  window.addEventListener('dblclick', doubleClick, true);
  window.addEventListener('contextmenu', contextMenu, true);
  window.addEventListener('input', input, true);
  window.addEventListener('change', change, true);
  window.addEventListener('blur', blur, true);
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('submit', submit, true);
  window.addEventListener('pointerdown', pointerDown, true);
  window.addEventListener('pointerup', pointerUp, true);
  window.addEventListener('pointercancel', cancelPointer, true);
  window.addEventListener('scroll', scroll, { capture: true, passive: true });

  cleanupRecording = () => {
    overlayObserver.disconnect();
    window.clearTimeout(scrollTimer);
    window.removeEventListener('click', click, true);
    window.removeEventListener('dblclick', doubleClick, true);
    window.removeEventListener('contextmenu', contextMenu, true);
    window.removeEventListener('input', input, true);
    window.removeEventListener('change', change, true);
    window.removeEventListener('blur', blur, true);
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('submit', submit, true);
    window.removeEventListener('pointerdown', pointerDown, true);
    window.removeEventListener('pointerup', pointerUp, true);
    window.removeEventListener('pointercancel', cancelPointer, true);
    window.removeEventListener('scroll', scroll, true);
    host.remove();
  };
}
