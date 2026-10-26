import nodemailer from 'nodemailer';

export async function deliverEmail(config: unknown, message: unknown) {
  const c = config as Record<string, unknown>, m = message as Record<string, unknown>;
  if (!c || !m || typeof c.host !== 'string' || !/^[a-z0-9.-]+$/i.test(c.host) || !Number.isInteger(c.port) || Number(c.port) < 1 || Number(c.port) > 65535 || typeof c.secure !== 'boolean' || typeof c.user !== 'string' || typeof c.password !== 'string' || !c.user || !c.password) throw new Error('发送邮箱 SMTP 配置无效');
  const address = (value: unknown): value is string => typeof value === 'string' && value.length < 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
  const to = typeof m.to === 'string' ? m.to.split(/[;,]/).map((item) => item.trim()).filter(Boolean) : [];
  if (!address(c.from) || !to.length || to.length > 20 || !to.every(address) || typeof m.subject !== 'string' || /[\r\n]/.test(m.subject) || m.subject.length > 998 || typeof m.text !== 'string' || m.text.length > 100000) throw new Error('邮件收件人、主题或正文格式无效');
  if (!Array.isArray(m.files) || m.files.length > 40) throw new Error('邮件附件列表无效');
  let bytes = 0;
  const attachments = m.files.map((raw: unknown) => {
    const file = raw as Record<string, unknown>;
    if (!file || typeof file.name !== 'string' || !file.name || file.name.length > 200 || /[\\/\r\n]/.test(file.name) || typeof file.mimeType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) || typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64) || file.base64.length % 4) throw new Error('邮件附件格式无效');
    bytes += file.base64.length * 3 / 4;
    if (bytes > 10 * 1024 * 1024) throw new Error('邮件附件超过 10 MB');
    return { filename: file.name, content: Buffer.from(file.base64, 'base64'), contentType: file.mimeType };
  });
  const transport = nodemailer.createTransport({ host: c.host, port: Number(c.port), secure: c.secure, requireTLS: !c.secure, auth: { user: c.user, pass: c.password }, tls: { rejectUnauthorized: true }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true });
  try {
    const result = await transport.sendMail({ from: c.from, to, subject: m.subject, text: m.text, attachments, disableFileAccess: true, disableUrlAccess: true });
    if (result.rejected.length) throw new Error('PARTIAL_REJECTION');
    return { messageId: result.messageId, accepted: result.accepted, attachmentCount: attachments.length };
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new Error(`邮件发送未能确认成功${code && /^[A-Z0-9_]+$/.test(code) ? `（${code}）` : ''}，结果可能未知；请检查邮箱发件记录和收件人，不要自动重发`);
  } finally { transport.close(); }
}
