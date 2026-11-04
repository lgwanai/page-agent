# Page Agent

![Page Agent 标志](public/icons/page-agent-128.png)

把网页操作编排为可复用工作流，在 Chrome 侧栏运行，或交给 Agent 通过本机 MCP 调用。可沿用浏览器中的登录状态，录制业务操作、编辑节点和参数，并读取实际结果。

**当前版本：扩展 0.10.77 · MCP 0.10.21 · 文档核对 2026-11-04**

[使用手册](docs/README.md) · [快速上手](docs/guide/quick-start.md) · [节点目录](docs/nodes/README.md) · [离线 HTML 手册](docs/user-manual.html) · [更新记录](CHANGELOG.md)

## 当前能力

提供 **18 种节点类型、22 个 MCP 工具**。普通网页操作不需要配置模型。

| 能力 | 使用方式 |
| --- | --- |
| 录制与画布 | 录制点击、输入、选择、焦点、键盘与拖拽；支持手动新增、双语类型标签、整理、缩放和撤销/重做 |
| 网页交互 | 操作表单、日期时间区间、自定义下拉、原生弹窗，以及通过本机绝对路径上传文件 |
| 定位与恢复 | 保存元素身份、frame 文档和业务 URL 参数；支持 iframe 重建、已保存 Selector 修复和新标签页跟随 |
| 数据处理 | 检索、监控、数据表转 JSON/Excel、按 key 列填充表格和输出业务结果 |
| 流程控制 | 类型化输入参数、成功/失败分支、循环和分页内部子流程、达到结果后提前结束 |
| 外部交互 | HTTP/HTTPS 请求返回 Text/JSON、页面截图、SMTP 邮件与按需模型分析 |
| 网页音视频 | 网页画面与声音或仅声音；后台录制、自动停止、WebM 保存和异步状态 URL |
| MCP 编排 | 创建、读取、修改、删除节点、检查页面、校验、调试、导入导出和运行工作流 |
| 工作流管理 | 搜索、排序、标签、复制、重命名、回收站、JSON 迁移和本机草稿恢复 |
| 本机连接 | 完整包 Setup 注册启动器，插件一键“配置并启动”；多客户端共享桥接，按实例 ID 路由 |

路径上传、邮件和工作流异步录屏需要相应的本机 MCP 服务。模型分析、HTTP 请求和邮件使用实际配置的外部服务。全部节点及参数见 [节点指南](docs/nodes/README.md)。

## 安装与首次使用

需要 **Chrome 125 或更新版本**，操作目标为 HTTP/HTTPS 网页。扩展只录制当前目标标签页，不默认采集桌面或麦克风。

### 完整 Windows / Mac 包

1. 将完整包解压到固定目录；Windows 运行 `Setup.cmd`，Mac 运行 `Setup.command`。
2. 在 `chrome://extensions` 开启开发者模式，加载包内的 `extension/` 目录。
3. 打开侧栏，核对 Chrome 实际加载版本为 **0.10.77**；需要本机服务时点击 MCP 面板中的 **配置并启动**。
4. Agent 客户端另行导入 Setup 生成的 `page-agent-mcp.json` 并启用服务。

完整包内置 Node、MCP 服务及生产依赖，无需客户安装 npm 或构建。移动目录或升级到新目录后重新运行该目录的 Setup。扩展 ZIP 只包含扩展，需要已有本机服务才能使用对应能力。

### 从源码构建

使用与 CI 一致的 Node.js 22 和 npm：

```bash
npm ci
npm --prefix mcp-server ci
npm run mcp:build
npm run build
```

在 Chrome 加载 `dist/`。需要 MCP 时执行 `npm run mcp:config`，将生成配置合并到客户端的 `mcpServers`。插件面板显示实际服务路径、版本和连接状态。完整步骤见 [安装与升级](docs/guide/installation.md)。

本仓库保留源码和离线 HTML 手册，生成的安装包、Node 运行时及本机配置不提交 Git。已有交付包可直接使用，源码用户可按下方命令打包，见 [交付产物说明](deliverables/README.md)。

## 跑通第一个流程

1. 执行 `npm run docs:serve`，打开 `http://127.0.0.1:4180/examples/practice.html`。
2. 点击侧栏“创建工作流”，选择录制网页操作或手动画布。
3. 选中节点并点击“展开属性”，配置开始参数、网页操作和输出节点。
4. 保存并运行，核对逐步结果与最终 `output`。

可直接导入 [本地练习 JSON](docs/examples/README.md)。开始节点配置目标网址时每次重新导航；要保留已准备好的 SPA、弹层或直播，请开启 **保持当前页面，不刷新**。该模式直接复用当前页面，后续网页节点继续校验实际控件。

