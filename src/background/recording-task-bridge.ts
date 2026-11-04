import type { MediaRecordingResult, RecordingTaskReceipt } from '@/shared/media-recording';

type TaskRequest = (result: MediaRecordingResult, requireFullDuration: boolean, requestedDurationMs: number) => Promise<RecordingTaskReceipt>;
let createTask: TaskRequest | undefined;
let publish: ((result: MediaRecordingResult) => void) | undefined;

export function configureRecordingTaskBridge(create?: TaskRequest, update?: (result: MediaRecordingResult) => void): void {
  createTask = create; publish = update;
}
export function requireRecordingTaskBridge(): void {
  if (!createTask) throw new Error('异步录屏需要已连接的 MCP 本机服务 0.10.21 或更新版本；请升级并重启共享桥接服务后重试');
}
export function createRecordingTask(result: MediaRecordingResult, requireFullDuration: boolean, requestedDurationMs: number): Promise<RecordingTaskReceipt> {
  requireRecordingTaskBridge();
  return createTask!(result, requireFullDuration, requestedDurationMs);
}
export function publishRecordingTask(result: MediaRecordingResult): void {
  if (result.taskId) publish?.(result);
}
