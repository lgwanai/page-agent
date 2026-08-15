import { loadProvider } from '@/shared/provider-storage';
import type { AiInvocationInput, AiInvocationResult, AiProviderConfig } from '@/types/provider';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function parseJson(content: string): AiInvocationResult {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned) as Partial<AiInvocationResult>;
    return { summary: parsed.summary ?? 'AI 已完成分析', output: parsed.output, decision: parsed.decision, invoke: parsed.invoke, raw: content };
  } catch {
    return { summary: content.slice(0, 240), output: content, raw: content };
  }
}

async function requestCompletion(config: AiProviderConfig, apiKey: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!config.baseUrl || !config.model || !apiKey) throw new Error('AI Provider 未完整配置，请先填写 Base URL、Model 和 API Key');
  const request = (structured: boolean) => fetch(endpoint(config.baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: config.model, temperature: config.temperature, ...(structured ? { response_format: { type: 'json_object' } } : {}), messages }),
  });
  let response = await request(true);
  let payload = await response.json().catch(() => ({})) as ChatCompletionResponse;
  // Some OpenAI-compatible gateways do not implement response_format yet.
  if (response.status === 400 && /response.?format|json.?mode/i.test(payload.error?.message ?? '')) {
    response = await request(false);
    payload = await response.json().catch(() => ({})) as ChatCompletionResponse;
  }
  if (!response.ok) throw new Error(payload.error?.message || `Provider 请求失败：HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Provider 没有返回可用内容');
  return content;
}

export async function testProvider(config: AiProviderConfig, apiKey?: string): Promise<{ model: string; reply: string }> {
  const stored = await loadProvider();
  const reply = await requestCompletion(config, apiKey ?? stored.secret.apiKey, [
    { role: 'system', content: 'Return JSON only.' },
    { role: 'user', content: 'Return {"status":"ok"}.' },
  ]);
  return { model: config.model, reply };
}

export async function invokeAiNode(
  instruction: string,
  inputs: AiInvocationInput[],
  availableActions: string[],
): Promise<AiInvocationResult> {
  const { config, secret } = await loadProvider();
  const system = `You are the reasoning node inside a browser workflow engine.
Analyze the named inputs and follow the instruction. Return one JSON object only:
{"summary":"human readable summary","output":any,"decision":"optional branch value","invoke":optional}
invoke may be {"kind":"action","actionName":"exact available action name"} or
{"kind":"event","inputName":"exact selector input name","event":{"type":"click|doubleClick|input|select|check|hover|focus|blur|pressKey|submit|scrollIntoView|custom","value":"optional","customEvent":"optional"}}.
Only invoke an action from the provided list and only invoke an event on a selector input. If no operation is needed, omit invoke.`;
  const content = await requestCompletion(config, secret.apiKey, [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ instruction, inputs, availableActions }) },
  ]);
  return parseJson(content);
}
