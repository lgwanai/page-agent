export interface MediaRecordingOptions {
  mode: 'videoAudio' | 'audio';
  fileName: string;
  durationMs: number;
}

export interface RecordingTaskReceipt {
  taskId: string;
  statusUrl: string;
  expiresAt: string;
  pollAfterMs: number;
}

export interface MediaRecordingResult {
  type: 'mediaRecording';
  id: string;
  tabId: number;
  mode: MediaRecordingOptions['mode'];
  state: 'recording' | 'finalizing' | 'ready' | 'saved' | 'error';
  startedAt: number;
  durationMs: number;
  bytes: number;
  chunks: number;
  mimeType: string;
  fileName: string;
  audioTracks: number;
  videoTracks: number;
  audioPeak: number;
  audibleSamples: number;
  videoSettings?: { width?: number; height?: number; frameRate?: number };
  stopReason?: 'manual' | 'duration' | 'source-ended' | 'cancelled' | 'error';
  error?: string;
  saveError?: string;
  downloadId?: number;
  savedPath?: string;
  blobUrl?: string;
  taskId?: string;
  statusUrl?: string;
  expiresAt?: string;
  pollAfterMs?: number;
}

export const MEDIA_RECORDING_LIMIT_MS = 30 * 60 * 1000;
export function validateRecordingOptions(options: MediaRecordingOptions): void {
  if (!options || !['videoAudio', 'audio'].includes(options.mode) || typeof options.fileName !== 'string'
    || !Number.isInteger(options.durationMs) || options.durationMs < 1000 || options.durationMs > MEDIA_RECORDING_LIMIT_MS) {
    throw new Error('网页录制需选择画面与声音或仅声音，录制时长为 1–1800 秒');
  }
}

export function recordingFileName(name: string, id: string, audioOnly: boolean): string {
  const base = name.replace(/[\\/:*?"<>|\r\n\u0000-\u001f]/g, '_').replace(/^\.+|[. ]+$/g, '').replace(/\.(webm|mp4|aac|mp3)$/i, '').slice(0, 100) || '网页录制';
  return `${base}-${id}.${audioOnly ? 'audio.webm' : 'webm'}`;
}
