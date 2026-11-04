# Windows / macOS / Linux MCP 部署

当前版本：扩展 **0.10.77**、MCP 服务 **0.10.21**。完整包带对应平台的官方 Node 22.23.3、扩展、服务、锁定生产依赖和 Setup；源码环境可自行构建。插件要求 Chrome 125+，本机启动器当前注册 Google Chrome 的默认 Native Messaging 位置。

## 选择完整包

| 文件 | 目标平台 | 首次执行 |
| --- | --- | --- |
| `Page-Agent-<版本>-Windows-x64.zip` | Windows x64 | `Setup.cmd` |
| `Page-Agent-<版本>-macOS-arm64.zip` | Apple 芯片 Mac | `Setup.command` |
| `Page-Agent-<版本>-macOS-x64.zip` | Intel Mac | `Setup.command` |

Windows ARM64 可由维护者用 `npm run package:windows -- --arm64` 构建；不要仅重命名 x64 包。Linux 当前使用源码部署。构建命令见 [交付产物说明](../deliverables/README.md)，生成包不随 Git 源码提交。

## 完整包安装与一键启动

1. 完整解压到固定、可写目录，保留 `runtime/`、`mcp-server/`、`extension/` 等全部内容。
2. 运行该目录的 Setup。它使用包内运行时生成 `page-agent-mcp.json`、写入扩展本机配置，并注册当前用户的 Chrome 启动器。
3. 在 Chrome 扩展管理页加载同一目录的 `extension/`，核对侧栏实际版本为 0.10.77。
4. 在插件 MCP 面板点击 **配置并启动**。插件读取本机配置，必要时拉起共享桥接，并核验连接及实际服务路径；无需在插件内手动导入文件或复制命令。
5. 模型客户端单独导入生成的 JSON 并启用 stdio MCP 服务。Setup 不会修改其他客户端的配置。

完整包使用不要求安装 Node、npm 或构建工具。移动目录或换用新版目录后重新运行该目录 Setup，并重新导入客户端配置。同目录删除重加插件无需重新复制 ID。插件 ZIP 仅包含扩展，不包含本机运行时和启动器。

“重试连接”只重连；“配置并启动”才负责启动与配置检查。服务已正常连接时不会为了重试而重启它。初次离线时先做 HTTP 就绪检测，避免不断创建失败的 WebSocket；Chrome 错误页中已存在的历史记录不会自动清除。

## 本机启动器的注册方式

Setup 使用 Chromium 路径哈希规则计算该扩展目录的 ID：Windows 使用 UTF-16LE 并归一化盘符，Mac/Linux 使用 UTF-8；manifest 已配置公钥时沿用公钥 ID。不会为了注册而修改 manifest.key、改变已有扩展身份。

| 平台 | 当前用户注册位置 |
| --- | --- |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Windows | `%LOCALAPPDATA%\PageAgent\NativeMessagingHosts\`，以及 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.page_agent.launcher` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/`，需在源码环境安装启动器 |

目录中包含 `com.page_agent.launcher.json` 和对应启动脚本。启动器限定明确的 Chrome 扩展 ID，仅接受固定的本机桥接启动请求，不接受任意命令、程序路径或网页操作。旧版手动安装命令在插件高级设置中保留。卸载时删除相应 manifest、启动脚本；Windows 还需删除对应的 HKCU 注册项。

注册只适用于当前实现的 Google Chrome 位置；不能据此承诺 Edge 或其他 Chromium 浏览器的一键启动已通过验证。

## 从源码部署

在目标电脑安装与 CI 一致的 Node.js 22 和 npm，将项目放到固定目录，在根目录执行：

```bash
npm ci
npm --prefix mcp-server ci
npm run mcp:build
npm run build
npm run mcp:config
```

Chrome 加载 `dist/`。生成的客户端配置使用当前电脑的 Node 完整路径和 `mcp-server/dist/index.js` 路径，例如：

```json
{
  "mcpServers": {
    "page-agent": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Page Agent\\mcp-server\\dist\\index.js"],
      "env": {"PAGE_AGENT_BRIDGE_PORT": "17373"}
    }
  }
}
```

示例路径需要替换，优先使用 `npm run mcp:config` 的实际输出。JSON 中 Windows 反斜线必须转义；参数数组保留路径中的空格，不要额外嵌入引号，也不要把 `npm.cmd` 当作 Node 可执行文件。PowerShell 拦截 npm.ps1 时可通过 `npm.cmd` 运行 npm 命令。

源码环境若要由插件一键启动本机服务，可按 MCP 面板高级设置显示的当前插件 ID 和本机路径安装启动器；不安装时保留由客户端启动共享桥接的方式。

## 升级与连接排障

1. 先确认工作流和后台录制均已结束，导出重要工作流，再更新扩展与服务。
2. 侧栏核对扩展 0.10.77，MCP 面板核对服务 0.10.21、实际脚本路径和连接的实例。
3. 换目录后运行新目录 Setup 或重新生成源码配置；客户端配置需分别更新。插件不会自动改写其他客户端的配置。
4. 共享 broker 独立于 stdio 客户端存活。仅关闭客户端可能仍连接旧目录服务，空闲后只停止已确认的旧 broker，再重新连接；不要结束所有 Node 进程。
5. 客户端能列出工具但插件离线时，检查 `127.0.0.1:17373` 的监听者及启动路径。WebSocket `/extension` 地址不作为客户端 HTTP MCP 地址，不需要开放到局域网。
6. 异步录屏要求已连接具备任务能力的新版服务；状态 URL、文件 URL 也只在本机可访问，详见 [录制协议](live-recording.md)。

## 验证范围与平台限制

Mac 已使用完整包运行时、安装器和标准 Chrome 完成抖音直播三分钟实录：MCP 101 ms 返回 URL，断开客户端后仍录制，最终 HTTP 下载与 Chrome 原文件一致。详细结果见 [录制验证记录](live-recording.md#最新包抖音异步实录2026-11-03)。

Windows x64 包已核对 PE 架构、依赖版本、ZIP 完整性和平台分支；0.10.77 起只打包生产依赖，移除构建机 macOS 开发模块。Windows ZIP 中的 JavaScript/SDK 使用 Mac Node 完成了 MCP 握手及 22 个工具发现，这不等于运行过 Windows 的 node.exe、cmd.exe 或 Chrome。

**Windows 真机录屏、Native Messaging 管道及非 UTF-8 系统代码页下中文安装路径仍待验收。** 可先在英文目录完成 Windows 基础验收，再单独验证中文目录。Windows/macOS/Linux 的 CI 构建与单元测试矩阵不替代各系统的浏览器录制验收。完整包未作整体签名或公证，具体运行条件以操作系统和企业实际策略为准。
