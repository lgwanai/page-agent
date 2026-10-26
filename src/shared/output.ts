import type { OutputNode, WorkflowNode } from '@/types/workflow';

/** Shared by imports, MCP authoring and runtime. No executable expressions. */
export function validateOutputNode(node: WorkflowNode): void {
  if (node.kind === 'query') {
    if (node.query.readSelector !== undefined && typeof node.query.readSelector !== 'string') throw new Error('Query 内部读取位置必须是 Selector 文本');
    if (node.query.normalizeWhitespace !== undefined && typeof node.query.normalizeWhitespace !== 'boolean') throw new Error('Query 空白处理配置必须是布尔值');
    if (node.query.maxResults !== undefined && (!Number.isInteger(node.query.maxResults) || node.query.maxResults < 1 || node.query.maxResults > 500)) throw new Error('Query 返回数量上限必须为 1～500 的整数');
    if (node.onEmpty !== undefined && !['success', 'failure'].includes(node.onEmpty)) throw new Error('Query 无匹配时的出口配置无效');
    return;
  }
  if (node.kind !== 'output') return;
  if (!['text', 'variable', 'node', 'dom'].includes(node.source)) throw new Error('Output 输出来源无效');
  if (node.outcome !== undefined && !['neutral', 'success', 'failure'].includes(node.outcome)) throw new Error('Output 业务结果配置无效');
  if (node.source === 'text' || node.source === 'variable') {
    if (typeof node.value !== 'string') throw new Error('Output 需要填写返回内容');
    if (node.source === 'variable' && !/^\{\{\s*[^{}]+?\s*\}\}$/.test(node.value)) throw new Error('Output 变量需要独立引用，例如 {{参数名}} 或 {{节点名称.output}}');
  }
  if (node.source === 'node' && (typeof node.sourceNodeId !== 'string' || !node.sourceNodeId)) throw new Error('Output 需要选择前序节点');
  if (node.path !== undefined && (typeof node.path !== 'string' || node.path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key)))) throw new Error('Output 字段路径无效');
  if (node.source === 'dom') {
    const target = node.target;
    if (!target || typeof target.selector !== 'string' || !Number.isInteger(target.frameId) || target.frameId < 0) throw new Error('Output DOM Selector 配置无效');
    if (!['text', 'value', 'attribute'].includes(String(node.read))) throw new Error('Output DOM 读取类型无效');
    if (node.read === 'attribute' && (typeof node.attributeName !== 'string' || !node.attributeName.trim())) throw new Error('Output 需要填写 DOM 属性名称');
    if (node.multiple !== undefined && typeof node.multiple !== 'boolean') throw new Error('Output DOM 列表配置必须是布尔值');
  }
}

/** Own-property lookup only. Missing output is an error, never fabricated "". */
export function outputPath(value: unknown, path = ''): unknown {
  if (!path.trim()) return value;
  let current = value;
  for (const key of path.split('.')) {
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key) || current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error(`Output 字段不存在：${path}`);
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function outputBusinessOk(node: OutputNode): boolean | undefined {
  return node.outcome === 'success' ? true : node.outcome === 'failure' ? false : undefined;
}
