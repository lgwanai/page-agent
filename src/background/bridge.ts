import type { UploadFilePath } from '@/shared/upload';
import { loadWorkspace, replaceWorkspace } from '@/shared/storage';
import { runAction, runScript } from './runner';
import { ensureWorkflowKeys, verifyWorkflowKey } from '@/shared/workflow-keys';
import { getInstanceId } from '@/shared/instance';
import { loadMcpConfiguration, mcpOptionsError, sameMcpOptions } from '@/shared/mcp-config';
import type { McpClientOptions } from '@/types/mcp';

let serverVersion: string | undefined;
let protocolVersion: number | undefined;
let liveMcpOptions: McpClientOptions | undefined;
import { MCP_BRIDGE_URL, type McpConnectionInfo } from '@/types/mcp';
import { AUTHORING_METHODS, handleAuthoring } from './authoring';
import { diagnose } from '@/shared/diagnostics';

let socket: WebSocket | null = null;
let retryTimer: number | undefined;
let retryDelay = 1000;
let bridgeConnected = false;
let bridgeError: string | undefined;
const mailPending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let mailAvailable = false;
export function sendEmailViaBridge(config: unknown, message: unknown): Promise<unknown> {
  if (!socket || socket.readyState !== WebSocket.OPEN || !mailAvailable) return Promise.reject(new Error('邮件需要新版本机 MCP 共享桥接，请重启 Page Agent MCP 服务后重连'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { mailPending.delete(id); reject(new Error('邮件发送超时，结果可能未知，请检查发件记录，不要自动重发')); }, 60000);
    mailPending.set(id, { resolve, reject, timer });
    socket!.send(JSON.stringify({ type: 'send_email', id, config, message }));
  });
}
let uploadAvailable = false;
const uploadPending = new Map<string, { resolve: (files: UploadFilePath[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function inspectUploadFilesViaBridge(paths: string[]): Promise<UploadFilePath[]> {
  if (!socket || socket.readyState !== WebSocket.OPEN || !uploadAvailable) return Promise.reject(new Error('文件路径上传需要新版的本机 MCP 服务，请启动或重启 Page Agent MCP 服务后重试'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { uploadPending.delete(id); reject(new Error('检查本机上传文件超时，尚未向网页上传')); }, 30000);
    uploadPending.set(id, { resolve, reject, timer });
    socket!.send(JSON.stringify({ type: 'inspect_upload_files', id, paths }));
  });
}
export function isBridgeConnected(): boolean { return bridgeConnected; }

export async function getMcpConnectionInfo(): Promise<McpConnectionInfo> {
  const configured = await loadMcpConfiguration();
  const hasConfigured = !mcpOptionsError(configured.options);
  return {
    instanceId: await getInstanceId(), connected: bridgeConnected,
    connecting: socket?.readyState === WebSocket.CONNECTING,
    bridgeUrl: MCP_BRIDGE_URL, error: bridgeError,
    clientOptions: hasConfigured ? configured.options : liveMcpOptions ?? configured.options,
    clientOptionsSource: hasConfigured ? configured.source : liveMcpOptions ? 'service' : 'unconfigured',
    runningClientOptions: liveMcpOptions, serverVersion, protocolVersion,
    configurationMismatch: Boolean(hasConfigured && liveMcpOptions && !sameMcpOptions(configured.options, liveMcpOptions)),
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
  if (AUTHORING_METHODS.includes(request.method)) return handleAuthoring(request.method, params);
  switch (request.method) {
    case 'ping': return { name: 'Page Agent', instanceId, version: chrome.runtime.getManifest().version };
    case 'get_state': return loadWorkspace();
    case 'set_state': {
      await replaceWorkspace(params.state as Awaited<ReturnType<typeof loadWorkspace>>, params.expectedRevisions as Record<string, number> | undefined);
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
      try {
        const data = JSON.parse(String(event.data));
        if (data.type === 'services') {
          mailAvailable = data.email === true;
          uploadAvailable = data.uploadNativePaths === true;
          serverVersion = typeof data.serverVersion === 'string' ? data.serverVersion : undefined;
          protocolVersion = typeof data.protocolVersion === 'number' ? data.protocolVersion : undefined;
          notifyStatus(true);
          if (typeof data.clientOptions?.command === 'string' && typeof data.clientOptions?.serverPath === 'string' && !mcpOptionsError(data.clientOptions)) { liveMcpOptions = data.clientOptions; notifyStatus(true); }
          return;
        }
        if (data.type === 'upload_file_paths_result') {
          const pending = uploadPending.get(data.id); if (!pending) return;
          clearTimeout(pending.timer); uploadPending.delete(data.id);
          if (data.ok && Array.isArray(data.result)) pending.resolve(data.result); else pending.reject(new Error(data.error || '读取上传文件失败'));
          return;
        }
        if (data.type === 'email_result') {
          const pending = mailPending.get(data.id); if (!pending) return;
          clearTimeout(pending.timer); mailPending.delete(data.id);
          if (data.ok) pending.resolve(data.result); else pending.reject(new Error(data.error || '邮件发送失败，结果可能未知，请检查发件记录'));
          return;
        }
      } catch { return; }
      let request: BridgeRequest;
      try { request = JSON.parse(String(event.data)) as BridgeRequest; }
      catch { return; }
      if (!request || !request.id || !request.method) return;
      const reply = (response: Record<string, unknown>) => {
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify(response));
      };
      void handleBridgeRequest(request)
        .then((result) => reply({ id: request.id, ok: true, result }))
        .catch((error: Error) => reply({ id: request.id, ok: false, error: error.message, diagnostic: diagnose(error, { requestId: request.id, extensionVersion: chrome.runtime.getManifest().version, method: request.method, instanceId: request.instanceId, workflowId: request.params?.workflowId ?? request.params?.scriptId, nodeId: request.params?.nodeId }) }));
    });
    connection.addEventListener('close', (event) => {
      if (heartbeatTimer !== undefined) self.clearInterval(heartbeatTimer);
      if (socket !== connection) return;
      socket = null;
      liveMcpOptions = undefined; serverVersion = undefined; protocolVersion = undefined;
      mailAvailable = false; uploadAvailable = false;
      for (const pending of uploadPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('检查文件时本机 MCP 服务断开，尚未向网页上传')); }
      uploadPending.clear();
      for (const pending of mailPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('邮件桥接断开，发送结果可能未知，请检查发件记录，不要自动重发')); }
      mailPending.clear();
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
