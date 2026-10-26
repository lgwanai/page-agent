vi.mock('./selector-upgrade', () => ({ SelectorUpgradeSession: class { reports = []; register() {} async prepare() {} async persist() {} } }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGraph } from './runner';
import type { WatchNode, WorkflowNode } from '@/types/workflow';
const node: WatchNode = { id:'watch', name:'监控', kind:'watch', target:{name:'状态',selector:'#status',frameId:0,tagName:'div',label:''}, source:'attribute',attributeName:'data-status',match:'equals',expected:'{{status}}',timeoutMs:100,intervalMs:100 };
afterEach(() => { vi.unstubAllGlobals(); });
function setup(values: unknown[]) {
  let index = 0;
  vi.stubGlobal('chrome', { tabs:{query:vi.fn().mockResolvedValue([{id:1,url:'https://example.com'}]),sendMessage:vi.fn(async (_id, message) => message.type === 'PAGE_AGENT_PING' ? {ok:true,frameLocator:true} : message.type === 'PAGE_AGENT_LOCATE_SELECTOR' ? {ok:true,count:1} : {ok:true,data:[values[Math.min(index++,values.length-1)]]})}, webNavigation:{getAllFrames:vi.fn().mockResolvedValue([{frameId:0,url:'https://example.com'}])},storage:{local:{get:vi.fn().mockResolvedValue({})}} });
}
describe('Watch execution', () => {
  it('waits for updated attributes then executes the success path', async () => {
    setup([{'data-status':'running'},{'data-status':'done'}]);
    const next:WorkflowNode={id:'next',name:'后续',kind:'wait',durationMs:0};
    const result=await runGraph([{...node,timeoutMs:500},next],[{id:'edge',sourceNodeId:'watch',sourcePort:'success',targetNodeId:'next'}],{status:'done'});
    expect(result.ok).toBe(true);expect(result.steps.at(-1)?.nodeId).toBe('next');expect(result.steps[0].data).toMatchObject({actual:'done',expected:'done'});
  });
  it('routes a timeout to failure and reports actual state', async () => {
    setup([{'data-status':'running'}]);
    const next:WorkflowNode={id:'recover',name:'恢复',kind:'wait',durationMs:0};
    const result=await runGraph([node,next],[{id:'edge',sourceNodeId:'watch',sourcePort:'failure',targetNodeId:'recover'}],{status:'done'});
    expect(result.ok).toBe(true);expect(result.steps[0].ok).toBe(false);expect(result.steps[0].message).toContain('running');expect(result.steps.at(-1)?.nodeId).toBe('recover');
  });
});
