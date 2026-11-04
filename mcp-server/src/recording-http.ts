import type { IncomingMessage, ServerResponse } from 'node:http';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { RecordingTaskRegistry, type RecordingSnapshot, type RecordingTask } from './recording-tasks.js';

export class RecordingHttp {
  private readonly refreshes = new Map<string, Promise<void>>();
  constructor(private readonly registry: RecordingTaskRegistry, private readonly baseUrl: () => string,
    private readonly latest: (instanceId: string, recordingId: string) => Promise<unknown>) {}

  private json(request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    response.end(request.method === 'HEAD' ? undefined : text);
  }
  private refresh(task: RecordingTask): Promise<void> {
    const existing = this.refreshes.get(task.token);
    if (existing) return existing;
    const work = this.latest(task.instanceId, task.recordingId).then(snapshot => this.registry.update(task.instanceId, snapshot))
      .finally(() => this.refreshes.delete(task.token));
    this.refreshes.set(task.token, work);
    return work;
  }
  private async file(snapshot: RecordingSnapshot) {
    if (snapshot.state !== 'saved' || !snapshot.savedPath || !isAbsolute(snapshot.savedPath) || snapshot.savedPath.includes('\0')) throw new Error('录屏文件尚未保存');
    const handle = await open(snapshot.savedPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== snapshot.bytes || stat.size <= 0) throw new Error('录屏文件已移动、删除或大小发生变化');
      return { handle, size: stat.size };
    } catch (error) { await handle.close(); throw error; }
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? '/', this.baseUrl());
    if (!url.pathname.startsWith('/recordings/')) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (request.headers.host !== new URL(this.baseUrl()).host || request.headers.origin) {
      this.json(request, response, 403, { error: '只允许本机客户端使用返回的状态 URL 访问' }); return true;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.setHeader('Allow', 'GET, HEAD'); this.json(request, response, 405, { error: '状态与文件地址仅支持 GET/HEAD' }); return true;
    }
    const match = url.pathname.match(/^\/recordings\/([A-Za-z0-9_-]{43})(\/file)?$/);
    if (!match || url.search) { this.json(request, response, 404, { error: '录屏任务不存在' }); return true; }
    try {
      const task = await this.registry.get(match[1]);
      if (!task) { this.json(request, response, 404, { error: '录屏任务不存在' }); return true; }
      if (task.expiresAt <= Date.now()) { this.json(request, response, 410, { taskId: task.taskId, status: 'expired', done: true, success: false, error: '录屏状态 URL 已过期，本机已保存文件不受影响' }); return true; }
      let unavailable = false;
      if (!['saved', 'error'].includes(task.snapshot.state)) {
        try { await this.refresh(task); }
        catch { unavailable = !task.snapshot.saveError; }
      }
      if (match[2]) {
        if (task.snapshot.state !== 'saved') { this.json(request, response, 409, { taskId: task.taskId, status: unavailable ? 'unavailable' : task.snapshot.state, error: '录屏文件尚未保存' }); return true; }
        const { handle, size } = await this.file(task.snapshot);
        let start = 0, end = size - 1;
        const range = request.headers.range;
        if (range) {
          const parts = range.match(/^bytes=(\d*)-(\d*)$/);
          const first = parts?.[1], last = parts?.[2];
          if (parts && (first || last)) {
            start = first ? Number(first) : Math.max(0, size - Number(last));
            end = first && last ? Math.min(Number(last), size - 1) : size - 1;
          }
          if (!parts || (!first && !last) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || (!first && Number(last) <= 0)) {
            await handle.close(); response.setHeader('Content-Range', `bytes */${size}`); this.json(request, response, 416, { error: '文件范围无效' }); return true;
          }
        }
        response.setHeader('Content-Type', task.snapshot.mimeType);
        response.setHeader('Content-Length', end - start + 1);
        response.setHeader('Accept-Ranges', 'bytes');
        response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(task.snapshot.fileName).replace(/'/g, '%27')}`);
        if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        response.writeHead(range ? 206 : 200);
        if (request.method === 'HEAD') { await handle.close(); response.end(); }
        else {
          const stream = handle.createReadStream({ start, end });
          stream.on('error', () => response.destroy());
          response.once('close', () => stream.destroy());
          stream.pipe(response);
        }
        return true;
      }
      const snapshot = task.snapshot;
      const failed = snapshot.state === 'error' || Boolean(snapshot.saveError)
        || (snapshot.state === 'saved' && task.requireFullDuration && (snapshot.stopReason !== 'duration' || snapshot.durationMs + 250 < task.requestedDurationMs));
      const status = failed ? 'failed' : snapshot.state === 'saved' ? 'completed' : unavailable ? 'unavailable' : snapshot.state === 'recording' ? 'recording' : 'saving';
      const receipt = this.registry.receipt(task);
      const body: Record<string, unknown> = { ...receipt, recordingId: task.recordingId, status, done: failed || status === 'completed',
        success: status === 'completed', requestedDurationMs: task.requestedDurationMs, durationMs: snapshot.durationMs, bytes: snapshot.bytes, chunks: snapshot.chunks,
        fileName: snapshot.fileName, mimeType: snapshot.mimeType, stopReason: snapshot.stopReason };
      if (failed) body.error = snapshot.error || snapshot.saveError || '录制提前结束，未录满指定时长；已录部分已保存';
      if (unavailable) body.error = '目标 Chrome 插件暂未连接或状态查询超时，请稍后重试同一 URL';
      if (snapshot.state === 'saved') {
        const file = await this.file(snapshot); await file.handle.close();
        const info = { filePath: snapshot.savedPath, fileUrl: `${receipt.statusUrl}/file`, size: file.size, mimeType: snapshot.mimeType };
        if (failed) body.partialFile = info; else Object.assign(body, info);
      }
      response.setHeader('Retry-After', '2');
      this.json(request, response, unavailable ? 503 : 200, body);
    } catch (error) {
      this.json(request, response, 503, { status: 'failed', done: true, success: false, error: (error as Error).message });
    }
    return true;
  }
}
