import { resolveLocator } from './locator-plan';
import type { RecordedTargetHint } from '@/types/workflow';

const IDENTITY_ATTRIBUTES = ['id', 'name', 'placeholder', 'aria-label', 'data-testid', 'data-test', 'data-qa'];
const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Recover recorded state-dependent selectors using stable, uniquely matched identity only. */
export function locateEventTarget(selector: string, hint?: RecordedTargetHint): Element | null {
  if (hint?.locator && hint.locator.selector !== selector) return locateEventTarget(selector);
  if (hint?.frameName && hint.frameName !== window.name) return null;
  if (hint?.locator?.version === 1 && hint.locator.selector === selector) return resolveLocator(hint.locator);
  const exact = [...document.querySelectorAll(selector)];
  if (!hint) {
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`Selector 匹配多个节点，无法安全操作：${selector}`);
    return null;
  }
  const attributes = hint.attributes ?? {};
  const identities = IDENTITY_ATTRIBUTES.filter((name) => Boolean(attributes[name]));
  const text = normalizeText(hint.text ?? '');
  // Text is only a fallback for interactive controls, not arbitrary containers.
  const textIdentity = text && ['button', 'a', 'option', 'label', 'summary'].includes(hint.tagName.toLowerCase());
  if (!identities.length && !textIdentity) {
    if (exact.length === 1 && exact[0].tagName.toLowerCase() === hint.tagName.toLowerCase()) return exact[0];
    if (exact.length > 1) throw new Error(`Selector 匹配多个节点，缺少唯一身份信息：${selector}`);
    return null;
  }
  const candidates = (exact.length ? exact : [...document.querySelectorAll('*')]).filter((element) => {
    if (element.tagName.toLowerCase() !== hint.tagName.toLowerCase()) return false;
    if (!identities.every((name) => element.getAttribute(name) === attributes[name])) return false;
    if (attributes.type && element.getAttribute('type') !== attributes.type) return false;
    if (textIdentity && normalizeText((element as HTMLElement).innerText || element.textContent || '') !== text) return false;
    return true;
  });
  if (candidates.length > 1) throw new Error(`节点身份匹配不唯一，无法安全操作：${selector}。请重新选择节点。`);
  return candidates[0] ?? null;
}
