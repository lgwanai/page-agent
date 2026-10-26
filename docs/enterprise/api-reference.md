# MCP 接口与工作流数据说明

> 历史评估资料：本篇保留 2026-10-10 的技术评估基线，未按 0.10.66 全量重审。当前安装、界面、节点与 MCP 使用请阅读 [最新使用手册](../README.md)。

基线：MCP Server 0.10.0 / 插件 0.10.18。工具定义以 [`mcp-server/src/index.ts`](../../mcp-server/src/index.ts) 为准。下文示例 ID 和 key 均为占位示例，不是可用凭据。

## 1. 接入协议

对 Agent 暴露的是 MCP **stdio** 服务，不是 REST API，也不是直接配置 WebSocket URL 的远程 HTTP MCP 服务。客户端启动 Node 进程，通过 MCP SDK 完成初始化、tools/list 和 tools/call。

```json
{
  "mcpServers": {
    "page-agent": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/page-agent/mcp-server/dist/index.js"],
      "env": { "PAGE_AGENT_BRIDGE_PORT": "17373" }
    }
  }
}
```

浏览器插件固定连接 `ws://127.0.0.1:17373/extension`。环境变量改变 Node 侧端口并不会自动改变插件常量和 CSP；当前交付应使用 17373，修改端口需同步代码与构建。

### 1.1 公共参数

| 名称 | 类型 | 含义 |
| --- | --- | --- |
| `instanceId` | UUID 字符串 | 明确指定的 Chrome 配置文件插件实例 |
| `workflowId` | UUID 字符串 | 工作流全局 ID |
| `key` | 非空字符串 | 当前实例中该工作流的访问密钥 |
| `data` | JSON 对象 | 本次运行输入；不是 JSON 字符串 |
| `variables` | JSON 对象 | 仅旧运行接口兼容，data 同名字段优先 |
| `expectedUpdatedAt` | 数字 | 最近读取的修订标记，用于编辑冲突检查 |

本文用 **I** 表示必须传 instanceId，**W** 表示必须传 instanceId、workflowId、key。W 的 key 是工作流访问控制，不是客户端身份认证，详见[安全文档](data-security.md)。

## 2. 工具总览：21 个

| 工具 | 身份参数 | 额外参数 | 结果/用途 |
| --- | --- | --- | --- |
| `page_agent_status` | instanceId 可选 | 无 | 连接状态、实例；指定实例时含活动页面 |
| `list_page_agent_instances` | 无 | 无 | 实例 ID、版本、连接时间列表 |
| `list_page_workflows` | I | 无 | 工作流摘要，不含 key |
| `list_page_scripts` | I | 无 | 旧名称，兼容工作流摘要 |
| `run_page_workflow` | W | data?、variables? | 完整运行结果 |
| `run_page_script` | I + scriptId + key | data?、variables? | 旧名称；scriptId 为工作流 ID 字符串 |
| `list_page_actions` | I | 无 | 完整旧 Action 定义列表，不要求 key |
| `run_page_action` | I | actionId、data?、variables? | 运行旧 Action，不要求工作流 key |
| `get_page_agent_workspace` | I | 无 | 已保存库完整定义，不要求 key |
| `get_page_workflow_toolkit` | 无 | 无 | 模板、事件、端口、建议步骤；无需浏览器连接 |
| `create_page_workflow` | I | name、description?、targetUrl? | 保存新图，返回 workflow 和新 key |
| `get_page_workflow` | W | 无 | 完整图和 updatedAt |
| `validate_page_workflow` | W | 无 | valid、ready、warnings、updatedAt |
| `edit_page_workflow` | W | expectedUpdatedAt、修改字段 | 验证后保存并返回新完整图 |
| `export_page_workflow` | W | 无 | 版本化工作流 JSON 对象 |
| `import_page_workflow` | I | file | 导入保存，返回 workflow 和新 key |
| `inspect_page_content` | W | frame/范围/输出限制 | frame 清单或控件快照 |
| `debug_page_node` | W | nodeId、data?、context? | 执行一个节点并返回报告 |
| `debug_page_workflow` | W | data? | 从 Start 运行并返回报告 |
| `get_page_debug_result` | W | 无 | 最近一次 MCP 调试报告或 null |
| `capture_page_screenshot` | W | mode、区域、尺寸选项 | PNG image 内容块与元数据 |

