import type { RuntimeMessage } from '@/types/messages';

type RecordingStartMessage = Extract<RuntimeMessage, { type: 'PAGE_AGENT_RECORDING_START_V2' }>;

interface RecordingDelivery {
  send: (frameId: number, message: RecordingStartMessage) => Promise<unknown>;
  inject: (frameId: number, files: string[]) => Promise<unknown>;
  contentScriptFiles: string[];
  wait: () => Promise<void>;
}

function isAcknowledged(response: unknown, startedAt: number): boolean {
  if (!response || typeof response !== 'object') return false;
  const result = response as { ok?: boolean; recording?: boolean; startedAt?: number };
  return result.ok === true && result.recording === true && result.startedAt === startedAt;
}

/** Content scripts use an async module loader. Injection completion alone is not readiness. */
export async function startRecordingInFrames(
  frames: Array<{ frameId: number }>,
  startedAt: number,
  delivery: RecordingDelivery,
): Promise<number> {
  const targets = frames.some((frame) => frame.frameId === 0) ? frames : [{ frameId: 0 }, ...frames];
  const results = await Promise.all(targets.map(async ({ frameId }) => {
    const message: RecordingStartMessage = { type: 'PAGE_AGENT_RECORDING_START_V2', startedAt, showOverlay: frameId === 0 };
    const send = async () => {
      try { return isAcknowledged(await delivery.send(frameId, message), startedAt); }
      catch { return false; }
    };
    if (await send()) return true;
    if (!delivery.contentScriptFiles.length) return false;
    try { await delivery.inject(frameId, delivery.contentScriptFiles); }
    catch { return false; }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await send()) return true;
      await delivery.wait();
    }
    return false;
  }));
  if (!results[targets.findIndex((frame) => frame.frameId === 0)]) {
    throw new Error('网页录制未启动：无法连接当前页面。请刷新网页后重试。');
  }
  return results.filter(Boolean).length;
}
