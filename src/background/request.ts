import type { RequestNode } from '@/types/workflow';
import { requestHeaders, requestUrl, validateRequestNode } from '@/shared/request';
import { interpolate } from './runtime-values';
import { checkCancellation, executionSignal, RunCancelled } from './execution-control';

export async function executeRequest(node: RequestNode, variables: Record<string, unknown>, context: Record<string, unknown>, operationSignal?: AbortSignal): Promise<{ data: unknown; status: number }> {
  validateRequestNode(node);
  checkCancellation();
  const url = requestUrl(interpolate(node.url, variables, context) ?? '');
  const headers = new Headers();
  for (const [name, value] of Object.entries(requestHeaders(node.headers))) {
    const resolved = interpolate(value, variables, context) ?? '';
    if (/[\r\n]/.test(resolved)) throw new Error('请求头变量不能包含换行');
    try { headers.set(name, resolved); } catch { throw new Error('请求头变量或文本值无效，请检查名称、编码与控制字符'); }
  }
  const body = ['GET', 'HEAD'].includes(node.method) ? undefined : interpolate(node.body, variables, context);
  const controller = new AbortController();
  const signals = [executionSignal(), operationSignal].filter((signal): signal is AbortSignal => Boolean(signal));
  const cancel = () => controller.abort();
  if (signals.some(signal => signal.aborted)) throw new RunCancelled();
  for (const signal of signals) {
    signal.addEventListener('abort', cancel, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, node.timeoutMs);
  try {
    const response = await fetch(url.href, { method: node.method, headers, body, credentials: 'omit', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`请求失败：HTTP ${response.status}`); }
    const text = await response.text();
    checkCancellation();
    if (controller.signal.aborted) throw new Error('请求已取消');
    let data: unknown = text;
    if (node.responseType === 'json') {
      try { data = JSON.parse(text); } catch { throw new Error('请求成功，但响应不是有效的 JSON；可将返回类型改为 Text'); }
    }
    return { data, status: response.status };
  } catch (error) {
    if (signals.some(signal => signal.aborted)) throw new RunCancelled();
    if (timedOut) throw new Error(`请求超时（${node.timeoutMs} 毫秒）`);
    if (error instanceof TypeError) throw new Error('网络请求失败，请检查链接、网络或服务器连接');
    throw error;
  } finally {
    clearTimeout(timer);
    for (const signal of signals) signal.removeEventListener('abort', cancel);
  }
}
