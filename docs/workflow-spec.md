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
- `nodes` 保存开始、网页操作、检索、输出、请求、智能分析、等待和循环等节点；`edges` 保存节点之间的成功、失败、遍历和完成路径。请求节点配置与返回值见 [请求节点](http-request.md)。
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


### 上传文件事件

网页节点支持 `event.type="upload"`，`event.value` 必须是非空路径配置或变量表达式（例如 `{{文件路径}}`）。精确变量引用可以解析为路径字符串数组；路径文本支持单行或换行分隔，也接受 JSON 字符串数组。目标可以是文件框、关联 label 或含唯一文件框的容器。Start 参数及导入导出保留此事件配置；不会将文件二进制写入工作流文件。实际上传依赖 Chrome 125+、扩展 0.10.56+、本机 MCP 0.10.14+；最多 20 个普通文件，不再设 20 MB 大小上限。MCP 仅预检并返回路径/元数据，Chrome 直接读取磁盘文件，内容不经过扩展消息；网站和浏览器自身限制仍适用。

## v0.10.57 定位描述

PageTarget 可携带 locator（version=1、selector、tagName、inputType、confidence、candidates）及 frameName。candidate 保存独立 CSS selector、可选 anchor，以及精确 match（text/value）；text 按空白归一化后完整相等，禁止 contains 猜测。优先级为 id、name、上层 ID 内精确身份、语义属性/文本、class、最终位置。多个候选不是拼接成一个位置路径；只在更高优先级规则没有匹配时回退，匹配多个元素立即失败。已有稳定祖先范围时，较弱全局规则不会跨出该范围。

录制、手动选择统一通过 describeElement 捕获。locator.selector 必须与当前 target.selector 一致才启用计划，显式修改 Selector 后按照用户 CSS 执行。Query/inspect 保留可独立执行的唯一 CSS，同时返回 locator 供调用方连同 target 保存，不能只保存看似非唯一的语义范围 CSS 而丢弃 match。

新捕获 frameQueryKeys 保留业务参数，排除 processId、sessionId、jsessionid、timestamp、_t、_ts、_、cachebust、cachebuster。URL 的 origin/path 和保留参数必须匹配，frameName 非空时还要匹配名称；新定位遍历所有候选 frame，frameId 只供诊断，不单独决定身份。旧节点未声明 frameQueryKeys 时保留完整 URL 精确匹配语义。

## v0.10.58 已有节点自动修复

执行节点前，先只读扫描当前目标文档。旧节点没有 locator、且 Selector 不含变量表达式时，可用已有 id/name、完整按钮文本、语义属性及旧 CSS 中的祖先 ID 恢复身份。原数字路径即使命中其他元素也不能作为身份证据；文本截断、重复身份、ID 被其他控件复用、祖先范围消失或多个 iframe 匹配时，不自动改写，也不发送该节点操作。通用非位置 CSS 检索范围（如 body、.rows）没有足够身份信息时保持原有检索语义。

修复发生在节点实际运行到对应页面时，支持嵌套子流程、Action、AI Selector 输入以及单节点调试。模板化 Selector 保持动态解析；现代 locator 和用户显式修改过的现代节点不被旧节点修复覆盖。重新枚举当前 frame，旧 frameId 不能用于消除歧义；保留业务查询参数，只排除已知运行参数。

新 target 保存 selectorUpgrade：version=1、previous（完整升级前 target）、upgradedAt、reason，同时写入新版 locator 和当前 frame 信息。RunResult.selectorUpgrades 列出升级/无法确认/并发冲突及是否已保存。升级后的目标按工作流/节点/AI 输入绑定定位，写入前比较最新目标与升级前快照；只修改该目标和 updatedAt，不覆盖并发修改的目标、连线、事件或其他节点。删除的工作流不会重建。只有通过唯一身份验证的节点会保存，即使后续步骤失败也保留已验证的升级。

升级结果会同步到当前编辑器；原 Selector 可在节点的“自动修复记录”查看，完整备份随工作流导出。下次运行直接使用保存的新规则。自动升级需要流程运行到对应页面，不会在离线状态猜测或遍历打开其他业务页面。

## 浏览器原生弹窗节点（0.10.60）

新增 kind=dialog，包含 target、event、dialogType、action、message、promptText、timeoutMs。触发与应答在同一节点中完成，取消走 success；未出现或校验失败走 failure。完整定义及边界见 [浏览器弹窗节点](browser-dialog.md)，JSON Schema 已同步。

## 画布交互（0.10.61）

选择节点仅显示底部属性条，通过“展开属性”查看详细设置；“收起属性”保留选择和即时编辑结果。开始拖动节点或画布时收起详情。左侧悬浮“新增节点”打开类型菜单，后续节点端口也可继续创建节点；右上角提供撤销/重做。

自动整理使用当前节点尺寸与现有连线，按从左到右的方向安排主画布和独立子流程，并将所有位置更新合并为一次编辑。子流程的虚拟入口保持固定位置。整理后自动适配视野，可一次撤销/重做；保存工作流会持久化新位置。

### 初始视野与缩放（0.10.62）

进入编辑器后，等待节点文档与可见区域及引擎尺寸同步，再适配当前保存的节点位置。初始化不执行整理；隐藏后显示的画布会继续等待并初始化。正常编辑不会自动重设视野，拖拽或滚轮操作会中断待执行的初始适配。

悬浮工具栏的节点库图标用于新增节点，缩放区提供放大、缩小、百分比按钮（重置为 100%）和适应全部节点。缩放围绕当前视野中心进行，百分比随滚轮与工具按钮更新；视野操作不会成为工作流编辑或改变节点位置。
