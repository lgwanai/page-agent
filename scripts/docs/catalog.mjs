export const baseline = '2026-10-27';
export const chapters = [
  ['overview', 'README.md', '手册导航', '阅读路径、版本和任务入口', '开始使用'],
  ['installation', 'guide/installation.md', '安装与升级', '扩展、便携包、源码和版本确认', '开始使用'],
  ['quick-start', 'guide/quick-start.md', '快速上手', '使用本地练习页跑通首个流程', '开始使用'],
  ['editor', 'guide/editor.md', '编辑与录制', '画布、属性、连接、快捷键和草稿', '日常操作'],
  ['variables', 'guide/variables.md', '参数与变量', '类型、表达式、节点输出和作用域', '日常操作'],
  ['workflows', 'guide/workflows.md', '工作流管理', '查找、备份、迁移、删除和恢复', '日常操作'],
  ['execution', 'guide/execution.md', '运行与调试', '执行方式、验收、停止和运行历史', '日常操作'],
  ['mcp', 'guide/mcp.md', 'MCP 接入与编排', '本机连接、调用身份和工具速查', '日常操作'],
  ['nodes', 'nodes/README.md', '节点目录', '全部 17 种类型及适用场景', '节点指南'],
  ['web', 'nodes/web.md', '网页操作与定位', '控件事件、iframe、自动修复和上传', '节点指南'],
  ['data', 'nodes/data.md', '数据读取与结果', '检索、监控、数据表、填充和输出', '节点指南'],
  ['control', 'nodes/control.md', '流程控制', '开始、等待、循环、分页与兼容 Action', '节点指南'],
  ['request', 'nodes/request.md', '请求', 'HTTP/HTTPS 与 Text/JSON 返回', '节点指南'],
  ['dialog-calendar', 'nodes/dialog-and-calendar.md', '弹窗与日历', '确认、输入、离开页面和日期时间', '节点指南'],
  ['media-ai', 'nodes/media-and-ai.md', '截图、邮件与智能分析', '文件、附件、本机配置与模型调用', '节点指南'],
  ['troubleshooting', 'guide/troubleshooting.md', '故障排查', '从第一处失败定位问题', '查阅参考'],
  ['data-permissions', 'guide/data-and-permissions.md', '数据与权限', '本机存储、外发、导出与账号边界', '查阅参考'],
  ['limits', 'reference/limits.md', '限制速查', '当前实现的容量、超时与不支持范围', '查阅参考'],
  ['glossary', 'reference/glossary.md', '术语表', '流程、标识、结果和协议概念', '查阅参考'],
  ['examples', 'examples/README.md', '练习与示例', '可导入流程、演示参数和预期结果', '查阅参考'],
  ['maintenance', 'reference/documentation.md', '文档维护', '内容源、构建、校验和历史边界', '查阅参考'],
  ['request-details', 'http-request.md', '请求字段参考', '方法、请求体、响应与 MCP', '专题附录'],
  ['dialog-details', 'browser-dialog.md', '原生弹窗参考', '触发、应答、来源校验与示例', '专题附录'],
  ['calendar-details', 'calendar-datetime.md', '日期时间参考', '日期、时分秒与最终值校验', '专题附录'],
  ['pagination-details', 'pagination-and-subflows.md', '分页与子流程参考', '终止条件、作用域和 JSON', '专题附录'],
  ['output-details', 'output-node.md', '输出参考', '数据来源、返回类型和业务状态', '专题附录'],
  ['mcp-details', 'mcp-authoring.md', 'MCP 编排参考', '工具参数与画布编辑示例', '专题附录'],
  ['schema-details', 'workflow-spec.md', '工作流 JSON 规范', '交换格式、约束与兼容', '专题附录'],
  ['platform-details', 'cross-platform-mcp.md', '跨系统部署参考', '便携包、路径与共享桥接', '专题附录'],
].map(([id, file, title, description, group], index) => ({ id, file, title, description, group, number: String(index + 1).padStart(2, '0') }));

export function slug(text) {
  return text.replace(/<[^>]*>/g, '').replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_~]/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}
