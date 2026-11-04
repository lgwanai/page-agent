import { validateRecordingOptions, type MediaRecordingOptions, type MediaRecordingResult } from '@/shared/media-recording';
import { publishRecordingTask } from './recording-task-bridge';

const OFFSCREEN_URL = 'src/offscreen/recorder.html';
const SAVED_KEY = 'pageAgentMediaRecordingV1';
const HISTORY_KEY = 'pageAgentMediaRecordingTasksV1';
let historyQueue: Promise<unknown> = Promise.resolve();
let creating: Promise<void> | undefined;
let starting = false;
const saving = new Map<string, Promise<MediaRecordingResult>>();

export function rememberMediaRecording(result: MediaRecordingResult): Promise<MediaRecordingResult> {
  const work = historyQueue.then(async () => {
    const stored = await chrome.storage.local.get(HISTORY_KEY);
    const history = (stored[HISTORY_KEY] ?? {}) as Record<string, MediaRecordingResult>;
    const previous = history[result.id];
    const next = previous && ['saved', 'error'].includes(previous.state) && !['saved', 'error'].includes(result.state)
      ? { ...result, ...previous } : { ...previous, ...result };
    delete next.blobUrl;
    if (next.state === 'saved') delete next.saveError;
    history[result.id] = next;
    const retained = Object.fromEntries(Object.values(history).sort((a, b) => b.startedAt - a.startedAt).slice(0, 100).map(item => [item.id, item]));
    const latest = Object.values(retained)[0] ?? next;
    await chrome.storage.local.set({ [HISTORY_KEY]: retained, [SAVED_KEY]: latest });
    publishRecordingTask(next);
    return next;
  });
  historyQueue = work.catch(() => undefined);
  return work;
}

export async function republishRecordingTasks(): Promise<void> {
  await historyQueue;
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  for (const result of Object.values((stored[HISTORY_KEY] ?? {}) as Record<string, MediaRecordingResult>)) publishRecordingTask(result);
}

async function hasOffscreen(): Promise<boolean> {
  return (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] })).length > 0;
}
async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen.createDocument({ url: OFFSCREEN_URL, reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS], justification: '录制用户选择的网页音视频，并持续保存录制分块' }).finally(() => { creating = undefined; });
  await creating;
}
async function offscreen(operation: string, params: Record<string, unknown> = {}): Promise<MediaRecordingResult | null> {
  const response = await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_OFFSCREEN', operation, ...params });
  if (!response?.ok) throw new Error(response?.error ?? '后台录制页面没有响应');
  return response.result ?? null;
}

export async function mediaRecordingStatus(tabId?: number): Promise<MediaRecordingResult | null> {
  const live = await hasOffscreen() ? await offscreen('status') : null;
  const saved = (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY] as MediaRecordingResult | undefined;
  const result = live && (!saved || live.id !== saved.id || saved.state !== 'saved')
    ? { ...live, ...(saved?.id === live.id && saved.saveError ? { saveError: saved.saveError, downloadId: saved.downloadId } : {}) }
    : saved ?? live;
  if (!result || (tabId !== undefined && result.tabId !== tabId)) return null;
  const history = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as Record<string, MediaRecordingResult> | undefined;
  const merged = { ...history?.[result.id], ...result };
  if (!live && ['recording', 'finalizing', 'ready'].includes(merged.state)) {
    return rememberMediaRecording({ ...merged, state: 'error', error: '录制后台已关闭或扩展已重载，任务已中断，未确认文件保存' });
  }
  return merged;
}

export async function mediaRecordingById(id: string): Promise<MediaRecordingResult | null> {
  const current = await mediaRecordingStatus();
  if (current?.id === id) return current;
  await historyQueue;
  const history = (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as Record<string, MediaRecordingResult> | undefined;
  const previous = history?.[id];
  if (!previous) return null;
  return ['recording', 'finalizing', 'ready'].includes(previous.state)
    ? { ...previous, state: 'error', error: '录制会话已中断，未确认文件保存' } : previous;
}

/** Polling never waits for recording duration or for the disk download. */
export async function pollMediaRecording(id: string): Promise<MediaRecordingResult> {
  const result = await mediaRecordingById(id);
  if (!result) throw new Error('录制任务不存在');
  if (result.state === 'ready' && !result.saveError) void saveMediaRecording(id).catch(() => undefined);
  return result;
}

export async function startMediaRecording(tabId: number, options: MediaRecordingOptions): Promise<MediaRecordingResult> {
  validateRecordingOptions(options);
  if (starting) throw new Error('网页录制正在启动');
  starting = true;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:\/\//i.test(tab.url ?? '')) throw new Error('网页录制仅支持 http/https 网页');
    const current = await mediaRecordingStatus();
    if (current && ['recording', 'finalizing', 'ready'].includes(current.state)) throw new Error('已有网页录制，请先停止并保存');
    await ensureOffscreen();
    let streamId: string;
    try {
      streamId = await new Promise<string>((resolve, reject) => chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, id => {
        const error = chrome.runtime.lastError;
        if (error || !id) reject(new Error(error?.message ?? '没有录制流 ID')); else resolve(id);
      }));
    }
    catch (error) { throw new Error(`未取得网页录制权限：请切回目标网页，点击浏览器工具栏的 Page Agent 图标，再开始录制；MCP 调用不会自动取得此权限。目标：${tabId} ${tab.url}；${(error as Error).message}`); }
    const result = await offscreen('start', { streamId, tabId, options });
    if (!result) throw new Error('网页录制未启动');
    try { return await rememberMediaRecording(result); }
    catch (error) { await stopMediaRecording(tabId, 'error').catch(() => undefined); throw error; }
  } finally { starting = false; }
}

