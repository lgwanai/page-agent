#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ExtensionBridge } from './bridge.js';

const bridge = new ExtensionBridge(Number(process.env.PAGE_AGENT_BRIDGE_PORT || 17373));
const server = new McpServer({ name: 'page-agent', version: '0.5.0' });
const jsonObject = z.record(z.string(), z.unknown());
const RUN_TIMEOUT_MS = 31 * 60 * 1000;

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
  description: '在当前 Chrome 活动网页运行一个已保存的 Script。data 可传入 JSON 对象；Start 节点按参数名称直接映射并校验类型，后续节点通过 {{参数名}} 使用。',
  inputSchema: {
    scriptId: z.string().describe('Script ID 或准确名称'),
    data: jsonObject.optional().describe('传给 Start 节点的 JSON 数据，可包含对象、数组、数字和布尔值'),
    variables: jsonObject.optional().describe('兼容旧版的模板变量；与 data 同时传入时，data 中的同名字段优先'),
  },
}, async ({ scriptId, data, variables }) => {
  try { return text(await bridge.request('run_script', { scriptId, data: data ?? {}, variables: variables ?? {} }, RUN_TIMEOUT_MS)); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_action', {
  description: '在当前 Chrome 活动网页运行一个已保存的 Action。data 中与 Start 声明同名的字段会直接映射并校验类型。',
  inputSchema: {
    actionId: z.string().describe('Action ID 或准确名称'),
    data: jsonObject.optional().describe('传给 Start 节点的 JSON 数据'),
    variables: jsonObject.optional().describe('兼容旧版的模板变量；data 中的同名字段优先'),
  },
}, async ({ actionId, data, variables }) => {
  try { return text(await bridge.request('run_action', { actionId, data: data ?? {}, variables: variables ?? {} }, RUN_TIMEOUT_MS)); }
  catch (error) { return toolError(error); }
});

server.registerTool('get_page_agent_workspace', {
  description: '读取 Page Agent 已保存的 Action 与 Script 定义。未保存的编辑内容不会持久化或通过 MCP 暴露，也不会抓取目标网页 DOM。',
  inputSchema: {},
}, async () => {
  try { return text(await bridge.request('get_state')); }
  catch (error) { return toolError(error); }
});

await server.connect(new StdioServerTransport());
