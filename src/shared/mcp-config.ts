import { MCP_BRIDGE_PORT, type McpClientOptions } from '@/types/mcp';

const STORAGE_KEY = 'pageAgentMcpClientOptionsV1';
const OVERRIDE_KEY = 'pageAgentMcpClientOverrideV1';
const BUILD_MCP_OPTIONS: McpClientOptions = { command: 'node', serverPath: '' };

export function isWindowsHost(): boolean {
  return typeof navigator !== 'undefined' && /Windows|Win32|Win64/i.test(navigator.userAgent + navigator.platform);
}

export function normalizeMcpPath(value: string): string {
  const trimmed = value.trim();
  // Windows “Copy as path” includes surrounding quotes; spawn already handles spaces.
  return /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

export function mcpOptionsForHost(options: McpClientOptions, windows = isWindowsHost()): McpClientOptions {
  const command = normalizeMcpPath(options.command);
  const serverPath = normalizeMcpPath(options.serverPath);
  const foreign = (path: string) => windows ? path.startsWith('/') : /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
  return { command: foreign(command) ? 'node' : command, serverPath: foreign(serverPath) ? '' : serverPath };
}

export const DEFAULT_MCP_OPTIONS = mcpOptionsForHost(BUILD_MCP_OPTIONS);

export function mcpOptionsError(options: McpClientOptions): string | null {
  options = { command: normalizeMcpPath(options.command), serverPath: normalizeMcpPath(options.serverPath) };
  if (!options.command.trim() || /[\r\n]/.test(options.command)) return '请填写 Node 命令或 Node 可执行文件的完整路径';
  if (!options.serverPath.trim()) return '请填写本机 mcp-server/dist/index.js 的完整路径';
  if (/(?:^|[\\/])(?:完整路径|你的用户名|path-to-project)(?:[\\/]|$)/i.test(options.serverPath)) return '尚未配置：不能使用占位目录，请导入本机生成的配置';
  if (isWindowsHost() && (options.command.startsWith('/') || options.serverPath.startsWith('/'))) return '当前是 Windows，但配置使用了 macOS/Linux 路径。请在这台电脑的项目根目录运行 npm run mcp:config，或填写本机 node.exe 和服务脚本路径';
  if (/\.(?:cmd|bat)$/i.test(options.command)) return '请使用 node 或 node.exe，不要使用 npm.cmd/npx.cmd；部分 MCP 客户端不能直接启动 Windows 批处理文件';
  if (!/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)/i.test(options.serverPath.trim()) || /[\r\n]/.test(options.serverPath)) {
    return '服务脚本必须使用完整路径，不能使用相对路径或 ~';
  }
  return null;
}

export function buildMcpClientConfig(options: McpClientOptions) {
  const error = mcpOptionsError(options);
  if (error) throw new Error(error);
  return { mcpServers: { 'page-agent': {
    command: normalizeMcpPath(options.command),
    args: [normalizeMcpPath(options.serverPath)],
    env: { PAGE_AGENT_BRIDGE_PORT: String(MCP_BRIDGE_PORT) },
  } } };
}

interface SetupConfiguration { options: McpClientOptions; revision: string | null }
async function readSetupOptions(): Promise<SetupConfiguration | undefined> {
  // The setup program writes this file next to the unpacked extension manifest.
  // Never infer customer paths from the machine that built the release.
  if (chrome.runtime?.getURL) {
    try {
      const response = await fetch(chrome.runtime.getURL('mcp-local-config.json'), { cache: 'no-store' });
      if (response.ok) {
        const config = await response.json();
        return { options: parseMcpClientConfig(config), revision: typeof config.pageAgentSetup?.revision === 'string' ? config.pageAgentSetup.revision : null };
      }
    } catch { /* Not installed/configured yet; allow explicit local configuration. */ }
  }
  return undefined;
}

const signature = (options?: McpClientOptions) => options ? JSON.stringify([normalizeMcpPath(options.command), normalizeMcpPath(options.serverPath)]) : null;
const setupSignature = (setup?: SetupConfiguration) => setup ? JSON.stringify([signature(setup.options), setup.revision]) : null;
export function sameMcpOptions(a: McpClientOptions, b: McpClientOptions): boolean {
  const path = (value: string) => isWindowsHost() ? normalizeMcpPath(value).replaceAll('\\', '/').toLowerCase() : normalizeMcpPath(value);
  return path(a.command) === path(b.command) && path(a.serverPath) === path(b.serverPath);
}

export async function loadMcpConfiguration(): Promise<{ options: McpClientOptions; source: 'setup' | 'saved' | 'unconfigured' }> {
  const setup = await readSetupOptions();
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<McpClientOptions> | undefined;
  const override = (await chrome.storage.local.get(OVERRIDE_KEY))[OVERRIDE_KEY] as { optionsSignature?: string; setupSignature?: string | null } | undefined;
  const options = mcpOptionsForHost({
    command: typeof stored?.command === 'string' && stored.command.trim() ? stored.command.trim() : DEFAULT_MCP_OPTIONS.command,
    serverPath: typeof stored?.serverPath === 'string' && stored.serverPath.trim() ? stored.serverPath.trim() : DEFAULT_MCP_OPTIONS.serverPath,
  });
  const savedValid = !mcpOptionsError(options);
  // A deliberate import is bound to the Setup it replaced. Loading a different
  // package (new generated paths) invalidates that override, but legacy saved
  // values must never displace a newly generated Setup configuration.
  if (savedValid && (!setup || override?.optionsSignature === signature(options) && override?.setupSignature === setupSignature(setup))) return { options, source: 'saved' };
  if (setup) return { options: setup.options, source: 'setup' };
  return { options: { ...DEFAULT_MCP_OPTIONS }, source: 'unconfigured' };
}

export async function loadMcpOptions(): Promise<McpClientOptions> {
  return (await loadMcpConfiguration()).options;
}

export function parseMcpClientConfig(value: unknown): McpClientOptions {
  const entry = (value as { mcpServers?: Record<string, { command?: unknown; args?: unknown; env?: Record<string, unknown> }> })?.mcpServers?.['page-agent'];
  if (!entry || typeof entry.command !== 'string' || !Array.isArray(entry.args) || entry.args.length !== 1 || typeof entry.args[0] !== 'string') throw new Error('请选择本机生成的 page-agent-mcp.json');
  if (entry.env?.PAGE_AGENT_BRIDGE_PORT !== undefined && String(entry.env.PAGE_AGENT_BRIDGE_PORT) !== String(MCP_BRIDGE_PORT)) throw new Error('配置端口必须与插件本机桥接端口一致');
  const options = mcpOptionsForHost({ command: entry.command, serverPath: entry.args[0] });
  const issue = mcpOptionsError(options);
  if (issue) throw new Error(issue);
  return options;
}

export async function saveMcpOptions(options: McpClientOptions): Promise<void> {
  const error = mcpOptionsError(options);
  if (error) throw new Error(error);
  const normalized = { command: normalizeMcpPath(options.command), serverPath: normalizeMcpPath(options.serverPath) };
  const setup = await readSetupOptions();
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized, [OVERRIDE_KEY]: { optionsSignature: signature(normalized), setupSignature: setupSignature(setup) } });
}
