import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaRecordingResult } from '@/shared/media-recording';

const options = { mode: 'videoAudio' as const, fileName: '直播', durationMs: 180000 };
let live: MediaRecordingResult | null;
let stored: Record<string, unknown>;
let exists: boolean;
let api: ReturnType<typeof chromeMock>;
function session(state: MediaRecordingResult['state'] = 'recording'): MediaRecordingResult {
  return { type: 'mediaRecording', id: 'test-session', tabId: 7, mode: 'videoAudio', state, startedAt: 1000, durationMs: 180000,
    bytes: 10000, chunks: 180, mimeType: 'video/webm;codecs=vp8,opus', fileName: '直播-test-session.webm', audioTracks: 1, videoTracks: 1, audioPeak: 0.5, audibleSamples: 720 };
}
function chromeMock() {
  return {
    tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: 'https://live.douyin.com/123' }), query: vi.fn().mockResolvedValue([{ id: 7 }]) },
    tabCapture: { getMediaStreamId: vi.fn((_options: unknown, callback: (id: string) => void) => callback('stream-id')) },
    runtime: {
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' }, lastError: undefined as { message: string } | undefined,
      getURL: (url: string) => `chrome-extension://test/${url}`,
      getContexts: vi.fn(async () => exists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: vi.fn(async (message: { operation: string }) => {
        if (message.operation === 'start') live = session();
        if (message.operation === 'stop') live = { ...live!, state: 'ready' };
        if (message.operation === 'export') return { ok: true, result: { ...live, blobUrl: 'blob:chrome-extension://test/recording' } };
        if (message.operation === 'release') live = { ...live!, state: 'saved' };
        return { ok: true, result: live };
      }),
    },
    offscreen: { Reason: { USER_MEDIA: 'USER_MEDIA', BLOBS: 'BLOBS' }, createDocument: vi.fn(async () => { exists = true; }) },
    storage: { local: { get: vi.fn(async () => stored), set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }) } },
    downloads: { download: vi.fn().mockResolvedValue(12), search: vi.fn().mockResolvedValue([{ id: 12, state: 'complete', filename: '/Downloads/PageAgent/直播.webm' }]),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  };
}
beforeEach(() => { vi.resetModules(); live = null; stored = {}; exists = false; api = chromeMock(); vi.stubGlobal('chrome', api); });
afterEach(() => { vi.unstubAllGlobals(); });

