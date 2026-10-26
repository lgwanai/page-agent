import type { WorkflowFile } from '@/types/workflow';

export function prepareEmail(body: unknown, attachments: unknown[]): { text: string; files: WorkflowFile[] } {
  const files: WorkflowFile[] = [];
  const append = (value: unknown) => {
    if (!value || typeof value !== 'object' || (value as { type?: string }).type !== 'files' || !Array.isArray((value as { files?: unknown }).files)) throw new Error('邮件附件变量必须是文件输出，例如 {{截图节点名称}}');
    for (const file of (value as { files: WorkflowFile[] }).files) {
      if (!file || typeof file.name !== 'string' || typeof file.base64 !== 'string' || typeof file.mimeType !== 'string') throw new Error('邮件附件格式无效');
      files.push(file);
    }
  };
  let text: string;
  if (body && typeof body === 'object' && (body as { type?: string }).type === 'files') { append(body); text = ''; }
  else text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  for (const value of attachments) append(value);
  if (files.reduce((sum, file) => sum + file.base64.length * 3 / 4, 0) > 10 * 1024 * 1024) throw new Error('邮件附件合计超过 10 MB，请改用区域或可视窗口截图');
  return { text, files };
}
