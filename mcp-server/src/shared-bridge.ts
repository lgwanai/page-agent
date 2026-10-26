import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Instance = { instanceId: string; version: string; connectedAt: string };
export class SharedBridge {
  private socket?: WebSocket;
  private known: Instance[] = [];
  private capabilities: string[] = [];
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(private readonly port: number) {}
  get instances(): Instance[] { return this.known; }
  get connected(): boolean { return this.known.length > 0; }
  get available(): boolean { return this.socket?.readyState === WebSocket.OPEN; }

  async connect(startBroker = true): Promise<void> {
    try { await this.open(); return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' || !startBroker) throw error;
    }
    const child = spawn(process.execPath, [fileURLToPath(new URL('./broker.js', import.meta.url))], {
      detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, PAGE_AGENT_BRIDGE_PORT: String(this.port) },
    });
    const spawnError = new Promise<never>((_, reject) => child.once('error', reject));
    child.unref();
    await Promise.race([spawnError, (async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        try { await this.open(); return; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error; }
      }
      throw new Error(`无法启动本机共享 MCP 桥接服务（系统 ${process.platform}，Node ${process.execPath}，端口 ${this.port}）。请确认 broker.js 与 index.js 同目录，使用受支持的 Node，并检查端口占用及安全软件是否阻止 Node 本机连接。`);
    })()]);
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${this.port}/mcp-client`);
      let ready = false;
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('桥接握手超时，请检查 17373 端口是否被旧 MCP 服务占用')); }, 3000);
      socket.on('error', (error) => { clearTimeout(timer); if (!ready) reject(error); });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!ready) reject(new Error('当前端口上的服务不支持多客户端，请先关闭旧版 Page Agent MCP 服务，再重新连接所有工具'));
        if (this.socket === socket) { this.socket = undefined; this.known = []; this.rejectPending(); }
      });
      socket.on('message', (raw) => {
        let message: { type?: string; protocol?: number; capabilities?: string[]; instances?: Instance[]; id?: string; ok?: boolean; result?: unknown; error?: string; diagnostic?: unknown };
        try { message = JSON.parse(String(raw)); } catch { return; }
        if (message.type === 'broker_ready' && message.protocol === 1) {
          clearTimeout(timer); ready = true; this.socket = socket; this.known = message.instances ?? []; this.capabilities = message.capabilities ?? []; resolve(); return;
        }
        if (!ready) return;
        if (message.type === 'instances') { this.known = message.instances ?? []; return; }
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result); else pending.reject(Object.assign(new Error(message.error ?? 'MCP 桥接失败'), { diagnostic: message.diagnostic }));
      });
    });
  }

  private rejectPending(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('共享桥接连接中断，操作结果可能未知，请检查页面后重试')); }
    this.pending.clear();
  }
  request(instanceId: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<unknown> {
    if (method === 'capture_screenshot' && !this.capabilities.includes('page_screenshot_v1')) return Promise.reject(new Error('当前共享桥接是旧版本，尚不支持截图。请停止旧 Page Agent broker 后重新连接 MCP，以加载 v0.10.0。'));
    if (['create_workflow', 'get_workflow', 'edit_workflow', 'delete_node', 'export_workflow', 'import_workflow', 'inspect_page', 'debug_node', 'debug_workflow', 'get_debug_result', 'validate_workflow'].includes(method) && !this.capabilities.includes('workflow_authoring_v1')) return Promise.reject(new Error('当前共享桥接仍是旧版本。请停止旧 Page Agent broker 后重连 MCP 客户端，以加载 v0.9.0；现有执行工具仍可使用。'));
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('共享 MCP 桥接未连接，请重新连接此工具'));
    const socket = this.socket;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP 请求超时，操作结果可能未知')); }, timeoutMs + 1000);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, instanceId, method, params, timeoutMs }), (error) => {
        if (!error) return;
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
    });
  }
  close(): void { this.socket?.close(); this.rejectPending(); }
}
