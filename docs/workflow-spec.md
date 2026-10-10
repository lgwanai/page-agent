# Page Agent 工作流 JSON 规范（v1）

工作流导出文件用于跨设备备份、审阅和导入。文件是 UTF-8 JSON，顶层结构固定为：

```json
{
  "$schema": "https://page-agent.dev/schemas/workflow-v1.json",
  "schemaVersion": 1,
  "kind": "page-agent-workflow",
  "exportedAt": "2026-10-07T08:00:00.000Z",
  "workflow": {
    "id": "30cb4d69-86b9-45aa-a497-e025f812c834",
    "name": "创建订单",
    "description": "在历史订单系统中创建订单",
    "nodes": [
      {
        "id": "start",
        "kind": "start",
        "name": "开始",
        "inputs": [],
        "targetUrl": "https://example.com/orders",
        "strictValidation": false,
        "waitForLogin": false,
        "loadTimeoutMs": 30000,
        "loginTimeoutMs": 300000,
        "settleDelayMs": 500
      }
    ],
    "edges": [],
    "createdAt": 1791360000000,
    "updatedAt": 1791360000000
  }
}
```

## 约束

- `workflow.id` 是工作流的全局唯一标识。新工作流使用 UUID v4。导入时如与本机已有 ID 冲突，插件会生成新 ID。
- `nodes` 保存 Start、网页操作、Query、AI、Action、等待和循环节点；`edges` 保存节点之间的成功、失败、遍历和完成路径。
- Start 节点的 `targetUrl` 是执行入口。录制生成的工作流会自动写入开始录制时的网页 URL。
- 配置了 `targetUrl` 时，每次运行都会重新导航到该地址（即使当前地址相同），等待新的主文档导航与加载完成。URL 留空才复用当前页面。普通/强校验仅控制导航后最终地址的校验范围，不决定是否导航。Start 日志记录 `previousUrl`、`requestedUrl`、`url` 和 `navigated`；地址加载完成不代表业务控件已经可用，后续节点继续进行控件校验。
- 网页节点的 `target` 保存 selector、元素类型和可读标签，`event` 保存点击、输入、选择、滚动、右键、长按等操作。
- `target.frameUrl` 可选，保存节点所在文档的地址，用于 iframe 重建后的重新定位；`frameId` 仅是录制时的提示。旧工作流没有 `frameUrl` 时，会通过 selector 唯一匹配当前 frame；跨 frame 匹配不唯一时停止，避免误操作。
- 网页操作的 selector 失效时，可用 `target` 已记录的元素类型、名称、placeholder 等稳定身份信息唯一定位；按钮可用已记录文本消除歧义。找不到或有多个匹配时走失败分支，不会猜测并点击第一个节点。Query 检索范围和多元素读取仍使用配置的 selector，不进行单节点身份恢复。
- 执行前最多等待 10 秒进行只读定位检查，每次刷新当前 frame 列表，适应主页面加载完成后才创建的 iframe 或异步渲染的表单。目标操作仅发送一次；不会因等待或响应通道断开重复点击。超时错误包含当前 frame ID 和可连接脚本数量。
- CSS selector 属于目标文档，不需要写入 iframe 路径或 XPath。后台枚举各级 frame，在各文档独立定位后向匹配文档执行；旧节点缺少 frame 信息或 `frameId=0` 时也允许唯一匹配子 frame。已保存 `frameUrl` 的节点保持文档范围，不会跳到其他 iframe。同名 selector 仍核验记录的元素类型和稳定属性；结果歧义时停止。操作失败会报告实际命中的 frame ID、文档 URL，区分“未找到”和“已找到但禁用”。
- 访问密钥不属于工作流内容，永远不会写入导出文件。导入工作流后，本机为其生成新的访问密钥。
- MCP 执行必须同时提供目标 Chrome 插件的 `instanceId`、`workflowId` 和对应密钥；参数数据放在 `data` JSON 对象中，按 Start 节点声明的同名字段映射。实例 ID 属于 Chrome 配置文件中的插件安装，不属于工作流导出文件；导入到另一实例后需要使用该实例的 ID。

机器可读约束见同目录的 `workflow.schema.json`。

## Query 节点

Query 只读取页面，不触发事件。`target` 与网页节点相同，指定范围 selector 和 frameId；`query` 配置范围内的候选元素与匹配规则：

```json
{
  "id": "query_orders",
  "kind": "query",
  "name": "订单检索",
  "target": { "name": "订单检索", "selector": "#orders", "frameId": 0, "tagName": "div", "label": "订单列表" },
  "query": {
    "candidateSelector": "a",
    "includeRoot": false,
    "source": "attribute",
    "attributeName": "href",
    "match": "regex",
    "pattern": "^/orders/[0-9]+$",
    "regexFlags": "i"
  }
}
```

- `candidateSelector`：CSS selector，空字符串或 `*` 检索所有后代；`includeRoot` 决定是否也检索范围元素本身。
- `source`：`attribute` 按具体属性名读取（即 `getAttribute`，不是 JavaScript 属性）；`value` 读取表单控件的当前值，其他元素读取文本；`text` 读取 `textContent`。
- `match`：`exists` 表示属性存在或不过滤值；`equals` 完全相同；`contains` 包含；`regex` 正则匹配。正则无需两侧斜杠，选项单独写在 `regexFlags` 中。属性不存在时不匹配，包括空字符串的正则。
- 范围 selector、候选 selector、属性名和匹配内容支持 `{{变量}}`。
- 输出为按文档顺序去重的 DOM 快照数组，每项有 `selector`、`frameId`、`tagName`、`label`、`name`、`value`、`text`、`matchedValue` 和完整 `attributes`。不是可跨进程传递的活 DOM 引用；后续操作使用 selector 重新定位。
- 循环数组配置为 `{{订单检索.output}}`，循环内操作可用 `{{item.selector}}`、`{{item.value}}` 或 `{{item.attributes.href}}`。AI 节点的节点输入可直接选择 Query，MCP 执行结果的对应 step.data 返回同一数组。
- 没有匹配项成功返回 `[]`；范围不存在、非法 selector、缺少属性名或无效正则走失败出口。
