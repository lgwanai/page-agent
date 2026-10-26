import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveValue, runGraph } from './runner';
import { capturePage } from './screenshot';
import { sendWorkflowEmail } from './email';
import type { WorkflowNode } from '@/types/workflow';
vi.mock('./screenshot',()=>({capturePage:vi.fn()}));
vi.mock('./email',()=>({sendWorkflowEmail:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('media workflow',()=>{
  it('resolves bare node names and retains legacy output paths',()=>{
    const context={'截图.名称':{ok:true,output:{type:'files'}},等待:{ok:true,output:123}};
    expect(resolveValue('{{等待}}',{},context)).toBe(123);
    expect(resolveValue('{{等待.output}}',{},context)).toBe(123);
    expect(resolveValue('{{截图.名称}}',{},context)).toEqual({type:'files'});
    expect(()=>resolveValue('文件 {{截图.名称}}',{},context)).toThrow('文件变量');
    expect(resolveValue('{{等待}}',{等待:'参数'},context)).toBe('参数');
  });
  it('passes screenshot PNG output to email attachments, with no real sending',async()=>{
    vi.stubGlobal('chrome',{tabs:{query:vi.fn().mockResolvedValue([{id:1,url:'https://example.com'}])},storage:{local:{get:vi.fn().mockResolvedValue({})}}});
    vi.mocked(capturePage).mockResolvedValue({images:[{data:'YWJj',mimeType:'image/png',width:10,height:10,offsetY:0}],metadata:{complete:true}});
    vi.mocked(sendWorkflowEmail).mockResolvedValue({accepted:['test@example.com']});
    const nodes:WorkflowNode[]=[{id:'shot',name:'页面截图',kind:'screenshot',mode:'viewport',fileName:'结果'},{id:'mail',name:'邮件',kind:'email',to:'test@example.com',subject:'结果',body:'正文',attachments:['{{页面截图}}']}];
    const result=await runGraph(nodes,[{id:'edge',sourceNodeId:'shot',sourcePort:'success',targetNodeId:'mail'}]);
    expect(result.ok).toBe(true);expect(sendWorkflowEmail).toHaveBeenCalledWith('test@example.com','结果','正文',[{name:'结果.png',mimeType:'image/png',base64:'YWJj'}]);
  });
});
