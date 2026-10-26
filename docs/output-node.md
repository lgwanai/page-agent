# Output 节点与业务结果（v0.10.46）

在画布工具栏或节点出口的添加菜单选择 **Output**。所有输出节点均可命名、保存、导入导出，并通过 MCP 创建和调试。

## 配置

| 输出来源 `source` | 配置方式 | 返回类型 |
| --- | --- | --- |
| `text` 文本 | `value: "未成功"`，或 `"任务状态：{{状态}}"` | 字符串 |
| `variable` 变量 | `value: "{{data}}"` 或 `"{{查询.output}}"`，必须独立引用 | 保留数字、布尔、null、对象、数组及文件结构 |
| `node` 前序节点 | 选择 `sourceNodeId`；可选 `path: "0.value"` / `"rows.0.金额"` | 前序节点输出或其中字段，保留类型 |
| `dom` 网页内容 | 使用 Selector 工具、已有节点的 DOM 或手动填写 `target`；`read` 选择 `text`、`value`、`attribute` | 字符串，开启 `multiple` 返回字符串列表 |

`source=node` 的字段路径相对节点输出本身，而不是整个运行日志。未执行的前序节点、未定义变量、缺失字段、缺失 DOM / 属性均报失败，不伪造空值；合法的 `0`、`false`、`null`、空字符串和空数组正常返回。路径不能访问原型，也不支持 JavaScript 表达式或 eval。

DOM 输出只读，不激发页面事件。默认要求唯一匹配；读取列表需开启 `multiple`，最多 1000 项。`read=attribute` 必须填写 `attributeName`，例如 `data-status`、`aria-valuenow`、`href`；`value` 读取 input / textarea / select 的当前值，而不是 HTML 默认属性。支持 iframe 的 `target.frameUrl` 定位机制。拒绝读取密码、隐藏输入或脚本节点；普通页面内容仍可能包含业务敏感信息，请仅将其返回给已授权的 Agent。不会调用 AI 供应商。

## MCP 返回

`run_page_workflow` 直接返回以下字段；`debug_page_node` / `debug_page_workflow` 将它们放在 `result` 中。

```json
{
  "ok": true,
  "output": "未成功",
  "outputs": { "未完成结果": "未成功" },
  "businessOk": false,
  "steps": []
}
```

- `ok`：执行流程是否正常完成，或错误是否已由失败分支处理。它不等于取数、下载、发送等业务已经成功。
- `output`：本次最后执行的 Output 值。
- `outputs`：按 Output 节点名称汇总；循环中同一节点执行多次保留最后一次输出。
- `businessOk`：`outcome=success` 标记 true，`failure` 标记 false；`neutral` 不作业务标记。任一 Output 标记 failure 时，以 false 为准，不被后续成功标记覆盖。

未执行 Output 时不附加上述输出字段。每次运行独立收集；不会读取历史手动参数或上次输出。后续步骤报错仍返回 `ok=false`，已产生的输出仅作为诊断，不应覆盖执行错误。Agent 应同时检查 `ok`、`businessOk` 和必要的步骤校验。

Output 按普通连线继续运行；不连接后续节点即结束当前路径，并非强制退出所有循环。需要立刻结束时应将其配置在分支末尾，且不要再连接有副作用的后续步骤。

## “未取数完成”分支

在检索第三列状态的 Query 上设置 `onEmpty: "failure"`。成功出口连接“下载”；失败出口连接：

```json
{
  "id": "not_ready",
  "kind": "output",
  "name": "未完成结果",
  "source": "text",
  "value": "未成功",
  "outcome": "failure"
}
```

无匹配状态走失败出口，但匹配检查不修改页面。其他 Query 错误也走失败出口；Agent 可通过 `steps[].diagnostic.code` 区分 `QUERY_NO_MATCH` 和定位 / 配置异常。旧 Query 不设置 `onEmpty` 时仍走成功出口返回空列表，兼容已有流程。

“已触发下载”的 Output 只表示点击已执行，不保证文件下载完成；要判断完整文件落盘仍需核对浏览器下载状态或本机文件，不能把文字声明当作文件校验。