it('starts an isolated offscreen recorder, immediately consumes a one-use stream ID, and never transfers video bytes through runtime messages', async () => {
  const { startMediaRecording } = await import('./media-recording');
  expect(await startMediaRecording(7, options)).toMatchObject({ state: 'recording', tabId: 7 });
  expect(api.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['USER_MEDIA', 'BLOBS'] }));
  expect(api.tabCapture.getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 7 }, expect.any(Function));
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_AGENT_MEDIA_OFFSCREEN', operation: 'start', streamId: 'stream-id', tabId: 7, options });
  expect(JSON.stringify(api.runtime.sendMessage.mock.calls)).not.toContain('base64');
});
it('rejects invalid configuration, browser-internal URLs and missing tab invocation before starting a recording', async () => {
  const { startMediaRecording } = await import('./media-recording');
  await expect(startMediaRecording(7, { ...options, durationMs: 0 })).rejects.toThrow('录制时长');
  expect(api.tabs.get).not.toHaveBeenCalled();
  api.tabs.get.mockResolvedValueOnce({ id: 7, url: 'chrome://extensions' });
  await expect(startMediaRecording(7, options)).rejects.toThrow('http/https');
  api.tabCapture.getMediaStreamId.mockImplementationOnce((_options, callback) => {
    api.runtime.lastError = { message: 'Extension has not been invoked' }; callback(''); api.runtime.lastError = undefined;
  });
  await expect(startMediaRecording(7, options)).rejects.toThrow('点击浏览器工具栏');
  expect(api.runtime.sendMessage.mock.calls.some(([message]) => message.operation === 'start')).toBe(false);
});
it('does not start another recorder while a recording or unsaved file exists', async () => {
  exists = true; live = session('recording');
  const { startMediaRecording } = await import('./media-recording');
  await expect(startMediaRecording(7, options)).rejects.toThrow('已有网页录制');
  live.state = 'ready';
  await expect(startMediaRecording(7, options)).rejects.toThrow('先停止并保存');
  expect(api.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
});
it('only stops the requested tab and reports success after the browser confirms the disk download', async () => {
  exists = true; live = session();
  const { stopMediaRecording, mediaRecordingStatus } = await import('./media-recording');
  await expect(stopMediaRecording(8)).rejects.toThrow('目标标签页没有');
  const result = await stopMediaRecording(7);
  expect(result).toMatchObject({ state: 'saved', downloadId: 12, savedPath: '/Downloads/PageAgent/直播.webm' });
  expect(result).not.toHaveProperty('blobUrl');
  expect(api.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_AGENT_MEDIA_OFFSCREEN', operation: 'release', id: 'test-session' });
  expect(await mediaRecordingStatus(7)).toEqual(result);
  expect(await stopMediaRecording(7)).toEqual(result);
  expect(api.downloads.download).toHaveBeenCalledOnce();
});
it('coalesces the auto-stop notification and a simultaneous status poll into one disk save', async () => {
  exists = true; live = session('ready');
  const { saveMediaRecording } = await import('./media-recording');
  const first = saveMediaRecording(live.id); const second = saveMediaRecording(live.id);
  expect(first).toBe(second);
  await Promise.all([first, second]);
  expect(api.downloads.download).toHaveBeenCalledOnce();
});
it('preserves recorded chunks on encoding, disk or download failure and never claims the file was saved', async () => {
  exists = true; live = session('ready');
  api.downloads.search.mockResolvedValue([{ id: 12, state: 'interrupted', error: 'FILE_NO_SPACE', filename: '' }]);
  const { saveMediaRecording } = await import('./media-recording');
  await expect(saveMediaRecording(live.id)).rejects.toThrow('FILE_NO_SPACE');
  expect(api.runtime.sendMessage.mock.calls.some(([message]) => message.operation === 'release')).toBe(false);
  expect((stored.pageAgentMediaRecordingV1 as MediaRecordingResult).state).toBe('ready');
  expect((stored.pageAgentMediaRecordingV1 as MediaRecordingResult).saveError).toContain('FILE_NO_SPACE');
  const { handleMediaRecordingMessage } = await import('./media-recording');
  expect(await handleMediaRecordingMessage({ operation: 'status' })).toMatchObject({ state: 'ready', saveError: expect.stringContaining('FILE_NO_SPACE') });
  expect(api.downloads.download).toHaveBeenCalledOnce();
  live = { ...session('error'), error: '分块保存失败' };
  await expect(saveMediaRecording(live.id)).rejects.toThrow('分块保存失败');
});
it('retains a completed task receipt when a later recording becomes current', async () => {
  exists = true; live = session('ready');
  const { rememberMediaRecording, saveMediaRecording, mediaRecordingById } = await import('./media-recording');
  const receipt = { taskId: 'task-one', statusUrl: 'http://127.0.0.1:17373/recordings/token' };
  await rememberMediaRecording({ ...live, ...receipt });
  await saveMediaRecording(live.id);
  live = { ...session(), id: 'second-session', startedAt: 2000 };
  await rememberMediaRecording(live);
  expect(await mediaRecordingById('test-session')).toMatchObject({ state: 'saved', savedPath: '/Downloads/PageAgent/直播.webm', ...receipt });
});
it('reports interruption after the offscreen recorder disappears instead of polling forever', async () => {
  const { rememberMediaRecording, pollMediaRecording } = await import('./media-recording');
  await rememberMediaRecording(session());
  expect(await pollMediaRecording('test-session')).toMatchObject({ state: 'error', error: expect.stringContaining('中断') });
});
it('polling and explicit stop do not wait for a pending disk download', async () => {
  exists = true; live = session();
  api.downloads.search.mockResolvedValue([{ id: 12, state: 'in_progress', filename: '' }]);
  const { rememberMediaRecording, requestMediaRecordingStop, pollMediaRecording, saveMediaRecording } = await import('./media-recording');
  await rememberMediaRecording({ ...live, taskId: 'task', statusUrl: 'http://127.0.0.1:17373/recordings/token' });
  expect(await requestMediaRecordingStop(live.id)).toMatchObject({ state: 'ready', taskId: 'task' });
  expect(await pollMediaRecording(live.id)).toMatchObject({ state: 'ready', taskId: 'task' });
  api.downloads.search.mockResolvedValue([{ id: 12, state: 'complete', filename: '/Downloads/PageAgent/直播.webm' }]);
  const work = saveMediaRecording(live.id);
  await vi.waitFor(() => expect(api.downloads.onChanged.addListener).toHaveBeenCalled());
  const change = api.downloads.onChanged.addListener.mock.calls[0][0] as unknown as (delta: { id: number }) => void;
  change({ id: 12 }); await work;
});
