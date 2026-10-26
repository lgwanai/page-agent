#!/bin/bash
set -eu
SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname "$0")" && pwd)"
if [ ! -x "$SCRIPT_DIR/runtime/node" ]; then
  echo '请完整解压安装包。若文件被企业安全策略阻止，请联系管理员审核。'
  exit 1
fi
if ! "$SCRIPT_DIR/runtime/node" "$SCRIPT_DIR/setup.mjs" "$@"; then
  echo '配置生成失败：请确认整个安装包已解压到可写目录，且芯片版本匹配。'
  exit 1
fi
echo ''
echo 'Chrome：打开 chrome://extensions，开启开发者模式，加载本目录的 extension 文件夹。'
echo 'MCP：导入本目录 page-agent-mcp.json，或粘贴剪贴板中的配置。'
if [ -t 0 ]; then
  read -r -p '按回车关闭窗口…' unused
fi
