// Release-builder only. The resulting customer package requires neither npm nor installed Node.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ZipArchive } from 'archiver';
import unzipper from 'unzipper';
import { writeCustomerGuide } from './customer-guide.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
// Pin release artifacts; never execute code downloaded from arbitrary mirrors.
const nodeVersion = '22.23.3';
const archiveName = `node-v${nodeVersion}-win-${arch}.zip`;
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
const work = await mkdtemp(join(tmpdir(), 'page-agent-windows-'));
const bundle = join(work, `Page-Agent-${version}-Windows-${arch}`);
await mkdir(bundle, { recursive: true });
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
console.log(`Downloading official Node ${nodeVersion} Windows ${arch} runtime…`);
const [archive, checksums] = await Promise.all([download(base + archiveName), download(base + 'SHASUMS256.txt')]);
const expected = checksums.toString('utf8').split(/\r?\n/).find(line => line.trim().endsWith(` ${archiveName}`))?.trim().split(/\s+/)[0];
if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Official Node SHA-256 verification failed');
const zip = await unzipper.Open.buffer(archive);
await zip.extract({ path: join(work, 'node') });
const runtime = join(work, 'node', `node-v${nodeVersion}-win-${arch}`);
await mkdir(join(bundle, 'runtime'));
for (const file of ['node.exe', 'LICENSE']) await cp(join(runtime, file), join(bundle, 'runtime', file));
function run(script, env = {}) {
  // Invoke npm's JS CLI directly: avoids shell quoting and npm.cmd differences.
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this builder using npm run package:windows');
  const result = spawnSync(process.execPath, [npm, 'run', script], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed`);
}
run('mcp:build');
run('build', { PAGE_AGENT_PORTABLE: '1' });
await cp(join(root, 'dist'), join(bundle, 'extension'), { recursive: true });
await cp(join(root, 'mcp-server', 'dist'), join(bundle, 'mcp-server', 'dist'), { recursive: true });
// Keep the complete installed dependency tree to preserve ESM, optional dependencies and licenses.
await cp(join(root, 'mcp-server', 'node_modules'), join(bundle, 'mcp-server', 'node_modules'), { recursive: true });
await cp(join(root, 'mcp-server', 'package.json'), join(bundle, 'mcp-server', 'package.json'));
await cp(join(root, 'scripts', 'portable-setup.mjs'), join(bundle, 'setup.mjs'));
await cp(join(root, 'scripts', 'windows-setup.cmd'), join(bundle, 'Setup.cmd'));
await writeCustomerGuide(bundle);
await writeFile(join(bundle, 'README.txt'), '\ufeff' + [
  `Page Agent ${version} — Windows ${arch} 免安装版`, '',
  '1. 将整个压缩包解压到固定目录（支持空格和中文路径），不要直接在压缩包内运行。',
  '2. 双击 Setup.cmd，自动生成 page-agent-mcp.json 并复制配置到剪贴板。',
  '3. 在 MCP 客户端导入 JSON 或粘贴配置。不会自动修改或覆盖其他客户端的配置。',
  '4. Chrome 扩展管理页开启开发者模式，加载已解压的扩展，选择 extension 文件夹。',
  '无需安装 Node、npm、依赖或构建代码。',
  'v0.10.51 日历新增 Fusion Next 日期时间区间适配：开始/结束文本参数 activity_start_time、activity_end_time 使用 YYYY-MM-DD HH:mm:ss；日历引用对应变量，点击日期及两端时分秒、日历内确定，核验主表单完整实际值后再 Output。',
  '示例：activity_start_time="2026-11-01 10:11:12"，activity_end_time="2026-12-05 20:21:22"。以页面实际允许日期和活动时长为准；不会自动提交报名，不支持的时间控件会明确失败。详见客户使用说明“日历时分秒与活动参数”。',
  '原 YYYY-MM-DD 纯日期逻辑保留。包含 v0.10.50 异步自定义下拉精确选择、Query 指定列读取和分页匹配后提前结束能力。',
  'v0.10.49 包含 Selector 与动态页面修复：保留实时 SPA 地址，排除动态 processId 但保留活动 ID 等业务参数；旧节点需在正确界面重新选取并更新工作流。',
  '包含录制去噪、新标签页跟随及单文件 content-script.js，减少纯鼠标经过产生的无效节点和页面脚本加载失败。FRAME_DOCUMENT_MISMATCH 与 CSS 找不到分别报错。详见客户使用说明“Selector 与动态页面定位修复”。',
  'v0.10.46 新增 Output：支持返回文本、变量、前序节点和 DOM 属性；output/businessOk 与执行 ok 分开。Query 无匹配可走失败分支。详见客户使用说明第七节。',
  '包含 v0.10.43 类型化手动参数弹窗及独立记忆、v0.10.44–45 起止日期实际校验与侧栏焦点修复；MCP 不读取手动输入历史。',
  'v0.10.42 扩展焦点 focus/blur、focusin/focusout、鼠标进入/移出、change/reset、导航键与组合键录制；支持输入法及粘贴/剪切后最终值采集，同次焦点及隐式激活动作去重。',
  '工作流重命名：列表“更多操作 → 重命名”或编辑标题旁铅笔；不改变工作流 ID、key 或节点配置。节点改动仍须更新工作流。详见客户使用说明第七节。',
  '路径检查：本包不含预生成的本机配置。必须运行本目录 Setup.cmd；生成的 command 和 args[0] 均应位于本次解压目录。重新运行后重新加载本包插件，并给每个 MCP 客户端重新导入新 JSON。',
  'v0.10.41 表格填充支持 ul/li、div、table 表头与 div 行以及表头/表体分离。请选择共同外层容器；复杂布局可配置表头、数据行和行内单元格 CSS Selector。',
  '客户使用说明.html 第八节提供可核对的 HTML、data 和高级 Selector 示例。不要将这些网页 Selector 当作本机 MCP 文件路径。',
  'v0.10.40 修复升级后旧 MCP 服务覆盖新路径：面板分别显示本机配置与当前服务，路径不一致时提示，不会自动停止旧服务。',
  '升级请先导出工作流备份，核对 Chrome 加载目录和侧栏版本；重新加载旧扩展不会切换到新目录。每个 MCP 客户端也须重新导入新 JSON。',
  'v0.10.39 新增表格填充节点：开始节点声明 data 为对象列表（对象数组），选择网页表格，配置一个或多个 key 列，填充数据使用 {{data}}。',
  '按同名表头填入输入框、下拉、单选和多选，跳过只读列并校验结果；Excel 需先转对象数组。完整配置及 JSON 示例见 客户使用说明.html 第八节。',
  '新版：运行期间自动确认原生 alert（新增 debugger 权限）；支持网页拖拽录制；开始节点可勾选“保持当前页面，不跳转、不刷新”。',
  '升级后请核对侧栏版本、按企业要求确认新增权限，并刷新业务网页。详情和限制见 客户使用说明.html。',
  '移动文件夹后请重新运行 Setup.cmd，并在 MCP 客户端重新导入配置。',
  '请保留 runtime、mcp-server、extension 等全部文件夹。不要将本机桥接端口开放到外网。',
  '本包包含第三方开源组件，许可证见 runtime/LICENSE 和各 node_modules 包目录。',
  '此包未签名。若企业安全策略阻止运行，请交由管理员审核；不要绕过安全提示或关闭防护。',
].join('\r\n'), 'utf8');
const outputDir = join(root, 'deliverables');
await mkdir(outputDir, { recursive: true });
const outputPath = join(outputDir, `Page-Agent-${version}-Windows-${arch}.zip`);
// Refuse accidental overwrite of an existing release.
const output = createWriteStream(outputPath, { flags: 'wx' });
const packed = new ZipArchive({ zlib: { level: 9 } });
const complete = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); packed.on('error', reject); });
packed.pipe(output);
packed.directory(bundle, false);
await packed.finalize();
await complete;
console.log(`Windows customer package: ${outputPath}`);
console.log(`Staging folder retained for inspection: ${bundle}`);
