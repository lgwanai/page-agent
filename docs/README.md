# Page Agent 使用手册

面向工作流编排人员、业务使用者和 Agent 集成开发者。按“安装 → 创建 → 配置 → 验证 → 复用”的顺序学习，也可以直接查阅对应节点。

| 文档信息 | 基线 |
| --- | --- |
| 核对日期 | 2026-10-27 |
| Chrome 扩展 | 0.10.66 |
| MCP 服务 | 0.10.17 |
| 工作流交换格式 | `page-agent-workflow`，`schemaVersion: 1` |
| 阅读形式 | 分章 Markdown、[离线 HTML 使用手册](user-manual.html) |

## 按任务阅读

| 我要完成的任务 | 阅读入口 |
| --- | --- |
| 第一次安装、更新插件 | [安装与升级](guide/installation.md) |
| 跑通第一个流程 | [快速上手](guide/quick-start.md) |
| 录制网页操作、使用画布和快捷键 | [编辑与录制](guide/editor.md) |
| 参数化、传递对象和数组 | [参数与变量](guide/variables.md) |
| 查找、导入导出、删除与恢复 | [工作流管理](guide/workflows.md) |
| 查看结果、停止运行、定位失败 | [运行与调试](guide/execution.md) |
| 让 Agent 创建或调用流程 | [MCP 接入与编排](guide/mcp.md) |
| 定位元素、读取数据、上传、请求、弹窗 | [节点使用指南](nodes/README.md) |
| 处理连接或页面变化问题 | [故障排查](guide/troubleshooting.md) |
| 核对数据存储与外发范围 | [数据与权限](guide/data-and-permissions.md) |
| 查看限制和术语 | [限制速查](reference/limits.md)、[术语表](reference/glossary.md) |

## 建议学习顺序

1. 按快速上手操作本地练习页，完成一次录制和一次手动运行。
2. 阅读参数与变量，把固定输入替换成可复用参数。
3. 通过输出节点返回结果，再学习失败出口与业务成功标记。
4. 按业务选择检索、循环、分页、请求或文件处理等节点。
5. 手动验证稳定后，再接入 MCP；使用目标实例、工作流 ID 和密钥调用。

## 节点分类

当前有 17 种节点类型；“开始”自动创建，“调用流程 / Action”保留兼容，其他 15 种可从新增节点菜单选择。

- [网页操作与定位](nodes/web.md)：网页操作、文件上传、定位修复和 iframe。
- [数据读取与结果](nodes/data.md)：检索、监控、数据表、表格填充和输出。
- [流程控制](nodes/control.md)：开始、等待、循环、分页、失败分支和兼容 Action。
- [请求](nodes/request.md)：HTTP/HTTPS、Text/JSON、请求头、请求体和变量。
- [弹窗与日历](nodes/dialog-and-calendar.md)：原生确认框、输入框、离开页面确认与日期时间。
- [截图、邮件与智能分析](nodes/media-and-ai.md)：文件输出、附件、本机配置与模型调用。

## 文档目录与维护

```text
docs/
  README.md                 阅读导航与版本基线
  user-manual.html          自动生成的离线使用手册
  guide/                    安装、上手、编辑、运行和接入
  nodes/                    按业务任务组织的节点手册
  reference/                限制、术语和文档维护说明
  examples/                 本地练习页、示例 JSON 与练习数据
  enterprise/               历史企业技术评估资料
  workflow.schema.json      工作流交换格式约束
```

原有专题路径继续保留，避免已有引用失效：[请求详细配置](http-request.md)、[浏览器原生弹窗](browser-dialog.md)、[日期时间](calendar-datetime.md)、[分页与子流程](pagination-and-subflows.md)、[输出](output-node.md)、[MCP 编排](mcp-authoring.md)、[JSON 规范](workflow-spec.md)。

历史版本见 [CHANGELOG](../CHANGELOG.md)。`enterprise/` 为早期技术评估基线，不能直接视为当前版本的完整接口清单；当前操作以本手册与运行中的 MCP 工具包为准。

维护者修改 Markdown 后执行 `npm run docs:build` 生成 HTML，执行 `npm run docs:check` 检查链接、节点与工具覆盖、示例配置和手册构建结果。详见 [文档维护](reference/documentation.md)。
