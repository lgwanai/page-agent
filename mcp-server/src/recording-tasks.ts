import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RecordingSnapshot {
  id: string; tabId: number; mode: 'videoAudio' | 'audio'; state: 'recording' | 'finalizing' | 'ready' | 'saved' | 'error';
  startedAt: number; durationMs: number; bytes: number; chunks: number; fileName: string; mimeType: string;
  stopReason?: string; error?: string; saveError?: string; savedPath?: string;
  audioTracks?: number; videoTracks?: number; audioPeak?: number; audibleSamples?: number;
}
export interface RecordingTask {
  token: string; taskId: string; instanceId: string; recordingId: string; createdAt: number; expiresAt: number;
  requestedDurationMs: number; requireFullDuration: boolean; snapshot: RecordingSnapshot;
}
export const RECORDING_TASK_TTL_MS = 24 * 60 * 60 * 1000;

export function recordingSnapshot(value: unknown): RecordingSnapshot {
  const result = value as Record<string, unknown> | null;
  if (!result || typeof result !== 'object' || typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(result.id)
    || !Number.isInteger(result.tabId) || !['videoAudio', 'audio'].includes(String(result.mode))
    || !['recording', 'finalizing', 'ready', 'saved', 'error'].includes(String(result.state))
    || typeof result.fileName !== 'string' || !result.fileName || result.fileName.length > 250 || /[\r\n\0\\/]/.test(result.fileName)
    || !['startedAt', 'durationMs', 'bytes', 'chunks'].every(key => typeof result[key] === 'number' && Number.isFinite(result[key]) && Number(result[key]) >= 0)) throw new Error('录屏任务状态格式无效');
  const snapshot: RecordingSnapshot = {
    id: result.id, tabId: result.tabId as number, mode: result.mode as RecordingSnapshot['mode'], state: result.state as RecordingSnapshot['state'],
    fileName: result.fileName, mimeType: result.mode === 'audio' ? 'audio/webm' : 'video/webm',
    startedAt: result.startedAt as number, durationMs: result.durationMs as number, bytes: result.bytes as number, chunks: result.chunks as number,
  };
  for (const key of ['stopReason', 'error', 'saveError', 'savedPath'] as const) if (typeof result[key] === 'string') snapshot[key] = result[key].slice(0, key === 'savedPath' ? 4000 : 1000);
  for (const key of ['audioTracks', 'videoTracks', 'audioPeak', 'audibleSamples'] as const) if (typeof result[key] === 'number' && Number.isFinite(result[key])) snapshot[key] = result[key];
  return snapshot;
}

export class RecordingTaskRegistry {
  private tasks = new Map<string, RecordingTask>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly loaded: Promise<void>;
  constructor(private readonly baseUrl: () => string, private readonly storePath?: string) {
    this.loaded = this.load();
    void this.loaded.catch(() => undefined);
  }
  private async load(): Promise<void> {
    if (!this.storePath) return;
    let text: string;
    try { text = await readFile(this.storePath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const data = JSON.parse(text) as { version?: number; tasks?: RecordingTask[] };
    if (data.version !== 1 || !Array.isArray(data.tasks)) throw new Error('本机录屏任务索引损坏，请检查任务索引文件');
    for (const value of data.tasks.slice(-100)) {
      if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.token) || typeof value.taskId !== 'string' || typeof value.instanceId !== 'string'
        || !Number.isFinite(value.createdAt) || value.recordingId !== value.snapshot?.id || !Number.isFinite(value.expiresAt) || typeof value.requireFullDuration !== 'boolean' || !Number.isFinite(value.requestedDurationMs)) continue;
      try { this.tasks.set(value.token, { ...value, snapshot: recordingSnapshot(value.snapshot) }); } catch { /* Skip an invalid entry without enabling arbitrary file access. */ }
    }
  }
  private persist(): Promise<void> {
    if (!this.storePath) return Promise.resolve();
    const write = this.queue.then(async () => {
      await mkdir(dirname(this.storePath!), { recursive: true, mode: 0o700 });
      const temporary = `${this.storePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, tasks: [...this.tasks.values()] }), { mode: 0o600 });
      await rename(temporary, this.storePath!);
    });
    this.queue = write.catch(() => undefined);
    return write;
  }
  async flush(): Promise<void> { await this.loaded; await this.queue; }
  receipt(task: RecordingTask) {
    return { taskId: task.taskId, statusUrl: `${this.baseUrl()}/recordings/${task.token}`, expiresAt: new Date(task.expiresAt).toISOString(), pollAfterMs: 2000 };
  }
  async create(instanceId: string, value: unknown, requireFullDuration: boolean, requestedDurationMs: number) {
    await this.loaded;
    const snapshot = recordingSnapshot(value);
    if (typeof requireFullDuration !== 'boolean' || !Number.isInteger(requestedDurationMs) || requestedDurationMs < 1000 || requestedDurationMs > 1800000) throw new Error('异步录屏时长无效');
    const existing = [...this.tasks.values()].find(task => task.instanceId === instanceId && task.recordingId === snapshot.id && task.expiresAt > Date.now());
    if (existing) return this.receipt(existing);
    const task: RecordingTask = { token: randomBytes(32).toString('base64url'), taskId: randomUUID(), instanceId, recordingId: snapshot.id,
      createdAt: Date.now(), expiresAt: Date.now() + RECORDING_TASK_TTL_MS, requestedDurationMs, requireFullDuration, snapshot };
    this.tasks.set(task.token, task);
    while (this.tasks.size > 100) this.tasks.delete(this.tasks.keys().next().value!);
    try { await this.persist(); } catch (error) { this.tasks.delete(task.token); throw error; }
    return this.receipt(task);
  }
  async get(token: string): Promise<RecordingTask | undefined> { await this.loaded; return this.tasks.get(token); }
  async update(instanceId: string, value: unknown): Promise<void> {
    await this.loaded;
    const snapshot = recordingSnapshot(value);
    const task = [...this.tasks.values()].find(item => item.instanceId === instanceId && item.recordingId === snapshot.id);
    if (!task || task.expiresAt <= Date.now()) return;
    if (['saved', 'error'].includes(task.snapshot.state)) return; // Late progress cannot overwrite a terminal result.
    task.snapshot = snapshot;
    await this.persist();
  }
}
