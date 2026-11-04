// Runs with the bundled Node, not the customer's PATH or npm installation.
import { existsSync, writeFileSync, renameSync, realpathSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
const entry = join(root, 'mcp-server', 'dist', 'index.js');
if (!existsSync(entry)) throw new Error('Incomplete package: extract the entire ZIP before running setup.');
const runtime = join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const extension = join(root, 'extension');
const manifest = join(extension, 'manifest.json');
if (!existsSync(runtime) || !statSync(runtime).isFile() || !statSync(entry).isFile() || !existsSync(manifest)) throw new Error('Incomplete package: runtime, extension and mcp-server must be in the same extracted folder.');
const version = JSON.parse(readFileSync(manifest, 'utf8')).version ?? 'unknown';
// Chrome cannot install a native host itself. Do it once here, with the ID
// Chromium will assign to this exact extension directory (no manifest changes).
if (!process.argv.includes('--no-native-host')) {
  const host = join(root, 'mcp-server', 'dist', 'native-host.js');
  if (!existsSync(host)) throw new Error('本机启动器缺失，请完整解压 v0.10.69+ 安装包。');
  const { installNativeHost, extensionIdForDirectory } = await import(pathToFileURL(host).href);
  const extensionId = extensionIdForDirectory(extension);
  installNativeHost(extensionId, { runtime, script: host });
  console.log(`本机启动器已自动注册（Chrome 插件 ${extensionId}）。无需导入文件或执行终端命令。`);
}

const config = { mcpServers: { 'page-agent': {
  // Always select this package's runtime, even if setup.mjs was launched by a
  // system Node or another version's launcher. Do not inherit that old path.
  command: runtime,
  args: [entry],
  env: { PAGE_AGENT_BRIDGE_PORT: '17373' },
} } };
const json = JSON.stringify(config, null, 2);
const target = join(root, 'page-agent-mcp.json');
writeFileSync(`${target}.tmp`, json + '\n', 'utf8');
renameSync(`${target}.tmp`, target);
const extensionConfig = join(root, 'extension', 'mcp-local-config.json');
if (existsSync(join(root, 'extension', 'manifest.json'))) {
  // Private extension metadata, not part of the client JSON: a fresh Setup run
  // invalidates old manual overrides even when the package stays in one folder.
  writeFileSync(extensionConfig, JSON.stringify({ ...config, pageAgentSetup: { revision: randomUUID(), version } }, null, 2) + '\n', 'utf8');
  console.log('本机配置已自动写入插件目录。加载该目录后，在 MCP 页面点击「配置并启动」即可。');
}
console.log('Page Agent MCP configuration created:\n' + target);
console.log(`\nPackage version: ${version}\nPackage directory: ${root}\nMCP executable: ${runtime}\nMCP script: ${entry}\nChrome extension directory: ${extension}`);
console.log('\nUpgrade: import this JSON into every MCP client. Setup does not change their saved configuration.');
console.log('Chrome Reload keeps the old extension folder: verify the loaded directory and version.');
console.log('A shared broker may still be running from an old folder. Check its reported script path before stopping it; do not interrupt active workflows.');
if (!process.argv.includes('--no-clipboard') && ['win32', 'darwin'].includes(process.platform)) {
  const copy = process.platform === 'win32'
    ? spawnSync('clip.exe', [], { input: Buffer.from(json, 'utf16le'), windowsHide: true })
    : spawnSync('/usr/bin/pbcopy', [], { input: json, encoding: 'utf8', env: { ...process.env, LANG: 'en_US.UTF-8' } });
  console.log(copy.status === 0 ? '\nConfiguration copied to clipboard. Paste/import it in your MCP client.' : '\nOpen page-agent-mcp.json and import/copy its contents into your MCP client.');
}
console.log('\n插件内无需手动导入 JSON，也无需复制安装命令。其他模型客户端仍按需导入 MCP 配置。');
console.log('\nNo dependencies or build steps are required. Keep this folder in its current location.');
console.log('After moving the folder, run setup again and re-import the generated configuration.');
