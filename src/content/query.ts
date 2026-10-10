import type { DomQuery, DomQueryMatch } from '@/types/workflow';
import { describeElement } from './selector';

function domValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return element.value;
  return element.textContent ?? '';
}

/** Traverse selected scopes and return deduplicated, document-ordered DOM snapshots. */
export function queryDom(selector: string, query: DomQuery): Omit<DomQueryMatch, 'frameId'>[] {
  if (!selector.trim()) throw new Error('请先选择 Query 检索范围');
  const roots = [...document.querySelectorAll(selector)];
  if (!roots.length) throw new Error(`Query 检索范围不存在：${selector}`);
  if (!['attribute', 'value', 'text'].includes(query.source)) throw new Error('Query 检索内容类型无效');
  if (!['exists', 'equals', 'contains', 'regex'].includes(query.match)) throw new Error('Query 匹配方式无效');
  const attributeName = query.attributeName.trim();
  if (query.source === 'attribute' && !attributeName) throw new Error('请填写要检索的属性名称');
  let regex: RegExp | undefined;
  if (query.match === 'regex') {
    try { regex = new RegExp(query.pattern, query.regexFlags); }
    catch (error) { throw new Error(`Query 正则表达式无效：${(error as Error).message}`); }
  }
  const candidateSelector = query.candidateSelector.trim() || '*';
  const candidates = new Set<Element>();
  for (const root of roots) {
    if (query.includeRoot && root.matches(candidateSelector)) candidates.add(root);
    for (const element of root.querySelectorAll(candidateSelector)) candidates.add(element);
  }
  const ordered = [...candidates].sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1);
  return ordered.flatMap((element) => {
    const matchedValue = query.source === 'attribute' ? element.getAttribute(attributeName)
      : query.source === 'text' ? element.textContent ?? '' : domValue(element);
    if (matchedValue === null) return [];
    let matches = query.match === 'exists';
    if (query.match === 'equals') matches = matchedValue === query.pattern;
    if (query.match === 'contains') matches = matchedValue.includes(query.pattern);
    if (regex) { regex.lastIndex = 0; matches = regex.test(matchedValue); }
    if (!matches) return [];
    const description = describeElement(element);
    return [{
      ...description, name: description.label, value: domValue(element), text: element.textContent ?? '',
      matchedValue, attributes: Object.fromEntries([...element.attributes].map((attribute) => [attribute.name, attribute.value])),
    }];
  });
}
