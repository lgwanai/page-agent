import { checkCancellation, pauseExecution } from './execution-control';
import type { RecordedTargetHint } from '@/types/workflow';
import { diagnose, diagnosticError } from '@/shared/diagnostics';
import { matchesFrameUrl } from '@/shared/frame-context';

interface Frame { frameId: number; url: string; documentId?: string }
interface TargetMessage { selector?: string; targetHint?: RecordedTargetHint }

function documentTarget(frame: Frame): { frameId: number; documentId?: string } {
  return { frameId: frame.frameId, ...(frame.documentId ? { documentId: frame.documentId } : {}) };
}

export async function readyFrame(tabId: number, frameId: number): Promise<boolean> {
  const manifest = chrome.runtime?.getManifest?.();
  const expectedVersion = manifest?.version ? `nodes-v${manifest.version}` : undefined;
  let lastPingError = '';
  const ping = async () => {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_AGENT_PING' }, { frameId });
      const matches = !expectedVersion || response?.contentVersion === expectedVersion;
      if (!matches) lastPingError = `页面脚本版本 ${response?.contentVersion ?? '未知'}，需要 ${expectedVersion}`;
      return response?.ok === true && response.frameLocator === true && matches;
    } catch (error) { lastPingError = (error as Error).message; return false; }
  };
  if (await ping()) return true;
  const files = (manifest?.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
  if (!files.length) return false;
  try { await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files }); }
  catch (error) { throw diagnosticError(new Error(`页面脚本注入失败：${(error as Error).message}。请重新加载当前构建的插件`), { phase: 'locating', tabId, actualFrameId: frameId, actionDispatched: false, contentScriptFiles: files, extensionVersion: manifest?.version, lastPingError }); }
  // CRX's content loader imports the actual module asynchronously.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    checkCancellation();
    if (await ping()) return true;
    await pauseExecution(100);
  }
  throw diagnosticError(new Error(`页面脚本握手失败：${lastPingError || '注入后未返回确认'}。请重新加载当前构建的插件`), { phase: 'locating', tabId, actualFrameId: frameId, actionDispatched: false, contentScriptFiles: files, extensionVersion: manifest?.version });
}

