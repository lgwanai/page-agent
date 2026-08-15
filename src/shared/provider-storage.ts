import type { AiProviderConfig, AiProviderSecret } from '@/types/provider';

const CONFIG_KEY = 'pageAgentProviderV1';
const SECRET_KEY = 'pageAgentProviderSecretV1';

export const DEFAULT_PROVIDER: AiProviderConfig = {
  preset: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  configured: false,
};

export async function loadProvider(): Promise<{ config: AiProviderConfig; secret: AiProviderSecret }> {
  const values = await chrome.storage.local.get([CONFIG_KEY, SECRET_KEY]);
  const secret = (values[SECRET_KEY] as AiProviderSecret | undefined) ?? { apiKey: '' };
  const config = { ...DEFAULT_PROVIDER, ...(values[CONFIG_KEY] as Partial<AiProviderConfig> | undefined) };
  config.configured = Boolean(secret.apiKey && config.baseUrl && config.model);
  return { config, secret };
}

export async function saveProvider(config: AiProviderConfig, apiKey?: string): Promise<AiProviderConfig> {
  const current = await loadProvider();
  const secret = { apiKey: apiKey === undefined ? current.secret.apiKey : apiKey };
  const next = { ...config, configured: Boolean(secret.apiKey && config.baseUrl && config.model) };
  await chrome.storage.local.set({ [CONFIG_KEY]: next, [SECRET_KEY]: secret });
  return next;
}
