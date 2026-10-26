# MCP 接入与编排

## 连接关系

Agent 客户端通过 stdio 启动本机 MCP 服务，服务通过本机桥接连接 Chrome 扩展。浏览器中的业务登录态保留在目标 Chrome 配置文件内。

```text
Agent 客户端 → stdio MCP 服务 → 本机桥接 → Chrome 扩展 → 目标网页
```

`ws://127.0.0.1:17373/extension` 是插件连接地址，不是应填写到客户端的 HTTP MCP 地址。插件不能自行启动 Node 服务；“重试连接”也不能代替启动服务。

## 配置流程

1. 便携包运行 Setup，或源码环境按 [安装与升级](installation.md) 构建服务。
2. 在本机生成 `page-agent-mcp.json`，或在插件“MCP”面板导入本机配置。
3. 将 JSON 的 `page-agent` 条目合并到客户端的 `mcpServers`；保留其他已有服务。
4. 在客户端启用/重启服务，回到侧栏确认 MCP 已连接。
5. 用 `list_page_agent_instances` 选择目标实例，再读取或运行目标流程。

```json
{
  "mcpServers": {
    "page-agent": {
      "command": "<本机 node 或 node.exe 完整路径>",
      "args": ["<本机 mcp-server/dist/index.js 完整路径>"],
      "env": {"PAGE_AGENT_BRIDGE_PORT":"17373"}
    }
  }
}
```

JSON 字符串中的 Windows 反斜线需要转义；优先使用 Setup 或 `npm run mcp:config` 生成配置。路径含空格时不要在字段内部额外加引号，也不要把 `npm.cmd` 当作 Node 可执行文件。

多个客户端可共享桥接。更新版本或移动目录时，重新生成本机配置并检查面板显示的实际服务路径；停止旧桥接前确认没有流程在执行，不要结束所有 Node 进程。

## 调用已保存流程

从列表复制“运行 Prompt”是最直接的方式；也可明确调用：

```json
{
  "instanceId":"<目标 Chrome 实例>",
  "workflowId":"<工作流 UUID>",
  "key":"<该工作流密钥>",
  "data":{"姓名":"张三"}
}
```

工具名为 `run_page_workflow`。名称不能代替工作流 UUID；参数以开始节点声明为准。MCP 不会补用手动运行的历史参数。

## 创建与修改

推荐顺序：`get_page_workflow_toolkit` → `create_page_workflow` → `inspect_page_content` → `edit_page_workflow` → `validate_page_workflow` → 单节点调试 → 完整调试。

先读取工具包获取当前节点模板和端口。每次修改前读取最新 `updatedAt`，以 `expectedUpdatedAt` 提交；冲突时重新读取和合并。修改接口会直接保存，不需要再点击侧栏保存。

`delete_page_node` 可删除指定节点并清理关联连线；容器删除包含内部节点，不自动重连前后节点。当前工具清单没有独立的工作流删除工具；删除整个流程使用侧栏“删除工作流”。

## 工具速查

| 场景 | 工具 |
| --- | --- |
| 实例与状态 | `list_page_agent_instances`、`page_agent_status` |
| 工作流列表与执行 | `list_page_workflows`、`run_page_workflow` |
| 节点模板与说明 | `get_page_workflow_toolkit` |
| 新建、读取、修改 | `create_page_workflow`、`get_page_workflow`、`edit_page_workflow` |
| 删除节点、结构检查 | `delete_page_node`、`validate_page_workflow` |
| 导入、导出 | `import_page_workflow`、`export_page_workflow` |
| 页面与 frame 读取 | `inspect_page_content` |
| 调试与最近结果 | `debug_page_node`、`debug_page_workflow`、`get_page_debug_result` |
| 独立截图 | `capture_page_screenshot` |
| 兼容接口 | `list_page_scripts`、`run_page_script`、`list_page_actions`、`run_page_action`、`get_page_agent_workspace` |

## iframe 与调试上下文

先用 `inspect_page_content(listFrames=true)` 读取当前 frame，再按 `frameId` 或 `frameUrl` 选择文档。不要把某次检查得到的数字 frame ID 当作长期身份。

`debug_page_node` 的 `data` 用于运行参数，`context` 用于前置节点输出；完整调试从开始节点执行。后者会产生真实网页操作，请先核对入口和参数。

完整字段与调用示例见 [MCP 编排参考](../mcp-authoring.md)。
