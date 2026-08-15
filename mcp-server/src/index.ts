#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ExtensionBridge } from './bridge.js';

const bridge = new ExtensionBridge(Number(process.env.PAGE_AGENT_BRIDGE_PORT || 17373));
const server = new McpServer({ name: 'page-agent', version: '0.1.0' });

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
}

server.registerTool('page_agent_status', {
  description: '检查 Page Agent Chrome 插件是否已连接，并返回当前活动网页。',
  inputSchema: {},
}, async () => {
  if (!bridge.connected) return text({ connected: false, hint: '请启动插件并打开目标网页' });
  try { return text({ connected: true, activePage: await bridge.request('active_page') }); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_scripts', {
  description: '列出用户在 Page Agent 执行模式中保存的所有 Script。优先复用这些脚本，避免重新抓取和分析网页。',
  inputSchema: {},
}, async () => {
  try { return text(await bridge.request('list_scripts')); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_actions', {
  description: '列出 Page Agent 中可复用的 Action。Action 是一组已验证的网页操作。',
  inputSchema: {},
}, async () => {
  try { return text(await bridge.request('list_actions')); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_script', {
  description: '在当前 Chrome 活动网页运行一个已保存的 Script。scriptId 既可以传 ID，也可以传名称；变量会替换节点中的 {{变量名}}。',
  inputSchema: {
    scriptId: z.string().describe('Script ID 或准确名称'),
    variables: z.record(z.string(), z.string()).optional().describe('模板变量，例如 {"客户名":"华贸"}'),
  },
}, async ({ scriptId, variables }) => {
  try { return text(await bridge.request('run_script', { scriptId, variables: variables ?? {} })); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_action', {
  description: '在当前 Chrome 活动网页运行一个已保存的 Action。actionId 既可以传 ID，也可以传名称。',
  inputSchema: {
    actionId: z.string().describe('Action ID 或准确名称'),
    variables: z.record(z.string(), z.string()).optional().describe('模板变量'),
  },
}, async ({ actionId, variables }) => {
  try { return text(await bridge.request('run_action', { actionId, variables: variables ?? {} })); }
  catch (error) { return toolError(error); }
});

server.registerTool('get_page_agent_workspace', {
  description: '读取 Page Agent 当前的 Action、Script 与编排草稿定义。用于理解已有网页能力，不会抓取目标网页 DOM。',
  inputSchema: {},
}, async () => {
  try { return text(await bridge.request('get_state')); }
  catch (error) { return toolError(error); }
});

await server.connect(new StdioServerTransport());
