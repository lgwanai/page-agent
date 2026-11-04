import { isBridgeListening } from './bridge-readiness';
import { launchMcpServer } from './mcp-launcher';
import type { UploadFilePath } from '@/shared/upload';
import { loadWorkspace, replaceWorkspace } from '@/shared/storage';
import { runAction, runScript } from './runner';
import { ensureWorkflowKeys, verifyWorkflowKey } from '@/shared/workflow-keys';
import { getInstanceId } from '@/shared/instance';
import { loadMcpConfiguration, mcpOptionsError, sameMcpOptions, saveMcpOptions } from '@/shared/mcp-config';
import type { McpClientOptions } from '@/types/mcp';

let serverVersion: string | undefined;
let protocolVersion: number | undefined;
let liveMcpOptions: McpClientOptions | undefined;
import { MCP_BRIDGE_URL, type McpConnectionInfo } from '@/types/mcp';
import { AUTHORING_METHODS, handleAuthoring } from './authoring';
import { diagnose } from '@/shared/diagnostics';
import type { MediaRecordingResult, RecordingTaskReceipt } from '@/shared/media-recording';
import { configureRecordingTaskBridge } from './recording-task-bridge';
import { pollMediaRecording, republishRecordingTasks } from './media-recording';

let socket: WebSocket | null = null;
let connectionCheck: Promise<void> | undefined;
let retryTimer: number | undefined;
let retryDelay = 1000;
let bridgeConnected = false;
let bridgeError: string | undefined;
let autoStartAttempted = false;
let serverStarting: Promise<void> | undefined;
let launcherError: string | undefined;
const recordingTaskPending = new Map<string, { resolve: (value: RecordingTaskReceipt) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function registerRecordingTask(result: MediaRecordingResult, requireFullDuration: boolean, requestedDurationMs: number): Promise<RecordingTaskReceipt> {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('录屏任务服务已断开'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { recordingTaskPending.delete(id); reject(new Error('录屏状态 URL 注册超时，已停止本次录制')); }, 5000);
    recordingTaskPending.set(id, { resolve, reject, timer });
    socket!.send(JSON.stringify({ type: 'register_media_recording_task', id, result, requireFullDuration, requestedDurationMs }));
  });
}
function publishRecordingResult(result: MediaRecordingResult): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'media_recording_task_update', result }));
}
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
    connecting: Boolean(connectionCheck) || socket?.readyState === WebSocket.CONNECTING,
    bridgeUrl: MCP_BRIDGE_URL, error: bridgeError, launcherError, serverStarting: Boolean(serverStarting),
    clientOptions: hasConfigured ? configured.options : liveMcpOptions ?? configured.options,
    clientOptionsSource: hasConfigured ? configured.source : liveMcpOptions ? 'service' : 'unconfigured',
    runningClientOptions: liveMcpOptions, serverVersion, protocolVersion,
    configurationMismatch: Boolean(hasConfigured && liveMcpOptions && !sameMcpOptions(configured.options, liveMcpOptions)),
  };
}

/** Retry a failed connection without interrupting an already-connected workflow. */
export function retryMcpConnection(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return Promise.resolve();
  if (retryTimer !== undefined) self.clearTimeout(retryTimer);
  retryTimer = undefined;
  retryDelay = 1000;
  return connectBridge();
}

