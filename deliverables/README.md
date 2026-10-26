# 构建与交付产物

本目录用于本机生成的安装包、离线文档包和校验截图。GitHub 源码只保留本说明，不提交旧安装包、Node 运行时或本机配置。

## 用户使用手册

- 源文档与导航：[使用手册](../docs/README.md)。
- 可直接打开的离线 HTML：[user-manual.html](../docs/user-manual.html)，支持章节导航、搜索、代码复制和打印/保存 PDF。
- 执行 `npm run docs:build` 后，本目录生成 `page-agent-user-manual-<插件版本>.zip`，包含分章文档、3 个练习流程、本地页面和只读静态服务脚本。
- 文档检查：`npm run docs:check`。

当前手册基线为扩展 0.10.66 / MCP 0.10.17，共 29 章。文档 ZIP 是构建结果，应从完成构建的本机或实际发布附件获取，源码克隆不包含该 ZIP。

## 扩展与便携包

| 命令 | 生成内容 |
| --- | --- |
| `npm run release:extension` | `page-agent-extension-<版本>.zip` |
| `npm run package:windows` | Windows 便携包，具体架构见命令参数 |
| `npm run package:mac` | macOS arm64/x64 便携包 |

不同交付包应以各自实际生成的版本为准。构建与安装说明见 [安装与升级](../docs/guide/installation.md) 和 [跨系统部署](../docs/cross-platform-mcp.md)。

## 历史企业评估手册

`scripts/build-customer-docs.mjs` 与 `scripts/customer-docs/` 用于早期企业技术评估 HTML 的构建，其 2026-10-10 内容属于历史基线，不替代当前使用手册。相关源文件保留在 [enterprise](../docs/enterprise/README.md)。