## 让 Agent 调用工作流

先通过 `list_page_agent_instances` 选择目标 Chrome 实例，再按工作流 ID 和密钥调用 `run_page_workflow`：

```json
{
  "instanceId": "<目标插件实例 UUID>",
  "workflowId": "<工作流 UUID>",
  "key": "<该工作流密钥>",
  "data": {"姓名": "张三"}
}
```

Agent 可通过 `get_page_workflow_toolkit` 获取模板，再创建、编辑和调试流程。名称不能代替 UUID；MCP 不读取手动运行参数的历史记忆。`ws://127.0.0.1:17373/extension` 是插件桥接地址，客户端使用 stdio 配置。详见 [MCP 接入](docs/guide/mcp.md) 和 [编排参考](docs/mcp-authoring.md)。

## 异步录屏与直播录制

1. 打开具体直播间，开始播放并取消播放器静音；在该网页点击工具栏 Page Agent 图标取得采集权限。
2. 手动录制可直接使用侧栏“录屏与录音”；Agent 流程使用 `mediaRecording` 节点，并让开始节点保持当前页面。
3. `record/start` 启动后立即返回 `taskId`、`statusUrl`、`expiresAt` 和 `pollAfterMs`。后续 Output 可返回 `{{直播录制.statusUrl}}`。
4. Agent 在运行 MCP 的同一台电脑轮询该 URL；只有 `done=true` 且 `success=true` 才算最终成功，此时可读取 `filePath` 和下载 `fileUrl`。

录制在关闭侧栏、MCP 客户端断开或工作流结束后继续；需要停止时使用停止节点或侧栏控制。每实例同时一段，最长 30 分钟。URL 最长有效 24 小时，服务保留最近 100 个任务。WebM 保存于 Chrome 下载目录的 `PageAgent/`，不将视频 Base64 放进 MCP 文本结果。

2026-11-03 的 Mac 真机抖音实录中，180 秒任务在 **101 ms** 返回 URL，断开客户端后完成，下载的 **60,242,473 字节**与 Chrome 保存文件 SHA-256 一致。Windows 包与平台分支已检查，**Windows 真机录制及中文路径编码仍待验收**。参数、失败状态、录制边界及验证记录见 [网页录制指南](docs/live-recording.md)。

## 开发、验证与打包

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元与集成测试 |
| `npm run lint` | TypeScript/React 静态检查 |
| `npm run build` / `npm run mcp:build` | 构建扩展 / 本机 MCP 服务 |
| `npm run test:e2e` | 独立 Chromium 扩展端到端测试；先构建扩展与 MCP，并安装 Playwright Chromium |
| `npm run release:extension` | 生成版本化扩展 ZIP |
| `npm run package:windows` | 生成 Windows x64 完整包；可用 `-- --arm64` 指定架构 |
| `npm run package:mac` | 生成 Apple 芯片和 Intel Mac 完整包；可单独指定 `-- --arm64` 或 `-- --x64` |
| `npm run docs:build` / `npm run docs:check` | 生成并校验离线手册、链接、节点覆盖和示例 |
| `npm run docs:serve` | 在本机 `127.0.0.1:4180` 提供手册与练习页 |

交付包使用固定版本的官方 Node 运行时并校验 SHA-256，只包含锁定的生产依赖。构建过程需要下载运行时；客户使用完整包无需再次下载开发依赖。验证范围见 [录制指南](docs/live-recording.md) 和 [跨系统部署](docs/cross-platform-mcp.md)。

## 文档与使用边界

- [使用手册](docs/README.md)：安装、画布、参数、运行、节点和排障。
- [数据与权限](docs/guide/data-and-permissions.md)：存储位置、录制访问令牌和数据流向。
- [限制速查](docs/reference/limits.md)：步数、容量、时长、并发和状态 URL 保留策略。
- [工作流 JSON 规范](docs/workflow-spec.md)：导入导出格式、字段和兼容性。
- [文档维护](docs/reference/documentation.md)：更新内容源、生成 HTML 和检查流程。

页面操作沿用当前账号权限。`ok` 表示流程执行情况，`businessOk` 表示显式业务结果；异步录制还须检查任务最终状态。导出文件不包含全局 AI/SMTP 配置和工作流密钥，显式填在节点中的令牌、正文和业务值仍会导出。

扩展新代码发布遵循 [版本同步规则](AGENTS.md)。历史发布说明见 [CHANGELOG](CHANGELOG.md)，[早期企业评估](docs/enterprise/README.md) 保留当时基线；当前操作以本手册与运行中的工具包为准。
