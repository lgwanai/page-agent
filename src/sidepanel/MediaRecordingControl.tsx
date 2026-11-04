import { useEffect, useState } from 'react';
import type { MediaRecordingOptions, MediaRecordingResult } from '@/shared/media-recording';

export function MediaRecordingControl({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<MediaRecordingOptions>({ mode: 'videoAudio', durationMs: 180000, fileName: '网页录制' });
  const [status, setStatus] = useState<MediaRecordingResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const read = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_RECORDING', operation: 'status' });
        if (!disposed && response.ok) setStatus(response.result);
        else if (!disposed && response.error) setError(response.error);
      } catch { /* Keep the last status while a reconnect is in progress. */ }
    };
    void read(); const timer = setInterval(() => { void read(); }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  const active = status?.state === 'recording' || status?.state === 'finalizing';
  const run = async (operation: 'start' | 'stop') => {
    setBusy(true); setError('');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_RECORDING', operation, options });
      if (!response.ok) throw new Error(response.error);
      setStatus(response.result);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="settings-overlay"><section className="settings-panel" role="dialog" aria-modal="true" aria-label="网页录屏与录音">
    <h2>网页录屏与录音</h2><p>先进入直播间并开始播放，再在该网页点击工具栏的 Page Agent 图标。录制期间可关闭侧边栏，文件会自动保存到下载目录的 PageAgent 文件夹。</p>
    <label>录制内容<select disabled={active || busy} value={options.mode} onChange={event => setOptions({ ...options, mode: event.target.value as MediaRecordingOptions['mode'] })}><option value="videoAudio">网页画面和声音</option><option value="audio">仅网页声音</option></select></label>
    <label>录制时长（秒）<input type="number" min="1" max="1800" disabled={active || busy} value={options.durationMs / 1000} onChange={event => setOptions({ ...options, durationMs: Number(event.target.value) * 1000 })} /></label>
    <label>录制文件名<input disabled={active || busy} value={options.fileName} onChange={event => setOptions({ ...options, fileName: event.target.value })} /></label>
    <div className="input-actions"><button disabled={busy || active} onClick={() => { void run('start'); }}>开始录屏</button><button className="secondary" disabled={busy || !active} onClick={() => { void run('stop'); }}>停止并保存录屏</button></div>
    {error && <p role="alert">{error}</p>}{status?.error && <p role="alert">{status.error}</p>}{status?.saveError && <p role="alert">{status.saveError}，已保留录制分块。</p>}
    {status?.state === 'ready' && status.saveError && <button className="secondary" disabled={busy} onClick={() => { void run('stop'); }}>重试保存录制</button>}
    {status && <div role="status"><strong>{{ recording: '正在录制', finalizing: '正在整理文件', ready: '正在保存文件', saved: '录制文件已保存', error: '录制失败' }[status.state]}</strong><p>已录 {Math.floor(status.durationMs / 1000)} 秒 · {(status.bytes / 1048576).toFixed(1)} MB · {status.chunks} 个分块</p><p>{status.audibleSamples > 0 ? '已检测到网页声音' : '尚未检测到声音，请检查播放器是否静音'}</p>{status.savedPath && <p>文件：{status.savedPath}</p>}{status.downloadId !== undefined && status.state === 'saved' && <button className="secondary" onClick={() => { void chrome.downloads.show(status.downloadId!); }}>在文件夹中显示录制</button>}</div>}
    <button className="secondary" onClick={onClose}>关闭录制面板</button>
  </section></div>;
}
