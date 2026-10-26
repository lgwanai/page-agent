import { useState } from 'react';
import { EXTENSION_BUILD_VERSION } from '@/shared/release';
export function VersionStatus({ serverVersion, protocolVersion, connected }: { serverVersion?: string; protocolVersion?: number; connected: boolean }) {
  const [frames, setFrames] = useState<Array<{ frameId: number; version?: string; error?: string }> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const version = chrome.runtime.getManifest?.().version ?? '未知';
  return <div className="component-versions"><strong>组件版本</strong><p>已加载扩展：{version} · 当前面板构建：{EXTENSION_BUILD_VERSION}</p>{version !== EXTENSION_BUILD_VERSION && <p role="alert">面板版本与扩展不一致，请关闭侧栏并重新打开。</p>}<p>MCP 服务：{connected ? serverVersion ?? '旧服务未报告版本' : '未连接'} · 协议：{protocolVersion ?? '未知'}</p>{connected && protocolVersion !== 1 && <p role="alert">服务未报告受支持的协议版本，请升级或重启本机 MCP 服务后复查。</p>}<button className="secondary" disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_COMPONENT_VERSIONS' });
      if (!response.ok) throw new Error(response.error ?? '读取失败');
      setFrames(response.result);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }}>{busy ? '检查中…' : '检查当前网页脚本版本'}</button>{error && <p role="alert">{error}</p>}{frames?.map(frame => <p key={frame.frameId}>Frame {frame.frameId}：{frame.version ?? frame.error ?? '未连接'}{frame.version && frame.version !== `nodes-v${version}` && <strong className="danger"> · 版本不一致，请刷新网页</strong>}</p>)}</div>;
}
