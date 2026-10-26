// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureLocator, resolveLocator } from './locator-plan';
import { describeElement, startSelecting, stopSelecting } from './selector';
import { startRecording, stopRecording } from './recorder';
import { locateEventTarget } from './target-locator';

beforeEach(() => { vi.stubGlobal('CSS', { escape: (s: string) => s }); });
afterEach(() => { stopSelecting(); stopRecording(); document.body.innerHTML = ''; window.name = ''; vi.unstubAllGlobals(); });
it('prioritizes id, then name, then ancestor ID with exact text before class', () => {
  document.body.innerHTML = '<section id="toolbar"><button id="save" name="save" class="submit">保存</button><button>取消</button></section><button>保存</button>';
  const button = document.querySelector('#save')!;
  const plan = captureLocator(button);
  expect(plan.candidates.slice(0,3).map(c => c.kind)).toEqual(['id','name','ancestor-exact']);
  expect(plan.candidates[2]).toMatchObject({ anchor: '#toolbar', match: { kind: 'text', value: '保存' } });
  button.removeAttribute('id'); expect(resolveLocator(plan)).toBe(button);
  button.removeAttribute('name'); button.className = 'new-active';
  button.parentElement!.insertAdjacentHTML('afterbegin', '<button>新增</button><div>新布局</div>');
  const wrap = document.createElement('div'); button.replaceWith(wrap); wrap.append(button);
  expect(resolveLocator(plan)).toBe(button);
});
it('survives sibling insertion and wrapper changes without numeric indexes', () => {
  document.body.innerHTML = '<div id="tools"><button>保存</button><button>取消</button></div><button>保存</button>';
  const button = document.querySelector('#tools button')!;
  const target = describeElement(button);
  expect(target.selector).toBe('#tools button');
  expect(target.locator!.candidates[0].match).toEqual({ kind:'text', value:'保存' });
  button.parentElement!.insertAdjacentHTML('afterbegin','<button>新建</button>');
  expect(locateEventTarget(target.selector,target)).toBe(button);
  button.textContent = '保存草稿';
  expect(locateEventTarget(target.selector,target)).toBeNull();
});
it('rejects newly ambiguous identities rather than selecting the first match', () => {
  document.body.innerHTML = '<div id="tools"><button>保存</button></div>';
  const plan = captureLocator(document.querySelector('button')!);
  document.querySelector('#tools')!.insertAdjacentHTML('beforeend','<button>保存</button>');
  expect(() => resolveLocator(plan)).toThrow('不唯一');
});
it('uses exact value for buttons but never captures mutable form values', () => {
  document.body.innerHTML = '<div id="form"><input type="submit" value="提交"><input type="submit" value="取消"><input name="customer" value="私密输入"></div>';
  const submit = captureLocator(document.querySelector('input')!);
  expect(submit.candidates[0]).toMatchObject({ kind:'ancestor-exact', match:{kind:'value',value:'提交'} });
  const edit = document.querySelector('[name=customer]') as HTMLInputElement;
  const plan = captureLocator(edit); edit.value = '新的数据';
  expect(JSON.stringify(plan)).not.toContain('私密输入');
  expect(resolveLocator(plan)).toBe(edit);
});
it('avoids generated IDs and transient classes', () => {
  document.body.innerHTML = '<div id="tools"><button id="radix-123" class="css-abcd active loading">提交</button></div>';
  const plan = captureLocator(document.querySelector('button')!);
  expect(plan.selector).toBe('#tools button');
  expect(JSON.stringify(plan)).not.toMatch(/radix|css-abcd|loading/);
});
it('flags positional-only locators and rejects changed sibling structures', () => {
  document.body.innerHTML = '<div><button></button><button></button></div>';
  const button = document.querySelectorAll('button')[1], plan = captureLocator(button);
  expect(plan.confidence).toBe('low');
  expect(resolveLocator(plan)).toBe(button);
  button.parentElement!.insertAdjacentHTML('afterbegin','<button></button>');
  expect(() => resolveLocator(plan)).toThrow('页面结构已改变');
});
it('records and manually selects the same semantic button despite focus classes', () => {
  document.body.innerHTML = '<div id="tools"><button><span>提交</span></button><button>取消</button></div><button>提交</button>';
  const child = document.querySelector('span')!;
  document.elementFromPoint = vi.fn(() => child);
  const selected = vi.fn(); startSelecting(selected); child.dispatchEvent(new MouseEvent('click',{ bubbles:true,cancelable:true }));
  const recorded = vi.fn(); startRecording(recorded,vi.fn(),false);
  child.closest('button')!.className = 'active loading'; (child as HTMLElement).click(); stopRecording();
  expect(selected.mock.calls[0][0].locator).toEqual(recorded.mock.calls[0][0].target.locator);
});
it('checks frame names and lets explicit selector edits replace captured plans', () => {
  document.body.innerHTML = '<button id="one">一</button><button id="two">二</button>'; window.name = 'order-form';
  const target = describeElement(document.querySelector('#one')!);
  window.name = 'other-form'; expect(locateEventTarget(target.selector,target)).toBeNull();
  expect(locateEventTarget('#two',target)).toBe(document.querySelector('#two'));
});
