export interface FocusReceipt {
  ok: boolean;
  documentFocused: boolean;
  nativeFocus: boolean;
  nativeFocusIn: boolean;
  repaired: string[];
}

/** Chrome can change activeElement without emitting focus events while its
 * side panel owns browser focus. React pickers then keep the old active index.
 * Observe the native transition and deliver only missing lifecycle events;
 * never claim success unless the actual DOM focus target is still correct. */
export function focusElement(element: HTMLElement): FocusReceipt {
  const doc = element.ownerDocument;
  const previous = doc.activeElement;
  const old = previous instanceof HTMLElement && previous !== element && previous !== doc.body && previous !== doc.documentElement ? previous : undefined;
  const seen = new Set<string>();
  const listeners: Array<[HTMLElement, string, EventListener]> = [];
  const watch = (target: HTMLElement, type: string) => {
    const listener: EventListener = event => { if (event.target === target) seen.add(type); };
    target.addEventListener(type, listener, true); listeners.push([target, type, listener]);
  };
  watch(element, 'focus'); watch(element, 'focusin');
  if (old) { watch(old, 'blur'); watch(old, 'focusout'); }
  try {
    element.focus({ preventScroll: true });
    const receipt: FocusReceipt = { ok: element.isConnected && doc.activeElement === element, documentFocused: doc.hasFocus(), nativeFocus: seen.has('focus'), nativeFocusIn: seen.has('focusin'), repaired: [] };
    if (!receipt.ok) return receipt;
    if (previous !== element || !receipt.documentFocused) {
      const notify = (target: HTMLElement, type: string, relatedTarget: EventTarget | null) => {
        if (!seen.has(type)) {
          target.dispatchEvent(new FocusEvent(type, { bubbles: type === 'focusin' || type === 'focusout', composed: true, relatedTarget }));
          receipt.repaired.push(type);
        }
      };
      if (old) { notify(old, 'blur', element); notify(old, 'focusout', element); }
      // Blur handlers may redirect focus or replace the input. Do not focus it
      // again or click a date after the application rejects the transition.
      if (element.isConnected && doc.activeElement === element) {
        notify(element, 'focus', old ?? null);
        if (element.isConnected && doc.activeElement === element) notify(element, 'focusin', old ?? null);
      }
      receipt.ok = element.isConnected && doc.activeElement === element;
    }
    return receipt;
  } finally {
    for (const [target, type, listener] of listeners) target.removeEventListener(type, listener, true);
  }
}
