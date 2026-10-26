# 浏览器原生弹窗节点

扩展 0.10.60、MCP 0.10.16 新增 `dialog` 节点。画布工具栏和后续节点菜单均可添加“浏览器弹窗 / Browser Dialog”；已有网页节点的属性中可点“转为浏览器弹窗节点”，保留 ID、连线、事件及完整 Selector/iframe 定位信息。

节点同时负责触发和应答：先监听原生弹窗，再执行所选控件的事件一次，最后核验 Chrome 返回的弹窗关闭结果。请用它替换原来的触发点击节点。不要在前面另放一次触发点击；confirm/prompt 会阻塞网页，等点击完成后才监听会来不及。

| 类型 | 确定 | 取消 |
| --- | --- | --- |
| `alert` | 关闭提示框 | 不适用 |
| `confirm` | 网页收到 `true` | 网页收到 `false` |
| `prompt` | 网页收到配置的文本，可为空 | 网页收到 `null` |
| `beforeunload` | 允许离开页面 | 留在当前页面 |

设置项：

- `target`、`event`：触发弹窗的网页控件与操作，默认点击。支持现有稳健定位、自动修复和 iframe 定位。不支持在此节点内上传文件。
- `dialogType`：上述四种原生弹窗类型之一。
- `action`：`accept`（确定）或 `dismiss`（取消）。alert 只允许 accept。
- `message`：留空接受任意弹窗文字；填写后精确匹配，支持 `{{变量}}`；引用不存在的变量会在触发前失败，不会放宽为任意文字。有保存的目标文档 URL 时也核对弹窗来源。
- `promptText`：prompt 确定时输入的文本，支持变量和空字符串。取消时不传输入内容。
- `timeoutMs`：从监听到触发及完成应答的总等待时间，默认 10000，范围 100–300000 毫秒。

取消是按配置完成的操作，走成功出口。弹窗未出现、类型/文字/来源不匹配、应答失败或实际关闭结果不一致时走失败出口。不匹配时不自动应答，应先人工检查；触发操作不会自动重试。运行停止会释放监听和调试连接。

输出示例：

```json
{"type":"confirm","message":"确认操作？","accepted":false,"url":"https://example.com/form","trigger":"clicked"}
```

prompt 还提供 `promptText`（仅确定时）与 `defaultPrompt`。可用 Output 节点引用前序弹窗节点输出的 `accepted` 或 `promptText`。已有 alert 自动确定行为继续可用；需要校验文字时改用明确的弹窗节点。

离开页面确认框依赖浏览器允许弹出，通常需要页面此前有真实用户交互。浏览器显示的 beforeunload 提示文字由浏览器决定，建议 `message` 留空。确定后旧文档的扩展消息可能随导航断开：只有 Chrome 已确认该 beforeunload 按配置关闭，节点才将此类断开视为允许导航的结果；不会重发点击，也不代表新页面业务完成。需要验证到达目标页面时，在后面连接 Watch/Query 等节点。

网页中用 HTML/CSS 实现的自定义弹层、系统文件选择器、浏览器权限请求和 HTTP 认证窗口不属于 JavaScript 原生弹窗；网页弹层继续用 Selector，文件选择使用上传节点。

## MCP 示例

先调用 `get_page_workflow_toolkit` 获取 `templates.dialog` 和 `browserDialog` 说明，再通过 `edit_page_workflow` 添加或更新节点。单节点调试会完成一次真实触发与应答；`debug_page_node`/`debug_page_workflow` 报告包含实际关闭校验。

```json
{
  "type":"add_node",
  "node":{
    "id":"confirm1","name":"取消操作","kind":"dialog",
    "target":{"name":"触发按钮","selector":"#confirm-button","frameId":0,"tagName":"button","label":"确认"},
    "event":{"type":"click"},
    "dialogType":"confirm","action":"dismiss",
    "message":"确认操作？","promptText":"","timeoutMs":10000
  }
}
```

`get_page_workflow`、导出、导入均保留配置。扩展和 MCP 更新后，重新加载扩展并重启 MCP 连接以读取新模板。
