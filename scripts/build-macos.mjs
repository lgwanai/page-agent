// Release-builder only. Customers receive a complete, relocatable offline bundle.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ZipArchive } from 'archiver';
import { writeCustomerGuide } from './customer-guide.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const nodeVersion = '22.23.3';
const arches = process.argv.includes('--arm64') ? ['arm64'] : process.argv.includes('--x64') ? ['x64'] : ['arm64', 'x64'];
const work = await mkdtemp(join(tmpdir(), 'page-agent-macos-'));
const base = `https://nodejs.org/dist/v${nodeVersion}/`;
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this builder using npm run package:mac');
execute(process.execPath, [npm, 'run', 'mcp:build']);
execute(process.execPath, [npm, 'run', 'build'], { env: { ...process.env, PAGE_AGENT_PORTABLE: '1' } });
const checksums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
const lock = JSON.parse(await readFile(join(root, 'mcp-server', 'package-lock.json'), 'utf8'));
const outputDir = join(root, 'deliverables');
await mkdir(outputDir, { recursive: true });

for (const arch of arches) {
  const archiveName = `node-v${nodeVersion}-darwin-${arch}.tar.gz`;
  console.log(`Downloading official Node ${nodeVersion} macOS ${arch} runtime…`);
  const archive = process.env.PAGE_AGENT_NODE_CACHE
    ? await readFile(join(process.env.PAGE_AGENT_NODE_CACHE, archiveName))
    : await download(base + archiveName);
  const expected = checksums.split(/\r?\n/).find(line => line.trim().endsWith(` ${archiveName}`))?.trim().split(/\s+/)[0];
  if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('Official Node SHA-256 verification failed');
  const tarPath = join(work, archiveName);
  await writeFile(tarPath, archive);
  execute('tar', ['-xzf', tarPath, '-C', work]);
  const bundle = join(work, `Page-Agent-${version}-macOS-${arch}`);
  await mkdir(join(bundle, 'runtime'), { recursive: true });
  const runtime = join(work, `node-v${nodeVersion}-darwin-${arch}`);
  await cp(join(runtime, 'bin', 'node'), join(bundle, 'runtime', 'node'));
  await chmod(join(bundle, 'runtime', 'node'), 0o755);
  await cp(join(runtime, 'LICENSE'), join(bundle, 'runtime', 'LICENSE'));
  await cp(join(root, 'dist'), join(bundle, 'extension'), { recursive: true });
  await cp(join(root, 'mcp-server', 'dist'), join(bundle, 'mcp-server', 'dist'), { recursive: true });
  await cp(join(root, 'mcp-server', 'package.json'), join(bundle, 'mcp-server', 'package.json'));
  // Copy only locked production packages, retaining package files and licenses.
  // Excludes build tools and build-host architecture-specific development binaries.
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') || metadata.dev) continue;
    const source = join(root, 'mcp-server', path);
    if (!existsSync(source)) {
      if (metadata.optional) continue;
      throw new Error(`Missing production dependency: ${path}`);
    }
    await cp(source, join(bundle, 'mcp-server', path), { recursive: true });
  }
  await cp(join(root, 'scripts', 'portable-setup.mjs'), join(bundle, 'setup.mjs'));
  await cp(join(root, 'scripts', 'macos-setup.command'), join(bundle, 'Setup.command'));
  await chmod(join(bundle, 'Setup.command'), 0o755);
  await writeCustomerGuide(bundle);
  await writeFile(join(bundle, 'README.txt'), [
    `Page Agent ${version} — macOS ${arch === 'arm64' ? 'Apple 芯片' : 'Intel'} 免安装版`, '',
    '1. 完整解压到固定且可写的目录，不要直接在压缩包内运行。支持中文和空格路径。',
    '2. 双击 Setup.command，自动生成 page-agent-mcp.json，并复制配置到剪贴板。',
    '3. 在 MCP 客户端导入 JSON 或粘贴配置。不用修改路径，不会覆盖其他客户端配置。',
    '4. Chrome 打开 chrome://extensions，开启开发者模式，加载本目录 extension 文件夹。',
    '无需安装 Node、npm、依赖或构建代码。请保留所有文件夹。',
    'v0.10.51 日历新增 Fusion Next 日期时间区间适配：开始/结束文本参数 activity_start_time、activity_end_time 使用 YYYY-MM-DD HH:mm:ss；日历引用对应变量，点击日期及两端时分秒、日历内确定，核验主表单完整实际值后再 Output。',
    '示例：activity_start_time="2026-11-01 10:11:12"，activity_end_time="2026-12-05 20:21:22"。以页面实际允许日期和活动时长为准；不会自动提交报名，不支持的时间控件会明确失败。详见客户使用说明“日历时分秒与活动参数”。',
    '原 YYYY-MM-DD 纯日期逻辑保留。包含 v0.10.50 异步自定义下拉精确选择、Query 指定列读取和分页匹配后提前结束能力。',
    'v0.10.49 包含 Selector 与动态页面修复：保留实时 SPA 地址，排除动态 processId 但保留活动 ID 等业务参数；旧节点需在正确界面重新选取并更新工作流。',
    '包含录制去噪、新标签页跟随及单文件 content-script.js，减少纯鼠标经过产生的无效节点和页面脚本加载失败。FRAME_DOCUMENT_MISMATCH 与 CSS 找不到分别报错。详见客户使用说明“Selector 与动态页面定位修复”。',
    'v0.10.46 新增 Output：支持返回文本、变量、前序节点和 DOM 属性；output/businessOk 与执行 ok 分开。Query 无匹配可走失败分支。详见客户使用说明第七节。',
    '包含 v0.10.43 类型化手动参数弹窗及独立记忆、v0.10.44–45 起止日期实际校验与侧栏焦点修复；MCP 不读取手动输入历史。',
    'v0.10.42 扩展焦点 focus/blur、focusin/focusout、鼠标进入/移出、change/reset、导航键与组合键录制；支持输入法及粘贴/剪切后最终值采集，同次焦点及隐式激活动作去重。',
    '工作流重命名：列表“更多操作 → 重命名”或编辑标题旁铅笔；不改变工作流 ID、key 或节点配置。节点改动仍须更新工作流。详见客户使用说明第七节。',
    '路径检查：本包不含预生成的本机配置。必须运行本目录 Setup.command；生成的 command 和 args[0] 均应位于本次解压目录。重新运行后重新加载本包插件，并给每个 MCP 客户端重新导入新 JSON。',
    'v0.10.41 表格填充支持 ul/li、div、table 表头与 div 行以及表头/表体分离。请选择共同外层容器；复杂布局可配置表头、数据行和行内单元格 CSS Selector。',
    '客户使用说明.html 第八节提供可核对的 HTML、data 和高级 Selector 示例。不要将这些网页 Selector 当作本机 MCP 文件路径。',
    'v0.10.40 修复升级后旧 MCP 服务覆盖新路径：面板分别显示本机配置与当前服务，路径不一致时提示，不会自动停止旧服务。',
    '升级请先导出工作流备份，核对 Chrome 加载目录和侧栏版本；重新加载旧扩展不会切换到新目录。每个 MCP 客户端也须重新导入新 JSON。',
    'v0.10.39 新增表格填充节点：开始节点声明 data 为对象列表（对象数组），选择网页表格，配置一个或多个 key 列，填充数据使用 {{data}}。',
    '按同名表头填入输入框、下拉、单选和多选，跳过只读列并校验结果；Excel 需先转对象数组。完整配置及 JSON 示例见 客户使用说明.html 第八节。',
    '新版：运行期间自动确认原生 alert（新增 debugger 权限）；支持网页拖拽录制；开始节点可勾选“保持当前页面，不跳转、不刷新”。',
    '升级后请核对侧栏版本、按企业要求确认新增权限，并刷新业务网页。详情和限制见 客户使用说明.html。',
    '移动目录后请再次双击 Setup.command，并在 MCP 客户端重新导入配置。',
    '本包未进行整体签名或公证。如被 macOS 或企业安全策略阻止，请联系管理员审核，不要关闭系统保护。',
    'Apple 芯片请选择 arm64；Intel Mac 请选择 x64。系统兼容要求以包内 Node 官方运行时为准。',
    '不要将本机桥接端口开放到局域网或外网。包内不含客户密钥和工作流。',
    '第三方许可证见 runtime/LICENSE 和各 node_modules 包目录。',
  ].join('\n') + '\n', 'utf8');
  const outputPath = join(outputDir, `Page-Agent-${version}-macOS-${arch}.zip`);
  const output = createWriteStream(outputPath, { flags: 'wx' });
  const zip = new ZipArchive({ zlib: { level: 9 } });
  const complete = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); zip.on('error', reject); });
  zip.pipe(output);
  // Include a containing folder so Finder extraction cannot scatter bundle files.
  zip.directory(bundle, `Page-Agent-${version}-macOS-${arch}`);
  await zip.finalize();
  await complete;
  console.log(`macOS customer package: ${outputPath}`);
  console.log(`Staging folder retained for inspection: ${bundle}`);
}
