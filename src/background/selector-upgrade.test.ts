import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { upgradeLegacyTarget, applySelectorUpgradePatches, SelectorUpgradeSession } from './selector-upgrade';
import type { PageTarget, SelectorUpgradeReport, WorkflowNode, WorkspaceState } from '@/types/workflow';
vi.mock('./frame-messaging',()=>({readyFrame:vi.fn(async()=>true)}));
const old:PageTarget={name:'保存',label:'保存',selector:'#tools > button:nth-child(2)',tagName:'button',frameId:7,frameUrl:'https://example.com/form?activityId=1&processId=old',text:'保存'};
const description={...old,selector:'#tools button',locator:{version:1 as const,selector:'#tools button',tagName:'button',confidence:'high' as const,candidates:[{kind:'ancestor-exact' as const,anchor:'#tools',selector:'button',match:{kind:'text' as const,value:'保存'}}]}};
const node=(target=structuredClone(old)):WorkflowNode=>({id:'click',name:'保存按钮',kind:'dom',target,event:{type:'click'}});
const send=vi.fn();
beforeEach(()=>{send.mockReset();send.mockResolvedValue({ok:true,targetUpgrade:1,target:description});vi.stubGlobal('chrome',{webNavigation:{getAllFrames:vi.fn(async()=>[{frameId:99,documentId:'new-doc',url:'https://example.com/form?activityId=1&processId=new'}])},tabs:{sendMessage:send}});});
afterEach(()=>{vi.unstubAllGlobals();});
it('repairs against a rebuilt document and preserves business guards and a full backup',async()=>{
  const result=(await upgradeLegacyTarget(1,old,0))!;
  expect(result).toMatchObject({frameId:99,frameQueryKeys:['activityId'],selector:'#tools button',selectorUpgrade:{version:1,previous:old}});
  expect(send).toHaveBeenCalledWith(1,{type:'PAGE_AGENT_REPAIR_TARGET',target:old},{frameId:99,documentId:'new-doc'});
  expect(old.selector).toContain('nth-child');
});
it('rejects changed business parameters before any page probe',async()=>{
  vi.mocked(chrome.webNavigation.getAllFrames).mockResolvedValue([{frameId:99,url:'https://example.com/form?activityId=2&processId=new'}] as chrome.webNavigation.GetAllFrameResultDetails[]);
  await expect(upgradeLegacyTarget(1,old,0)).rejects.toThrow('业务 URL');
  expect(send).not.toHaveBeenCalled();
});
it('rejects multiple matching iframe documents instead of preferring the old frame ID',async()=>{
  vi.mocked(chrome.webNavigation.getAllFrames).mockResolvedValue([7,99].map(frameId=>({frameId,url:old.frameUrl!})) as chrome.webNavigation.GetAllFrameResultDetails[]);
  await expect(upgradeLegacyTarget(1,old,0)).rejects.toThrow('多个 iframe');
});
it('does not migrate when a page reports an ambiguous identity or missing capability',async()=>{
  send.mockResolvedValueOnce({ok:false,targetUpgrade:1,error:'身份不唯一'});
  await expect(upgradeLegacyTarget(1,old,0)).rejects.toThrow('不唯一');
  send.mockResolvedValueOnce({ok:true});
  await expect(upgradeLegacyTarget(1,old,0)).rejects.toThrow('页面脚本');
});
it('waits for late-rendered controls without replaying any action',async()=>{
  vi.useFakeTimers();
  try {
    send.mockResolvedValueOnce({ok:true,targetUpgrade:1,target:null});
    const pending=upgradeLegacyTarget(1,old,1000); await vi.runAllTimersAsync();
    expect((await pending)?.locator).toBeDefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.every(call=>call[1].type==='PAGE_AGENT_REPAIR_TARGET')).toBe(true);
  } finally {vi.useRealTimers();}
});
it('skips modern targets and dynamic templates',async()=>{
  expect(await upgradeLegacyTarget(1,description,0)).toBeUndefined();
  expect(await upgradeLegacyTarget(1,{...old,selector:'{{item.selector}}'},0)).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
const state=():WorkspaceState=>({scripts:[{id:'workflow',name:'旧流程',createdAt:1,updatedAt:1,nodes:[node()],edges:[]}],actions:[],draft:[],draftEdges:[]});
const report=():SelectorUpgradeReport=>({nodeId:'click',nodeName:'保存按钮',workflowId:'workflow',workflowKind:'script',status:'upgraded',reason:'升级',previous:structuredClone(old),target:structuredClone(description)});
it('patches only the verified target and preserves concurrent metadata and unrelated nodes',()=>{
  const latest=state(), item=report(); latest.scripts[0].name='并发改名';latest.scripts[0].nodes.push({id:'wait',name:'新增节点',kind:'wait',durationMs:1});
  applySelectorUpgradePatches(latest,[{owner:{kind:'script',id:'workflow'},report:item}]);
  expect(item.persisted).toBe(true);expect(latest.scripts[0].name).toBe('并发改名');
  expect(latest.scripts[0].nodes).toHaveLength(2);expect(latest.scripts[0].updatedAt).toBeGreaterThan(1);
});
it('preserves a concurrently edited target or deleted workflow',()=>{
  for(const deleted of [false,true]){
    const latest=state(),item=report();
    if(deleted)latest.scripts=[];else (latest.scripts[0].nodes[0] as Extract<WorkflowNode,{kind:'dom'}>).target.selector='#new-user-selector';
    applySelectorUpgradePatches(latest,[{owner:{kind:'script',id:'workflow'},report:item}]);
    expect(item).toMatchObject({status:'conflict',persisted:false});
    if(!deleted)expect((latest.scripts[0].nodes[0] as Extract<WorkflowNode,{kind:'dom'}>).target.selector).toBe('#new-user-selector');
  }
});
it('registers nested nodes but upgrades them only when executed',async()=>{
  const child=node(),parent:WorkflowNode={id:'loop',name:'循环',kind:'loop',items:'[]',itemVariable:'row',indexVariable:'index',maxIterations:10,body:{nodes:[child],edges:[]}};
  const session=new SelectorUpgradeSession();session.register([parent],{kind:'script',id:'workflow'});
  await session.prepare(1,parent);expect(send).not.toHaveBeenCalled();
  await session.prepare(1,child);expect(session.reports[0]).toMatchObject({workflowId:'workflow',status:'upgraded'});
  await session.prepare(1,child);expect(send).toHaveBeenCalledTimes(1);
});
