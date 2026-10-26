# Windows / macOS / Linux MCP 部署

## macOS 客户免安装包（推荐）

分别提供 `Page-Agent-<版本>-macOS-arm64.zip`（Apple 芯片）和 `Page-Agent-<版本>-macOS-x64.zip`（Intel）。完整解压到固定且可写的目录，双击 `Setup.command`，即可使用内置 Node 生成本机 `page-agent-mcp.json` 并复制到剪贴板。在 MCP 客户端导入或粘贴配置，首次手动加载包内 `extension` 即可。

客户不需要安装 Node、npm、依赖或构建，也无需修改路径；不修改其他 MCP 客户端配置。目录移动后重新运行 Setup 并重新导入配置。包内保留运行时和启动脚本的执行权限。整体安装包尚未签名或公证；如被系统或企业安全策略阻止，应联系管理员审核，不要关闭保护或绕过系统警告。

维护者运行 `npm run package:mac` 一次生成两种芯片版本；也可指定 `-- --arm64` 或 `-- --x64`。打包时校验 Node 官方运行时 SHA-256，并只包含 MCP 的锁定生产依赖，保留第三方许可证。

## Windows 客户免安装包（推荐）

交付文件为 `deliverables/Page-Agent-<版本>-Windows-x64.zip`。完整解压到固定目录后：

1. 双击 `Setup.cmd`：自动使用内置 Node 生成本机 `page-agent-mcp.json`，并复制配置到剪贴板。
2. 在 MCP 客户端导入该 JSON 或粘贴配置，不用修改路径，不会自动覆盖其他 MCP 配置。
3. 在 Chrome 扩展管理页开启开发者模式，加载解压目录内的 `extension`。

客户无需安装 Node、npm、依赖，也无需构建。包内不包含客户密钥或工作流，现有 Chrome 插件数据不受影响。移动解压目录后需再次双击 Setup，并重新导入配置。x64 包用于 Windows x64；ARM64 需由维护者执行 `npm run package:windows -- --arm64` 生成对应包。

维护者打包命令为 `npm run package:windows`，从 Node 官方站点下载固定版本运行时并验证 SHA-256，内置服务和依赖。程序不会修改防火墙、注册开机启动、自动授予权限或修改其他客户端配置。企业安全策略如阻止未签名脚本，应由客户管理员审核，不能绕过保护。

以下源码部署步骤仅供维护者或不使用免安装包的环境使用。

扩展不能启动本机 Node，也不能扫描本机文件系统。MCP 客户端通过 stdio 启动本机服务，服务再连接本机共享桥接。复制扩展 dist 不会同时安装 Node 或 MCP 服务。

## 在目标电脑准备

安装 Node.js 22 LTS（或兼容的新版本），将完整项目放到目标电脑，例如 `C:\Page Agent`。在该目录打开终端运行：

```text
npm --prefix mcp-server install
npm run mcp:build
npm run mcp:config
```

最后一条命令输出 JSON 配置，自动使用**当前电脑**的 Node 完整路径及项目脚本完整路径。将输出中的 JSON 添加到 MCP 客户端配置；不要复制 npm 的命令标题。Windows PowerShell 如拦截 npm.ps1，可用 `npm.cmd` 执行上述安装/构建命令；生成 JSON 中的 command 仍应是 `node.exe`。

示例（实际路径以命令输出为准）：

```json
{
  "mcpServers": {
    "page-agent": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Page Agent\\mcp-server\\dist\\index.js"],
      "env": { "PAGE_AGENT_BRIDGE_PORT": "17373" }
    }
  }
}
```

参数数组会保留路径中的空格、中文。不要在路径字符串里再次嵌入引号，也不要将 command 改为 npm.cmd、npx.cmd 或带参数的命令行。

## 升级与排障

1. 重新加载 dist 插件，确认 v0.10.34 或更高；更新并重新构建 MCP 服务（本次为 v0.10.5）。
2. 跨系统构建路径及从另一系统保存的路径会被清空，防止生成明显无法运行的配置。同系统迁移目录也需要重新运行 `npm run mcp:config`。
3. 重启 MCP 客户端。插件“记住配置”不会自动修改其他客户端的配置。
4. 若显示 Connection closed，先确认生成 JSON 中 command 和 args[0] 在本机存在，再查看客户端启动 stderr。仅 dist 扩展目录不够，需要保留 MCP 服务的 dist 和 node_modules。
5. 如果客户端能列出工具但插件离线，检查本机 127.0.0.1:17373 的占用和安全软件。无需将端口开放到局域网，也不要关闭防火墙。
6. 多客户端共用一个 broker；服务升级时需停止旧 broker 后重连客户端。不要为了排障结束所有 Node 进程，其他项目也可能依赖它们。

已增加 Windows/macOS/Linux CI 构建测试矩阵；本地 macOS 上的模拟 Windows 路径测试不等于 Windows 实机验证。
