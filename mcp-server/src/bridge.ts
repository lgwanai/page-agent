import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface BridgeResponse {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: string;
  type?: string;
  role?: string;
}

export class ExtensionBridge {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly server: WebSocketServer;

  constructor(port = 17373) {
    this.server = new WebSocketServer({ port, host: '127.0.0.1' });
    this.server.on('connection', (socket, request) => {
      if (request.url !== '/extension') {
        socket.close(1008, 'Only extension clients are allowed');
        return;
      }
      this.socket?.close(1000, 'Replaced by a new extension connection');
      this.socket = socket;
      process.stderr.write('[page-agent] Chrome extension connected\n');
      socket.on('message', (data) => this.receive(String(data)));
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null;
        process.stderr.write('[page-agent] Chrome extension disconnected\n');
      });
    });
    this.server.on('listening', () => process.stderr.write(`[page-agent] Bridge listening at ws://127.0.0.1:${port}/extension\n`));
  }

  get connected(): boolean {
    return this.socket?.readyState === this.socket?.OPEN;
  }

  private receive(raw: string): void {
    let message: BridgeResponse;
    try { message = JSON.parse(raw) as BridgeResponse; }
    catch { return; }
    if (message.type === 'hello') return;
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error ?? 'Extension bridge request failed'));
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    if (!this.connected || !this.socket) {
      return Promise.reject(new Error('Page Agent Chrome 插件未连接。请打开 Chrome、加载插件，并保持目标网页打开。'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Page Agent 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }
}
