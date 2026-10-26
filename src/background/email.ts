import { EMAIL_CONFIG_KEY, type EmailConfig } from '@/types/email';
import type { WorkflowFile } from '@/types/workflow';
import { sendEmailViaBridge } from './bridge';

export async function sendWorkflowEmail(to: string, subject: string, text: string, files: WorkflowFile[]) {
  const stored = await chrome.storage.local.get(EMAIL_CONFIG_KEY);
  const config = stored[EMAIL_CONFIG_KEY] as EmailConfig | undefined;
  if (!config?.host || !config.user || !config.password || !config.from) throw new Error('请先配置发送邮箱 SMTP 信息');
  return sendEmailViaBridge(config, { to, subject, text, files });
}
