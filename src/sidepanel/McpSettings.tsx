import { useCallback, useEffect, useState } from 'react';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import { MCP_BRIDGE_PORT, MCP_BRIDGE_URL, type McpConnectionInfo } from '@/types/mcp';
import { buildMcpClientConfig, DEFAULT_MCP_OPTIONS, mcpOptionsError } from '@/shared/mcp-config';

const TEMPLATE_CONFIG = buildMcpClientConfig({ command: 'node', serverPath: '/完整路径/page-agent/mcp-server/dist/index.js' });

export function McpSettings({ instanceId, connected, onClose, notify }: {
  instanceId: string;
  connected: boolean;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [info, setInfo] = useState<McpConnectionInfo>({ instanceId, connected, connecting: false, bridgeUrl: MCP_BRIDGE_URL, clientOptions: DEFAULT_MCP_OPTIONS });
  const [options, setOptions] = useState(DEFAULT_MCP_OPTIONS);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const issue = mcpOptionsError(options);
  const configJson = JSON.stringify(issue ? TEMPLATE_CONFIG : buildMcpClientConfig(options), null, 2);
  const call = async (message: RuntimeMessage) => {
    const response = await chrome.runtime.sendMessage(message) as RuntimeResponse | undefined;
    if (!response?.ok) throw new Error(response?.error ?? '插件后台未响应，请重新加载插件');
    return response;
  };
  const refresh = useCallback(async (loadOptions = false) => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_GET_MCP_INFO' }) as RuntimeResponse | undefined;
      if (!response?.ok || !response.result) throw new Error(response?.error ?? '无法读取 MCP 连接信息，请重新加载插件');
      const next = response.result as McpConnectionInfo;
      setInfo(next);
      if (loadOptions) setOptions(next.clientOptions);
      setLoadError('');
    } catch (error) { setLoadError((error as Error).message); }
  }, []);

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type === 'PAGE_AGENT_BRIDGE_STATUS') setInfo((current) => ({ ...current, connected: message.connected, connecting: Boolean(message.connecting), error: message.error }));
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('keydown', escape);
    return () => { chrome.runtime.onMessage.removeListener(listener); window.removeEventListener('keydown', escape); };
  }, [onClose]);

  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); notify(message); }
    catch (error) { notify(`复制失败：${(error as Error).message}`); }
  };
  const save = async () => {
    setBusy('save');
    try { await call({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS', options }); notify('MCP 客户端配置已记住，请复制到 MCP 客户端后启动服务'); }
    catch (error) { notify((error as Error).message); }
    finally { setBusy(null); }
  };
  const retry = async () => {
    setBusy('retry');
    try {
      const response = await call({ type: 'PAGE_AGENT_RECONNECT_MCP' });
      if (response.result) setInfo(response.result as McpConnectionInfo);
      notify('已请求重新连接，请先确保 MCP 客户端中的 Page Agent 服务已启动');
    } catch (error) { notify((error as Error).message); }
    finally { setBusy(null); }
  };

  return <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel mcp-settings" role="dialog" aria-modal="true" aria-labelledby="mcp-settings-title">
      <div className="inspector-head"><div><strong id="mcp-settings-title">MCP 连接配置</strong><span>模型 → 本机 Node 服务 → Chrome 插件</span></div><button className="icon-btn" aria-label="关闭 MCP 配置" onClick={onClose}>×</button></div>
      <div className={`mcp-status ${info.connected ? 'online' : ''}`} role="status"><i /><div><strong>{info.connected ? '已连接本机 MCP 服务' : info.connecting ? '正在连接本机 MCP 服务…' : '尚未连接本机 MCP 服务'}</strong><span>{info.error || (info.connected ? '此 Chrome 插件实例已连接；执行工作流仍需提供对应访问密钥。' : '插件会自动连接本机服务；启动服务后可点击下方重试连接。')}</span></div></div>
      {loadError && <p className="mcp-error" role="alert">{loadError}</p>}
      <label>插件连接地址（WebSocket）<div className="mcp-copy-field"><input readOnly value={info.bridgeUrl} /><button className="secondary compact" onClick={() => void copy(info.bridgeUrl, '插件连接地址已复制')}>复制</button></div><small>固定端口 {MCP_BRIDGE_PORT}，用于插件连接本机服务，不是填写到模型客户端的 HTTP MCP 地址。</small></label>
      <label>当前 Chrome 插件实例 ID<div className="mcp-copy-field"><input readOnly value={info.instanceId} /><button className="secondary compact" disabled={!info.instanceId} onClick={() => void copy(info.instanceId, '实例 ID 已复制')}>复制</button></div><small>调用工作流时传入 instanceId、workflowId 和 key，避免操作其他 Chrome 实例。</small></label>
      <div className="mcp-section-title">1. 准备本机 MCP 服务</div>
      <p className="mcp-help">在 Page Agent 项目的 mcp-server 目录运行下面两条命令。插件不能自行启动 Node 服务，必须由 MCP 客户端启动。</p>
      <pre className="mcp-code">npm install{'\n'}npm run build</pre>
      <div className="mcp-section-title">2. 生成 MCP 客户端配置</div>
      <label>Node 命令或可执行文件路径<input value={options.command} placeholder="node 或 Node 可执行文件的完整路径" onChange={(event) => setOptions({ ...options, command: event.target.value })} /><small>默认自动使用本机构建插件时的 Node 可执行文件路径；自定义部署时可修改。</small></label>
      <label>MCP 服务脚本完整路径<input value={options.serverPath} placeholder="例如 /Users/你的用户名/page-agent/mcp-server/dist/index.js" onChange={(event) => setOptions({ ...options, serverPath: event.target.value })} /><small>已自动带入本机项目的 mcp-server/dist/index.js 路径，无需手填。迁移电脑或项目目录后，请在新位置重新构建插件或修改路径；已保存的配置优先。</small></label>
      <button className="secondary compact" onClick={() => setOptions({ ...DEFAULT_MCP_OPTIONS })}>恢复本机自动配置</button>
      {issue && <p className="mcp-error">{issue}；下面暂时显示配置模板。</p>}
      <label>MCP 客户端 JSON 配置<textarea className="mcp-config-json" readOnly value={configJson} aria-label="MCP 客户端 JSON 配置" /></label>
      <div className="settings-actions"><button className="secondary" disabled={Boolean(issue) || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '记住配置'}</button><button className="primary" disabled={Boolean(issue)} onClick={() => void copy(configJson, 'MCP 配置已复制，请添加到客户端的 mcpServers 配置中')}>复制 MCP 配置</button></div>
      <div className="mcp-section-title">3. 在 MCP 客户端启动服务</div>
      <p className="mcp-help">将 JSON 中的 page-agent 条目添加到客户端的 mcpServers 配置，保留原有其他条目，然后启用服务或重启客户端。通过 list_page_agent_instances 查找本实例；也可调用 page_agent_status 并传入上面的 instanceId 检查目标页面。</p>
      <details className="mcp-troubleshooting"><summary>无法连接？检查这些情况</summary><ul><li>脚本文件是否存在？先在 mcp-server 目录执行 npm install、npm run build。</li><li>客户端是否能找到 Node？必要时填写 Node 的完整路径。</li><li>端口 {MCP_BRIDGE_PORT} 是否被占用？当前架构只启动一个本机 MCP 服务，多个 Chrome 插件可同时接入。</li><li>是否更新并重启了 MCP 服务？旧版服务不支持插件实例 ID。</li><li>插件未连接时不能直接在客户端填写 WebSocket 地址，需使用上面的 stdio 配置。</li></ul></details>
      <div className="settings-actions"><button className="secondary" onClick={() => void refresh()}>刷新状态</button><button className="primary" disabled={Boolean(busy) || info.connected || info.connecting} onClick={() => void retry()}>{busy === 'retry' ? '重试中…' : '重试连接'}</button></div>
    </section>
  </div>;
}
