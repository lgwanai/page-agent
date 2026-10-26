import type { LocatorCandidate, TargetLocator } from '@/types/workflow';
export const normalizeDomText = (value: string) => value.replace(/\s+/g, ' ').trim();
function identityText(element: Element): string {
  if (element.matches('script,style,template')) return '';
  if (!element.querySelector('script,style,template')) return normalizeDomText(element.textContent ?? '');
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('script,style,template').forEach(node => node.remove());
  return normalizeDomText(copy.textContent ?? '');
}
const quote = (value: string) => JSON.stringify(value);
export function stableId(value: string): boolean {
  return Boolean(value) && !/^(?:[:]|(?:react|radix|headlessui|rc_select|rc-menu|el-id|mui)-?[_:-]?\d)/i.test(value)
    && !/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value);
}
function stableClasses(element: Element): string[] {
  return [...element.classList].filter(name => !/^(css-|jsx-|ng-|v-)/i.test(name)
    && !/(^|[-_])(active|focus|focused|hover|selected|disabled|loading|open|expanded)([-_]|$)/i.test(name)
    && !/--[A-Za-z0-9_-]{6,}$/.test(name) && !/_[a-zA-Z0-9]{6,}$/.test(name)).sort().slice(0, 3);
}
function exactIdentity(element: Element): LocatorCandidate['match'] | undefined {
  const tag = element.tagName.toLowerCase();
  if ((tag === 'input' && ['button', 'submit', 'reset', 'radio', 'checkbox'].includes(element.getAttribute('type') ?? '')) || tag === 'option') {
    const value = element.getAttribute('value'); if (value) return { kind: 'value', value };
  }
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return undefined; // Editable values are run data.
  const text = identityText(element);
  return text && text.length <= 200 ? { kind: 'text', value: text } : undefined;
}
function candidatesFor(candidate: LocatorCandidate, tag: string, inputType?: string): Element[] {
  const scope = candidate.anchor ? [...document.querySelectorAll(candidate.anchor)] : [document];
  if (candidate.anchor && scope.length > 1) throw new Error('上层定位 ID 不唯一，请重新选择节点');
  const found = scope.flatMap(root => [...root.querySelectorAll(candidate.selector)]).filter(element => {
    if (element.tagName.toLowerCase() !== tag) return false;
    if (inputType && element.getAttribute('type') !== inputType) return false;
    if (!candidate.match) return true;
    return candidate.match.kind === 'value' ? element.getAttribute('value') === candidate.match.value
      : identityText(element) === candidate.match.value;
  });
  return [...new Set(found)];
}
function parentFingerprint(element: Element): string {
  return JSON.stringify([...(element.parentElement?.children ?? [])].map(child => [child.tagName, child.id, child.getAttribute('name'), identityText(child).slice(0, 200)]));
}
/** CSS-only compatibility path, used where the consumer cannot carry semantic metadata. */
export function cssSelectorFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const unique = (selector: string) => { try { const nodes = document.querySelectorAll(selector); return nodes.length === 1 && nodes[0] === element; } catch { return false; } };
  if (element === document.documentElement) return 'html';
  if (stableId(element.id) && unique(`[id=${quote(element.id)}]`)) return `#${CSS.escape(element.id)}`;
  for (const key of ['name', 'data-testid', 'data-test', 'data-qa', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(key), selector = `${tag}[${key}=${quote(value ?? '')}]`;
    if (value && unique(selector)) return selector;
  }
  const classes = stableClasses(element);
  for (const name of classes) { const selector = `${tag}.${CSS.escape(name)}`; if (unique(selector)) return selector; }
  if (unique(tag)) return tag;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    if (stableId(current.id) && document.querySelectorAll(`[id=${quote(current.id)}]`).length === 1) {
      parts.unshift(`#${CSS.escape(current.id)}`); return parts.join(' > ');
    }
    const siblings: Element[] = [...(current.parentElement?.children ?? [])].filter(child => child.tagName === current!.tagName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    parts.unshift(part);
    if (unique(parts.join(' > '))) return parts.join(' > ');
    current = current.parentElement;
  }
  return parts.join(' > ');
}
export function captureLocator(element: Element): TargetLocator {
  const tagName = element.tagName.toLowerCase(), inputType = element.getAttribute('type') ?? undefined;
  const match = exactIdentity(element), candidates: LocatorCandidate[] = [];
  const add = (candidate: LocatorCandidate) => {
    try { const nodes = candidatesFor(candidate, tagName, inputType); if (nodes.length === 1 && nodes[0] === element && !candidates.some(item => JSON.stringify(item) === JSON.stringify(candidate))) candidates.push(candidate); } catch { /* Capture only verifiably unique candidates. */ }
  };
  if (stableId(element.id)) add({ kind: 'id', selector: `#${CSS.escape(element.id)}` });
  const name = element.getAttribute('name'); if (name) add({ kind: 'name', selector: `${tagName}[name=${quote(name)}]` });
  let ancestor = element.parentElement, anchors = 0;
  while (ancestor && anchors < 3) {
    if (stableId(ancestor.id)) {
      const anchor = `#${CSS.escape(ancestor.id)}`;
      if (match) add({ kind: 'ancestor-exact', anchor, selector: tagName, match });
      else {
        for (const attribute of ['name', 'aria-label', 'placeholder', 'data-testid', 'data-test', 'data-qa']) {
          const value = element.getAttribute(attribute);
          if (value) add({ kind: 'attribute', anchor, selector: `${tagName}[${attribute}=${quote(value)}]` });
        }
        add({ kind: 'ancestor', anchor, selector: tagName });
      }
      anchors++;
    }
    ancestor = ancestor.parentElement;
  }
  for (const attribute of ['data-testid', 'data-test', 'data-qa', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(attribute); if (value) add({ kind: 'attribute', selector: `${tagName}[${attribute}=${quote(value)}]`, ...(match ? { match } : {}) });
  }
  if (match) add({ kind: 'text', selector: tagName, match });
  const classes = stableClasses(element);
  for (const value of classes) add({ kind: 'class', selector: `${tagName}.${CSS.escape(value)}`, ...(match ? { match } : {}) });
  if (classes.length > 1) add({ kind: 'class', selector: `${tagName}${classes.map(value => `.${CSS.escape(value)}`).join('')}`, ...(match ? { match } : {}) });
  if (!match) add({ kind: 'tag', selector: tagName });
  if (!candidates.length) add({ kind: 'position', selector: cssSelectorFor(element), ...(match ? { match } : {}), parentFingerprint: parentFingerprint(element) });
  const primary = candidates[0];
  const selector = primary.anchor ? `${primary.anchor} ${primary.selector}` : primary.selector;
  return { version: 1, selector, tagName, ...(inputType ? { inputType } : {}), confidence: primary.kind === 'position' ? 'low' : primary.kind === 'class' || primary.kind === 'tag' ? 'medium' : 'high', candidates };
}
export function resolveLocator(locator: TargetLocator): Element | null {
  const anchors = [...new Set(locator.candidates.flatMap(candidate => candidate.anchor ? [candidate.anchor] : []))];
  for (const candidate of locator.candidates) {
    const matches = candidatesFor(candidate, locator.tagName, locator.inputType).filter(element =>
      candidate.anchor || candidate.kind === 'id' || candidate.kind === 'name' || !anchors.length
      || anchors.some(anchor => [...document.querySelectorAll(anchor)].some(root => root.contains(element))));
    if (matches.length > 1) throw new Error('节点身份匹配不唯一，停止操作；请缩小上层 ID 范围或重新选择节点');
    if (!matches.length) continue;
    const element = matches[0];
    if (candidate.kind === 'position' && candidate.parentFingerprint !== parentFingerprint(element)) throw new Error('低置信度位置定位的页面结构已改变，请重新选择节点');
    return element;
  }
  return null;
}
