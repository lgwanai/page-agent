# Page Agent

Page Agent 把传统网页中的操作流程固化为可复用的 **Action** 和 **Script**。模型调用时只需选择并运行已有能力，不必每次通过 CDP 抓取整页 DOM、重新理解页面再执行。

## 当前能力（v0.4）

- Chrome/Edge Manifest V3 Side Panel，执行模式与编排模式分离
- Select 工具：进入无事件响应的页面选择状态，悬停高亮并生成稳定 selector
- DOM 节点：点击、双击、输入内容、选择、勾选、悬停、聚焦、按键、提交、自定义事件等
- FlowGram 自由布局画布：节点右侧使用成功/失败连接点；悬停点击“＋”会选择网页 DOM、创建后续 Selector 节点并自动连线，也保留手动拖线
- AI Provider：支持 OpenAI、火山方舟 Ark、DeepSeek 和自定义 OpenAI-compatible API
- AI 节点：真实调用已配置模型进行分析，可返回结构化 output、调用 Action 或操作具名 selector 输入
- AI 输入列表：可从网页 Selector、已有节点或固定文本添加，支持单节点和列表读取
- 自动结果验收：输入、选择、勾选会比对页面最终值，点击等操作会确认目标收到真实 DOM 事件；节点丢失、隐藏、禁用或结果不符都会走失败出口
- 循环节点：遍历数组、当前项/索引变量、最大次数和“遍历/完成/失败”端口
- 所有可执行节点都有“成功/失败”端口；失败分支存在时会进入恢复流程
- 显式保存：未保存画布只存在于当前侧栏会话；本地 `schemaVersion: 2` 库仅持久化 Action 与 Script
- Action：保存一组通用步骤，并可被其他流程复用
- Script：保存完整业务流程，出现在执行模式列表
- `{{变量名}}`：事件值、AI 指令和 selector 支持运行时变量
- 本地 MCP Bridge：模型可列出和执行 Script/Action，不需要读取整页 DOM

## 运行插件

```bash
npm install
npm run build
```

打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载本项目的 `dist/`。

## 配置 AI Provider

点击插件顶部的“配置 AI”，填写：

- `Base URL`：例如 OpenAI 的 `https://api.openai.com/v1`、火山方舟的 `https://ark.cn-beijing.volces.com/api/v3`
- `Model`：模型 ID；方舟可填写推理 Endpoint ID
- `API Key`：只保存在 Chrome extension local storage 的独立 secret key 中

API Key 不会进入工作流 JSON、Action、Script 或 MCP 的 `get_page_agent_workspace` 输出。点击“测试连接”可在保存前验证。

## 编排一个流程

1. 打开目标网页并点击 Page Agent 图标。
2. 切换到“编排模式”，点击“选择网页节点”。
3. 在网页中悬停、点击目标元素，插件会生成带唯一名称的 Selector 节点。
4. 在 FlowGram 画布中选择节点，通过属性面板配置“输入内容”“点击”等事件；操作后的页面状态由执行器自动验收。
5. 节点右侧绿色点代表成功路径、红色点代表失败路径。悬停点击“＋”，再到网页选择 DOM，即可创建并自动连接后续 Selector 节点；也可以直接拖线连接已有节点。
6. AI 节点的输入可以通过 Selector 工具采集，也可以选择已有节点或添加文本。
7. 每张执行卡片默认有“成功/失败”出口；节点不存在、不可操作、事件未触发或最终状态与操作预期不符时走失败出口。循环节点的“遍历”分支末端需要连回循环节点，“完成”出口进入后续流程。
8. 点击“运行画布”验证，再保存为 Action 或 Script。

再次进入编排模式时默认是空白新流程。点击顶部“打开”可选择已保存的 Action 或 Script 载入编辑器；只有点击“保存/更新”才会写入 Chrome 本地存储。

## MCP 接入

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

MCP Server 启动后监听 `127.0.0.1:17373`；插件后台会自动连接。连接完全在本机进行，侧栏右上角 MCP 指示器会变绿。

可用工具：

- `page_agent_status`
- `list_page_scripts`
- `list_page_actions`
- `run_page_script`
- `run_page_action`
- `get_page_agent_workspace`

## 工作流表达式

节点名称是运行时变量的命名空间，例如：

- `{{客户列表AI.output.items}}`：读取 AI 节点返回的数据
- `{{客户列表AI.decision}}`：读取 AI 的分支决策
- `{{item.name}}`：循环体内读取当前项
- `{{index}}`：循环体内读取当前索引

## 设计边界

FlowGram 仅作为画布和节点编辑层使用。它的官方 Runtime 仍定位为早期参考实现，因此 Page Agent 使用自己的 Chrome 图运行时执行 DOM、Action、自动结果验收、失败分支和循环。这样不会把浏览器执行稳定性绑定到上游 Runtime 的 API 变更。

当前 Provider 使用 OpenAI-compatible Chat Completions 协议。Anthropic 原生 Messages、Gemini 原生 API 等非兼容协议可以在后续通过 Provider Adapter 扩展。
