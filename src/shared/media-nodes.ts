import type { WorkflowNode } from '@/types/workflow';
export function validateMediaNode(node: WorkflowNode) {
  if (node.kind === 'tableFill' && node.structure !== undefined && (!node.structure || typeof node.structure !== 'object' || Array.isArray(node.structure) || Object.entries(node.structure).some(([key, value]) => !['headerSelector', 'rowSelector', 'cellSelector'].includes(key) || typeof value !== 'string' || value.length > 2000))) throw new Error('表格填充高级结构配置无效；表头、数据行、单元格应为 CSS Selector 文本');
  if (node.kind === 'tableFill' && (!node.target || typeof node.target.selector !== 'string' || !Number.isInteger(node.target.frameId) || node.target.frameId < 0 || typeof node.data !== 'string' || !Array.isArray(node.keyColumns) || !node.keyColumns.length || node.keyColumns.some(key => typeof key !== 'string' || !key.trim()) || new Set(node.keyColumns.map(key => key.trim())).size !== node.keyColumns.length || typeof node.skipUnmatchedRows !== 'boolean')) throw new Error('表格填充节点需配置表格、data 和至少一个不重复的 key 列');
  if(node.kind==='datatable'&&(!node.target||typeof node.target.selector!=='string'||!Number.isInteger(node.target.frameId)||node.target.frameId<0||!['auto','firstRow','none'].includes(node.header)||typeof node.parseNumbers!=='boolean'||typeof node.exportExcel!=='boolean'||typeof node.fileName!=='string'))throw new Error('DataTable 节点配置无效');
  if (node.kind === 'screenshot') {
    if (!['viewport','fullPage','region'].includes(node.mode) || typeof node.fileName !== 'string') throw new Error('截图节点配置无效');
    if (node.region && (![node.region.x,node.region.y,node.region.width,node.region.height].every(Number.isFinite) || node.region.x < 0 || node.region.y < 0 || node.region.width <= 0 || node.region.height <= 0)) throw new Error('截图区域无效');
  }
  if (node.kind === 'email') {
    if (![node.to,node.subject,node.body].every(value=>typeof value==='string') || !Array.isArray(node.attachments) || !node.attachments.every(value=>typeof value==='string')) throw new Error('邮件节点配置无效');
    if (Object.keys(node).some(key=>!['id','kind','name','position','to','subject','body','attachments'].includes(key))) throw new Error('邮件节点不能包含邮箱密码或 SMTP 配置，请使用本机邮箱配置');
  }
}