注意：新建/导入不要求已有工作流 key，因为它们生成新的 key。当前也没有另一个实例级创建凭据。因此能够接入本机 MCP 的客户端可以创建自己的可执行工作流，不能依靠工作流 key 限制所有页面访问。

## 3. 发现和运行

`list_page_agent_instances` 返回数组：

```json
[{"instanceId":"11111111-1111-4111-8111-111111111111","version":"0.10.18","connectedAt":"2026-10-10T01:00:00.000Z"}]
```

工作流摘要字段：`id / instanceId / name / description / nodeCount / updatedAt / lastRunAt / requiresKey`。`requiresKey=true` 描述运行接口，不表示所有读取接口都要求 key。

完整运行示例：

```json
{
  "instanceId":"11111111-1111-4111-8111-111111111111",
  "workflowId":"22222222-2222-4222-8222-222222222222",
  "key":"<从插件复制的工作流密钥>",
  "data":{"customer_name":"示例客户","items":[{"sku":"A001","quantity":2}]}
}
```

`run_page_workflow` 从已保存定义执行，不读取未保存画布。传参缺失时不会补用手动输入历史。`run_page_script` 的 ID 字段名是 scriptId，不支持以名称代替该接口的工作流 ID；旧 `run_page_action` 可使用 Action ID 或准确名称。

### 3.1 普通运行结果

```json
{
  "ok":true,
  "steps":[{
    "ok":true,"nodeId":"input1","message":"输入校验成功",
    "outputPort":"success","data":{"value":"示例客户"},
    "verification":{"ok":true,"summary":"输入校验成功","expected":"示例客户","actual":"示例客户","evidence":["示例证据"]}
  }]
}
```

示例中的 data/evidence 仅展示形状，不保证所有事件输出相同字段。StepResult 公共字段为 ok、nodeId、message，可选 data、verification、diagnostic、outputPort。RunResult 为 ok、steps，可选 error、diagnostic。

失败路径被恢复后 RunResult 可能成功，但 steps 中仍有失败项。请记录步骤状态和业务验收结果，不仅记录总体 ok。

## 4. 创建、编辑与并发

### 4.1 创建和读取

`create_page_workflow` 必填 name，description 和 targetUrl 可选。自动创建 Start、UUID 和 key，并立即保存，不执行网页操作。返回 `{workflow,key,hint}`。创建接口本次返回 key；列表不会返回 key，但用户可以在插件列表复制，不能称为“系统永远只可获取一次”。

`get_page_workflow` 返回完整定义；使用其 updatedAt 作为后续编辑的 expectedUpdatedAt。

### 4.2 edit_page_workflow

可选字段：`name:string`、`description:string`、`nodes:object[]`（最多 500）、`edges:WorkflowEdge[]`（最多 1000）、`operations:Operation[]`（最多 1000）。至少传身份和 expectedUpdatedAt；当前未要求必须包含非空修改。

操作类型：

| type | 字段 | 行为 |
| --- | --- | --- |
| `add_node` | node | 增加完整节点 |
| `update_node` | nodeId、patch | 顶层浅合并，保留原 ID |
| `remove_node` | nodeId | 删除节点和相关边；禁止删除 Start |
| `connect` | edge | 增加完整连线 |
| `disconnect` | edgeId | 删除指定边 |

传 nodes/edges 时先整体替换，再顺序应用 operations。patch 是浅合并，更新 event 或 target 时需提供该嵌套对象完整必要字段，不能假定深合并。

