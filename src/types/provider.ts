export type ProviderPreset = 'openai' | 'ark' | 'deepseek' | 'custom';

export interface AiProviderConfig {
  preset: ProviderPreset;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  configured: boolean;
}

export interface AiProviderSecret {
  apiKey: string;
}

export interface AiInvocationInput {
  name: string;
  type: string;
  value: unknown;
}

export interface AiInvocationResult {
  summary: string;
  output: unknown;
  decision?: string;
  invoke?:
    | { kind: 'action'; actionName: string }
    | { kind: 'event'; inputName: string; event: { type: string; value?: string; customEvent?: string } };
  raw?: string;
}

export const PROVIDER_PRESETS: Record<Exclude<ProviderPreset, 'custom'>, Pick<AiProviderConfig, 'name' | 'baseUrl'>> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  ark: { name: '火山方舟 Ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
};
