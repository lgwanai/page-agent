# 请求节点 · HTTP Request

从画布左侧“新增节点”选择“请求”，展开属性，配置请求链接与返回类型。URL、请求头的值和请求体支持工作流变量。请求由扩展后台发送，支持跨域 HTTP/HTTPS 和自定义端口，默认不携带网页 Cookie。

## 配置

| 字段 | 含义 |
| --- | --- |
| `url` | 完整 HTTP/HTTPS 链接，支持 `{{变量}}` |
| `method` | GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS |
| `headers` | JSON 对象文本，值必须为文本，可引用变量 |
| `body` | 请求体文本；单独引用对象变量时自动序列化成 JSON；GET/HEAD 留空 |
| `responseType` | `text` 返回原始文本；`json` 解析为对象、数组、标量或 null |
| `timeoutMs` | 100–300000 毫秒，默认 30000；包含读取响应体的时间 |

例如发送 JSON：

```json
{
  "id": "request1",
  "name": "创建记录",
  "kind": "request",
  "url": "https://example.com:8443/api/records",
  "method": "POST",
  "headers": "{\"Content-Type\":\"application/json\",\"Authorization\":\"Bearer {{令牌}}\"}",
  "body": "{{记录}}",
  "responseType": "json",
  "timeoutMs": 30000
}
```

后续节点用 `{{创建记录.output}}` 或 `{{创建记录}}` 读取完整返回内容，用 `{{创建记录.output.id}}` 读取字段。可连接输出节点的“前序节点”或“变量”来源，把结果作为工作流返回值。JSON 类型保留，不转换为字符串。

成功条件是 HTTP 2xx 且按配置完成响应解析。HTTP 错误、网络失败、超时、JSON 解析失败走失败出口。空响应需要选择 Text；JSON 模式不会把空响应或无效 JSON 当作成功。执行日志记录 HTTP 状态码与返回类型。

停止运行会中止正在进行的请求，也会阻止后续节点执行；已经在服务器处理的请求不会回滚。请求不自动重试，写入请求遇到超时或连接错误时，应检查服务器结果后再决定是否重新运行。

MCP `get_page_workflow_toolkit` 提供 `templates.request` 和 `httpRequest` 说明，创建、编辑、调试、运行、导入导出使用现有工作流工具。需要 MCP 服务 0.10.17 或更新版本。
