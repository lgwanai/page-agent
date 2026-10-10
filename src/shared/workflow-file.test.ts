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
