import { inspectUploadFiles } from './upload.js';
import { readFileSync } from 'node:fs';
const serverVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { deliverEmail } from './email.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  socket: WebSocket;
}

interface BridgeResponse {
  diagnostic?: unknown;
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  type?: string;
  role?: string;
  instanceId?: string;
  version?: string;
}

interface ExtensionClient {
  socket: WebSocket;
  instanceId: string;
  version: string;
  connectedAt: string;
}

export class ExtensionBridge {
  private readonly clients = new Map<string, ExtensionClient>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly server: WebSocketServer;
  readonly ready: Promise<void>;
  private readonly relays = new Set<WebSocket>();
  private readonly running = new Set<string>();

  constructor(port = 17373) {
    this.server = new WebSocketServer({ port, host: '127.0.0.1' });
    this.ready = new Promise((resolve, reject) => {
      this.server.once('listening', resolve);
      this.server.once('error', reject);
    });
    this.server.on('connection', (socket, request) => {
      if (request.url === '/mcp-client' && !request.headers.origin) {
        this.relays.add(socket);
        socket.send(JSON.stringify({ type: 'broker_ready', protocol: 1, capabilities: ['workflow_authoring_v1', 'page_screenshot_v1'], instances: this.instances }));
        socket.on('error', () => undefined);
        socket.on('close', () => this.relays.delete(socket));
        socket.on('message', (raw) => { void this.relayRequest(socket, String(raw)); });
        return;
      }
      if (request.url !== '/extension') {
        socket.close(1008, 'Only extension clients are allowed');
        return;
      }
      const handshakeTimer = setTimeout(() => socket.close(1008, 'Instance handshake required'), 5000);
      socket.on('message', (data) => {
        this.receive(socket, String(data));
        if ([...this.clients.values()].some((client) => client.socket === socket)) clearTimeout(handshakeTimer);
      });
      socket.on('error', () => { /* close handles client removal and pending requests */ });
      socket.on('close', () => {
        clearTimeout(handshakeTimer);
        for (const [id, client] of this.clients) {
          if (client.socket === socket) { this.clients.delete(id); process.stderr.write(`[page-agent] Instance ${id} disconnected\n`); }
        }
        this.broadcastInstances();
        this.rejectForSocket(socket, new Error('目标 Chrome 插件实例已断开，操作结果可能未知，请检查页面后再重试'));
      });
    });
    this.server.on('listening', () => process.stderr.write(`[page-agent] Bridge listening at ws://127.0.0.1:${port}/extension\n`));
  }

  private broadcastInstances(): void {
    for (const relay of this.relays) if (relay.readyState === WebSocket.OPEN) relay.send(JSON.stringify({ type: 'instances', instances: this.instances }));
  }

