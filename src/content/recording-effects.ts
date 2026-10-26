import type { EventDefinition, PageTarget } from '@/types/workflow';
import { describeElement } from './selector';

const POPUPS = '[role="menu"],[role="dialog"],[role="listbox"],[role="tooltip"],[class*="dropdown"],[class*="popover"],[class*="tooltip"],[class*="popup"]';
const visible = (element: Element) => {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};

/** Passive browser events are evidence candidates, not workflow actions by themselves. */
export function recordingEffects(record: (element: HTMLElement, event: EventDefinition, target: Omit<PageTarget, 'frameId'>) => void) {
  type Pending = { element: HTMLElement; event: EventDefinition; target: Omit<PageTarget, 'frameId'>; scope: Element; before: string; timer: number };
  let pending: Pending | undefined;
  const snapshot = (scope: Element) => JSON.stringify({
    text: scope.textContent?.slice(0, 8000),
    // Existing inline panels may become visible without adding any DOM nodes.
    visibility: [scope, ...scope.querySelectorAll('*')].slice(0, 200).map(element => visible(element)),
    state: [...scope.querySelectorAll('[aria-expanded],[aria-invalid],[aria-checked],[hidden],[disabled],[readonly],[checked],[selected]'), scope].slice(0, 200).map(element =>
      ['aria-expanded', 'aria-invalid', 'aria-checked', 'hidden', 'disabled', 'readonly', 'checked', 'selected'].map(key => element.getAttribute(key))),
    popups: [...document.querySelectorAll(POPUPS)].filter(element => !element.closest('[id^="__page_agent_"]'))
      .slice(0, 150).map(element => [element, visible(element)] as const)
      .filter(([, shown]) => shown).map(([element]) => element.textContent?.slice(0, 2000)),
  });
  const flush = () => {
    const candidate = pending;
    if (!candidate) return;
    pending = undefined; window.clearTimeout(candidate.timer);
    // A meaningful hover may enable the very button clicked next. Preserve it;
    // only state-neutral focus/hover transitions are discarded.
    if (candidate.before !== snapshot(candidate.scope)) record(candidate.element, candidate.event, candidate.target);
  };
  return {
    queue(element: HTMLElement, event: EventDefinition) {
      if (pending?.element === element && ((pending.event.type === 'focus' && event.type === 'focusin') || (pending.event.type === 'blur' && event.type === 'focusout'))) {
        pending.event = event; return;
      }
      flush();
      const parent = element.parentElement;
      const scope = parent && parent !== document.body && parent !== document.documentElement ? parent : element;
      pending = { element, event, target: describeElement(element), scope, before: snapshot(scope), timer: window.setTimeout(() => flush(), 450) };
    },
    flush,
    stop() { flush(); },
  };
}
