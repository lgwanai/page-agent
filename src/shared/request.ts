import type { RequestNode, WorkflowNode } from '@/types/workflow';

export const REQUEST_METHODS: RequestNode['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export function requestUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('请求 URL 必须是完整的 HTTP 或 HTTPS 链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请求 URL 仅支持 HTTP/HTTPS，认证信息请放在请求头中');
  return url;
}
export function requestHeaders(value: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('请求头必须是有效的 JSON 对象'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.entries(parsed).some(([key, value]) => !/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('请求头必须是名称与文本值组成的 JSON 对象');
  return parsed as Record<string, string>;
}
export function validateRequestNode(node: WorkflowNode): void {
  if (node.kind !== 'request') return;
  if (typeof node.url !== 'string' || !node.url.trim() || !REQUEST_METHODS.includes(node.method) || !['text', 'json'].includes(node.responseType)
    || typeof node.headers !== 'string' || typeof node.body !== 'string' || !Number.isInteger(node.timeoutMs) || node.timeoutMs < 100 || node.timeoutMs > 300000) throw new Error('请求节点配置无效：需要 URL、方法、请求头、请求体、返回类型及 100–300000 毫秒超时');
  if (!/\{\{[^{}]+\}\}/.test(node.url)) requestUrl(node.url);
  requestHeaders(node.headers);
  if (['GET', 'HEAD'].includes(node.method) && node.body.trim()) throw new Error('GET / HEAD 请求不能包含请求体');
}
