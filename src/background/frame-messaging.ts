import type { RecordedTargetHint } from '@/types/workflow';

interface Frame { frameId: number; url: string; documentId?: string }
interface TargetMessage { selector?: string; targetHint?: RecordedTargetHint }

function sameDocument(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch { return left === right; }
}

function documentTarget(frame: Frame): { frameId: number; documentId?: string } {
  return { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) };
}

async function readyFrame(tabId: number, frameId: number): Promise<boolean> {
  const ping = async () => {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_PING' }, { frameId });
      return response?.ok === true && response.frameLocator === true;
    } catch { return false; }
  };
  if (await ping()) return true;
  const files = (chrome.runtime.getManifest().content_scripts ?? []).flatMap((entry) => entry.js ?? []);
  if (!files.length) return false;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files }); }
  catch { return false; }
  // CRX's content loader imports the actual module asynchronously.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await ping()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** Locate first, execute once: a failed execution response must never cause a duplicate click. */
export async function sendFrameMessage(
  tabId: number, recordedFrameId: number, message: unknown, frameUrl?: string, timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const selector = (message as TargetMessage)?.selector;
  const targetHint = (message as TargetMessage)?.targetHint;
  const waitMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(timeoutMs, 30_000)) : 10_000;
  const deadline = Date.now() + waitMs;
  let connectedFrames = 0;
  let currentFrameIds: number[] = [];
  const locate = async (frame: Frame): Promise<boolean> => {
    if (!await readyFrame(tabId, frame.frameId)) return false;
    connectedFrames += 1;
    if (selector === undefined) return true;
    let result: { ok?: boolean; error?: string; count?: number } | undefined;
    try { result = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_LOCATE_SELECTOR', selector, ...(targetHint ? { targetHint } : {}) }, documentTarget(frame)); }
    catch { return false; /* The frame may have navigated after the readiness check. */ }
    if (result?.ok === false) throw new Error(String(result.error ?? 'Selector 定位失败'));
    return result?.ok === true && Number(result.count) > 0;
  };
  let selected: Frame | undefined;
  do {
    // AJAX/micro-frontends can create an iframe or render its form AFTER tab load complete.
    // Re-enumerate documents and repeat read-only probes, not the requested operation.
    const frames: Frame[] | null = await chrome.webNavigation.getAllFrames({ tabId });
    currentFrameIds = (frames ?? []).map((frame) => frame.frameId);
    connectedFrames = 0;
    // Old workflows can have a missing/default frameId=0. Treat it as a hint,
    // not a restriction: a plain CSS selector may belong to a child document.
    const candidates = (frames ?? []).filter((frame) => !frameUrl || sameDocument(frame.url, frameUrl));
    const preferred = (recordedFrameId !== 0 || frameUrl) ? candidates.find((frame) => frame.frameId === recordedFrameId) : undefined;
    if (preferred && await locate(preferred)) selected = preferred;
    else {
      const remaining = candidates.filter((frame) => frame !== preferred);
      const located = await Promise.all(remaining.map(async (frame) => await locate(frame) ? frame : undefined));
      const matches = located.filter((frame): frame is Frame => Boolean(frame));
      if (matches.length > 1) throw new Error(`Selector 在多个 frame 中匹配，无法安全执行：${selector ?? '未知节点'}。请重新选择节点。`);
      selected = matches[0];
    }
    if (selected || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  } while (!selected);
  if (!selected) {
    const details = currentFrameIds.length ? `当前 frame：${currentFrameIds.join(', ')}；已连接 ${connectedFrames} 个页面脚本` : '尚未发现页面 frame';
    const document = frameUrl ? `；目标 frame 文档：${frameUrl}` : '';
    throw new Error(`等待节点 ${waitMs / 1000} 秒后仍无法在当前页面定位节点：${selector ?? '未知节点'}（录制 frame ${recordedFrameId}；${details}${document}）。请检查页面或重新选择节点。`);
  }
  // Do not retry after dispatch: navigation can close the channel after an action has taken effect.
  const response = await chrome.tabs.sendMessage(tabId, message, documentTarget(selected));
  if (!response || typeof response !== 'object') throw new Error('页面脚本没有返回执行结果');
  return {
    ...response,
    ...(response.ok === false && response.error ? { error: `${String(response.error)}（实际命中 frame ${selected.frameId}：${selected.url}）` } : {}),
    frameId: selected.frameId, frameUrl: selected.url,
  };
}