/** Ensure the local broker is running; a healthy connection is never restarted. */
export function startMcpServer(): Promise<void> {
  if (bridgeConnected) return Promise.resolve();
  if (serverStarting) return serverStarting;
  autoStartAttempted = true;
  launcherError = undefined;
  serverStarting = launchMcpServer().then(async (options) => {
    const configured = await loadMcpConfiguration();
    // Keep this extension's Setup configuration and deliberate overrides. The
    // registered host may belong to another package/profile; do not replace them.
    if (options && configured.source === 'unconfigured') await saveMcpOptions(options);
    // Let an initial readiness probe finish before retrying its failed check.
    await connectionCheck;
    await retryMcpConnection();
  }).catch((error: Error) => {
    launcherError = error.message;
    throw error;
  }).finally(() => { serverStarting = undefined; notifyStatus(bridgeConnected, bridgeError); });
  notifyStatus(bridgeConnected, bridgeError);
  return serverStarting;
}
/** One user action succeeds only after both a live connection and valid paths. */
export async function configureAndStartMcpServer(): Promise<McpConnectionInfo> {
  await startMcpServer();
  const deadline = Date.now() + 8000;
  while (!bridgeConnected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (!bridgeConnected) throw new Error('本机启动器已响应，但插件仍未连接服务。请确认 Chrome 加载的是运行 Setup 的安装包内 extension 目录，再点击重试。');
  let info = await getMcpConnectionInfo();
  if (info.clientOptionsSource === 'service' && !mcpOptionsError(info.clientOptions)) {
    await saveMcpOptions(info.clientOptions);
    info = await getMcpConnectionInfo();
  }
  if (info.configurationMismatch) throw new Error('当前连接的服务来自其他安装目录，尚未完成本次配置。请展开高级设置核对路径；确认没有工作流运行后关闭旧服务，再重新配置并启动。');
  const issue = mcpOptionsError(info.clientOptions);
  if (issue) throw new Error('已连接服务，但没有获得有效的本机配置。请双击新安装包中的 Setup 后重试。');
  return info;
}

function autoStartMcpServer(): void {
  if (autoStartAttempted || !chrome.runtime.sendNativeMessage) return;
  void startMcpServer().catch(() => undefined);
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
    case 'recording_status': return pollMediaRecording(String(params.recordingId ?? ''));
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
  chrome.runtime.sendMessage({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected, connecting: Boolean(connectionCheck) || socket?.readyState === WebSocket.CONNECTING, error }).catch(() => undefined);
}

function scheduleReconnect(): void {
  if (retryTimer) return;
  retryTimer = self.setTimeout(() => {
    retryTimer = undefined;
    connectBridge();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

/** Check availability first; never probe a stopped service with a WebSocket. */
export function connectBridge(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return Promise.resolve();
  if (connectionCheck) return connectionCheck;
  connectionCheck = (async () => {
    if (await isBridgeListening()) { openBridgeSocket(); return; }
    notifyStatus(false, '本机 MCP 服务尚未启动。可在 MCP 页面点击「配置并启动」；首次使用请先运行完整安装包中的 Setup。');
    scheduleReconnect();
    autoStartMcpServer();
  })().catch((error: Error) => {
    notifyStatus(false, error.message);
    scheduleReconnect();
  }).finally(() => {
    connectionCheck = undefined;
    notifyStatus(bridgeConnected, bridgeError);
  });
  return connectionCheck;
}

function openBridgeSocket(): void {
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
          configureRecordingTaskBridge(data.recordingTasks === true ? registerRecordingTask : undefined, data.recordingTasks === true ? publishRecordingResult : undefined);
          if (data.recordingTasks === true) void republishRecordingTasks().catch(() => undefined);
          notifyStatus(true);
          if (typeof data.clientOptions?.command === 'string' && typeof data.clientOptions?.serverPath === 'string' && !mcpOptionsError(data.clientOptions)) { liveMcpOptions = data.clientOptions; notifyStatus(true); }
          return;
        }
        if (data.type === 'media_recording_task_result') {
          const pending = recordingTaskPending.get(data.id); if (!pending) return;
          clearTimeout(pending.timer); recordingTaskPending.delete(data.id);
          const value = data.result as RecordingTaskReceipt | undefined;
          let valid = false;
          try {
            const url = new URL(value!.statusUrl);
            valid = url.origin === `http://${new URL(MCP_BRIDGE_URL).host}` && /^\/recordings\/[A-Za-z0-9_-]{43}$/.test(url.pathname) && !url.search && !url.hash;
          } catch { /* Invalid receipt is rejected before returning a link to the caller. */ }
          if (data.ok && value && valid && typeof value.taskId === 'string' && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))) pending.resolve(value);
          else pending.reject(new Error(data.error || '录屏任务服务没有返回有效的本机状态 URL'));
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
      configureRecordingTaskBridge();
      for (const pending of recordingTaskPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('录屏任务服务断开，已停止尚未取得状态 URL 的录制')); }
      recordingTaskPending.clear();
      for (const pending of uploadPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('检查文件时本机 MCP 服务断开，尚未向网页上传')); }
      uploadPending.clear();
      for (const pending of mailPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('邮件桥接断开，发送结果可能未知，请检查发件记录，不要自动重发')); }
      mailPending.clear();
      notifyStatus(false, event.reason || '无法连接本机 MCP 服务，或服务已断开。请在 MCP 客户端启动 Page Agent 服务后重试。');
      scheduleReconnect();
      autoStartMcpServer();
    });
    connection.addEventListener('error', () => connection.close());
  } catch (error) {
    socket = null;
    notifyStatus(false, (error as Error).message);
    scheduleReconnect();
  }
}
