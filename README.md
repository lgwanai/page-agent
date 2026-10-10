# Page Agent

Page Agent 把传统网页中的操作流程固化为可复用的 **Action** 和 **工作流**。模型调用时只需按 ID 运行已有能力，不必每次通过 CDP 抓取整页 DOM、重新理解页面再执行。

## 当前能力（v0.10.15）

- Chrome/Edge Manifest V3 Side Panel，工作流列表、录制状态和专注编辑界面分离
- 工作流录制：网页悬浮显示录制状态和停止按钮，记录点击、双击、输入、选择、勾选、滚动、右键、长按和提交，停止后自动生成可编辑节点图
- 工作流列表：每个工作流使用全局唯一 UUID，并有独立的本机访问密钥
- JSON 导入导出：使用版本化工作流规范；导出文件不包含访问密钥，导入后生成新的本机密钥
- Start 节点：每个新流程默认包含唯一入口，可用表单控件声明 MCP 输入参数及类型、导航目标 URL、校验最终页面、等待人工登录完成并在页面稳定后自动继续
- Select 工具：进入无事件响应的页面选择状态，悬停高亮并生成稳定 selector
- DOM 节点：分析元素标签、输入类型和语义属性，只提供当前元素真正适用的操作；原生下拉框会直接读取可选项
- FlowGram 自由布局画布：按住空白处拖动平移，滚轮以鼠标位置为中心缩放（25%–200%），Shift + 拖动可框选节点；节点右侧使用成功/失败连接点，悬停点击“＋”后可从 Selector、Query、AI、循环、等待五类节点中选择，并自动创建和连线
- Query 节点：选择 DOM 范围，遍历并按属性名称、当前值或文本检索；支持存在、相同、包含和正则匹配，返回可供 AI 和循环使用的 DOM 列表
- AI Provider：支持 OpenAI、火山方舟 Ark、DeepSeek 和自定义 OpenAI-compatible API
- AI 节点：真实调用已配置模型进行分析，可返回结构化 output、调用 Action 或操作具名 selector 输入
- AI 输入列表：可从网页 Selector、已有节点或固定文本添加，支持单节点和列表读取
- 自动结果验收：输入、选择、勾选会比对页面最终值，点击等操作会确认目标收到真实 DOM 事件；节点丢失、隐藏、禁用或结果不符都会走失败出口
- 循环节点：遍历数组、当前项/索引变量、最大次数和“遍历/完成/失败”端口
- 所有可执行节点都有“成功/失败”端口；失败分支存在时会进入恢复流程
- 显式保存：未保存画布只存在于当前侧栏会话；本地 `schemaVersion: 2` 库仅持久化 Action 与工作流
- Action：保存一组通用步骤，并可被其他流程复用
- 工作流：保存完整业务流程，出现在首页列表，并可通过 ID + 密钥供 MCP 调用
- `{{变量名}}`：事件值、AI 指令、selector 和循环支持 Start 映射的字符串、数字、布尔值、对象或数组
- 本地 MCP Bridge：模型可列出和执行工作流/Action，不需要读取整页 DOM

## 运行插件

```bash
npm install
npm run build
```

打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载本项目的 `dist/`。

插件顶部显示当前加载的版本号。每次发布插件代码更新时，递增 patch 版本，并同步 `manifest.json`、`package.json`、`package-lock.json` 后重新构建；不要用旧版本号发布不同的插件构建。

## 配置 AI Provider

点击插件顶部的“配置 AI”，填写：

- `Base URL`：例如 OpenAI 的 `https://api.openai.com/v1`、火山方舟的 `https://ark.cn-beijing.volces.com/api/v3`
- `Model`：模型 ID；方舟可填写推理 Endpoint ID
- `API Key`：只保存在 Chrome extension local storage 的独立 secret key 中

API Key 不会进入工作流 JSON、Action、Script 或 MCP 的 `get_page_agent_workspace` 输出。点击“测试连接”可在保存前验证。

## 编排一个流程

1. 打开 Page Agent，首页只展示已保存的工作流和创建、导入入口。点击“创建工作流” → “手动画布编辑”，才会进入画布并创建不可删除的 Start 节点。
2. 选择 Start，像设计表单一样声明 MCP 参数名称、类型、是否必填和用途说明，再配置目标页面 URL、普通/强校验、页面加载等待，以及登录跳转后的最长等待时间；URL 留空时使用当前页面。
3. 点击 Start 右侧路径连接点的“＋”，从 Selector、Query、AI、循环、等待五类节点中选择后续节点。
4. 选择 Selector 后，在网页中悬停、点击目标元素，插件会生成带唯一名称的网页节点并自动连线。
5. 在 FlowGram 画布中选择网页节点，通过属性面板配置“输入内容”“点击”等事件；操作后的页面状态由执行器自动验收。
6. AI 节点的输入可以通过 Selector 工具采集，也可以选择已有节点或添加文本。
7. 每张执行卡片默认有“成功/失败”出口；节点不存在、不可操作、事件未触发或最终状态与操作预期不符时走失败出口。循环节点的“遍历”分支末端需要连回循环节点，“完成”出口进入后续流程。
8. 点击“运行画布”验证，再保存为 Action 或 Script。

