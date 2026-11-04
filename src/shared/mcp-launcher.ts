import { isWindowsHost, mcpOptionsError, normalizeMcpPath } from './mcp-config';
import type { McpClientOptions } from '@/types/mcp';

/** Install only the launcher shipped alongside the configured MCP entry point. */
export function nativeLauncherInstallCommand(options: McpClientOptions, extensionId: string, windows = isWindowsHost()): string {
  const issue = mcpOptionsError(options);
  if (issue) throw new Error(issue);
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('无法读取当前 Chrome 插件 ID，请重新打开插件');
  const server = normalizeMcpPath(options.serverPath);
  if (!/(?:^|[\\/])index\.js$/.test(server)) throw new Error('启动器需要本机 mcp-server/dist/index.js 配置');
  const launcher = server.replace(/index\.js$/, 'native-host.js');
  // PowerShell single-quoted strings prevent interpolation of $, `, %, and spaces.
  const quote = windows ? (value: string) => `'${value.replaceAll("'", "''")}'` : (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `${windows ? '& ' : ''}${quote(normalizeMcpPath(options.command))} ${quote(launcher)} --install ${extensionId}`;
}
