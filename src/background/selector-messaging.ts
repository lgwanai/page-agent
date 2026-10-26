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
  const acknowledged = (response: unknown) => !!response && typeof response === 'object' && (response as { ok?: boolean }).ok === true;
  try {
    if (acknowledged(await delivery.send(frameId, message))) return true;
  } catch {
    if (message.type === 'PAGE_AGENT_STOP_SELECT') return false;
  }

  if (message.type === 'PAGE_AGENT_STOP_SELECT' || !delivery.contentScriptFiles.length) return false;

  try {
    await delivery.inject(frameId, delivery.contentScriptFiles);
  } catch (error) { throw new Error(`frame ${frameId} 脚本注入失败：${(error as Error).message}`); }
  // CRX loader imports its module asynchronously: executeScript completing
  // does not mean the message listener has been installed yet.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { if (acknowledged(await delivery.send(frameId, message))) return true; }
    catch { /* wait for the loader, inject only once */ }
    if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export async function sendSelectorToFrames(
  frames: SelectorFrame[],
  message: SelectorMessage,
  delivery: SelectorDelivery,
): Promise<number> {
  const targets = frames.length ? frames : [{ frameId: 0 }];
  const delivered = await Promise.allSettled(targets.map(({ frameId }) => deliverToFrame(frameId, message, delivery)));
  const count = delivered.filter((result) => result.status === 'fulfilled' && result.value).length;

  if (message.type === 'PAGE_AGENT_START_SELECT' && count === 0) {
    const failures = delivered.flatMap((result) => result.status === 'rejected' ? [String(result.reason?.message ?? result.reason)] : []);
    throw new Error(`无法在当前页面启动 Selector：${failures.join('；') || '页面脚本未就绪或未返回确认'}。请刷新目标网页并确认已重新加载当前插件版本；若仍失败，请检查扩展站点访问权限。`);
  }

  return count;
}
