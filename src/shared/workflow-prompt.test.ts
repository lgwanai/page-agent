import { describe, expect, it } from 'vitest';
import { createStartNode, type ScriptDefinition } from '@/types/workflow';
import { workflowRunPrompt } from './workflow-prompt';
const workflow:ScriptDefinition={id:'workflow-A',name:'报表',nodes:[createStartNode('start')],edges:[],createdAt:1,updatedAt:1};
describe('copy workflow prompt',()=>{
  it('includes the exact instance, workflow and current key',()=>{
    const prompt=workflowRunPrompt(workflow,'instance-A','TEST-KEY');
    expect(prompt).toContain('run_page_workflow');expect(prompt).toContain('"instanceId": "instance-A"');expect(prompt).toContain('"workflowId": "workflow-A"');expect(prompt).toContain('"key": "TEST-KEY"');expect(prompt).toContain('直接使用 data: {}');
  });
  it('describes declared parameters instead of copying manual history or inventing required values',()=>{
    const start=createStartNode('start');start.inputs=[{id:'param',name:'开始日期',type:'string',required:true,description:'报表起始日期'}];
    const prompt=workflowRunPrompt({...workflow,nodes:[start]},'instance-A','TEST-KEY');
    expect(prompt).toContain('"开始日期"：文本，必填');expect(prompt).toContain('向我询问');expect(prompt).toContain('不要使用插件手动运行的历史输入');
  });
  it('refuses a prompt without an instance or key',()=>expect(()=>workflowRunPrompt(workflow,'','')).toThrow());
});
