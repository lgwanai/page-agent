import { afterEach, expect, it, vi } from 'vitest';
import { setNativeUploadFiles } from './native-upload';
import { UPLOAD_MARKER } from '@/shared/upload';
function setup(child = false) {
  const listeners = new Set<(source: chrome.debugger.Debuggee, method: string, event: object) => void>();
  const node = { nodeName: 'INPUT', backendNodeId: 7, attributes: ['type', 'file', UPLOAD_MARKER, 'token'] };
  const send = vi.fn(async (session: chrome.debugger.Debuggee & { sessionId?: string }, method: string, params?: object): Promise<object> => {
    if (child && !session.sessionId && method === 'Target.setAutoAttach' && (params as { autoAttach: boolean }).autoAttach) for (const listener of listeners) listener({ tabId: 1 }, 'Target.attachedToTarget', { sessionId: 'child', targetInfo: { type: 'iframe' } });
    if (method === 'DOM.getDocument') return { root: child && !session.sessionId ? { nodeName: '#document', backendNodeId: 1 } : { nodeName: '#document', backendNodeId: 1, children: [node] } };
    return {};
  });
  vi.stubGlobal('chrome', { debugger: { sendCommand: send, onEvent: { addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn), removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.delete(fn) } } });
  return { send, listeners };
}
afterEach(() => { vi.unstubAllGlobals(); });
it.each([false, true])('sets disk paths once in the correct native target (child session: %s)', async child => {
  const { send, listeners } = setup(child);
  const validate = vi.fn().mockResolvedValue(undefined);
  await setNativeUploadFiles(1, 'token', ['/tmp/large.bin'], validate);
  expect(validate).toHaveBeenCalledOnce();
  const dispatches = send.mock.calls.filter(([, method]) => method === 'DOM.setFileInputFiles');
  expect(dispatches).toHaveLength(1);
  expect(dispatches[0]).toEqual([child ? { tabId: 1, sessionId: 'child' } : { tabId: 1 }, 'DOM.setFileInputFiles', { backendNodeId: 7, files: ['/tmp/large.bin'] }]);
  expect(listeners.size).toBe(0);
});
it('does not dispatch if final control validation fails', async () => {
  const { send } = setup();
  await expect(setNativeUploadFiles(1, 'token', ['/tmp/a'], async () => { throw new Error('控件已替换'); })).rejects.toThrow('替换');
  expect(send.mock.calls.some(([, method]) => method === 'DOM.setFileInputFiles')).toBe(false);
});
it('reports an unknown outcome without retrying after native dispatch fails', async () => {
  const { send } = setup(); const original = send.getMockImplementation()!;
  send.mockImplementation(async (session, method, params) => { if (method === 'DOM.setFileInputFiles') throw new Error('channel closed'); return original(session, method, params); });
  await expect(setNativeUploadFiles(1, 'token', ['/tmp/a'], async () => undefined)).rejects.toThrow('结果可能未知');
  expect(send.mock.calls.filter(([, method]) => method === 'DOM.setFileInputFiles')).toHaveLength(1);
});
