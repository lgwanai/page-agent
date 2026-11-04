# MCP 接入与编排

## 一键配置并启动

当前扩展 0.10.77 / MCP 0.10.21 的完整安装包不需要在插件内手动导入文件、填写路径或复制命令到终端：

1. 首次双击完整包中的 `Setup.command`（Mac）或 `Setup.cmd`（Windows）。Setup 自动注册当前目录的 Chrome 插件并将本机路径写入 `extension`。
2. Chrome 加载包内的 `extension` 目录，在插件 MCP 页面点击 **配置并启动**。
3. 打开插件也会自动检测。只有配置有效且实际连接成功时，一键操作才返回成功；连接超时或旧目录服务冲突会提示原因。

删除重加同一目录的插件不需要重新复制 ID 或安装命令。移动安装包或换用新版目录时，重新双击该目录的 Setup。首次本机安装无法由 Chrome 插件自行完成，这是浏览器的权限边界；只安装插件 ZIP 不会安装本机服务。

文件导入、手填路径和旧版启动器安装命令保留在折叠的 **高级设置与手动配置** 中用于排障。模型客户端仍需单独启用 stdio MCP 配置，插件不会修改其他客户端的配置文件。详见 [本机部署说明](../cross-platform-mcp.md)。

## 连接关系

Agent 客户端通过 stdio 启动本机 MCP 服务，服务通过本机桥接连接 Chrome 扩展。浏览器中的业务登录态保留在目标 Chrome 配置文件内。

```text
Agent 客户端 → stdio MCP 服务 → 本机桥接 → Chrome 扩展 → 目标网页
```

`ws://127.0.0.1:17373/extension` 是插件连接地址，不是应填写到客户端的 HTTP MCP 地址。扩展可通过一次性安装的本机启动器自动启动共享桥接，MCP 面板提供“配置并启动”按钮；“重试连接”只重连，不负责启动。

## 配置流程

1. 便携包运行 Setup，或源码环境按 [安装与升级](installation.md) 构建服务。
2. 完整包由 Setup 写入配置，插件点击“配置并启动”；源码环境用 `npm run mcp:config` 生成客户端 JSON，高级导入保留用于排障。
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

## 异步录屏：立即返回，随后查询

`mediaRecording` 节点不占用整段录制时长的 MCP 请求。Start 选择“保持当前页面”，录制节点使用 `record/start`，后接 Output 返回 `{{直播录制.statusUrl}}`。启动后即返回 `taskId`、`statusUrl`、`expiresAt`、`pollAfterMs`，节点成功仅表示任务已受理。

Agent 在运行 MCP 的同一台电脑每约 2 秒 GET 实际返回的 `statusUrl`：

| 状态 | 处理 |
| --- | --- |
| `recording` / `saving`，`done=false` | 等待 pollAfterMs 后继续查询 |
| `completed`，`done=true`，`success=true` | 使用 filePath 读取本机文件，或 GET fileUrl 下载 |
| `failed`，`done=true`，`success=false` | 查看 error；partialFile 是已录部分，不能当作完整定时任务成功 |
| `unavailable`，`done=false`，HTTP 503 | 扩展暂未连接或状态查询超时，稍后查询同一 URL |
| HTTP 410 | URL 已过期，本机已保存的文件不受影响 |

MCP 客户端断开、流程结束或取消后，已受理录制仍继续。需要停止时使用录制的 `stop` 节点或侧栏控制，然后继续查询同一 URL，直到磁盘保存确认。URL 包含随机访问令牌，最长有效 24 小时，保留最近 100 个任务；不能公开分享。云端 Agent 不能直接访问用户电脑的 127.0.0.1，须通过同机 HTTP 客户端拉取。

该 HTTP 接口不是新的 MCP 服务入口。它面向本机 HTTP 客户端，不提供跨域网页 fetch 接口。参数、权限、文件下载和完整输出示例见 [网页录制指南](../live-recording.md)，MCP 编辑示例见 [编排参考](../mcp-authoring.md#异步网页录制扩展-01077--mcp-01021)。

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
