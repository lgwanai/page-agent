import { describe, expect, it } from 'vitest';
import { createStartNode, DEFAULT_DOM_QUERY, type ScriptDefinition } from '@/types/workflow';
import { exportWorkflow, importWorkflow } from './workflow-file';

const workflow: ScriptDefinition = {
  id: '30cb4d69-86b9-45aa-a497-e025f812c834',
  name: '录制工作流',
  nodes: [createStartNode('start')],
  edges: [],
  createdAt: 1,
  updatedAt: 2,
};

describe('workflow JSON file', () => {
  it('round-trips asynchronous optional combobox filters and projected row queries inside a result-stopping pagination body', () => {
    const target = { name: '类目', selector: '#categoryId', frameId: 0, tagName: 'input', label: '', attributes: { role: 'combobox' } };
    const script: ScriptDefinition = { ...workflow, nodes: [...workflow.nodes,
      { id: 'filter', name: '筛选', kind: 'dom', target, event: { type: 'select', value: '{{filter_category}}', optionalValue: true, minWaitMs: 1000, maxWaitMs: 2000 } },
      { id: 'pages', name: '查找分页', kind: 'pagination', target: { ...target, tagName: 'div' }, mode: 'all', page: '1', pageVariable: 'page', maxPages: 5000, timeoutMs: 5000, settleMs: 500, stopWhen: '{{本页匹配.output}}', body: { nodes: [
        { id: 'rows', name: '本页匹配', kind: 'query', target: { ...target, tagName: 'table' }, query: { ...DEFAULT_DOM_QUERY, candidateSelector: 'tbody > tr', readSelector: ':scope > td:nth-child(2)', source: 'text', match: 'equals', pattern: '{{category_name}}', normalizeWhitespace: true } },
      ], edges: [] } },
    ] };
    expect(importWorkflow(exportWorkflow(script), []).workflow.nodes).toMatchObject(script.nodes);
    const invalid = exportWorkflow(script); Object.assign(invalid.workflow.nodes[2], { stopWhen: 'eval(anything)' });
    expect(() => importWorkflow(invalid, [])).toThrow('变量引用');
  });
  it('preserves explicit document query guards through save/export/import and rejects malformed guards', () => {
    const guarded: ScriptDefinition = { ...workflow, nodes: [...workflow.nodes, { id: 'pick', kind: 'dom', name: '去选择', target: { name: '去选择', selector: 'button.next-small', frameId: 0, frameUrl: 'https://example.com/apply?activityId=123&processId=old', frameQueryKeys: ['activityId'], tagName: 'button', label: '去选择', text: '去选择' }, event: { type: 'click' } }] };
    expect(importWorkflow(exportWorkflow(guarded), []).workflow.nodes[1]).toMatchObject(guarded.nodes[1]);
    const invalid = exportWorkflow(guarded);
    Object.assign((invalid.workflow.nodes[1] as Extract<import('@/types/workflow').WorkflowNode, { kind: 'dom' }>).target, { frameQueryKeys: ['activityId', 'activityId'] });
    expect(() => importWorkflow(invalid, [])).toThrow('URL 参数范围配置无效');
  });
  it('round-trips focus lifecycle and keyboard modifier events without migrating them to click', () => {
    const base = { target: { name: '字段', selector: '#field', frameId: 0, tagName: 'input', label: '' } };
    const script: ScriptDefinition = { ...workflow, nodes: [...workflow.nodes,
      { ...base, id: 'in', name: '进入', kind: 'dom', event: { type: 'focusin' } },
      { ...base, id: 'out', name: '离开', kind: 'dom', event: { type: 'focusout' } },
      { ...base, id: 'key', name: '组合键', kind: 'dom', event: { type: 'pressKey', value: 's', code: 'KeyS', modifiers: { ctrl: true } } },
      { ...base, id: 'input', name: '保留焦点输入', kind: 'dom', event: { type: 'input', value: 'abc', keepFocus: true } },
    ] };
    expect(importWorkflow(exportWorkflow(script), []).workflow.nodes.slice(1)).toMatchObject(script.nodes.slice(1));
    const invalid = exportWorkflow(script);
    Object.assign((invalid.workflow.nodes[3] as Extract<import('@/types/workflow').WorkflowNode, { kind: 'dom' }>).event, { modifiers: { ctrl: 'true' } });
    expect(() => importWorkflow(invalid, [])).toThrow('网页事件配置无效');
  });
  it('preserves table-fill selector, multiple keys and variable binding through export/import', () => {
    const filled: ScriptDefinition = { ...workflow, nodes: [...workflow.nodes, { id: 'fill', kind: 'tableFill', name: '填充', target: { name: '表格', selector: '#t', frameId: 2, frameUrl: 'https://example.com/frame', tagName: 'div', label: '' }, data: '{{data}}', keyColumns: ['SKU', '仓库'], skipUnmatchedRows: true, structure: { headerSelector: 'thead th', rowSelector: '.body > li', cellSelector: ':scope > div' } }] };
    const restored = importWorkflow(exportWorkflow(filled), []).workflow;
    expect(restored.nodes.at(-1)).toMatchObject(filled.nodes.at(-1)!);
    const invalid = exportWorkflow(filled);
    Object.assign(invalid.workflow.nodes.at(-1)!, { structure: { rowSelector: 123 } });
    expect(() => importWorkflow(invalid, [])).toThrow('高级结构配置无效');
  });
  it('round-trips DataTable selection and Excel configuration',()=>{
    const table:ScriptDefinition={...workflow,nodes:[...workflow.nodes,{id:'table',kind:'datatable',name:'报表',target:{name:'报表',selector:'#report',frameId:4,frameUrl:'https://example.com/report',tagName:'table',label:''},header:'firstRow',parseNumbers:false,exportExcel:true,fileName:'报表'}]};
    expect(importWorkflow(exportWorkflow(table),[]).workflow.nodes[1]).toMatchObject(table.nodes[1]);
  });
  it('round-trips screenshot region and mail variable references without SMTP secrets',()=>{
    const media:ScriptDefinition={...workflow,nodes:[...workflow.nodes,{id:'shot',name:'页面截图',kind:'screenshot',mode:'region',region:{x:1,y:2,width:100,height:200},fileName:'测试'},{id:'mail',name:'发送邮件',kind:'email',to:'test@example.com',subject:'结果',body:'正文',attachments:['{{页面截图}}']}]};
    const exported=exportWorkflow(media);expect(importWorkflow(exported,[]).workflow.nodes).toMatchObject(media.nodes);
    const invalid=structuredClone(exported);Object.assign(invalid.workflow.nodes[2],{password:'SECRET'});
    expect(()=>importWorkflow(invalid,[])).toThrow('不能包含邮箱密码');
  });
  it('round-trips random wait ranges', () => {
    const random: ScriptDefinition={...workflow,nodes:[...workflow.nodes,{id:'random-wait',name:'随机等待',kind:'wait',durationMs:500,mode:'random',minDurationMs:1000,maxDurationMs:3000}]};
    expect(importWorkflow(exportWorkflow(random),[]).workflow.nodes[1]).toMatchObject(random.nodes[1]);
  });
  it('round-trips Watch configuration', () => {
    const watched: ScriptDefinition = { ...workflow, nodes: [...workflow.nodes, { id:'watch', name:'导出状态', kind:'watch', target:{name:'状态',selector:'#status',frameId:3,tagName:'div',label:''},source:'attribute',attributeName:'data-status',match:'equals',expected:'{{status}}',timeoutMs:60000,intervalMs:500 }], edges: [{id:'watch-edge',sourceNodeId:'start',targetNodeId:'watch',sourcePort:'success'}] };
    const result=importWorkflow(exportWorkflow(watched),[]).workflow;
    expect(result.nodes).toMatchObject(watched.nodes);expect(result.edges).toEqual(watched.edges);
  });
  it('round-trips editable Query settings and graph connections', () => {
    const withQuery: ScriptDefinition = {
      ...workflow,
      nodes: [...workflow.nodes, { id: 'query', kind: 'query', name: '链接', target: { name: '链接', selector: '#list', frameId: 2, tagName: 'ul', label: '列表' }, query: { ...DEFAULT_DOM_QUERY, source: 'attribute', attributeName: 'href', match: 'regex', pattern: '^/orders/', regexFlags: 'i' } }],
      edges: [{ id: 'start-query', sourceNodeId: 'start', targetNodeId: 'query', sourcePort: 'success' }],
    };
    const imported = importWorkflow(exportWorkflow(withQuery), []).workflow;
    expect(imported.nodes[1]).toMatchObject(withQuery.nodes[1]);
    expect(imported.edges).toEqual(withQuery.edges);
  });
  it('round-trips without including a secret key', () => {
    const exported = exportWorkflow(workflow);
    expect(JSON.stringify(exported)).not.toContain('accessKey');
    const imported = importWorkflow(exported, []);
    expect(imported.idChanged).toBe(false);
    expect(imported.workflow.id).toBe(workflow.id);
  });

  it('assigns a new UUID when an imported id already exists', () => {
    const imported = importWorkflow(exportWorkflow(workflow), [workflow.id]);
    expect(imported.idChanged).toBe(true);
    expect(imported.workflow.id).not.toBe(workflow.id);
    expect(imported.workflow.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects malformed Query configuration before opening the editor', () => {
    const exported = exportWorkflow(workflow);
    const raw = { ...exported, workflow: { ...exported.workflow, nodes: [{ id: 'bad-query', name: '检索', kind: 'query', target: { selector: 'body', frameId: 0 }, query: { source: 'javascript' } }] } };
    expect(() => importWorkflow(raw, [])).toThrow('Query 节点的检索范围或配置无效');
  });

  it('rejects unrelated JSON', () => {
    expect(() => importWorkflow({ hello: 'world' }, [])).toThrow('不是有效的 Page Agent 工作流文件');
  });

  it('rejects edges that reference unknown nodes', () => {
    const exported = exportWorkflow(workflow);
    exported.workflow.edges = [{ id: 'broken', sourceNodeId: 'start', targetNodeId: 'missing', sourcePort: 'success' }];
    expect(() => importWorkflow(exported, [])).toThrow('不存在的节点');
  });
});
