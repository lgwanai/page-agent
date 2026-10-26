import type { PageTarget } from '@/types/workflow';
import { captureLocator, normalizeDomText, stableId } from './locator-plan';
import { describeElement } from './selector';

/** Read-only recovery: a positional hit is never evidence of identity by itself. */
export function repairLegacyTarget(target: PageTarget): Omit<PageTarget, 'frameId'> | null {
  if (target.locator || /\{\{/.test(target.selector)) return null;
  if (target.frameName && target.frameName !== window.name) return null;
  const tag = target.tagName.toLowerCase();
  if (!/^[a-z][\w-]*$/.test(tag)) throw new Error('旧节点缺少有效的元素类型，不能自动确认身份');
  const attrs = target.attributes ?? {};
  const text = normalizeDomText(target.text ?? '');
  const semanticText = text && text.length < 160 && ['button','a','option','label','summary'].includes(tag) ? text : '';
  const all = [...document.querySelectorAll(tag)].filter(element => !attrs.type || element.getAttribute('type') === attrs.type);
  const unique = (elements: Element[]) => {
    if (elements.length > 1) throw new Error('旧节点身份匹配不唯一，未修改 Selector，也未发送页面操作');
    return elements[0];
  };
  const describe = (element: Element) => {
    const description = describeElement(element);
    // Do not replace one positional path with another positional path.
    if (description.locator?.confidence === 'low') throw new Error('旧节点只有数字位置证据，无法安全自动升级');
    return description;
  };
  // An exact stable ID/name remains authoritative, but conflicting saved identity
  // is rejected: an ID can have been recycled for a different field.
  for (const key of ['id','name'] as const) {
    const value = attrs[key];
    if (!value || (key === 'id' && !stableId(value))) continue;
    const matches = all.filter(element => element.getAttribute(key) === value);
    if (!matches.length) continue;
    const element = unique(matches)!;
    const conflicts = ['name','placeholder','aria-label','data-testid','data-test','data-qa'].filter(attribute => attribute !== key && attrs[attribute]);
    if (conflicts.some(attribute => element.hasAttribute(attribute) && element.getAttribute(attribute) !== attrs[attribute])
      || (semanticText && normalizeDomText(element.textContent ?? '') !== semanticText)) throw new Error('旧节点的 ID/name 与保存的文本或属性冲突，未自动修改');
    return describe(element);
  }
  // Extract ID tokens only from the ancestor part of the original CSS. Never
  // execute/evaluate the path as code, or trust its nth-child indexes.
  const parts = target.selector.split(/\s*(?:>|\+|~|\s)\s*/).filter(Boolean);
  const anchors = parts.slice(0,-1).flatMap(part => {
    const match = part.match(/^#([a-zA-Z_][\w-]*)/);
    return match && stableId(match[1]) ? [match[1]] : [];
  }).reverse();
  let scope: Element[] = all;
  if (anchors.length) {
    const roots = [...document.querySelectorAll('[id]')].filter(element => element.id === anchors[0]);
    if (roots.length > 1) throw new Error('旧 Selector 的上层 ID 不唯一，未自动修改');
    if (!roots.length) return null; // Never escape a recorded business region.
    scope = all.filter(element => roots[0].contains(element));
  }
  const keys = ['data-testid','data-test','data-qa','name','aria-label','placeholder'].filter(key => attrs[key]);
  const identities = scope.filter(element => keys.every(key => element.getAttribute(key) === attrs[key])
    && (!semanticText || normalizeDomText(element.textContent ?? '') === semanticText));
  if (keys.length || semanticText) {
    const element = unique(identities);
    return element ? describe(element) : null;
  }
  // Handwritten stable CSS with no metadata can upgrade if it is unique and
  // has a stable attribute/ID identity. Generic/positional selectors stay untouched.
  if (!/:nth-|:first-|:last-|:only-|[>+~]/i.test(target.selector) && /#|\[(?:id|name|data-testid|data-test|data-qa|aria-label|placeholder)=/.test(target.selector)) {
    let exact: Element[]; try { exact = [...document.querySelectorAll(target.selector)].filter(element => all.includes(element)); } catch { return null; }
    const element = unique(exact);
    if (element && captureLocator(element).confidence !== 'low') return describe(element);
    return null;
  }
  let exact: Element[]; try { exact = [...document.querySelectorAll(target.selector)].filter(element => scope.includes(element)); } catch { return null; }
  if (!exact.length) return null;
  throw new Error('旧节点缺少可验证的 ID、name 或完整文本等身份信息，保留原配置，无法安全自动升级');
}
