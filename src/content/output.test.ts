// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readOutputDom } from './output';
beforeEach(() => { document.body.innerHTML = '<div id="status" data-state="done">取数完成<script>SECRET</script><input type="password" value="SECRET"></div><input id="start" value="2026-10-01"><a href="/one">一</a><a href="/two">二</a>'; });
it('reads text, current input value and a named attribute', () => {
  expect(readOutputDom('#status', 'text')).toBe('取数完成');
  (document.querySelector('#start') as HTMLInputElement).value = '2026-10-11';
  expect(readOutputDom('#start', 'value')).toBe('2026-10-11');
  expect(readOutputDom('#status', 'attribute', 'data-state')).toBe('done');
});
it('returns lists only when explicitly configured and preserves empty attribute values', () => {
  expect(() => readOutputDom('a', 'text')).toThrow('唯一');
  expect(readOutputDom('a', 'attribute', 'href', true)).toEqual(['/one', '/two']);
  document.querySelector('#status')!.setAttribute('data-empty', '');
  expect(readOutputDom('#status', 'attribute', 'data-empty')).toBe('');
});
it('fails on missing DOM, missing attributes and unsupported value controls', () => {
  expect(() => readOutputDom('#missing', 'text')).toThrow('不存在');
  expect(() => readOutputDom('#status', 'attribute', 'data-missing')).toThrow('缺少属性');
  expect(() => readOutputDom('#status', 'value')).toThrow('input');
});
it('does not expose password, hidden input or script data', () => {
  document.body.insertAdjacentHTML('beforeend', '<input type="hidden" value="SECRET">');
  for (const selector of ['input[type="password"]', 'input[type="hidden"]', 'script']) expect(() => readOutputDom(selector, 'attribute', 'value')).toThrow('不允许');
});
