#!/usr/bin/env node
// Run on the destination machine: never reuse the build machine's paths.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const serverPath = fileURLToPath(new URL('../mcp-server/dist/index.js', import.meta.url));
if (!existsSync(serverPath)) {
  console.error('MCP 服务尚未构建。请先在项目根目录执行 npm --prefix mcp-server install，然后执行 npm run mcp:build。');
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ mcpServers: { 'page-agent': {
    command: process.execPath,
    args: [serverPath],
    env: { PAGE_AGENT_BRIDGE_PORT: '17373' },
  } } }, null, 2));
}
