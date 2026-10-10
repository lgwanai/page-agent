import { describe, expect, it, vi } from 'vitest';
import { startRecordingInFrames } from './recording-messaging';

const startedAt = 123;
const ack = { ok: true, recording: true, startedAt };

describe('recording startup handshake', () => {
  it('requires a recorder acknowledgment and injects into an already-open page', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValueOnce(ack);
    const inject = vi.fn().mockResolvedValue([]);
    await expect(startRecordingInFrames([{ frameId: 0 }], startedAt, {
      send, inject, contentScriptFiles: ['assets/content-loader.js'], wait: vi.fn(),
    })).resolves.toBe(1);
    expect(inject).toHaveBeenCalledWith(0, ['assets/content-loader.js']);
  });

  it('does not accept an old listener or an async loader as a ready recorder', async () => {
    const send = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(ack);
    const wait = vi.fn().mockResolvedValue(undefined);
    await startRecordingInFrames([{ frameId: 0 }], startedAt, {
      send, inject: vi.fn(), contentScriptFiles: ['content.js'], wait,
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledOnce();
  });

  it('rejects startup when no recorder is available', async () => {
    await expect(startRecordingInFrames([{ frameId: 0 }], startedAt, {
      send: vi.fn().mockResolvedValue(undefined), inject: vi.fn(), contentScriptFiles: ['content.js'], wait: vi.fn(),
    })).rejects.toThrow('网页录制未启动');
  });

  it('requires the main document even if an iframe is available', async () => {
    await expect(startRecordingInFrames([{ frameId: 7 }], startedAt, {
      send: vi.fn(async (id) => id === 7 ? ack : undefined), inject: vi.fn(), contentScriptFiles: [], wait: vi.fn(),
    })).rejects.toThrow('网页录制未启动');
  });
});
