import { describeElement, selectorFor } from './selector';

/** Bounded, read-only snapshot. Never expose password/hidden input values or raw HTML. */
export function inspectPage(selector: string, maxNodes = 100, maxText = 12000) {
  const limit = Math.max(1, Math.min(200, Number(maxNodes) || 100));
  let remaining = Math.max(1, Math.min(50000, Number(maxText) || 12000));
  const roots = Array.from(document.querySelectorAll(selector));
  const elements = Array.from(new Set(roots.flatMap((root) => [root, ...root.querySelectorAll('input,textarea,select,button,a,[role],label,h1,h2,h3,table')])));
  const nodes = elements.filter((el) => !el.matches('script,style,input[type=password],input[type=hidden]')).slice(0, limit).map((el) => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('script,style,input[type=password],input[type=hidden]').forEach((n) => n.remove());
    const text = (copy.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, Math.min(remaining, 1000)); remaining -= text.length;
    const attributes = Object.fromEntries(['id', 'class', 'type', 'role', 'placeholder', 'aria-label', 'title', 'name', 'accept', 'multiple'].filter((key) => el.hasAttribute(key)).map((key) => [key, el.getAttribute(key)!]));
    const bounds = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const selector = selectorFor(el), description = describeElement(el);
    return { selector, locator: { ...description.locator!, selector }, tagName: el.tagName.toLowerCase(), text, attributes, visible: bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none', disabled: el.matches(':disabled') || !!el.closest('[disabled], [aria-disabled="true"], [class*="-disabled"]'),
      ...(((el instanceof HTMLInputElement && el.type !== 'file') || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) ? { value: el.value.slice(0, 1000) } : {}),
      ...(el instanceof HTMLInputElement && el.type === 'file' ? { upload: { accept: el.accept, multiple: el.multiple } } : {}),
      ...(el instanceof HTMLSelectElement ? { options: Array.from(el.options).slice(0, 100).map((o) => ({ value: o.value, label: o.label })) } : {}),
    };
  });
  return { ok: true, title: document.title, url: location.href, rootCount: roots.length, totalNodes: elements.length, truncated: elements.length > limit || remaining === 0, nodes };
}
