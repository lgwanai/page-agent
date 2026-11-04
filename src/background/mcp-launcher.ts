import type { McpClientOptions } from '@/types/mcp';
import { mcpOptionsError } from '@/shared/mcp-config';
export const NATIVE_HOST = 'com.page_agent.launcher';
let pending: Promise<McpClientOptions | undefined> | undefined;

/** Coalesce automatic and manual requests; no executable paths cross this boundary. */
export function launchMcpServer(): Promise<McpClientOptions | undefined> {
  if (pending) return pending;
  pending = (async () => {
    if (!chrome.runtime.sendNativeMessage) throw new Error('当前环境不支持本机启动器，请在 MCP 客户端启动服务');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'ensure_server' }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('本机启动器响应超时，请检查本机服务后重试')), 15000); }),
      ]);
      if (response?.ok !== true) throw new Error(response?.error || '本机启动器未确认服务已就绪');
      if (response.clientOptions !== undefined) {
        const options = response.clientOptions as McpClientOptions;
        if (typeof options.command !== 'string' || typeof options.serverPath !== 'string' || mcpOptionsError(options)) throw new Error('本机启动器返回的服务路径无效，请重新运行完整安装包中的 Setup');
        return options;
      }
      return undefined; // Compatibility with the v0.10.18 launcher.

    } catch (error) {
      const message = (error as Error).message;
      if (/not found|not registered|forbidden|access.*denied|does not exist/i.test(message)) throw new Error('尚未安装本机启动器，或加载的插件目录与安装包不一致。请双击完整安装包中的 Setup.command（Mac）或 Setup.cmd（Windows）一次，再加载包内 extension 并点击「配置并启动」。无需手动导入文件或执行终端命令。');
      throw new Error(`本机服务启动失败：${message}`);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  })().finally(() => { pending = undefined; });
  return pending;
}