  private async relayRequest(socket: WebSocket, raw: string): Promise<void> {
    let message: { id?: string; instanceId?: string; method?: string; params?: Record<string, unknown>; timeoutMs?: number };
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message.id !== 'string') return;
    const allowed = ['active_page', 'get_state', 'list_scripts', 'list_workflows', 'list_actions', 'run_script', 'run_workflow', 'run_action', 'create_workflow', 'get_workflow', 'edit_workflow', 'delete_node', 'export_workflow', 'import_workflow', 'inspect_page', 'debug_node', 'debug_workflow', 'get_debug_result', 'validate_workflow', 'capture_screenshot'];
    const instanceId = String(message.instanceId ?? '');
    const method = String(message.method ?? '');
    const run = method.startsWith('run_') || ['debug_node', 'debug_workflow', 'capture_screenshot'].includes(method);
    let locked = false;
    try {
      if (!allowed.includes(method)) throw new Error('不支持的 MCP 桥接操作');
      if (run && this.running.has(instanceId)) throw new Error('目标插件实例正在执行另一个工作流，请等待完成后再运行');
      if (run) { this.running.add(instanceId); locked = true; }
      const timeout = Math.max(1, Math.min(Number(message.timeoutMs) || 120_000, 31 * 60 * 1000));
      const result = await this.request(instanceId, method, message.params ?? {}, timeout);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, ok: true, result }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: message.id, ok: false, error: (error as Error).message, diagnostic: (error as Error & { diagnostic?: unknown }).diagnostic }));
    } finally { if (locked) this.running.delete(instanceId); }
  }

  get connected(): boolean {
    return this.instances.length > 0;
  }

  get instances(): Array<{ instanceId: string; version: string; connectedAt: string }> {
    return [...this.clients.values()].filter((client) => client.socket.readyState === WebSocket.OPEN)
      .map(({ instanceId, version, connectedAt }) => ({ instanceId, version, connectedAt }));
  }

  address(): AddressInfo | null { return this.server.address() as AddressInfo | null; }

  async close(): Promise<void> {
    for (const socket of this.server.clients) {
      this.rejectForSocket(socket, new Error('MCP Bridge 已关闭'));
      socket.terminate();
    }
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  private rejectForSocket(socket: WebSocket, error: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  private receive(socket: WebSocket, raw: string): void {
    let message: BridgeResponse;
    try { message = JSON.parse(raw) as BridgeResponse; }
    catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hello') {
      if (message.role !== 'extension' || typeof message.instanceId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.instanceId)) {
        socket.close(1008, 'Valid instanceId required; update the extension');
        return;
      }
      const owner = [...this.clients.values()].find((client) => client.socket === socket);
      if (owner) {
        if (owner.instanceId !== message.instanceId) socket.close(1008, 'Cannot change instance identity');
        return;
      }
      const existing = this.clients.get(message.instanceId);
      if (existing && existing.socket.readyState === WebSocket.OPEN) {
        socket.close(1008, 'Duplicate instanceId; use a distinct Chrome profile');
        return;
      }
      this.clients.set(message.instanceId, { socket, instanceId: message.instanceId, version: message.version ?? '', connectedAt: new Date().toISOString() });
      socket.send(JSON.stringify({ type: 'services', email: true, uploadNativePaths: true, serverVersion, protocolVersion: 1, clientOptions: { command: process.execPath, serverPath: fileURLToPath(new URL('./index.js', import.meta.url)) } }));
      this.broadcastInstances();
      process.stderr.write(`[page-agent] Instance ${message.instanceId} connected\n`);
      return;
    }
    if (message.type === 'inspect_upload_files' && message.id && [...this.clients.values()].some(client => client.socket === socket)) {
      const owner = [...this.clients.values()].find(client => client.socket === socket)!;
      const lock = `upload:${owner.instanceId}`;
      const reply = (data: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'upload_file_paths_result', id: message.id, ...data })); };
      if (this.running.has(lock)) { reply({ ok: false, error: '此插件实例正在读取上传文件，请等待' }); return; }
      this.running.add(lock);
      void inspectUploadFiles((message as BridgeResponse & { paths: unknown }).paths).then(result => reply({ ok: true, result })).catch((error: Error) => reply({ ok: false, error: error.message })).finally(() => this.running.delete(lock));
      return;
    }
    if (message.type === 'send_email' && message.id && [...this.clients.values()].some((client) => client.socket === socket)) {
      const owner = [...this.clients.values()].find((client) => client.socket === socket)!;
      const lock = `email:${owner.instanceId}`;
      if (this.running.has(lock)) { socket.send(JSON.stringify({ type: 'email_result', id: message.id, ok: false, error: '此插件实例正在发送另一封邮件，请等待，不要自动重发' })); return; }
      this.running.add(lock);
      const data = message as BridgeResponse & { config: unknown; message: unknown };
      void deliverEmail(data.config, data.message).then((result) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'email_result', id: message.id, ok: true, result })); }).catch((error: Error) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'email_result', id: message.id, ok: false, error: error.message })); }).finally(() => this.running.delete(lock));
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending || pending.socket !== socket) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(Object.assign(new Error(message.error ?? 'Extension bridge request failed'), { diagnostic: message.diagnostic }));
  }

  request(instanceId: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    if (!instanceId) return Promise.reject(new Error('必须指定 Chrome 插件 instanceId，不会自动选择其他实例'));
    const client = this.clients.get(instanceId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Chrome 插件实例未连接：${instanceId}。请在该实例加载插件，不会转发到其他 Chrome 实例。`));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Page Agent 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, socket: client.socket });
      client.socket.send(JSON.stringify({ id, instanceId, method, params }), (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }
}
