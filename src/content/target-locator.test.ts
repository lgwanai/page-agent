// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { locateEventTarget } from './target-locator';

afterEach(() => { document.body.innerHTML = ''; });

describe('recorded target recovery', () => {
  it('does not accept a same-ID lookalike with different recorded identity', () => {
    document.body.innerHTML = '<input id="datePeriod" placeholder="其他日期" disabled>';
    expect(locateEventTarget('#datePeriod', { tagName: 'input', attributes: { id: 'datePeriod', placeholder: '开始日期' } })).toBeNull();
  });

  it('checks the recorded element type even when the CSS selector matches exactly once', () => {
    document.body.innerHTML = '<div id="datePeriod"></div>';
    expect(locateEventTarget('#datePeriod', { tagName: 'input', attributes: { id: 'datePeriod' } })).toBeNull();
  });

  it('recovers an end-date input after its recorded active class disappears', () => {
    document.body.innerHTML = '<div class="dt-oui-picker-input"><input placeholder="开始日期"></div><span>至</span><div class="dt-oui-picker-input"><input placeholder="结束日期"></div>';
    const hint = { tagName: 'input', attributes: { placeholder: '结束日期' } };
    const oldSelector = 'div.dt-oui-picker-input.dt-oui-picker-input-active:nth-of-type(3) > input';
    expect(locateEventTarget(oldSelector, hint)).toBe(document.querySelector('[placeholder="结束日期"]'));
  });

  it('does not pick the first of multiple inputs with the same recorded identity', () => {
    document.body.innerHTML = '<input placeholder="结束日期"><input placeholder="结束日期">';
    expect(() => locateEventTarget('.active > input', { tagName: 'input', attributes: { placeholder: '结束日期' } })).toThrow('不唯一');
  });

  it('matches the recorded tag and all stable identity attributes', () => {
    document.body.innerHTML = '<textarea placeholder="结束日期"></textarea><input placeholder="结束日期" name="other"><input placeholder="结束日期" name="endDate">';
    expect(locateEventTarget('.active > input', { tagName: 'input', attributes: { placeholder: '结束日期', name: 'endDate' } }))
      .toBe(document.querySelector('[name="endDate"]'));
  });

  it('disambiguates button selectors using their recorded label text', () => {
    document.body.innerHTML = '<button class="primary" type="button">生成报表</button><button class="primary" type="button">下载报表</button>';
    expect(locateEventTarget('button.primary', { tagName: 'button', text: '下载报表', attributes: { type: 'button' } }))
      .toBe(document.querySelectorAll('button')[1]);
  });

  it('never guesses a missing generic node without stable identity', () => {
    document.body.innerHTML = '<input><button>提交</button>';
    expect(locateEventTarget('.active > input', { tagName: 'input', attributes: { tabindex: '0' } })).toBeNull();
    expect(locateEventTarget('.missing', { tagName: 'div', text: '提交' })).toBeNull();
  });

  it('keeps a unique original selector authoritative', () => {
    document.body.innerHTML = '<input id="endDate">';
    expect(locateEventTarget('#endDate')).toBe(document.querySelector('#endDate'));
  });

  it('fails safely instead of using the first match of an ambiguous selector', () => {
    document.body.innerHTML = '<a>one</a><a>two</a>';
    expect(() => locateEventTarget('a')).toThrow('多个节点');
    expect(() => locateEventTarget('a', { tagName: 'a', text: '' })).toThrow('缺少唯一身份信息');
  });
});
