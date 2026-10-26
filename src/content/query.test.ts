// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DOM_QUERY } from '@/types/workflow';
import { queryDom } from './query';

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML = '<section id="scope" data-id="root"><a id="first" href="/orders/12">订单12</a><div id="nested"><a id="second" href="/other">其他</a><input id="field" value="initial"><a id="empty" href="">空链接</a></div></section><a id="outside" href="/orders/13">范围外</a>';
});
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

describe('Query DOM traversal', () => {
  it('matches only a specified cell but returns its row for later radio selection', () => {
    document.body.innerHTML = '<table id="scope"><tbody><tr id="row1"><td><input type="radio"></td><td>  茶\n </td><td>352</td></tr><tr id="row2"><td><input type="radio"></td><td>餐饮具</td><td>茶</td></tr></tbody></table>';
    const config = { ...DEFAULT_DOM_QUERY, candidateSelector: 'tbody > tr', readSelector: ':scope > td:nth-child(2)', source: 'text' as const, match: 'equals' as const, pattern: '茶', normalizeWhitespace: true };
    expect(queryDom('#scope', config)).toMatchObject([{ selector: '#row1', matchedValue: '茶', tagName: 'tr' }]);
    expect(queryDom('#scope', { ...config, pattern: '餐' })).toEqual([]);
    expect(queryDom('#scope', { ...config, readSelector: '.missing' })).toEqual([]);
    expect(() => queryDom('#scope', { ...config, readSelector: 'td' })).toThrow('必须唯一');
    expect(queryDom('#scope', { ...config, match: 'exists', maxResults: 1 }).map(row => row.selector)).toEqual(['#row1']);
    expect(() => queryDom('#scope', { ...config, maxResults: 0 })).toThrow('返回数量');
  });
  it('finds named attributes, including empty attributes, only inside the scope', () => {
    const matches = queryDom('#scope', { ...DEFAULT_DOM_QUERY, source: 'attribute', attributeName: 'href' });
    expect(matches.map((item) => item.selector)).toEqual(['#first', '#second', '#empty']);
    expect(matches[0]).toMatchObject({ tagName: 'a', value: '订单12', text: '订单12', matchedValue: '/orders/12', attributes: { id: 'first', href: '/orders/12' } });
  });

  it('supports exact and contains filtering on attributes', () => {
    const config = { ...DEFAULT_DOM_QUERY, source: 'attribute' as const, attributeName: 'href', pattern: '/orders/' };
    expect(queryDom('#scope', { ...config, match: 'contains' }).map((item) => item.selector)).toEqual(['#first']);
    expect(queryDom('#scope', { ...config, match: 'equals', pattern: '/other' }).map((item) => item.selector)).toEqual(['#second']);
    expect(queryDom('#scope', { ...config, match: 'regex', pattern: '^$' }).map((item) => item.selector)).toEqual(['#empty']);
  });

  it('reads current form values rather than stale value attributes', () => {
    document.querySelector<HTMLInputElement>('#field')!.value = 'WorkBuddy';
    const matches = queryDom('#scope', { ...DEFAULT_DOM_QUERY, candidateSelector: 'input', match: 'regex', pattern: '^workbuddy$', regexFlags: 'i' });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ selector: '#field', value: 'WorkBuddy', matchedValue: 'WorkBuddy', attributes: { value: 'initial' } });
  });

  it('reads select and textarea values and falls back to text for other DOM', () => {
    document.body.innerHTML = '<div id="scope"><select id="choice"><option value="abc">标签</option></select><textarea id="text">abc</textarea><span id="label">abc</span></div>';
    expect(queryDom('#scope', { ...DEFAULT_DOM_QUERY, candidateSelector: 'select,textarea,span', match: 'equals', pattern: 'abc' }).map((item) => item.selector)).toEqual(['#choice', '#text', '#label']);
  });

  it('resets global regex state, deduplicates overlapping scopes and preserves DOM order', () => {
    const matches = queryDom('#nested, #scope', { ...DEFAULT_DOM_QUERY, candidateSelector: 'a', source: 'text', match: 'regex', pattern: '.', regexFlags: 'g' });
    expect(matches.map((item) => item.selector)).toEqual(['#first', '#second', '#empty']);
  });

  it('honors whether the selected root is included', () => {
    const config = { ...DEFAULT_DOM_QUERY, source: 'attribute' as const, attributeName: 'data-id' };
    expect(queryDom('#scope', config).map((item) => item.selector)).toEqual(['#scope']);
    expect(queryDom('#scope', { ...config, includeRoot: false })).toEqual([]);
  });

  it('returns an empty list when no value matches, but rejects missing scopes or invalid settings', () => {
    expect(queryDom('#scope', { ...DEFAULT_DOM_QUERY, match: 'equals', pattern: '不存在' })).toEqual([]);
    expect(() => queryDom('', DEFAULT_DOM_QUERY)).toThrow('请先选择');
    expect(() => queryDom('#missing', DEFAULT_DOM_QUERY)).toThrow('范围不存在');
    expect(() => queryDom('#scope', { ...DEFAULT_DOM_QUERY, source: 'attribute' })).toThrow('属性名称');
    expect(() => queryDom('#scope', { ...DEFAULT_DOM_QUERY, match: 'regex', pattern: '[' })).toThrow('正则表达式无效');
    expect(() => queryDom('#scope', { ...DEFAULT_DOM_QUERY, candidateSelector: '[' })).toThrow();
  });
});