```json
{
  "instanceId":"11111111-1111-4111-8111-111111111111",
  "workflowId":"22222222-2222-4222-8222-222222222222",
  "key":"<工作流密钥>",
  "expectedUpdatedAt":1791594000000,
  "operations":[
    {"type":"update_node","nodeId":"start","patch":{"inputs":[{"id":"p1","name":"customer_name","type":"string","required":true}]}},
    {"type":"add_node","node":{"id":"input1","name":"输入客户","kind":"dom","position":{"x":360,"y":100},"target":{"name":"客户框","selector":"#customer","frameId":0,"tagName":"input","label":"客户","attributes":{"type":"text"}},"event":{"type":"input","value":"{{customer_name}}"}}},
    {"type":"connect","edge":{"id":"e1","sourceNodeId":"start","targetNodeId":"input1","sourcePort":"success"}}
  ]
}
```

修订不一致返回 WORKFLOW_REVISION_CONFLICT；重新读取并合并，不要自动覆盖。批量操作、节点和连线校验通过后才保存新图。修订标记与 lastRunAt 含义不同，运行更新时间不等于定义修改。

### 4.3 校验范围

要求唯一 Start、唯一非空节点 ID/名称、合法配置、存在的边端点、唯一边 ID、单个输出端口最多一条边，禁止边指向 Start。DOM 事件与目标类型匹配。

`validate_page_workflow` 的 warnings 包含未连接节点、未配置 Selector。`valid=true` 只说明结构通过，`ready=true` 仅说明当前警告为空，不证明页面定位、业务权限、网络或业务结果可成功。

## 5. 页面读取与调试

### 5.1 inspect_page_content

参数：

| 参数 | 类型/默认 | 说明 |
| --- | --- | --- |
| listFrames | boolean，可选 | true 时只返回 tabId 和 frames |
| frameId | 非负整数，默认 0 | 当前 frame，不应复用导航前编号 |
| frameUrl | string，可选 | 精确 URL 匹配，提供时优先于 frameId |
| selector | string，默认 body | CSS 范围 |
| maxNodes | 1–200，默认 100 | 返回元素上限 |
| maxText | 1–50000，默认 12000 | 文本预算，不是整个 JSON 大小上限 |

先 listFrames，再选择唯一当前文档。快照含 title、url、rootCount、totalNodes、truncated、nodes，以及后台附加 tabId、frameId、frameUrl。控件含 selector、tagName、text、有限属性、visible、disabled，可有 value 与 options。

快照不提供原始 HTML，排除 password/hidden 输入，单元素文本/value 和选项有数量限制；它仍可能返回其他敏感文本和普通输入内容。AI selector 输入、Query 和截图不是同一套过滤规则。

### 5.2 debug_page_node

只执行 nodeId 指定节点，不运行前后节点，不自动导航 Start URL。需要导航时先调试 Start，或使用 debug_page_workflow。即使调试非 Start，运行前仍会校验 Start 参数，需提供必填 data。

context 为前置节点上下文 JSON，例如 `{"查询客户":{"ok":true,"output":[...]}}`；它是调用方提供的数据，不是后台自动恢复之前步骤。单独调试 Loop 仅解析列表，不执行循环体。

### 5.3 调试报告

debug_page_node 和 debug_page_workflow 返回：

```json
{
  "runId":"33333333-3333-4333-8333-333333333333",
  "workflowId":"22222222-2222-4222-8222-222222222222",
  "workflowUpdatedAt":1791594000001,
  "startedAt":1791594001000,"finishedAt":1791594003000,
  "result":{"ok":true,"steps":[]}
}
```

每个工作流仅在 Chrome 会话存储保存最近一次 MCP 调试报告。普通 run_page_workflow 不保证产生这种报告。存储失败时可能附 warning，执行已经发生，不应重跑以补日志。

## 6. 截图接口

capture_page_screenshot 要求 W，并返回 MCP 文本元数据和一个或多个 `type=image / mimeType=image/png / data=base64` 内容块。客户端须支持 MCP 图片内容。

| 参数 | 类型/默认 | 说明 |
| --- | --- | --- |
| mode | viewport / region / fullPage；默认 viewport | 截图模式 |
| selector | 非空 string，可选 | region 主文档唯一 CSS Selector |
| region | {x,y,width,height}，可选 | 主文档坐标，x/y≥0，宽高>0 |
| scale | 0.1–2，默认 1 | 输出比例，可能按设备/宽度上限调整 |
| maxTiles | 1–100，默认 40 | 滚动采集数量上限 |
| settleMs | 50–1000，默认 200 | 每次滚动后等待 |
| hideFixed | boolean，默认 true | 后续瓦片尝试隐藏固定/粘性元素 |