编辑界面不展示工作流列表，也不提供切换其他流程的入口。点击“返回列表”退出后，可通过工作流卡片的“编辑”重新打开；已有 Actions 可在首页折叠区域打开。旧流程会自动补齐 Start。只有点击“保存/更新”才会写入 Chrome 本地存储；未保存的修改在返回列表前会提示确认，确认后丢弃，新建流程不会载入上次草稿。

## MCP 接入

点击插件右上角 **MCP** 打开连接配置面板。面板显示连接状态、插件 WebSocket 地址和实例 ID；构建插件时会自动将本机 `mcp-server/dist/index.js` 的绝对路径和 Node 可执行文件路径带入配置，无需手填，直接复制 MCP 客户端 JSON 即可。支持记住自定义路径、恢复本机自动配置、刷新状态和重试连接。已保存的非空配置优先于自动路径，不会自动覆盖；路径信息不进入工作流 JSON。

自动路径对应构建插件的机器和项目位置，不是浏览器运行时扫描文件系统。迁移到其他电脑或移动项目目录后，在新位置重新构建插件，或通过面板修改路径。恢复自动配置后可点击“记住配置”替换此前保存的自定义配置。

插件不能自行启动 Node MCP 服务，需要将生成的配置添加到 MCP 客户端中并启用服务。不要把 `ws://127.0.0.1:17373/extension` 当作客户端 HTTP MCP 地址；该地址仅用于插件与本机服务通信。面板中包含安装、构建和常见连接错误的处理提示。

```bash
cd mcp-server
npm install
npm run build
```

