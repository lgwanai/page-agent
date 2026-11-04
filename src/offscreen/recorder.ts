import { recordingFileName, validateRecordingOptions, type MediaRecordingOptions, type MediaRecordingResult } from '@/shared/media-recording';

let current: MediaRecordingResult | null = null;
let recorder: MediaRecorder | undefined;
let media: MediaStream | undefined;
let audio: AudioContext | undefined;
let directory: FileSystemDirectoryHandle | undefined;
let writes = Promise.resolve();
let stopPromise: Promise<MediaRecordingResult> | undefined;
let recorderStopped: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let meter: ReturnType<typeof setInterval> | undefined;
let monotonicStart = 0;

function status(): MediaRecordingResult | null {
  if (!current) return null;
  return { ...current, ...(current.state === 'recording' ? { durationMs: Math.round(performance.now() - monotonicStart) } : {}) };
}

async function manifest(): Promise<void> {
  if (!directory || !current) return;
  const file = await directory.getFileHandle('metadata.json', { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(status()));
  await writable.close();
}

function cleanup(): void {
  clearTimeout(timer); clearInterval(meter);
  media?.getTracks().forEach(track => track.stop());
  media = undefined;
  void audio?.close().catch(() => undefined); audio = undefined;
}

async function start(streamId: string, tabId: number, options: MediaRecordingOptions): Promise<MediaRecordingResult> {
  validateRecordingOptions(options);
  if (current && ['recording', 'finalizing', 'ready'].includes(current.state)) throw new Error('已有录制或尚未保存的录制，请先停止并保存');
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const mimeType = options.mode === 'audio' ? 'audio/webm;codecs=opus' : 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error(`当前浏览器不支持录制 ${mimeType}`);
  const root = await navigator.storage.getDirectory();
  directory = await root.getDirectoryHandle(`page-agent-recording-${id}`, { create: true });
  current = { type: 'mediaRecording', id, tabId, mode: options.mode, state: 'finalizing', startedAt: Date.now(), durationMs: 0, bytes: 0, chunks: 0,
    mimeType, fileName: recordingFileName(options.fileName, id, options.mode === 'audio'), audioTracks: 0, videoTracks: 0, audioPeak: 0, audibleSamples: 0 };
  writes = Promise.resolve(); stopPromise = undefined;
  try {
    const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
    media = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: source } as MediaTrackConstraints,
      video: options.mode === 'audio' ? false : { mandatory: { ...source, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 } } as MediaTrackConstraints,
    });
    current.audioTracks = media.getAudioTracks().length;
    current.videoTracks = media.getVideoTracks().length;
    if (!current.audioTracks || (options.mode === 'videoAudio' && !current.videoTracks)) throw new Error('未取得所需音视频轨道，尚未开始录制');
    const settings = media.getVideoTracks()[0]?.getSettings();
    if (settings) current.videoSettings = { width: settings.width, height: settings.height, frameRate: settings.frameRate };
    audio = new AudioContext();
    const sourceNode = audio.createMediaStreamSource(media);
    const analyser = audio.createAnalyser(); analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    sourceNode.connect(audio.destination); // tabCapture suppresses playback; restore it for the viewer.
    await audio.resume();
    const samples = new Float32Array(analyser.fftSize);
    meter = setInterval(() => {
      if (!current || current.state !== 'recording') return;
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      current.audioPeak = Math.max(current.audioPeak, peak);
      if (peak > 0.001) current.audibleSamples++;
    }, 250);
    recorder = new MediaRecorder(media, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    recorderStopped = new Promise(resolve => recorder!.addEventListener('stop', () => resolve(), { once: true }));
    recorder.addEventListener('stop', () => { if (current?.state === 'recording') void stop('source-ended'); });
    recorder.ondataavailable = ({ data }) => {
      if (!data.size || !current) return;
      const index = current.chunks++;
      writes = writes.then(async () => {
        const file = await directory!.getFileHandle(`${String(index).padStart(8, '0')}.chunk`, { create: true });
        const writable = await file.createWritable();
        await writable.write(data); await writable.close();
        current!.bytes += data.size;
        await manifest();
      }).catch(error => {
        if (current) { current.error = `录制分块保存失败：${String(error)}`; current.stopReason = 'error'; }
        if (recorder?.state !== 'inactive') void stop('error');
      });
    };
    recorder.onerror = event => { if (current) current.error = `编码失败：${String((event as Event & { error?: Error }).error ?? '未知错误')}`; void stop('error'); };
    media.getTracks().forEach(track => track.addEventListener('ended', () => { if (current?.state === 'recording') void stop('source-ended'); }, { once: true }));
    current.state = 'recording'; current.startedAt = Date.now(); monotonicStart = performance.now();
    recorder.start(1000);
    timer = setTimeout(() => { void stop('duration'); }, options.durationMs);
    await manifest();
    return status()!;
  } catch (error) {
    cleanup(); current.state = 'error'; current.error = (error as Error).message;
    await manifest().catch(() => undefined);
    throw error;
  }
}

