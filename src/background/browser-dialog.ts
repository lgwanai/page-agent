import { matchesFrameUrl } from '@/shared/frame-context';
import type { BrowserDialogType, DialogNode } from '@/types/workflow';
import { checkCancellation, executionSignal, RunCancelled } from './execution-control';

type Session = chrome.debugger.Debuggee & { sessionId?: string };
interface Opening { type: BrowserDialogType; message: string; defaultPrompt?: string; url?: string }
export interface DialogReceipt { type: BrowserDialogType; message: string; accepted: boolean; promptText?: string; defaultPrompt?: string; url?: string }
const configuredTabs = new Map<number, { suppressAlerts: boolean }>();
/** The normal alert listener yields to an explicitly configured native dialog. */
export function hasConfiguredDialog(tabId: number) { return configuredTabs.get(tabId)?.suppressAlerts ?? false; }

/** The trigger is dispatched once, only after native dialog listeners are ready. */
export async function executeBrowserDialog<T>(tabId: number, node: DialogNode, trigger: (signal: AbortSignal) => Promise<T>): Promise<{ dialog: DialogReceipt; trigger: T }> {
  checkCancellation();
  if (!chrome.debugger?.sendCommand) throw new Error('浏览器弹窗节点需要 Chrome 调试权限');
  if (configuredTabs.has(tabId)) throw new Error('当前标签页已有弹窗处理节点在运行');
  configuredTabs.set(tabId, { suppressAlerts: true });
  const triggerController = new AbortController();
  const root: Session = { tabId };
  const sessions = new Map<string, Session>();
  const setup = new Set<Promise<unknown>>();
  let closing = false;
  let failureError: unknown;
  let opening: Opening | undefined;
  let openingSession: Session | undefined;
  let receipt: DialogReceipt | undefined;
  let commandFinished = false;
  let closed = false;
  let complete: (value: DialogReceipt) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const dialog = new Promise<DialogReceipt>((resolve, reject) => { complete = resolve; fail = reject; });
  void dialog.catch(() => undefined);
  let rejectFailure: (error: unknown) => void = () => undefined;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  void failure.catch(() => undefined);
  const reject = (error: unknown) => { failureError = error; fail(error); rejectFailure(error); };
  const command = (session: Session, method: string, params?: object) => chrome.debugger.sendCommand(session, method, params);
  const options = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] };
  const enable = (session: Session) => {
    const task = (async () => { await command(session, 'Page.enable'); await command(session, 'Target.setAutoAttach', options); })();
    setup.add(task); void task.then(() => setup.delete(task), error => { setup.delete(task); if (!closing) reject(new Error(`无法监听 iframe 弹窗：${(error as Error).message}`)); });
  };
  const finish = () => { if (receipt && commandFinished && closed) complete(receipt); };
  const listener = (source: Session, method: string, raw?: object) => {
    if (closing || source.tabId !== tabId) return;
    if (method === 'Target.attachedToTarget') {
      const event = raw as { sessionId?: string; targetInfo?: { type?: string } };
      if (event?.sessionId && event.targetInfo?.type === 'iframe') {
        const session = { tabId, sessionId: event.sessionId }; sessions.set(event.sessionId, session); enable(session);
      }
      return;
    }
    if (method === 'Target.detachedFromTarget') {
      const event = raw as { sessionId?: string };
      if (event?.sessionId) sessions.delete(event.sessionId);
      return;
    }
    if (method === 'Page.javascriptDialogOpening') {
      const event = raw as Opening;
      // Subsequent alerts keep the established automatic-accept behavior.
      if (receipt && event.type === 'alert') return;
      if (opening || receipt) { reject(new Error('一次触发出现多个浏览器弹窗，请检查页面后拆分操作；后续弹窗未自动应答')); return; }
      if (event.url && /^https?:/.test(node.target.frameUrl ?? '') && !matchesFrameUrl(event.url, node.target.frameUrl!, node.target.frameQueryKeys)) {
        reject(new Error(`浏览器弹窗来源不匹配：${event.url}。未自动应答，请手动检查弹窗；触发操作不会重试。`)); return;
      }
      if (event.type !== node.dialogType || (node.message && event.message !== node.message)) {
        reject(new Error(`浏览器弹窗不匹配：期待 ${node.dialogType}${node.message ? `「${node.message}」` : ''}，实际 ${event.type}「${event.message}」。未自动应答，请手动检查弹窗；触发操作不会重试。`)); return;
      }
      opening = event; openingSession = source;
      configuredTabs.get(tabId)!.suppressAlerts = false;
      receipt = { type: event.type, message: event.message, accepted: node.action === 'accept', ...(event.type === 'prompt' ? { promptText: node.action === 'accept' ? node.promptText : undefined, defaultPrompt: event.defaultPrompt ?? '' } : {}), ...(event.url ? { url: event.url } : {}) };
      void command(source, 'Page.handleJavaScriptDialog', { accept: receipt.accepted, ...(event.type === 'prompt' && receipt.accepted ? { promptText: node.promptText } : {}) }).then(() => { commandFinished = true; finish(); }, error => reject(new Error(`浏览器弹窗应答失败，结果可能未知，请检查页面后再运行：${(error as Error).message}`)));
    } else if (method === 'Page.javascriptDialogClosed' && !closed && openingSession && source.sessionId === openingSession.sessionId) {
      const event = raw as { result?: boolean; userInput?: string };
      if (event.result !== receipt?.accepted || (receipt?.type === 'prompt' && receipt.accepted && event.userInput !== node.promptText)) {
        reject(new Error('浏览器弹窗实际关闭结果与配置不一致，请检查是否有人手动操作')); return;
      }
      closed = true; finish();
    }
  };
  const signal = executionSignal();
  const abort = () => reject(new RunCancelled());
  const detached = (source: Session) => { if (source.tabId === tabId) reject(new Error('浏览器调试连接已断开；弹窗操作结果可能未知，请检查页面')); };
  const timer = setTimeout(() => reject(new Error(`浏览器弹窗节点等待超过 ${node.timeoutMs} 毫秒，未完成预期弹窗应答；触发操作不会重试，请检查页面`)), node.timeoutMs);
  chrome.debugger.onEvent.addListener(listener);
  chrome.debugger.onDetach?.addListener(detached);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([(async () => {
      await command(root, 'Target.setAutoAttach', options);
      while (setup.size) await Promise.all([...setup]);
      checkCancellation();
      if (failureError) throw failureError;
      if (closing) throw new Error('弹窗监听已结束，未触发控件');
      const triggered = trigger(triggerController.signal);
      const [observed, value] = await Promise.all([dialog, triggered]);
      return { dialog: observed, trigger: value };
    })(), failure]);
  } finally {
    closing = true; clearTimeout(timer);
    triggerController.abort();
    signal?.removeEventListener('abort', abort);
    chrome.debugger.onEvent.removeListener(listener);
    chrome.debugger.onDetach?.removeListener(detached);
    configuredTabs.delete(tabId);
    await command(root, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
  }
}
