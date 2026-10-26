import { allowedEventsForTarget, type WorkflowNode } from '@/types/workflow';
export function validateDialogNode(node: WorkflowNode): void {
  if (node.kind !== 'dialog') return;
  if (!['alert', 'confirm', 'prompt', 'beforeunload'].includes(node.dialogType)
    || !['accept', 'dismiss'].includes(node.action) || (node.dialogType === 'alert' && node.action !== 'accept')
    || typeof node.message !== 'string' || typeof node.promptText !== 'string'
    || !Number.isFinite(node.timeoutMs) || node.timeoutMs < 100 || node.timeoutMs > 300000) throw new Error('浏览器弹窗配置无效');
  const target = node.target;
  if (!target || typeof target.selector !== 'string' || !target.selector.trim() || !Number.isInteger(target.frameId) || target.frameId < 0
    || !['name', 'label', 'tagName'].every(key => typeof target[key as keyof typeof target] === 'string')) throw new Error('弹窗节点必须选择触发控件');
  if (!node.event || node.event.type === 'upload' || !allowedEventsForTarget(target).includes(node.event.type)) throw new Error('弹窗触发事件与控件不匹配（上传文件请使用上传节点）');
}
