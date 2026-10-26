# 节点使用指南

节点名称用于业务识别与变量引用；节点类型在界面显示中文名称和英文副标题。以下为当前完整类型目录。

| 中文名称 | 英文名 | kind | 作用与入口 |
| --- | --- | --- | --- |
| 开始 | Start | `start` | 唯一流程入口、参数和页面导航；[流程控制](control.md) |
| 网页操作 | Selector | `dom` | 输入、点击、选择、上传等；[网页操作](web.md) |
| 浏览器弹窗 | Browser Dialog | `dialog` | 触发并应答原生弹窗；[弹窗与日历](dialog-and-calendar.md) |
| 检索 | Query | `query` | 按条件读取 DOM 列表；[数据读取](data.md) |
| 输出 | Output | `output` | 返回业务结果与标记；[数据读取](data.md) |
| 监控 | Watch | `watch` | 等待值、文本或属性达到条件；[数据读取](data.md) |
| 请求 | HTTP Request | `request` | HTTP/HTTPS，返回 Text/JSON；[请求](request.md) |
| 数据表 | DataTable | `datatable` | 当前 DOM 表格转结构化数据和 Excel；[数据读取](data.md) |
| 表格填充 | Table Fill | `tableFill` | 按 key 列匹配写入网页表格；[数据读取](data.md) |
| 截图 | Screenshot | `screenshot` | 可视、整页或区域 PNG；[截图与模型](media-and-ai.md) |
| 发送邮件 | Email | `email` | 正文与文件附件；[截图与模型](media-and-ai.md) |
| 日历选择器 | Calendar | `calendar` | 日期与日期时间；[弹窗与日历](dialog-and-calendar.md) |
| 分页 | Pagination | `pagination` | 指定页或逐页处理；[流程控制](control.md) |
| 智能分析 | AI | `ai` | 调用配置的模型处理输入；[截图与模型](media-and-ai.md) |
| 等待 | Wait | `wait` | 固定或随机等待；[流程控制](control.md) |
| 循环 | Loop | `loop` | 数组每项执行内部流程；[流程控制](control.md) |
| 调用流程 | Action | `action` | 兼容旧 Action；当前菜单不提供新建；[流程控制](control.md) |

开始节点自动创建，不能删除。Action 保留兼容，其余节点可从左侧新增菜单或输出连接点创建。

普通节点使用 `success` / `failure`；新循环与分页容器使用 `done` / `failure`。内部节点连接到本作用域的入口路径，不能跨容器连线。

所有节点都应先按 [运行与调试](../guide/execution.md) 验证，再用于正式流程。
