vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import type { WorkflowNode } from '@/types/workflow';
afterEach(()=>{vi.unstubAllGlobals();});
describe('DataTable runtime',()=>{
  it('loops through table rows and resolves named column values',async()=>{
    const data={type:'datatable',columns:['金额'],rows:[{金额:12},{金额:34}],values:[[12],[34]],rowCount:2};
    const send=vi.fn(async(_tab,message)=>message.type==='PAGE_AGENT_PING'?{ok:true,frameLocator:true}:message.type==='PAGE_AGENT_LOCATE_SELECTOR'?{ok:true,count:1}:message.type==='PAGE_AGENT_READ_DATATABLE'?{ok:true,data}:{ok:true});
    vi.stubGlobal('chrome',{tabs:{query:vi.fn().mockResolvedValue([{id:1,url:'https://example.com'}]),sendMessage:send},webNavigation:{getAllFrames:vi.fn().mockResolvedValue([{frameId:0,url:'https://example.com'}])},storage:{local:{get:vi.fn().mockResolvedValue({})}}});
    const child:WorkflowNode={id:'input',kind:'dom',name:'填入金额',target:{name:'输入',selector:'#input',frameId:0,tagName:'input',label:''},event:{type:'input',value:'{{item.金额}}'}};
    const nodes:WorkflowNode[]=[{id:'table',kind:'datatable',name:'数据表',target:{name:'表格',selector:'table',frameId:0,tagName:'table',label:''},header:'auto',parseNumbers:true,exportExcel:false,fileName:'数据表'},{id:'loop',kind:'loop',name:'遍历',items:'{{数据表}}',itemVariable:'item',indexVariable:'index',maxIterations:10,body:{nodes:[child],edges:[]}}];
    const result=await runGraph(nodes,[{id:'edge',sourceNodeId:'table',sourcePort:'success',targetNodeId:'loop'}]);
    expect(result.ok).toBe(true);expect(send.mock.calls.filter(([,message])=>message.type==='PAGE_AGENT_EXECUTE_EVENT').map(([,message])=>message.event.value)).toEqual(['12','34']);
  });
});