region 模式必须且只能指定 selector 或 region。selector 不穿透 iframe；iframe 区域可按主文档矩形截图。

元数据含 mode、tabId、url、title、region、complete、tileCount、warnings，滚动模式还可有 scale、requestedTiles、scrollRestored。图片描述含 width、height、offsetY。具体字段随模式不同，调用方应容忍可选字段。

必须检查 complete 和 warnings，不能把部分长图说成全页。长图分段约束包括单边 8192 像素、单段约 1600 万像素、总编码体积限制；过大时降低 scale 或分区域。滚动会触发页面事件，图片会包含屏幕上的业务数据，调用前需确认数据访问授权。

截图需要 Chrome 授予当前页面的 captureVisibleTab 权限；跨站导航后可能需用户再次点击扩展。不会自动选择其他实例或激活另一个标签页来截图。

## 7. 工作流 JSON

```json
{
  "$schema":"https://page-agent.dev/schemas/workflow-v1.json",
  "schemaVersion":1,"kind":"page-agent-workflow",
  "exportedAt":"2026-10-10T01:00:00.000Z",
  "workflow":{
    "id":"22222222-2222-4222-8222-222222222222","name":"示例流程",
    "createdAt":1791594000000,"updatedAt":1791594000000,
    "nodes":[{
      "id":"start","name":"开始","kind":"start","position":{"x":80,"y":100},
      "inputs":[],"targetUrl":"https://example.com/",
      "strictValidation":false,"waitForLogin":false,
      "loadTimeoutMs":30000,"loginTimeoutMs":300000,"settleDelayMs":500
    }],"edges":[]
  }
}
```

`$schema` 是格式标识，不是必需的网络请求。导出为完整定义，不包含单独存储的工作流 key、Provider API Key 或手动参数历史。但定义中固定值、URL 查询参数、AI 指令和录制文字会保留，可能本身含秘密。

import_page_workflow 的 file 为上述对象，不是文件路径或字符串。ID 冲突/不合规则生成新 UUID；返回新的本地 key。导入不自动执行，但后续执行有实际业务影响。

### 7.1 节点字段摘要

公共字段：id、name、kind，position 可选。PageTarget 必需 name、selector、frameId、tagName、label；可选 frameUrl、text、attributes、options。

| kind | 类型专属字段 |
| --- | --- |
| start | inputs、targetUrl、strictValidation、waitForLogin、loadTimeoutMs、loginTimeoutMs、settleDelayMs |
| dom | target、event={type,value?,customEvent?} |
| query | target、query={candidateSelector,includeRoot,source,attributeName,match,pattern,regexFlags} |
| calendar | target、date、endDate、mode=single/range |
| ai | instruction、inputs、event；可选 scopeSelector、actionId（兼容字段） |
| wait | durationMs |
| loop | items、itemVariable、indexVariable、maxIterations |
| action | actionId（旧版） |

Query.source 为 attribute/value/text；match 为 exists/equals/contains/regex。AI inputs.type 为 selector/node/literal，对应 target/sourceNodeId/value，可选 multiple、attribute=text/value/html/attributes。AI 的 scopeSelector/actionId 不能理解为当前全局安全范围约束，实际逻辑以绑定 inputs 与模型 invoke 为准。

支持事件：click、doubleClick、input、select、check、hover、focus、blur、pressKey、submit、scrollIntoView、scrollPage、contextMenu、longPress、custom。模拟回车配置 `type=pressKey,value=Enter`，不是在 input 中输入换行。

## 8. 错误与重试约定

工具错误通常返回 MCP `isError=true`，text 内容为 JSON；执行失败可能位于 RunResult 或调试报告 result 内。状态工具连接失败可返回 connected=false，不能只依赖 isError。

