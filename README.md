# Page Agent

Page Agent 把传统网页中的操作流程固化为可复用的 **Action** 和 **Script**。模型调用时只需选择并运行已有能力，不必每次通过 CDP 抓取整页 DOM、重新理解页面再执行。

## 当前能力

- Chrome/Edge Manifest V3 Side Panel，执行模式与编排模式分离
- Select 工具：进入无事件响应的页面选择状态，悬停高亮并生成稳定 selector
- DOM 节点：点击、双击、输入内容、选择、勾选、悬停、聚焦、按键、提交、自定义事件等
- AI 节点：用自然语言在动态 DOM 中语义定位元素，并可继续调用一个 Action
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

## 编排一个流程

1. 打开目标网页并点击 Page Agent 图标。
2. 切换到“编排模式”，点击“选择网页节点”。
3. 在网页中悬停、点击目标元素，插件会生成节点。
4. 为节点选择“输入内容”“点击”等用户语义事件；可以单步运行验证。
5. 添加更多节点或 AI 节点，点击“运行流程”验证完整链路。
6. 可将流程保存为 Action，或保存为 Script 后在执行模式一键运行。

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

## 设计边界

首版 AI 节点使用本地可解释的语义匹配器，适合“找到包含某客户名的行并点击”等动态列表场景，不绑定任何云端模型。后续可以在 MCP Bridge 上增加 Model Resolver，由宿主模型返回候选节点或分支决策；现有 Script/Action 数据结构无需变化。
