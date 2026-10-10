import { MCP_BRIDGE_PORT, type McpClientOptions } from '@/types/mcp';

const STORAGE_KEY = 'pageAgentMcpClientOptionsV1';
export const DEFAULT_MCP_OPTIONS: McpClientOptions = typeof __PAGE_AGENT_LOCAL_MCP__ !== 'undefined'
  ? { ...__PAGE_AGENT_LOCAL_MCP__ }
  : { command: 'node', serverPath: '' };

export function mcpOptionsError(options: McpClientOptions): string | null {
  if (!options.command.trim() || /[\r\n]/.test(options.command)) return '请填写 Node 命令或 Node 可执行文件的完整路径';
  if (!options.serverPath.trim()) return '请填写本机 mcp-server/dist/index.js 的完整路径';
  if (!/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)/i.test(options.serverPath.trim()) || /[\r\n]/.test(options.serverPath)) {
    return '服务脚本必须使用完整路径，不能使用相对路径或 ~';
  }
  return null;
}

export function buildMcpClientConfig(options: McpClientOptions) {
  const error = mcpOptionsError(options);
  if (error) throw new Error(error);
  return { mcpServers: { 'page-agent': {
    command: options.command.trim(),
    args: [options.serverPath.trim()],
    env: { PAGE_AGENT_BRIDGE_PORT: String(MCP_BRIDGE_PORT) },
  } } };
}

export async function loadMcpOptions(): Promise<McpClientOptions> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<McpClientOptions> | undefined;
  return {
    command: typeof stored?.command === 'string' && stored.command.trim() ? stored.command.trim() : DEFAULT_MCP_OPTIONS.command,
    serverPath: typeof stored?.serverPath === 'string' && stored.serverPath.trim() ? stored.serverPath.trim() : DEFAULT_MCP_OPTIONS.serverPath,
  };
}

export async function saveMcpOptions(options: McpClientOptions): Promise<void> {
  const error = mcpOptionsError(options);
  if (error) throw new Error(error);
  await chrome.storage.local.set({ [STORAGE_KEY]: { command: options.command.trim(), serverPath: options.serverPath.trim() } });
}