/** Locate first, execute once: a failed execution response must never cause a duplicate click. */
export async function sendFrameMessage(
  tabId: number, recordedFrameId: number, message: unknown, frameUrl?: string, timeoutMs = 10_000, frameQueryKeys?: string[], operationSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const ensureActive = () => {
    checkCancellation();
    if (operationSignal?.aborted) throw new Error('弹窗节点监听已结束，未发送页面操作');
  };
  ensureActive();
  const selector = (message as TargetMessage)?.selector;
  const rawHint = (message as TargetMessage)?.targetHint;
  const targetHint = rawHint?.locator && rawHint.locator.selector !== selector ? undefined : rawHint;
  const waitMs = Number.isFinite(timeoutMs) ? Math.max(0, Math.min(timeoutMs, 30_000)) : 10_000;
  const deadline = Date.now() + waitMs;
  let connectedFrames = 0;
  let currentFrameIds: number[] = [];
  let currentFrames: Array<{ frameId: number; url: string }> = [];
  let candidateCount = 0;
  const scriptFailures = new Map<number, string>();
  const locate = async (frame: Frame): Promise<boolean> => {
    try { if (!await readyFrame(tabId, frame.frameId)) return false; }
    catch (error) { scriptFailures.set(frame.frameId, (error as Error).message); return false; }
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
    ensureActive();
    // AJAX/micro-frontends can create an iframe or render its form AFTER tab load complete.
    // Re-enumerate documents and repeat read-only probes, not the requested operation.
    const frames: Frame[] | null = await chrome.webNavigation.getAllFrames({ tabId });
    currentFrameIds = (frames ?? []).map((frame) => frame.frameId);
    currentFrames = (frames ?? []).map((frame) => ({ frameId: frame.frameId, url: frame.url }));
    connectedFrames = 0;
    // Old workflows can have a missing/default frameId=0. Treat it as a hint,
    // not a restriction: a plain CSS selector may belong to a child document.
    const candidates = (frames ?? []).filter((frame) => !frameUrl || matchesFrameUrl(frame.url, frameUrl, frameQueryKeys));
    candidateCount = candidates.length;
    const preferred = (recordedFrameId !== 0 || frameUrl) ? candidates.find((frame) => frame.frameId === recordedFrameId) : undefined;
    if (!targetHint?.locator && preferred && await locate(preferred)) selected = preferred;
    else {
      const remaining = candidates.filter((frame) => targetHint?.locator || frame !== preferred);
      const located = await Promise.all(remaining.map(async (frame) => await locate(frame) ? frame : undefined));
      const matches = located.filter((frame): frame is Frame => Boolean(frame));
      if (matches.length > 1) throw diagnosticError(new Error(`Selector 在多个 frame 中匹配，无法安全执行：${selector ?? '未知节点'}。请重新选择节点。`), { phase: 'locating', selector, tabId, actionDispatched: false, matchedFrames: matches.map((frame) => ({ frameId: frame.frameId, url: frame.url })) });
      selected = matches[0];
    }
    if (selected || Date.now() >= deadline) break;
    await pauseExecution(Math.min(250, Math.max(0, deadline - Date.now())));
  } while (!selected);
  if (!selected) {
    if (frameUrl && currentFrames.length && !candidateCount) throw diagnosticError(new Error(`目标 frame 文档与当前页面不匹配，尚未进行 Selector 定位：${frameUrl}。请检查实时页面地址及页面 URL 参数范围配置`), { phase: 'locating', selector, tabId, actionDispatched: false, requestedFrameUrl: frameUrl, frameQueryKeys, currentFrames });
    if (!connectedFrames && scriptFailures.size) throw diagnosticError(new Error(`页面脚本连接失败，尚未执行页面操作：${[...scriptFailures].map(([id, error]) => `frame ${id}: ${error}`).join('；')}`), { phase: 'locating', tabId, actionDispatched: false, requestedFrameUrl: frameUrl, currentFrames, scriptFailures: Object.fromEntries(scriptFailures) });
    const details = currentFrameIds.length ? `当前 frame：${currentFrameIds.join(', ')}；已连接 ${connectedFrames} 个页面脚本` : '尚未发现页面 frame';
    const document = frameUrl ? `；目标 frame 文档：${frameUrl}` : '';
    throw diagnosticError(new Error(`等待节点 ${waitMs / 1000} 秒后仍无法在当前页面定位节点：${selector ?? '未知节点'}（录制 frame ${recordedFrameId}；${details}${document}）。请检查页面或重新选择节点。`), { phase: 'locating', selector, tabId, actionDispatched: false, recordedFrameId, requestedFrameUrl: frameUrl, currentFrameIds, currentFrames, connectedFrames, timeoutMs: waitMs });
  }
  // Do not retry after dispatch: navigation can close the channel after an action has taken effect.
  ensureActive();
  let response;
  try { response = await chrome.tabs.sendMessage(tabId, message, documentTarget(selected)); }
  catch (error) { throw diagnosticError(new Error(`页面操作已发送，但响应中断，操作结果可能未知：${(error as Error).message}`), { phase: 'execution', selector, tabId, actualFrameId: selected.frameId, actualFrameUrl: selected.url }); }
  if (!response || typeof response !== 'object') throw diagnosticError(new Error('页面脚本没有返回执行结果，操作结果可能未知'), { phase: 'execution', selector, tabId, actualFrameId: selected.frameId, actualFrameUrl: selected.url });
  return {
    ...response,
    ...(response.ok === false && response.error ? { error: `${String(response.error)}（实际命中 frame ${selected.frameId}：${selected.url}）` } : {}),
    frameId: selected.frameId, frameUrl: selected.url,
    ...(response.ok === false ? { diagnostic: diagnose(new Error(String(response.error ?? '页面操作失败')), { selector, tabId, actualFrameId: selected.frameId, actualFrameUrl: selected.url }) } : {}),
  };
}
