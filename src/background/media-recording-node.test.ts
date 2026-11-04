import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeMediaRecording } from './media-recording-node';
import { mediaRecordingById, pollMediaRecording, rememberMediaRecording, requestMediaRecordingStop, startMediaRecording, stopMediaRecording } from './media-recording';
import { configureRecordingTaskBridge } from './recording-task-bridge';
import { beginExecution, cancelExecution, finishExecution } from './execution-control';
import type { MediaRecordingNode } from '@/types/workflow';
import type { MediaRecordingResult } from '@/shared/media-recording';
vi.mock('./media-recording', () => ({ mediaRecordingById: vi.fn(), mediaRecordingStatus: vi.fn(), pollMediaRecording: vi.fn(), rememberMediaRecording: vi.fn(), requestMediaRecordingStop: vi.fn(), startMediaRecording: vi.fn(), stopMediaRecording: vi.fn() }));
const node: MediaRecordingNode = { id: 'record', name: '录直播', kind: 'mediaRecording', action: 'record', mode: 'videoAudio', durationMs: 180000, fileName: '直播-{{name}}' };
const session: MediaRecordingResult = { type: 'mediaRecording', id: 'session', tabId: 7, state: 'recording', mode: 'videoAudio', startedAt: 1, durationMs: 0, bytes: 0, chunks: 0, mimeType: 'video/webm', fileName: '直播.webm', audioTracks: 1, videoTracks: 1, audioPeak: 0.2, audibleSamples: 10 };
const receipt = { taskId: 'task', statusUrl: `http://127.0.0.1:17373/recordings/${'a'.repeat(43)}`, expiresAt: '2026-12-01T00:00:00.000Z', pollAfterMs: 2000 };
const register = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); configureRecordingTaskBridge(register);
  register.mockResolvedValue(receipt);
  vi.mocked(startMediaRecording).mockResolvedValue(session);
  vi.mocked(mediaRecordingById).mockResolvedValue(session);
  vi.mocked(rememberMediaRecording).mockImplementation(async value => value);
  vi.mocked(stopMediaRecording).mockResolvedValue({ ...session, state: 'saved' });
  vi.mocked(requestMediaRecordingStop).mockResolvedValue({ ...session, state: 'ready' });
});
afterEach(() => { configureRecordingTaskBridge(); finishExecution(); });

it('returns a pollable URL immediately for a three-minute recording without waiting for a file', async () => {
  const result = await executeMediaRecording(7, node, { name: '抖音' }, {});
  expect(result).toMatchObject({ state: 'recording', durationMs: 0, ...receipt });
  expect(result.savedPath).toBeUndefined();
  expect(startMediaRecording).toHaveBeenCalledWith(7, { mode: 'videoAudio', durationMs: 180000, fileName: '直播-抖音' });
  expect(register).toHaveBeenCalledWith(session, true, 180000);
  expect(pollMediaRecording).not.toHaveBeenCalled();
});
it('keeps an accepted task independent of the workflow execution lifetime', async () => {
  const runId = beginExecution();
  const result = await executeMediaRecording(7, { ...node, action: 'start' }, {}, {});
  cancelExecution(runId); finishExecution();
  expect(result.statusUrl).toBe(receipt.statusUrl);
  expect(register).toHaveBeenCalledWith(session, false, 180000);
  expect(stopMediaRecording).not.toHaveBeenCalled();
});
it('stops and polls by explicit recording id, even after the target tab changes', async () => {
  vi.mocked(requestMediaRecordingStop).mockResolvedValue({ ...session, ...receipt, state: 'ready' });
  vi.mocked(pollMediaRecording).mockResolvedValue({ ...session, ...receipt });
  expect(await executeMediaRecording(8, { ...node, action: 'stop', recordingId: '{{开始录制.id}}' }, {}, { 开始录制: { id: 'session' } })).toMatchObject({ state: 'ready', statusUrl: receipt.statusUrl });
  expect(requestMediaRecordingStop).toHaveBeenCalledWith('session');
  await executeMediaRecording(8, { ...node, action: 'status', recordingId: 'session' }, {}, {});
  expect(pollMediaRecording).toHaveBeenCalledWith('session');
  expect(register).not.toHaveBeenCalled();
});
it('refuses old or disconnected brokers before capturing any page content', async () => {
  configureRecordingTaskBridge();
  await expect(executeMediaRecording(7, node, {}, {})).rejects.toThrow('0.10.21');
  expect(startMediaRecording).not.toHaveBeenCalled();
});
it('cleans up a capture when URL registration fails', async () => {
  register.mockRejectedValue(new Error('注册失败'));
  await expect(executeMediaRecording(7, node, {}, {})).rejects.toThrow('注册失败');
  expect(requestMediaRecordingStop).toHaveBeenCalledWith('session', 'error');
});
it('preserves a fast terminal result that arrived before registration completed', async () => {
  vi.mocked(mediaRecordingById).mockResolvedValue({ ...session, state: 'saved', savedPath: '/tmp/clip.webm' });
  expect(await executeMediaRecording(7, node, {}, {})).toMatchObject({ state: 'saved', savedPath: '/tmp/clip.webm', ...receipt });
});
it('rejects missing or unresolved recording ids without touching another capture', async () => {
  vi.mocked(mediaRecordingById).mockResolvedValue(null);
  await expect(executeMediaRecording(7, { ...node, action: 'stop', recordingId: 'other-session' }, {}, {})).rejects.toThrow('未找到指定');
  await expect(executeMediaRecording(7, { ...node, action: 'stop', recordingId: '{{missing.id}}' }, {}, {})).rejects.toThrow('引用为空');
  expect(requestMediaRecordingStop).not.toHaveBeenCalled();
});
