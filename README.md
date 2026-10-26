# Page Agent

将网页操作录制、编排为可重复执行的工作流，通过 Chrome 侧栏手动运行，或由 Agent 通过本机 MCP 调用。

**当前基线：扩展 0.10.66 · MCP 0.10.17 · 文档核对 2026-10-27**

[使用手册](docs/README.md) · [快速上手](docs/guide/quick-start.md) · [节点指南](docs/nodes/README.md) · [离线 HTML 手册](docs/user-manual.html) · [更新记录](CHANGELOG.md)

## 能做什么

| 能力 | 使用方式 |
| --- | --- |
| 录制与编辑 | 录制网页操作，或在画布手动创建；可折叠属性栏、自动整理、缩放和撤销/重做 |
| 网页交互 | 输入、点击、选择、勾选、焦点、滚动、拖动、键盘事件和本机路径上传 |
| 定位与恢复 | 录制和选取使用一致的定位信息，支持 iframe 重建与已有 Selector 自动修复 |
| 数据处理 | 检索、条件监控、原生数据表转 JSON/Excel、按 key 列填充表格、输出业务结果 |
| 流程控制 | 参数化开始节点、等待、循环与分页内部子流程、成功/失败分支 |
| 外部交互 | HTTP 请求返回 Text/JSON，原生弹窗应答、日期时间选择、截图与邮件 |
| 智能分析 | 按需调用配置的模型，使用网页、前置节点或文本输入 |
| MCP | 创建、读取、编辑、删除节点、校验、调试、导入导出和运行工作流 |
| 工作流管理 | 搜索、排序、标签、复制、重命名、回收站、JSON 迁移与本机恢复草稿 |

普通网页操作不需要 AI。路径上传与邮件需要相应本机 MCP 服务；模型分析、HTTP 请求、邮件和网页提交分别使用实际配置的外部服务。

## 安装

已有扩展包时，完整解压，在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载直接包含 `manifest.json` 的目录。打开侧栏核对实际版本，操作目标应为 HTTP/HTTPS 网页。

源码构建使用 Node.js 20 或更新版本：

```bash
npm ci
npm run build
```

在 Chrome 加载生成的 `dist/`。若使用维护者提供的完整便携包，按包内 Setup 操作，无需重新安装依赖或构建。安装、平台差异及升级路径见 [安装与升级](docs/guide/installation.md)。

## 跑通第一个流程

1. 打开测试网页和 Page Agent 侧栏，点击“创建工作流”。
2. 选择录制，或在手动画布中配置开始节点、添加网页操作。
3. 选中节点，再点下方“展开属性”，配置参数与事件。
4. 连接输出节点，验证实际结果，保存并从列表运行。

可以使用 [本地练习页与示例 JSON](docs/examples/README.md) 学习，无需对真实业务系统提交操作。完整步骤见 [快速上手](docs/guide/quick-start.md)。

## MCP 接入

在项目根目录构建服务并生成当前电脑的配置：

```bash
npm --prefix mcp-server ci
npm run mcp:build
npm run mcp:config
```

将生成的 `page-agent` 条目合并到客户端的 `mcpServers`，启用服务后，用 `list_page_agent_instances` 核对目标实例。执行流程需 `instanceId`、`workflowId` 和 `key`，输入通过 `data` 按开始节点声明传入。

侧栏“MCP”面板可查看实际服务路径、版本与状态。`ws://127.0.0.1:17373/extension` 是插件桥接地址，不是客户端 HTTP MCP 地址。不要沿用其他电脑的路径。

阅读：[MCP 接入](docs/guide/mcp.md) · [编排参考](docs/mcp-authoring.md) · [工作流 JSON 规范](docs/workflow-spec.md)。

## 文档与使用手册

- **入门和日常操作**：[手册首页](docs/README.md)、[编辑与录制](docs/guide/editor.md)、[参数变量](docs/guide/variables.md)、[工作流管理](docs/guide/workflows.md)。
- **配置与运行**：[全部节点](docs/nodes/README.md)、[运行调试](docs/guide/execution.md)、[故障排查](docs/guide/troubleshooting.md)。
- **部署与参考**：[数据与权限](docs/guide/data-and-permissions.md)、[限制](docs/reference/limits.md)、[术语](docs/reference/glossary.md)。
- **交付阅读**：[可搜索、可打印的离线 HTML](docs/user-manual.html)；分章 Markdown 是内容源。
- **历史资料**：[CHANGELOG](CHANGELOG.md)、[早期企业技术评估](docs/enterprise/README.md)。历史资料不作为当前完整接口清单。

## 开发与文档命令

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元与集成测试 |
| `npm run test:e2e` | 独立 Chromium 扩展端到端测试，需先构建扩展与 MCP |
| `npm run lint` | TypeScript/React 源码静态检查 |
| `npm run build` | 检查类型并构建扩展 |
| `npm run mcp:build` | 构建本机 MCP 服务 |
| `npm run release:extension` | 构建并生成版本化扩展 ZIP |
| `npm run docs:build` | 从 Markdown 生成离线使用手册与文档包 |
| `npm run docs:check` | 检查链接、类型覆盖、示例与生成结果 |
| `npm run docs:serve` | 在 `127.0.0.1:4180` 提供手册和只读练习页 |

扩展、MCP 与文档分别按实际变更维护。插件代码发布遵循 [AGENTS.md](AGENTS.md) 的版本同步规则；文档更新不等同于发布新插件代码。

## 使用边界

页面操作沿用当前账号权限，可能产生真实业务影响。事件执行、业务目标达成与服务器接收是不同结果；使用输出和监控进行验收，结果未知时先确认状态再决定是否重跑。

导出 JSON 不包含工作流密钥、全局 AI/SMTP 配置，但显式写入节点的令牌、正文或业务数据仍会导出。没有统一企业账号、RBAC 或应用层密钥保险库；实际数据范围见 [数据与权限](docs/guide/data-and-permissions.md)。