在 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "page-agent": {
      "command": "node",
      "args": ["/absolute/path/to/page-agent/mcp-server/dist/index.js"]
    }
  }
}
```

MCP Server v0.8.0 支持多个工具同时连接：各工具启动独立 stdio 客户端进程，共享自动启动的本机桥接后台 `127.0.0.1:17373`，不再争抢端口。关闭一个工具不会断开其他工具或插件，桥接后台独立运行。各 Chrome 配置文件的插件连接互不顶替。同一插件实例同时运行多个工作流时会明确返回“正在执行”，避免互相操作页面；查询仍可并发。插件顶部显示实际加载的版本，MCP 实例列表可查询实例 ID。

从旧版 MCP 服务升级时，请先在所有工具中停用旧 Page Agent MCP，再启用新服务；旧服务仍占用端口时会提示升级，不会强制杀掉旧进程。v0.8.1 将 MCP 握手与桥接连接解耦，即使端口由旧服务占用，客户端也能初始化和列出工具，`page_agent_status` 返回具体错误，而不是退出导致 Connection closed。配置路径和端口无需修改。本次只升级 MCP Server，插件无需重新加载。桥接中断后的工作流不会自动重放，需检查页面后再重试。

`instanceId` 是本机生成并保存在当前 Chrome 配置文件中的 UUID，重启浏览器或插件后台不会改变；同一配置文件的多个窗口共享 ID，不同配置文件的插件安装有不同 ID。它不是 Chrome 操作系统进程号，也不是工作流 UUID；不会随工作流导入导出。未安装或未连接插件的 Chrome 实例无法被 MCP 操作。复制整个 Chrome 配置文件可能复制实例 ID，服务会拒绝重复 ID，不会覆盖已连接的实例。

可用工具：

- `page_agent_status`
- `list_page_agent_instances`
- `list_page_workflows`
- `run_page_workflow`
- `list_page_scripts`
- `list_page_actions`
- `run_page_script`
- `run_page_action`
- `get_page_agent_workspace`

先调用 `list_page_agent_instances` 获取已连接实例，再以目标 `instanceId` 调用 `list_page_workflows`。除实例发现和状态查询外，所有 MCP 工具（包括旧名称 `run_page_script`）都必须指定 `instanceId`。目标不在线或不存在时直接报错，不会自动切换到其他实例；重连不会自动重放未完成的网页操作。

`run_page_workflow` 必须同时传入 Chrome 插件实例 ID、工作流 UUID 和对应访问密钥。实例 ID 只用于定位，不能替代访问密钥。密钥可在插件工作流列表中点击“复制密钥”获取，不会出现在列表接口、工作流 JSON 或 workspace 输出中。`data` 接受 JSON 对象；Start 中可以通过中文控件选择“文本、数字、列表、对象、对象列表”，不需要编写 JSON Schema 或 JSON 路径。参数名称与 JSON 字段名称一致时自动映射。例如：

```json
{
  "instanceId": "91bcd01f-71be-4255-8f1a-ce8667321072",
  "workflowId": "30cb4d69-86b9-45aa-a497-e025f812c834",
  "key": "从插件复制的工作流密钥",
  "data": {
    "客户名": "华贸",
    "订单列表": [{ "sku": "A001", "quantity": 2 }]
  }
}
```

后续 DOM 输入值可填写 `{{客户名}}`，循环节点可填写 `{{订单列表}}`。Start 会在网页跳转前完成同名映射和类型校验；缺少必填参数或类型不符时从 Start 的失败出口继续，未连接失败出口则终止并返回清晰错误。旧版 `variables` 参数继续兼容，和 `data` 同时提供时以 `data` 的同名字段为准。

## 录制与导入导出

在首页点击“创建工作流” → “录制网页操作”，随后在网页中正常操作。侧栏只展示录制状态和停止按钮，网页右上角也会出现悬浮录制条；点击任一停止按钮后，插件用开始录制时的 URL 创建 Start 节点，并按操作顺序生成可编辑网页节点，自动进入专注编辑界面。密码内容不会被录入，插件会自动创建一个必填 Start 参数供运行时传入。

录制会先确认页面监听器已启动；对于扩展安装前已打开的网页，会自动补注入内容脚本。输入内容实时采集并合并连续变化，回车前会保存最终输入值，因此“点击搜索框 → 输入 WorkBuddy → 回车跳转”无需失焦也能生成正确顺序的节点。新页面加载时会自动重新接入当前录制，停止时等待已发送的操作保存完成。

同一标签页的文档跳转、SPA 重绘和浏览器前进/后退恢复都会重新挂载录制浮层；页面移除浮层 DOM 时也会自动恢复。页面加载完成不是唯一恢复时机，录制监听和浮层会在新文档就绪后恢复。停止后会清理 DOM 观察器，并拒绝旧页面的过期恢复消息，避免已停止的录制再次出现。

同一表单中，紧随 Enter 或点击操作触发的提交会作为该操作的页面响应合并，不再生成额外的“提交表单”节点。Enter 隐式触发的默认提交按钮点击也会合并。独立提交、其他表单的提交和后续独立提交仍会保留。回放 Enter 时，会尊重页面处理器和取消事件；单行输入框缺失的原生表单提交行为由执行器补齐，页面已提交时不再重复提交。

工作流列表支持导出 `.page-agent.json` 文件和导入 JSON。正式规范见 [docs/workflow-spec.md](docs/workflow-spec.md)，机器可读 Schema 见 [docs/workflow.schema.json](docs/workflow.schema.json)。导入发生 ID 冲突时会生成新的 UUID；密钥始终在本机重新生成。

## 工作流表达式

节点名称是运行时变量的命名空间，例如：

- `{{客户列表AI.output.items}}`：读取 AI 节点返回的数据
- `{{Query.output}}`：Query 匹配的 DOM 列表，可直接作为循环输入
- `{{item.selector}}`、`{{item.value}}`、`{{item.attributes.href}}`：循环中访问匹配元素的 selector、值和属性
- `{{客户列表AI.decision}}`：读取 AI 的分支决策
- `{{item.name}}`：循环体内读取当前项
- `{{index}}`：循环体内读取当前索引

### Query 使用示例

从工具栏或节点右侧“＋”添加 Query，在属性浮层选择网页中的列表容器，也可复用已有网页节点的 DOM。检索内容选择“DOM 属性”，属性名称填 `href`，匹配方式选择“正则匹配”，表达式填 `^/orders/[0-9]+$`，候选元素填 `a`，即可返回范围内符合条件的链接。运行后可以展开“查看匹配 DOM”检查结果。

“DOM 值”读取 input、textarea、select 的实时 value，其他元素读取文本；“文本内容”读取 textContent。检索输出是含 selector、frameId、value、text、matchedValue、attributes 等字段的 JSON 快照，可用于 AI 输入、循环或 MCP 执行结果。匹配内容支持 Start 输入变量，例如 `{{关键词}}`。没有匹配项返回空列表，非法 selector、范围不存在或正则错误走失败出口。

## 设计边界

FlowGram 仅作为画布和节点编辑层使用。它的官方 Runtime 仍定位为早期参考实现，因此 Page Agent 使用自己的 Chrome 图运行时执行 DOM、Action、自动结果验收、失败分支和循环。这样不会把浏览器执行稳定性绑定到上游 Runtime 的 API 变更。

当前 Provider 使用 OpenAI-compatible Chat Completions 协议。Anthropic 原生 Messages、Gemini 原生 API 等非兼容协议可以在后续通过 Provider Adapter 扩展。