function stop(reason: MediaRecordingResult['stopReason'] = 'manual'): Promise<MediaRecordingResult> {
  if (!current) return Promise.reject(new Error('没有可停止的网页录制'));
  if (stopPromise) return stopPromise;
  if (current.state !== 'recording') return Promise.resolve(status()!);
  current.durationMs = Math.round(performance.now() - monotonicStart);
  current.state = 'finalizing'; current.stopReason = reason;
  clearTimeout(timer); clearInterval(meter);
  stopPromise = (async () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    // Native source termination can set state=inactive before its last dataavailable.
    // Wait for the stop event in both cases so that final chunk enters the write queue.
    await recorderStopped;
    cleanup();
    await writes;
    current!.state = current!.error || !current!.bytes ? 'error' : 'ready';
    if (!current!.bytes && !current!.error) current!.error = '录制没有产生文件数据';
    await manifest().catch(error => { current!.error = `保存元数据失败：${String(error)}`; current!.state = 'error'; });
    // Wake the worker to save even if the side panel has closed or a start node has returned.
    void chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_READY', id: current!.id }).catch(() => undefined);
    return status()!;
  })();
  return stopPromise;
}

async function exportRecording(): Promise<MediaRecordingResult> {
  if (!current || !directory || !['ready', 'error', 'saved'].includes(current.state) || !current.bytes) throw new Error('录制文件尚未就绪');
  if (!current.blobUrl) {
    const files: File[] = [];
    for (let index = 0; index < current.chunks; index++) {
      const handle = await directory.getFileHandle(`${String(index).padStart(8, '0')}.chunk`).catch(() => null);
      if (handle) files.push(await handle.getFile());
    }
    const blob = new Blob(files, { type: current.mimeType });
    if (blob.size !== current.bytes) throw new Error('录制分块不完整，无法导出');
    current.blobUrl = URL.createObjectURL(blob);
  }
  return status()!;
}

async function release(id: string): Promise<void> {
  if (!current || current.id !== id || ['recording', 'finalizing'].includes(current.state)) return;
  if (current.blobUrl) URL.revokeObjectURL(current.blobUrl);
  current.blobUrl = undefined;
  current.state = 'saved';
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(`page-agent-recording-${id}`, { recursive: true });
  directory = undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'PAGE_AGENT_MEDIA_OFFSCREEN' || sender.id !== chrome.runtime.id) return false;
  const work = message.operation === 'start' ? start(message.streamId, message.tabId, message.options)
    : message.operation === 'stop' ? stop(message.reason)
    : message.operation === 'export' ? exportRecording()
    : message.operation === 'release' ? release(message.id)
    : Promise.resolve(status());
  void work.then(result => sendResponse({ ok: true, result })).catch((error: Error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
