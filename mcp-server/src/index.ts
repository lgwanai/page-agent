#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SharedBridge } from './shared-bridge.js';

const bridge = new SharedBridge(Number(process.env.PAGE_AGENT_BRIDGE_PORT || 17373));
const server = new McpServer({ name: 'page-agent', version: '0.8.1' });
let connecting: Promise<void> | undefined;
async function ensureBridge(): Promise<void> {
  if (bridge.available) return;
  if (!connecting) connecting = bridge.connect().finally(() => { connecting = undefined; });
  await connecting;
}
const jsonObject = z.record(z.string(), z.unknown());
const instanceSchema = { instanceId: z.string().uuid().describe('目标 Chrome 插件实例 ID，可从插件复制或通过 list_page_agent_instances 查询') };
const RUN_TIMEOUT_MS = 31 * 60 * 1000;

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
}

server.registerTool('page_agent_status', {
  description: '列出已连接的 Chrome 插件实例；提供 instanceId 时检查该实例并读取其活动网页，不会自动选择其他实例。',
  inputSchema: { instanceId: instanceSchema.instanceId.optional() },
}, async ({ instanceId }) => {
  try { await ensureBridge(); }
  catch (error) { return text({ connected: false, instances: [], error: (error as Error).message }); }
  const instances = bridge.instances;
  if (!instanceId) return text({ connected: bridge.connected, instances, hint: '使用目标 instanceId 调用工作流；未安装或未连接的 Chrome 不会出现在此列表中' });
  if (!instances.some((item) => item.instanceId === instanceId)) return text({ connected: false, instanceId, instances });
  try { return text({ connected: true, instanceId, activePage: await bridge.request(instanceId, 'active_page') }); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_agent_instances', {
  description: '列出已连接的 Chrome 插件实例 ID、版本和连接时间。所有工作流操作必须显式指定目标 instanceId。',
  inputSchema: {},
}, async () => {
  try { await ensureBridge(); return text(bridge.instances); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_scripts', {
  description: '兼容旧名称：列出 Page Agent 中保存的工作流及其全局唯一 ID，不返回安全密钥。',
  inputSchema: instanceSchema,
}, async ({ instanceId }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'list_scripts')); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_workflows', {
  description: '列出指定 Chrome 插件实例中保存的工作流，返回实例 ID 和工作流 ID；执行时还需要对应密钥。',
  inputSchema: instanceSchema,
}, async ({ instanceId }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'list_workflows')); }
  catch (error) { return toolError(error); }
});

server.registerTool('list_page_actions', {
  description: '列出 Page Agent 中可复用的 Action。Action 是一组已验证的网页操作。',
  inputSchema: instanceSchema,
}, async ({ instanceId }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'list_actions')); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_script', {
  description: '兼容旧名称：通过全局唯一 ID 和密钥运行已保存工作流。data 会按 Start 节点声明映射。',
  inputSchema: {
    ...instanceSchema,
    scriptId: z.string().describe('工作流的全局唯一 ID，不支持名称'),
    key: z.string().min(1).describe('该工作流对应的访问密钥'),
    data: jsonObject.optional().describe('传给 Start 节点的 JSON 数据，可包含对象、数组、数字和布尔值'),
    variables: jsonObject.optional().describe('兼容旧版的模板变量；与 data 同时传入时，data 中的同名字段优先'),
  },
}, async ({ instanceId, scriptId, key, data, variables }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'run_script', { scriptId, key, data: data ?? {}, variables: variables ?? {} }, RUN_TIMEOUT_MS)); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_workflow', {
  description: '仅在指定 instanceId 的 Chrome 插件中，通过 workflowId 和密钥运行工作流。目标未连接时拒绝执行，不会切换到其他实例。data 按 Start 同名参数映射。',
  inputSchema: {
    ...instanceSchema,
    workflowId: z.string().uuid().describe('工作流全局唯一 ID'),
    key: z.string().min(1).describe('工作流列表中由用户复制的访问密钥'),
    data: jsonObject.optional().describe('传给 Start 节点的 JSON 数据'),
    variables: jsonObject.optional().describe('兼容旧版的模板变量；data 中的同名字段优先'),
  },
}, async ({ instanceId, workflowId, key, data, variables }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'run_workflow', { workflowId, key, data: data ?? {}, variables: variables ?? {} }, RUN_TIMEOUT_MS)); }
  catch (error) { return toolError(error); }
});

server.registerTool('run_page_action', {
  description: '在当前 Chrome 活动网页运行一个已保存的 Action。data 中与 Start 声明同名的字段会直接映射并校验类型。',
  inputSchema: {
    ...instanceSchema,
    actionId: z.string().describe('Action ID 或准确名称'),
    data: jsonObject.optional().describe('传给 Start 节点的 JSON 数据'),
    variables: jsonObject.optional().describe('兼容旧版的模板变量；data 中的同名字段优先'),
  },
}, async ({ instanceId, actionId, data, variables }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'run_action', { actionId, data: data ?? {}, variables: variables ?? {} }, RUN_TIMEOUT_MS)); }
  catch (error) { return toolError(error); }
});

server.registerTool('get_page_agent_workspace', {
  description: '读取 Page Agent 已保存的 Action 与工作流定义。不会返回访问密钥；未保存编辑内容也不会持久化或通过 MCP 暴露。',
  inputSchema: instanceSchema,
}, async ({ instanceId }) => {
  try { await ensureBridge(); return text(await bridge.request(instanceId, 'get_state')); }
  catch (error) { return toolError(error); }
});

server.server.onclose = () => { bridge.close(); process.exit(0); };
await server.connect(new StdioServerTransport());
// MCP initialization must not depend on the browser bridge being available.
// Report a conflicting legacy broker as a tool error, never close stdio.
void ensureBridge().catch((error) => process.stderr.write(`[page-agent] ${(error as Error).message}\n`));
