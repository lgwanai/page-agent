// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RunInputs } from './RunInputs';
import { readValueDraft, valueDraft } from './StructuredRunInput';
import type { StartInputDeclaration, StartInputType } from '@/types/workflow';

let root: Root;
let container: HTMLDivElement;
let stored: Record<string, unknown>;
const run = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); stored = {};
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(stored[key]) })),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(stored, values)),
  } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const field = (type: StartInputType, name = 'data', required = true): StartInputDeclaration => ({ id: name, name, type, required });
async function render(inputs = [field('object')], historyKey = 'workflow') {
  await act(async () => root.render(<RunInputs inputs={inputs} historyKey={historyKey} onCancel={cancel} onRun={run} />));
}
function labelled<T extends HTMLElement>(label: string): T {
  const item = [...container.querySelectorAll<HTMLElement>('[aria-label]')].find(node => node.getAttribute('aria-label') === label);
  if (!item) throw new Error(`Missing control: ${label}`);
  return item as T;
}
async function click(text: string) {
  const item = [...container.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text);
  if (!item) throw new Error(`Missing button: ${text}`);
  await act(async () => item.click());
}
async function set(label: string, value: string) {
  const input = labelled<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(label);
  const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}

it('provides typed text/number controls and omits blank optional parameters', async () => {
  await render([field('string', 'name'), field('number', 'count'), field('object', 'optional', false)]);
  expect(labelled<HTMLInputElement>('name').type).toBe('text');
  expect(labelled<HTMLInputElement>('count').type).toBe('number');
  await set('name', 'customer'); await set('count', '0'); await click('开始运行');
  expect(run).toHaveBeenCalledWith({ name: 'customer', count: 0 });
});

it('builds nested objects with string, number and boolean controls without JSON', async () => {
  await render();
  await click('给data添加字段'); await set('data的第1个字段名', 'customer'); await set('data.customer的类型', 'object');
  await click('给data.customer添加字段'); await set('data.customer的第1个字段名', 'city'); await set('data.customer.city的值', '上海');
  await click('给data添加字段'); await set('data的第2个字段名', 'count'); await set('data.count的类型', 'number'); await set('data.count的值', '0');
  await click('给data添加字段'); await set('data的第3个字段名', 'active'); await set('data.active的类型', 'boolean'); await set('data.active的值', 'false');
  await click('开始运行');
  expect(run).toHaveBeenCalledWith({ data: { customer: { city: '上海' }, count: 0, active: false } });
  expect(stored['pageAgentRunInputs:workflow']).toEqual({ data: { type: 'object', value: '{"customer":{"city":"上海"},"count":0,"active":false}' } });
});

it('builds object arrays and allows only objects for their immediate items', async () => {
  await render([field('objectArray')]);
  await click('给data添加一项');
  expect([...labelled<HTMLSelectElement>('data[1]的类型').options].map(option => option.value)).toEqual(['object']);
  await click('给data[1]添加字段'); await set('data[1]的第1个字段名', 'SKU'); await set('data[1].SKU的值', 'A001');
  await click('给data添加一项'); await click('删除data[2]');
  await click('开始运行'); expect(run).toHaveBeenCalledWith({ data: [{ SKU: 'A001' }] });
});

it('edits lists and nested arrays with per-item types', async () => {
  await render([field('array')]); await click('给data添加一项'); await set('data[1]的值', 'a');
  expect([...labelled<HTMLSelectElement>('data[1]的类型').options].map(option => option.value)).not.toContain('object');
  await click('给data添加一项'); await set('data[2]的类型', 'array');
  await click('给data[2]添加一项'); await set('data[2][1]的类型', 'number'); await set('data[2][1]的值', '2.5');
  await click('开始运行'); expect(run).toHaveBeenCalledWith({ data: ['a', [2.5]] });
});

it('imports JSON into the layered form and persists nested values after reopening', async () => {
  await render([field('objectArray')]); await click('粘贴 / 编辑 JSON');
  await set('data', '[{"SKU":"001","count":3,"detail":{"enabled":false}}]'); await click('分层表单');
  expect(labelled<HTMLInputElement>('data[1].SKU的值').value).toBe('001');
  expect(labelled<HTMLInputElement>('data[1].count的值').type).toBe('number');
  await click('开始运行');
  await act(async () => root.unmount()); root = createRoot(container); await render([field('objectArray')]);
  expect(labelled<HTMLInputElement>('data[1].SKU的值').value).toBe('001');
  await click('开始运行');
  expect(run).toHaveBeenLastCalledWith({ data: [{ SKU: '001', count: 3, detail: { enabled: false } }] });
});

it('rejects duplicate fields or incomplete numbers instead of submitting previous valid JSON', async () => {
  await render(); await click('给data添加字段'); await set('data的第1个字段名', 'count'); await set('data.count的类型', 'number');
  await set('data.count的值', ''); await click('开始运行'); expect(run).not.toHaveBeenCalled();
  expect(container.textContent).toContain('有效数字');
  await set('data.count的值', '1'); await click('给data添加字段'); await set('data的第2个字段名', 'count');
  await click('开始运行'); expect(run).not.toHaveBeenCalled(); expect(container.textContent).toContain('重复');
  await click('删除data.count'); // Remove the first duplicate; remaining text field is valid.
  await click('开始运行'); expect(run).toHaveBeenCalledWith({ data: { count: '' } });
});

it('does not run malformed JSON or a JSON value of the wrong declared type', async () => {
  await render(); await click('粘贴 / 编辑 JSON'); await set('data', '{'); await click('开始运行');
  expect(run).not.toHaveBeenCalled(); expect(container.textContent).toContain('JSON');
  await set('data', '[]'); await click('分层表单'); expect(container.textContent).toContain('数据类型');
  await click('开始运行'); expect(run).not.toHaveBeenCalled();
  await set('data', '{}'); await click('开始运行'); expect(run).toHaveBeenCalledWith({ data: {} });
});

it('distinguishes an explicit empty object from omission and clears only this workflow history', async () => {
  stored['pageAgentRunInputs:other'] = { data: { type: 'object', value: '{"other":1}' } };
  await render(); await click('开始运行'); expect(run).not.toHaveBeenCalled();
  await click('使用空对象'); await click('开始运行'); expect(run).toHaveBeenCalledWith({ data: {} });
  run.mockClear(); await act(async () => root.unmount()); root = createRoot(container); await render();
  await click('清除本工作流的手动参数记忆'); await click('开始运行');
  expect(run).not.toHaveBeenCalled(); expect(stored['pageAgentRunInputs:workflow']).toEqual({});
  expect(stored['pageAgentRunInputs:other']).toEqual({ data: { type: 'object', value: '{"other":1}' } });
});

it('ignores remembered values of a changed type and does not save edits on cancel', async () => {
  stored['pageAgentRunInputs:workflow'] = { data: { type: 'string', value: 'old' } };
  await render([field('number')]); expect(labelled<HTMLInputElement>('data').value).toBe('');
  await set('data', '123'); await click('取消'); expect(cancel).toHaveBeenCalledOnce();
  expect(stored['pageAgentRunInputs:workflow']).toEqual({ data: { type: 'string', value: 'old' } });
});

it('round-trips special property names safely and bounds excessive nesting', () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"constructor":"text","a.b":[false,null]}');
  expect(readValueDraft(valueDraft(source), 'data')).toEqual(source);
  expect(({} as Record<string, unknown>).safe).toBeUndefined();
  let nested: unknown = 'end'; for (let index = 0; index < 25; index++) nested = { child: nested };
  expect(() => valueDraft(nested)).toThrow('层级');
});
