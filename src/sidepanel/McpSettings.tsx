import { VersionStatus } from './VersionStatus';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeMessage, RuntimeResponse } from '@/types/messages';
import { MCP_BRIDGE_PORT, MCP_BRIDGE_URL, type McpConnectionInfo } from '@/types/mcp';
import { buildMcpClientConfig, DEFAULT_MCP_OPTIONS, mcpOptionsError, parseMcpClientConfig } from '@/shared/mcp-config';

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
  const [loaded, setLoaded] = useState(false);
  const configFile = useRef<HTMLInputElement>(null);
  const optionsDirty = useRef(false);
  const issue = mcpOptionsError(options);
  const configJson = loaded && !issue ? JSON.stringify(buildMcpClientConfig(options), null, 2) : '';
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
      setLoaded(true);
      if (loadOptions || !optionsDirty.current) setOptions(next.clientOptions);
      if (loadOptions) optionsDirty.current = false;
      setLoadError('');
    } catch (error) { setLoaded(false); setLoadError((error as Error).message); }
  }, []);

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const listener = (message: RuntimeMessage) => {
      if (message.type === 'PAGE_AGENT_BRIDGE_STATUS') {
        setInfo((current) => ({ ...current, connected: message.connected, connecting: Boolean(message.connecting), error: message.error }));
        if (message.connected) void refresh();
      }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('keydown', escape);
    return () => { chrome.runtime.onMessage.removeListener(listener); window.removeEventListener('keydown', escape); };
  }, [onClose, refresh]);

  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); notify(message); }
    catch (error) { notify(`复制失败：${(error as Error).message}`); }
  };
  const save = async () => {
    setBusy('save');
    try { await call({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS', options }); optionsDirty.current = false; await refresh(true); notify('MCP 客户端配置已记住，请复制到 MCP 客户端后启动服务'); }
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
      <VersionStatus serverVersion={info.serverVersion} protocolVersion={info.protocolVersion} connected={info.connected} />
      <div className="mcp-section-title">1. 准备本机 MCP 服务</div>
      <input ref={configFile} type="file" accept=".json,application/json" className="hidden-file-input" aria-label="导入本机 MCP 配置文件" onChange={async (event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try { const imported = parseMcpClientConfig(JSON.parse(await file.text())); await call({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS', options: imported }); optionsDirty.current = true; setOptions(imported); setLoaded(true); await refresh(); notify('本机 MCP 配置已导入，请同步导入 Agent 客户端；不会自动替换正在运行的旧服务'); } catch (error) { notify(`导入失败：${(error as Error).message}`); }
      }} />
      <button className="secondary" onClick={() => configFile.current?.click()}>导入本机 MCP 配置</button>
      <p className="mcp-help">便携版无需安装依赖或构建。请先运行新包内 Setup，并确认 Chrome 加载的是新包的 extension 目录；“重新加载”仍会使用原目录。也可导入新生成的 page-agent-mcp.json。旧服务路径不会覆盖本机配置。</p>
      {info.configurationMismatch && <div className="mcp-error" role="alert"><strong>当前连接的服务与本机配置路径不一致</strong><p>下方 JSON 保留本机配置，不会退回旧路径。请将新配置导入所有 MCP 客户端；旧共享桥接仍可能驻留，请由管理员确认没有工作流运行后，按下列路径识别并停止旧 Page Agent 桥接，再重连。无需重新安装依赖。</p><div>当前服务 Node：<code>{info.runningClientOptions?.command}</code></div><div>当前服务脚本：<code>{info.runningClientOptions?.serverPath}</code></div></div>}

      <div className="mcp-section-title">2. 生成 MCP 客户端配置</div>
      <p className="mcp-help">导入此电脑生成的 page-agent-mcp.json，不要沿用其他电脑的文件。插件不能扫描本机文件系统；未获取配置时不会显示 JSON，也不能复制。</p>
      {info.clientOptionsSource && <p className="mcp-help">配置来源：{{ setup: '当前加载插件目录中的 Setup 配置', saved: '用户明确导入或保存的配置', service: '当前服务报告的路径（尚无本机配置）', unconfigured: '尚未配置' }[info.clientOptionsSource]}</p>}

      <label>Node 命令或可执行文件路径<input value={options.command} placeholder="本机 Node 可执行文件路径" onChange={(event) => { optionsDirty.current = true; setOptions({ ...options, command: event.target.value }); }} /><small>使用 node 或 node.exe，不要填写 npm.cmd/npx.cmd。路径含空格无需额外加引号。</small></label>
      <label>MCP 服务脚本完整路径<input value={options.serverPath} placeholder="本机 MCP 服务脚本路径" onChange={(event) => { optionsDirty.current = true; setOptions({ ...options, serverPath: event.target.value }); }} /><small>来自本机配置或已连接服务；如需手动填写，请使用本机实际存在的文件路径。</small></label>
      <button className="secondary compact" onClick={() => void refresh(true)}>重新读取本机配置</button>
      {(!loaded || issue) && <p className="mcp-error" role="status">尚未配置：未获取到有效的本机 MCP 路径。请导入本机生成的配置文件，或先启动已正确配置的服务。{issue && <small>{issue}</small>}</p>}
      {configJson && <label>MCP 客户端 JSON 配置<textarea className="mcp-config-json" readOnly value={configJson} aria-label="MCP 客户端 JSON 配置" /></label>}
      <div className="settings-actions"><button className="secondary" disabled={Boolean(issue) || Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '记住配置'}</button><button className="primary" disabled={!configJson} onClick={() => void copy(configJson, 'MCP 配置已复制，请添加到客户端的 mcpServers 配置中')}>复制 MCP 配置</button></div>
      <div className="mcp-section-title">3. 在 MCP 客户端启动服务</div>
      <p className="mcp-help">将 JSON 中的 page-agent 条目添加到客户端的 mcpServers 配置，保留原有其他条目，然后启用服务或重启客户端。通过 list_page_agent_instances 查找本实例；也可调用 page_agent_status 并传入上面的 instanceId 检查目标页面。</p>
      <details className="mcp-troubleshooting"><summary>无法连接？检查这些情况</summary><ul><li>便携版请完整解压并运行新目录内 Setup；不需要 npm install 或构建。</li><li>Chrome 扩展“详细信息”中的加载目录是否仍是旧包？重新加载不会切换目录。</li><li>Agent 客户端是否重新导入了新目录生成的 page-agent-mcp.json？Setup 不会自动修改客户端设置。</li><li>端口 {MCP_BRIDGE_PORT} 上可能仍是旧共享桥接；按当前服务脚本路径识别，勿结束所有 Node 进程。</li><li>多个 MCP 客户端可以共用桥接；切换版本前先确认没有工作流运行。</li><li>插件未连接时不能直接在客户端填写 WebSocket 地址，需使用上面的 stdio 配置。</li></ul></details>
      <div className="settings-actions"><button className="secondary" onClick={() => void refresh(true)}>刷新状态</button><button className="primary" disabled={Boolean(busy) || info.connected || info.connecting} onClick={() => void retry()}>{busy === 'retry' ? '重试中…' : '重试连接'}</button></div>
    </section>
  </div>;
}
