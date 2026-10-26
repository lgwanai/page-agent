// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { repairLegacyTarget } from './legacy-target';
import { resolveLocator } from './locator-plan';
import type { PageTarget } from '@/types/workflow';
const target = (patch: Partial<PageTarget> = {}): PageTarget => ({name:'保存',label:'保存',tagName:'button',frameId:33,selector:'#toolbar > button:nth-child(2)',text:'保存',...patch});
beforeEach(() => { vi.stubGlobal('CSS',{escape:(value:string)=>value}); document.body.innerHTML = '<section id="toolbar"><button>新增</button><div><button>保存</button></div><button>取消</button></section><button>保存</button>'; });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML=''; window.name=''; });
it('repairs a stale numeric path even when it now hits a different button', () => {
  const old=target({selector:'#toolbar > button:nth-of-type(2)'}), copy=structuredClone(old);
  const next=repairLegacyTarget(old)!;
  expect(next.selector).toBe('#toolbar button');
  expect(next.locator?.candidates[0]).toMatchObject({kind:'ancestor-exact',match:{kind:'text',value:'保存'}});
  expect(resolveLocator(next.locator!)).toBe(document.querySelector('#toolbar div button'));
  expect(old).toEqual(copy);
});
it('rejects duplicate identities inside the saved scope without using old indexes', () => {
  document.querySelector('#toolbar')!.insertAdjacentHTML('beforeend','<button>保存</button>');
  expect(()=>repairLegacyTarget(target())).toThrow('不唯一');
});
it('does not escape a missing saved region to a lookalike elsewhere', () => {
  document.querySelector('#toolbar')!.remove();
  expect(repairLegacyTarget(target())).toBeNull();
});
it('recovers after an old ID disappears using a unique name and compatible input type', () => {
  document.body.innerHTML='<input name="customer" type="text"><input name="other" type="text">';
  const next=repairLegacyTarget(target({tagName:'input',text:'',selector:'#old-id',attributes:{id:'old-id',name:'customer',type:'text'}}))!;
  expect(next.selector).toBe('input[name="customer"]');
});
it('rejects recycled IDs with conflicting saved identity', () => {
  document.body.innerHTML='<input id="date" placeholder="其他日期"><button id="save">取消</button>';
  expect(()=>repairLegacyTarget(target({tagName:'input',selector:'#date',text:'',attributes:{id:'date',placeholder:'开始日期'}}))).toThrow('冲突');
  expect(()=>repairLegacyTarget(target({selector:'#save',attributes:{id:'save'}}))).toThrow('冲突');
});
it('uses complete text globally only when no ancestor scope was recorded', () => {
  expect(()=>repairLegacyTarget(target({selector:'.generated.active > button:nth-child(2)'}))).toThrow('不唯一');
  document.body.innerHTML='<button>取消</button><button>保存</button>';
  expect(repairLegacyTarget(target({selector:'.old > button:nth-child(3)'}))?.locator?.candidates[0].kind).toBe('text');
});
it('does not treat a truncated snapshot as full exact text', () => {
  const text='文'.repeat(160); document.body.innerHTML='<button>'+text+'更多内容</button>';
  expect(()=>repairLegacyTarget(target({selector:'button:nth-child(1)',text}))).toThrow('身份信息');
});
it('refuses positional-only identity and wrong tags', () => {
  expect(()=>repairLegacyTarget(target({selector:'#toolbar > button:nth-child(1)',text:''}))).toThrow('身份信息');
  document.body.innerHTML='<div id="field"></div>';
  expect(repairLegacyTarget(target({selector:'#field',tagName:'input',text:'',attributes:{id:'field'}}))).toBeNull();
});
it('upgrades a unique stable CSS ID without stored attributes', () => {
  document.body.innerHTML='<button id="save">保存</button>';
  expect(repairLegacyTarget(target({selector:'#save',text:''}))?.selector).toBe('#save');
});
it('never rewrites dynamic selector templates or explicitly edited modern plans', () => {
  expect(repairLegacyTarget(target({selector:'{{item.selector}}'}))).toBeNull();
  const modern=repairLegacyTarget(target())!;
  expect(repairLegacyTarget({...target(),locator:modern.locator})).toBeNull();
});