```json
{
  "ok":false,"error":"示例错误",
  "diagnostic":{
    "code":"SELECTOR_NOT_FOUND","message":"示例错误","phase":"locating",
    "context":{"nodeId":"input1","selector":"#customer","recordedFrameId":12},
    "retryPolicy":"after_fix","sideEffects":"none",
    "suggestions":["先检查目标文档和 Selector。"]
  }
}
```

context 可含请求/版本/工作流/节点/字段路径、当前 frame、Selector 或 expectedUpdatedAt/actualUpdatedAt。字段按错误场景不同，不保证总齐全，也不是可公开的脱敏日志。

| 错误类别 | 代表 code | 处理 |
| --- | --- | --- |
| 连接 | BRIDGE_UNAVAILABLE、BROKER_UPGRADE_REQUIRED、INSTANCE_OFFLINE、INSTANCE_MISMATCH | 检查本机服务、版本和实例 |
| 鉴权 | WORKFLOW_KEY_INVALID | 核对实例、工作流和 key；不得猜测或回显 |
| 编辑 | WORKFLOW_REVISION_CONFLICT、WORKFLOW_INVALID | 重新读取并合并，修正字段 |
| 输入 | INPUT_REQUIRED、INPUT_TYPE_MISMATCH、CALENDAR_DATE_INVALID | 对照 Start 和日期格式 |
| 定位 | FRAME_AMBIGUOUS_OR_MISSING、SELECTOR_NOT_FOUND、SELECTOR_INVALID、TARGET_NOT_INTERACTABLE | 读取当前 frame、弹层和范围 |
| 页面 | PAGE_URL_INVALID、NAVIGATION_OR_LOGIN_FAILED、CONTENT_SCRIPT_UNAVAILABLE | 检查权限、登录和导航 |
| AI | AI_PROVIDER_NOT_CONFIGURED、AI_PROVIDER_REQUEST_FAILED | 检查 Provider，防止外发至错误地址 |
| 执行 | INSTANCE_BUSY、POSTCONDITION_FAILED、CALENDAR_SELECTION_FAILED | 等待或检查操作后的真实状态 |
| 不确定结果 | EXECUTION_OUTCOME_UNKNOWN | 先读取页面/日志，再决定是否重试 |
| 截图 | SCREENSHOT_REGION_INVALID、SCREENSHOT_PERMISSION_DENIED、SCREENSHOT_PAGE_CHANGED、SCREENSHOT_LIMIT_EXCEEDED | 修正区域、权限或输出体积 |

另外可能出现 NODE_NOT_FOUND、WORKFLOW_NOT_FOUND、QUERY_PATTERN_INVALID、INTERNAL_ERROR。部分错误码通过错误文本规则归类，尚不是独立类型化异常系统；集成应容忍新 code，同时保存 message 和 context。

retryPolicy 为 after_fix、after_wait 或 inspect_before_retry。sideEffects=possible 表示动作可能已发生，不提供事务回滚或幂等保证。即使某次失败 sideEffects=none，前面的工作流步骤也可能已经执行。

普通桥接超时约 120 秒，运行/调试最多 31 分钟，截图请求 120 秒，截图采集本身约 90 秒。超时不等于业务取消；当前没有 MCP 取消运行工具、幂等 key 或自动续跑接口。

## 9. 内部桥接协议

以下用于理解架构，不建议企业业务系统绕过 MCP 直接调用。

- `/mcp-client`：本机 Node relay，broker_ready 协议号 1，声明 workflow_authoring_v1、page_screenshot_v1。
- `/extension`：插件 hello 携带 role、instanceId、version；后台每约 20 秒发送心跳。
- 请求：`{id,instanceId,method,params}`。
- 成功：`{id,ok:true,result}`；失败：`{id,ok:false,error,diagnostic?}`。
- 响应只接受对应实例 socket 的请求 ID，防止串线。

broker 有 method 白名单，未开放 set_state；但插件内部 handler 保留该方法，不应将它误认为在所有信任路径上都被鉴权。当前 WebSocket 没有统一共享密钥或客户端证书，不能作为公网服务直接暴露。
