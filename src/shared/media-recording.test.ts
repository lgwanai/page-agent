import { expect, it } from 'vitest';
import { recordingFileName, validateRecordingOptions } from './media-recording';
import { exportWorkflow, importWorkflow } from './workflow-file';
import { createStartNode, type MediaRecordingNode } from '@/types/workflow';
import { validateMediaNode } from './media-nodes';
it.each([0, -1, NaN, Infinity, 999, 1800001, 1000.5])('rejects an invalid recording duration %s', durationMs => {
  expect(() => validateRecordingOptions({ mode: 'videoAudio', fileName: '直播', durationMs })).toThrow();
});
it('round trips recording nodes including session references and validates imported settings', () => {
  const node: MediaRecordingNode = { id: 'record', kind: 'mediaRecording', name: '录直播', action: 'record', mode: 'videoAudio', durationMs: 180000, fileName: '直播-{{主播}}' };
  const workflow = { id: '11223344-1111-4111-8111-aabbccddeeff', name: '直播录制', nodes: [createStartNode(), node], edges: [], createdAt: 1, updatedAt: 1 };
  expect(importWorkflow(exportWorkflow(workflow), []).workflow.nodes[1]).toMatchObject(node);
  expect(() => validateMediaNode({ ...node, action: 'invalid' } as unknown as MediaRecordingNode)).toThrow();
  expect(() => importWorkflow(exportWorkflow({ ...workflow, nodes: [{ ...node, durationMs: 0 }] }), [])).toThrow();
});
it('keeps a recording download beneath its designated directory, with a unique ID and correct file format', () => {
  const name = recordingFileName('../直播/../test.mp4', 'unique-id', false);
  expect(name).not.toMatch(/[\\/\r\n]/);
  expect(name).not.toMatch(/^\./);
  expect(name).toMatch(/-unique-id\.webm$/);
  expect(recordingFileName('', 'audio-id', true)).toBe('网页录制-audio-id.audio.webm');
});