async function waitDownload(downloadId: number): Promise<chrome.downloads.DownloadItem> {
  return new Promise((resolve, reject) => {
    const changed = (delta: chrome.downloads.DownloadDelta) => { if (delta.id === downloadId) void inspect(); };
    const cleanup = () => { chrome.downloads.onChanged.removeListener(changed); clearTimeout(timer); };
    const inspect = async () => {
      try {
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (item?.state === 'complete') { cleanup(); resolve(item); }
        else if (!item || item.state === 'interrupted') { cleanup(); reject(new Error(`录制文件保存失败：${item?.error ?? '下载任务不存在'}`)); }
      } catch (error) { cleanup(); reject(error); }
    };
    chrome.downloads.onChanged.addListener(changed);
    const timer = setTimeout(() => { cleanup(); reject(new Error('录制文件保存超时，请在浏览器下载记录中检查，录制分块仍保留')); }, 120_000);
    void inspect();
  });
}

export function saveMediaRecording(id: string): Promise<MediaRecordingResult> {
  const pending = saving.get(id);
  if (pending) return pending;
  const work = (async () => {
    const result = await mediaRecordingStatus();
    if (!result || result.id !== id) throw new Error('录制会话不存在');
    if (result.state === 'saved') return result;
    if (result.state === 'error') { await rememberMediaRecording(result); throw new Error(result.error ?? '录制失败，已保留录制分块'); }
    if (result.state !== 'ready') throw new Error('录制尚未停止');
    const exported = await offscreen('export');
    if (!exported?.blobUrl) throw new Error('没有可保存的录制文件');
    const stored = (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY] as MediaRecordingResult | undefined;
    let downloadId = stored?.id === id ? stored.downloadId : undefined;
    if (downloadId !== undefined && stored?.saveError) {
      const [previous] = await chrome.downloads.search({ id: downloadId });
      // Only an explicit retry after a confirmed failed download starts a new save.
      if (!previous || previous.state === 'interrupted') downloadId = undefined;
    }
    if (downloadId === undefined) {
      downloadId = await chrome.downloads.download({ url: exported.blobUrl, filename: `PageAgent/${result.fileName}`, saveAs: false, conflictAction: 'uniquify' });
      await chrome.storage.local.set({ [SAVED_KEY]: { ...result, downloadId } });
    }
    const item = await waitDownload(downloadId);
    const saved: MediaRecordingResult = { ...result, state: 'saved', downloadId, savedPath: item.filename };
    delete saved.blobUrl;
    delete saved.saveError;
    await chrome.storage.local.set({ [SAVED_KEY]: saved });
    await rememberMediaRecording(saved);
    await offscreen('release', { id }).catch(() => undefined);
    return saved;
  })().catch(async error => {
    const current = await mediaRecordingStatus().catch(() => null);
    const stored = (await chrome.storage.local.get(SAVED_KEY))[SAVED_KEY] as MediaRecordingResult | undefined;
    if (current?.id === id && current.state === 'ready') await rememberMediaRecording({ ...current, ...(stored?.id === id ? { downloadId: stored.downloadId } : {}), saveError: (error as Error).message });
    throw error;
  }).finally(() => { saving.delete(id); });
  saving.set(id, work);
  return work;
}

export async function stopMediaRecording(tabId?: number, reason = 'manual'): Promise<MediaRecordingResult> {
  const status = await mediaRecordingStatus(tabId);
  if (!status) throw new Error('目标标签页没有网页录制');
  if (status.state === 'saved') return status;
  const stopped = await offscreen('stop', { reason });
  if (!stopped) throw new Error('录制会话不存在');
  return saveMediaRecording(stopped.id);
}

export async function requestMediaRecordingStop(id: string, reason: MediaRecordingResult['stopReason'] = 'manual'): Promise<MediaRecordingResult> {
  const current = await mediaRecordingById(id);
  if (!current) throw new Error('录制任务不存在');
  if (current.state === 'saved' || current.state === 'error') return current;
  const active = await mediaRecordingStatus();
  if (active?.id !== id) throw new Error('录制任务已结束，不能停止其他录制');
  const stopped = await offscreen('stop', { reason });
  if (!stopped) throw new Error('录制会话不存在');
  const result = await rememberMediaRecording({ ...current, ...stopped });
  void saveMediaRecording(id).catch(() => undefined);
  return result;
}

export async function handleMediaRecordingMessage(message: { operation: string; tabId?: number; options?: MediaRecordingOptions }): Promise<MediaRecordingResult | null> {
  if (message.operation === 'status') {
    const result = await mediaRecordingStatus(message.tabId);
    if (result?.state === 'ready' && !result.saveError) return saveMediaRecording(result.id);
    return result;
  }
  if (message.operation === 'stop') return stopMediaRecording(message.tabId);
  if (message.operation === 'start' && message.options) {
    const tabId = message.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId === undefined) throw new Error('没有目标网页');
    return startMediaRecording(tabId, message.options);
  }
  throw new Error('不支持的网页录制操作');
}
