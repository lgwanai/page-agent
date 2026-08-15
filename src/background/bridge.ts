import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import { runAction, runScript } from './runner';

const BRIDGE_URL = 'ws://127.0.0.1:17373/extension';
let socket: WebSocket | null = null;
let retryTimer: number | undefined;
let retryDelay = 1000;

interface BridgeRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

async function activePage(): Promise<Record<string, unknown>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { tabId: tab?.id, title: tab?.title, url: tab?.url };
}

async function handle(request: BridgeRequest): Promise<unknown> {
  const params = request.params ?? {};
  switch (request.method) {
    case 'ping': return { name: 'Page Agent', version: chrome.runtime.getManifest().version };
    case 'get_state': return loadWorkspace();
    case 'set_state': {
      await saveWorkspace(params.state as Awaited<ReturnType<typeof loadWorkspace>>);
      return { saved: true };
    }
    case 'list_scripts': return (await loadWorkspace()).scripts;
    case 'list_actions': return (await loadWorkspace()).actions;
    case 'run_script': return runScript(String(params.scriptId ?? ''), (params.variables ?? {}) as Record<string, string>);
    case 'run_action': return runAction(String(params.actionId ?? ''), (params.variables ?? {}) as Record<string, string>);
    case 'active_page': return activePage();
    default: throw new Error(`未知 Bridge 方法：${request.method}`);
  }
}

function notifyStatus(connected: boolean): void {
  chrome.runtime.sendMessage({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected }).catch(() => undefined);
}

function scheduleReconnect(): void {
  if (retryTimer) return;
  retryTimer = self.setTimeout(() => {
    retryTimer = undefined;
    connectBridge();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

export function connectBridge(): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  try {
    socket = new WebSocket(BRIDGE_URL);
    socket.addEventListener('open', () => {
      retryDelay = 1000;
      notifyStatus(true);
      socket?.send(JSON.stringify({ type: 'hello', role: 'extension', version: chrome.runtime.getManifest().version }));
    });
    socket.addEventListener('message', (event) => {
      let request: BridgeRequest;
      try { request = JSON.parse(String(event.data)) as BridgeRequest; }
      catch { return; }
      if (!request.id || !request.method) return;
      void handle(request)
        .then((result) => socket?.send(JSON.stringify({ id: request.id, ok: true, result })))
        .catch((error: Error) => socket?.send(JSON.stringify({ id: request.id, ok: false, error: error.message })));
    });
    socket.addEventListener('close', () => { socket = null; notifyStatus(false); scheduleReconnect(); });
    socket.addEventListener('error', () => socket?.close());
  } catch {
    socket = null;
    scheduleReconnect();
  }
}
