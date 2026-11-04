import type { MediaRecordingNode } from '@/types/workflow';
import { validateMediaNode } from '@/shared/media-nodes';
import type { MediaRecordingResult } from '@/shared/media-recording';
import { mediaRecordingById, mediaRecordingStatus, pollMediaRecording, rememberMediaRecording, requestMediaRecordingStop, startMediaRecording } from './media-recording';
import { createRecordingTask, requireRecordingTaskBridge } from './recording-task-bridge';
import { checkCancellation } from './execution-control';
import { interpolate } from './runtime-values';

export async function executeMediaRecording(tabId: number, node: MediaRecordingNode, variables: Record<string, unknown>, context: Record<string, unknown>): Promise<MediaRecordingResult> {
  validateMediaNode(node);
  const id = interpolate(node.recordingId, variables, context)?.trim();
  if (node.recordingId?.trim() && !id) throw new Error('网页录制 ID 引用为空，请检查前序开始节点输出');
  if (node.action === 'stop' || node.action === 'status') {
    const current = id ? await mediaRecordingById(id) : await mediaRecordingStatus(tabId);
    if (!current) throw new Error('未找到指定的网页录制，请检查录制 ID 和目标标签页');
    return node.action === 'stop' ? requestMediaRecordingStop(current.id) : pollMediaRecording(current.id);
  }
  checkCancellation();
  requireRecordingTaskBridge();
  const started = await startMediaRecording(tabId, { mode: node.mode, durationMs: node.durationMs, fileName: interpolate(node.fileName, variables, context) || node.name });
  try {
    const task = await createRecordingTask(started, node.action === 'record', node.durationMs);
    const latest = await mediaRecordingById(started.id) ?? started;
    return await rememberMediaRecording({ ...latest, ...task });
  } catch (error) {
    void requestMediaRecordingStop(started.id, 'error').catch(() => undefined);
    throw error;
  }
}
