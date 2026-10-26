import { checkCancellation, pauseExecution } from './execution-control';
import { UPLOAD_MARKER } from '@/shared/upload';
type Session = chrome.debugger.Debuggee & { sessionId?: string };
interface DomNode { nodeName: string; backendNodeId: number; attributes?: string[]; children?: DomNode[]; contentDocument?: DomNode; shadowRoots?: DomNode[] }
function markedNodes(root: DomNode, token: string): number[] {
  const found: number[] = [], stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const attributes = node.attributes ?? [];
    const index = attributes.indexOf(UPLOAD_MARKER);
    if (index >= 0 && index % 2 === 0 && attributes[index + 1] === token && node.nodeName === 'INPUT') found.push(node.backendNodeId);
    stack.push(...(node.children ?? []), ...(node.shadowRoots ?? []));
    if (node.contentDocument) stack.push(node.contentDocument);
  }
  return found;
}
/** Uses the debugger already owned by withAlertConfirmation; never attaches or detaches it. */
export async function setNativeUploadFiles(tabId: number, token: string, paths: string[], beforeDispatch: () => Promise<void>) {
  const root: Session = { tabId };
  const sessions = new Map<string, Session>([['', root]]);
  const setup = new Set<Promise<unknown>>();
  let closing = false;
  const options = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe', exclude: false }] };
  const command = <T>(session: Session, method: string, params?: object) => chrome.debugger.sendCommand(session, method, params) as Promise<T>;
  const attachChildren = (session: Session) => {
    const task = command(session, 'Target.setAutoAttach', options).catch(() => undefined);
    setup.add(task); void task.finally(() => setup.delete(task)); return task;
  };
  const listener = (source: Session, method: string, raw?: object) => {
    if (closing || source.tabId !== tabId) return;
    const event = raw as { sessionId?: string; targetInfo?: { type: string } } | undefined;
    if (method === 'Target.detachedFromTarget' && event?.sessionId) sessions.delete(event.sessionId);
    if (method === 'Target.attachedToTarget' && event?.sessionId && event.targetInfo?.type === 'iframe') {
      const session = { tabId, sessionId: event.sessionId }; sessions.set(event.sessionId, session); void attachChildren(session);
    }
  };
  chrome.debugger.onEvent.addListener(listener);
  try {
    // Flat sessions also reach cross-origin, out-of-process iframes (Chrome 125+).
    await command(root, 'Target.setAutoAttach', options);
    const deadline = Date.now() + 5000;
    let selected: { session: Session; backendNodeId: number } | undefined;
    while (Date.now() < deadline) {
      checkCancellation(); await Promise.all([...setup]);
      const matches: Array<{ session: Session; backendNodeId: number }> = [];
      for (const session of sessions.values()) {
        let document: { root: DomNode };
        try { document = await command(session, 'DOM.getDocument', { depth: -1, pierce: true }); }
        catch (error) { if (!session.sessionId) throw error; continue; }
        for (const backendNodeId of markedNodes(document.root, token)) matches.push({ session, backendNodeId });
      }
      if (matches.length > 1) throw new Error('上传控件标识不唯一，尚未选择文件，请重新选择控件');
      if (matches.length === 1) { selected = matches[0]; break; }
      await pauseExecution(50);
    }
    if (!selected) throw new Error('上传控件已被替换或未连接，尚未选择文件');
    await beforeDispatch(); checkCancellation();
    try { await command(selected.session, 'DOM.setFileInputFiles', { files: paths, backendNodeId: selected.backendNodeId }); }
    catch (error) { throw new Error(`原生文件选择已发送，上传结果可能未知，请检查页面，勿自动重试：${(error as Error).message}`); }
  } finally {
    closing = true;
    await Promise.all([...setup]);
    await command(root, 'Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
    chrome.debugger.onEvent.removeListener(listener);
  }
}
