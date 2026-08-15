import type { RuntimeMessage } from '@/types/messages';

type SelectorMessage = Extract<RuntimeMessage, { type: 'PAGE_AGENT_START_SELECT' | 'PAGE_AGENT_STOP_SELECT' }>;

export interface SelectorFrame {
  frameId: number;
}

export interface SelectorDelivery {
  send: (frameId: number, message: SelectorMessage) => Promise<unknown>;
  inject: (frameId: number, files: string[]) => Promise<unknown>;
  contentScriptFiles: string[];
}

async function deliverToFrame(
  frameId: number,
  message: SelectorMessage,
  delivery: SelectorDelivery,
): Promise<boolean> {
  try {
    await delivery.send(frameId, message);
    return true;
  } catch {
    if (message.type === 'PAGE_AGENT_STOP_SELECT') return false;
  }

  if (!delivery.contentScriptFiles.length) return false;

  try {
    await delivery.inject(frameId, delivery.contentScriptFiles);
    await delivery.send(frameId, message);
    return true;
  } catch {
    return false;
  }
}

export async function sendSelectorToFrames(
  frames: SelectorFrame[],
  message: SelectorMessage,
  delivery: SelectorDelivery,
): Promise<number> {
  const targets = frames.length ? frames : [{ frameId: 0 }];
  const delivered = await Promise.all(targets.map(({ frameId }) => deliverToFrame(frameId, message, delivery)));
  const count = delivered.filter(Boolean).length;

  if (message.type === 'PAGE_AGENT_START_SELECT' && count === 0) {
    throw new Error('无法在当前页面启动 Selector，请确认页面是可访问的 http/https 网页');
  }

  return count;
}
