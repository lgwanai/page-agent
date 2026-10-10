import type { PageTarget } from '@/types/workflow';

const OVERLAY_ID = '__page_agent_select_overlay__';
const HIGHLIGHT_ID = '__page_agent_highlight__';
const TOOLTIP_ID = '__page_agent_tooltip__';

let cleanupActiveSelector: (() => void) | null = null;

function escapeCss(value: string): string {
  return CSS.escape(value);
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

export function selectorFor(element: Element): string {
  if (element === document.documentElement) return 'html';
  const html = element as HTMLElement;
  if (html.id) {
    const selector = `#${escapeCss(html.id)}`;
    if (isUnique(selector)) return selector;
  }

  for (const attribute of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = `${element.tagName.toLowerCase()}[${attribute}="${escapeCss(value)}"]`;
    if (isUnique(selector)) return selector;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    const stableClasses = [...current.classList]
      .filter((name) => !/^(css-|jsx-|ng-|v-)/i.test(name) && !/(^|[-_])(active|focus|focused|hover|selected)([-_]|$)/i.test(name))
      .slice(0, 2);
    if (stableClasses.length) part += stableClasses.map((name) => `.${escapeCss(name)}`).join('');

    const parent: Element | null = current.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((child) => child.tagName === current!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (isUnique(selector)) return selector;
    current = parent;
  }
  return parts.join(' > ');
}

function elementLabel(element: Element): string {
  const html = element as HTMLElement;
  const aria = element.getAttribute('aria-label');
  const placeholder = element.getAttribute('placeholder');
  const title = element.getAttribute('title');
  const name = element.getAttribute('name');
  const id = element.getAttribute('id');
  const explicitLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null;
  const wrappingLabel = element.closest('label')?.textContent;
  const text = html.innerText || element.textContent;
  return (aria || explicitLabel || wrappingLabel || placeholder || title || name || text || element.tagName)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function selectionTarget(element: Element): Element {
  return element.closest('button,a,input,textarea,select,option,label,summary,[contenteditable="true"],[role="button"],[role="link"],[role="option"],[role="menuitem"],[onclick]') ?? element;
}

export function describeElement(element: Element): Omit<PageTarget, 'frameId'> {
  const attributes: Record<string, string> = {};
  for (const key of ['id', 'name', 'type', 'role', 'aria-label', 'placeholder', 'data-testid', 'contenteditable', 'disabled', 'multiple', 'tabindex']) {
    const value = element.getAttribute(key);
    if (value !== null) attributes[key] = value;
  }
  const options = element instanceof HTMLSelectElement
    ? [...element.options].slice(0, 200).map((option) => ({
      value: option.value,
      label: (option.textContent ?? option.value).replace(/\s+/g, ' ').trim(),
    }))
    : undefined;
  return {
    name: '',
    selector: selectorFor(element),
    frameUrl: location.href,
    tagName: element.tagName.toLowerCase(),
    label: elementLabel(element),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    attributes,
    ...(options ? { options } : {}),
  };
}

export function stopSelecting(): void {
  cleanupActiveSelector?.();
  cleanupActiveSelector = null;
}

export function startSelecting(onSelect: (target: Omit<PageTarget, 'frameId'>) => void, exactElement = false): void {
  stopSelecting();
  if (!document.documentElement) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '2147483645', cursor: 'crosshair', background: 'transparent',
  });
  const highlight = document.createElement('div');
  highlight.id = HIGHLIGHT_ID;
  Object.assign(highlight.style, {
    position: 'fixed', zIndex: '2147483644', pointerEvents: 'none', border: '2px solid #6657e8',
    background: 'rgba(102,87,232,.12)', borderRadius: '4px', transition: 'all 35ms linear',
  });
  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  Object.assign(tooltip.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', padding: '6px 9px',
    color: '#fff', background: '#201d35', borderRadius: '6px', font: '12px/1.4 system-ui',
    maxWidth: '360px', boxShadow: '0 4px 18px rgba(0,0,0,.22)',
  });

  let hovered: Element | null = null;
  const underlying = (x: number, y: number): Element | null => {
    overlay.style.pointerEvents = 'none';
    const element = document.elementFromPoint(x, y);
    overlay.style.pointerEvents = 'auto';
    return element;
  };
  const move = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (overlay.style.pointerEvents === 'none' && event.target instanceof HTMLIFrameElement) return;
    overlay.style.pointerEvents = 'auto';
    const rawTarget = underlying(event.clientX, event.clientY);
    hovered = rawTarget ? exactElement ? rawTarget : selectionTarget(rawTarget) : null;
    if (!hovered) return;
    const rect = hovered.getBoundingClientRect();
    Object.assign(highlight.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
    tooltip.textContent = `${hovered.tagName.toLowerCase()} · ${elementLabel(hovered)}`;
    const top = rect.top > 38 ? rect.top - 34 : Math.min(rect.bottom + 6, innerHeight - 34);
    tooltip.style.left = `${Math.max(6, Math.min(rect.left, innerWidth - 370))}px`;
    tooltip.style.top = `${top}px`;
    // Let the selector overlay inside a same- or cross-origin iframe receive the pointer.
    // The parent document keeps a capture blocker below, so leaving the iframe cannot trigger page handlers.
    if (hovered instanceof HTMLIFrameElement) overlay.style.pointerEvents = 'none';
  };
  const click = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const rawTarget = hovered ? null : underlying(event.clientX, event.clientY);
    hovered ??= rawTarget ? exactElement ? rawTarget : selectionTarget(rawTarget) : null;
    if (!hovered) return;
    const selected = describeElement(hovered);
    stopSelecting();
    onSelect(selected);
  };
  const keydown = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') stopSelecting();
  };
  const block = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const blockedEvents = [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dblclick', 'contextmenu',
    'wheel', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'drop', 'submit',
  ];
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('click', click, { capture: true, passive: false });
  for (const type of blockedEvents) {
    window.addEventListener(type, block, { capture: true, passive: false });
  }
  window.addEventListener('keydown', keydown, true);
  document.documentElement.append(highlight, overlay, tooltip);

  cleanupActiveSelector = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('click', click, true);
    for (const type of blockedEvents) {
      window.removeEventListener(type, block, true);
    }
    window.removeEventListener('keydown', keydown, true);
    overlay.remove(); highlight.remove(); tooltip.remove();
  };
}
