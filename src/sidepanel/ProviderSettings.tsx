import { useEffect, useState } from 'react';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import { PROVIDER_PRESETS, type AiProviderConfig, type ProviderPreset } from '@/types/provider';
import { DEFAULT_PROVIDER } from '@/shared/provider-storage';

async function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

export function ProviderSettings({ onClose, notify }: { onClose: () => void; notify: (message: string) => void }) {
  const [config, setConfig] = useState<AiProviderConfig>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  useEffect(() => {
    void send({ type: 'PAGE_AGENT_GET_PROVIDER' }).then((response) => {
      if (response.result) setConfig(response.result as AiProviderConfig);
    });
  }, []);

  const choosePreset = (preset: ProviderPreset) => {
    if (preset === 'custom') return setConfig({ ...config, preset, name: '自定义 Provider', baseUrl: '' });
    setConfig({ ...config, preset, ...PROVIDER_PRESETS[preset] });
  };
  const test = async () => {
    setBusy('test');
    const response = await send({ type: 'PAGE_AGENT_TEST_PROVIDER', config, apiKey: apiKey || undefined });
    setBusy(null);
    notify(response.ok ? `连接成功：${config.model}` : response.error ?? '连接失败');
  };
  const save = async () => {
    setBusy('save');
    const response = await send({ type: 'PAGE_AGENT_SAVE_PROVIDER', config, apiKey: apiKey || undefined });
    setBusy(null);
    if (response.ok) { notify('AI Provider 配置已保存'); onClose(); }
    else notify(response.error ?? '保存失败');
  };

  return <div className="settings-overlay">
    <section className="settings-panel">
      <div className="inspector-head"><div><strong>AI Provider</strong><span>OpenAI-compatible Chat Completions</span></div><button className="icon-btn" onClick={onClose}>×</button></div>
      <label>供应商<select value={config.preset} onChange={(event) => choosePreset(event.target.value as ProviderPreset)}><option value="openai">OpenAI</option><option value="ark">火山方舟 Ark</option><option value="deepseek">DeepSeek</option><option value="custom">自定义兼容接口</option></select></label>
      <label>显示名称<input value={config.name} onChange={(event) => setConfig({ ...config, name: event.target.value })} /></label>
      <label>Base URL<input value={config.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} /></label>
      <label>Model<input value={config.model} placeholder="模型或 Endpoint ID" onChange={(event) => setConfig({ ...config, model: event.target.value })} /></label>
      <label>API Key<input type="password" value={apiKey} placeholder={config.configured ? '已保存；留空保持不变' : 'sk-...'} onChange={(event) => setApiKey(event.target.value)} /></label>
      <label>Temperature <span>{config.temperature}</span><input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })} /></label>
      <div className="security-note">API Key 单独保存在 Chrome extension local storage，不会进入 Script、Action 或 MCP 的 workspace 输出。企业环境建议后续接入内网模型网关。</div>
      <div className="settings-actions"><button className="secondary" disabled={Boolean(busy)} onClick={test}>{busy === 'test' ? '测试中…' : '测试连接'}</button><button className="primary" disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? '保存中…' : '保存配置'}</button></div>
    </section>
  </div>;
}
