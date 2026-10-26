import { expect, it } from 'vitest';
import { applySelectorUpgradeReports } from './selector-upgrades';
import type { PageTarget, SelectorUpgradeReport, WorkflowNode } from '@/types/workflow';
const previous:PageTarget={name:'旧',label:'旧',tagName:'button',frameId:0,selector:'button:nth-child(1)'};
const target:PageTarget={...previous,selector:'#save'};
const report:SelectorUpgradeReport={nodeId:'button',nodeName:'保存',status:'upgraded',reason:'验证通过',previous,target,workflowKind:'script',workflowId:'script'};
it('updates nested drafts immutably and preserves user edits and other owners',()=>{
  const child:WorkflowNode={id:'button',name:'保存',kind:'dom',target:previous,event:{type:'click'}};
  const loop:WorkflowNode={id:'loop',name:'循环',kind:'loop',items:'[]',itemVariable:'row',indexVariable:'index',maxIterations:1,body:{nodes:[child],edges:[]}};
  const [updated]=applySelectorUpgradeReports([loop],[report],'script');
  expect(updated).not.toBe(loop);
  expect((updated as typeof loop).body!.nodes[0]).toMatchObject({target});
  expect(child.target).toEqual(previous);
  child.target={...previous,selector:'#user-edit'};
  expect((applySelectorUpgradeReports([loop],[report],'script')[0] as typeof loop).body!.nodes[0]).toMatchObject({target:child.target});
  expect(applySelectorUpgradeReports([child],[{...report,workflowId:'other'}],'script')[0]).toBe(child);
});
it('updates AI inputs by binding ID and ignores unresolved results',()=>{
  const ai:WorkflowNode={id:'ai',name:'AI',kind:'ai',instruction:'读取',event:{type:'click'},inputs:[{id:'field',name:'字段',type:'selector',target:previous}]};
  const result=applySelectorUpgradeReports([ai],[{...report,nodeId:'ai',inputId:'field'}],'script')[0] as typeof ai;
  expect(result.inputs[0].target).toEqual(target);
  expect(applySelectorUpgradeReports([ai],[{...report,nodeId:'ai',inputId:'field',status:'unresolved'}],'script')[0]).toBe(ai);
});
