import { loadWorkspace, saveWorkspace } from '@/shared/storage';
import { runAction, runScript } from './runner';
import { ensureWorkflowKeys, verifyWorkflowKey } from '@/shared/workflow-keys';
import { getInstanceId } from '@/shared/instance';
import { loadMcpOptions } from '@/shared/mcp-config';
import { MCP_BRIDGE_URL, type McpConnectionInfo } from '@/types/mcp';

let socket: WebSocket | null = null;
let retryTimer: number | undefined;
let retryDelay = 1000;
let bridgeConnected = false;
let bridgeError: string | undefined;
export function isBridgeConnected(): boolean { return bridgeConnected; }

export async function getMcpConnectionInfo(): Promise<McpConnectionInfo> {
  return {
    instanceId: await getInstanceId(), connected: bridgeConnected,
    connecting: socket?.readyState === WebSocket.CONNECTING,
    bridgeUrl: MCP_BRIDGE_URL, error: bridgeError,
    clientOptions: await loadMcpOptions(),
  };
}

/** Retry a failed connection without interrupting an already-connected workflow. */
export function retryMcpConnection(): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  if (retryTimer !== undefined) self.clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDelay = 1000;
  connectBridge();
}

interface BridgeRequest {
  id: string;
  method: string;
  instanceId: string;
  params?: Record<string, unknown>;
}

async function activePage(): Promise<Record<string, unknown>> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { tabId: tab?.id, title: tab?.title, url: tab?.url };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requestData(params: Record<string, unknown>): Record<string, unknown> {
  const variables = isJsonObject(params.variables) ? params.variables : {};
  const data = isJsonObject(params.data) ? params.data : {};
  return { ...variables, ...data };
}

export async function handleBridgeRequest(request: BridgeRequest): Promise<unknown> {
  const instanceId = await getInstanceId();
  if (request.instanceId !== instanceId) throw new Error('Chrome 插件实例 ID 不匹配，拒绝在当前实例执行');
  const params = request.params ?? {};
  switch (request.method) {
    case 'ping': return { name: 'Page Agent', instanceId, version: chrome.runtime.getManifest().version };
    case 'get_state': return loadWorkspace();
    case 'set_state': {
      await saveWorkspace(params.state as Awaited<ReturnType<typeof loadWorkspace>>);
      return { saved: true };
    }
    case 'list_scripts':
    case 'list_workflows': {
      const workflows = (await loadWorkspace()).scripts;
      await ensureWorkflowKeys(workflows.map((workflow) => workflow.id));
      return workflows.map((workflow) => ({
        id: workflow.id,
        instanceId,
        name: workflow.name,
        description: workflow.description,
        nodeCount: workflow.nodes.length,
        updatedAt: workflow.updatedAt,
        lastRunAt: workflow.lastRunAt,
        requiresKey: true,
      }));
    }
    case 'list_actions': return (await loadWorkspace()).actions;
    case 'run_script':
    case 'run_workflow': {
      const workflowId = String(params.workflowId ?? params.scriptId ?? '');
      const key = String(params.key ?? '');
      const workflow = (await loadWorkspace()).scripts.find((item) => item.id === workflowId);
      if (!workflow) throw new Error(`工作流不存在：${workflowId}`);
      if (!await verifyWorkflowKey(workflowId, key)) throw new Error('工作流密钥无效');
      return runScript(workflowId, requestData(params));
    }
    case 'run_action': return runAction(String(params.actionId ?? ''), requestData(params));
    case 'active_page': return activePage();
    default: throw new Error(`未知 Bridge 方法：${request.method}`);
  }
}

function notifyStatus(connected: boolean, error?: string): void {
  bridgeConnected = connected;
  bridgeError = error;
  chrome.runtime.sendMessage({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected, connecting: socket?.readyState === WebSocket.CONNECTING, error }).catch(() => undefined);
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
    const connection = new WebSocket(MCP_BRIDGE_URL);
    socket = connection;
    notifyStatus(false);
    let heartbeatTimer: number | undefined;
    connection.addEventListener('open', () => {
      retryDelay = 1000;
      void getInstanceId().then((instanceId) => {
        if (connection.readyState !== WebSocket.OPEN) return;
        connection.send(JSON.stringify({ type: 'hello', role: 'extension', instanceId, version: chrome.runtime.getManifest().version }));
        notifyStatus(true);
        // Application messages keep the MV3 worker/connection active while MCP is idle.
        heartbeatTimer = self.setInterval(() => {
          if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: 'heartbeat' }));
        }, 20_000);
      }).catch(() => connection.close());
    });
    connection.addEventListener('message', (event) => {
      let request: BridgeRequest;
      try { request = JSON.parse(String(event.data)) as BridgeRequest; }
      catch { return; }
      if (!request || !request.id || !request.method) return;
      const reply = (response: Record<string, unknown>) => {
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(response));
      };
      void handleBridgeRequest(request)
        .then((result) => reply({ id: request.id, ok: true, result }))
        .catch((error: Error) => reply({ id: request.id, ok: false, error: error.message }));
    });
    connection.addEventListener('close', (event) => {
      if (heartbeatTimer !== undefined) self.clearInterval(heartbeatTimer);
      if (socket !== connection) return;
      socket = null;
      notifyStatus(false, event.reason || '无法连接本机 MCP 服务，或服务已断开。请在 MCP 客户端启动 Page Agent 服务后重试。');
      scheduleReconnect();
    });
    connection.addEventListener('error', () => connection.close());
  } catch (error) {
    socket = null;
    notifyStatus(false, (error as Error).message);
    scheduleReconnect();
  }
}
