// Release verification only. Does not connect to or restart the shared broker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rename, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import unzipper from 'unzipper';
import { JSDOM } from 'jsdom';
import { customerGuideFiles } from './customer-guide.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')).version;
const mcpVersion = JSON.parse(await readFile(join(projectRoot, 'mcp-server/package.json'), 'utf8')).version;
const guides = await customerGuideFiles();
const guideDocument = new JSDOM(guides['客户使用说明.html']);
for (const anchor of guideDocument.window.document.querySelectorAll('nav a[href^="#"]')) assert(guideDocument.window.document.getElementById(anchor.getAttribute('href').slice(1)), `Missing guide section: ${anchor.getAttribute('href')}`);
const example = JSON.parse(guideDocument.window.document.querySelector('[data-example="activity-time-input"]').textContent);
assert.equal(example.activity_start_time, '2026-11-01 10:11:12');
assert.equal(example.activity_end_time, '2026-12-05 20:21:22');
assert.equal(JSON.parse(guideDocument.window.document.querySelector('[data-example="activity-time-output"]').textContent).businessOk, true);
guideDocument.window.close();
// Exercise Windows path generation on any release host. This is an isolated
// filesystem simulation, not a claim that node.exe ran on macOS.
const setupSource = await readFile(join(projectRoot, 'scripts/portable-setup.mjs'), 'utf8');
const setupScript = new Script(setupSource.replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', 'setupUrl'));
let windowsRevision = 0;
for (const windowsRoot of [`C:\\客户 文档\\Page-Agent-${version}`, `D:\\移动后 最新目录\\Page-Agent-${version}`]) {
  const stale = JSON.stringify({ mcpServers: { 'page-agent': { command: 'C:\\old\\0.10.37\\node.exe', args: ['C:\\old\\0.10.37\\index.js'] } } });
  const files = new Map([
    [win32.join(windowsRoot, 'runtime/node.exe'), 'runtime'],
    [win32.join(windowsRoot, 'mcp-server/dist/index.js'), 'entry'],
    [win32.join(windowsRoot, 'extension/manifest.json'), JSON.stringify({ version })],
    [win32.join(windowsRoot, 'page-agent-mcp.json'), stale],
    [win32.join(windowsRoot, 'extension/mcp-local-config.json'), stale],
  ]);
  const run = () => setupScript.runInNewContext({
    setupUrl: 'file:///windows-fixture/setup.mjs', dirname: win32.dirname, join: win32.join,
    fileURLToPath: () => win32.join(windowsRoot, 'setup.mjs'), realpathSync: () => windowsRoot,
    existsSync: path => files.has(path), statSync: () => ({ isFile: () => true }),
    readFileSync: path => { assert(files.has(path)); return files.get(path); },
    writeFileSync: (path, value) => files.set(path, value),
    renameSync: (from, to) => { assert(files.has(from)); files.set(to, files.get(from)); files.delete(from); },
    randomUUID: () => `windows-revision-${++windowsRevision}`,
    process: { platform: 'win32', execPath: 'C:\\old\\0.10.37\\node.exe', argv: ['node', 'setup.mjs', '--no-clipboard'] },
    console: { log: () => {} }, spawnSync: () => { throw new Error('No real external processes in Windows simulation'); },
  });
  run();
  const config = JSON.parse(files.get(win32.join(windowsRoot, 'page-agent-mcp.json')));
  assert.deepEqual(config.mcpServers['page-agent'], { command: win32.join(windowsRoot, 'runtime/node.exe'), args: [win32.join(windowsRoot, 'mcp-server/dist/index.js')], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } });
  const local = JSON.parse(files.get(win32.join(windowsRoot, 'extension/mcp-local-config.json')));
  assert.deepEqual(local.mcpServers, config.mcpServers);
  assert.equal(local.pageAgentSetup.version, version);
  assert(!JSON.stringify(config).includes('0.10.37'));
  run();
  assert.notEqual(JSON.parse(files.get(win32.join(windowsRoot, 'extension/mcp-local-config.json'))).pageAgentSetup.revision, local.pageAgentSetup.revision);
}
console.log('Windows setup path simulation passed: drives, Chinese/spaces, stale-path replacement, current bundled runtime and fresh revisions.');
const availableVariants = ['Windows-x64', 'macOS-arm64', 'macOS-x64'];
const variants = process.argv.length > 2 ? process.argv.slice(2) : availableVariants;
for (const variant of variants) assert(availableVariants.includes(variant), `Unknown variant: ${variant}`);
const sandbox = await mkdtemp(join(tmpdir(), 'page-agent-release-check-'));
for (const variant of variants) {
  const name = `Page-Agent-${version}-${variant}`;
  assert(guides['客户使用说明.html'].includes(name + '.zip'), 'Customer guide names an outdated package');
  const archivePath = join(projectRoot, 'deliverables', name + '.zip');
  execFileSync('/usr/bin/unzip', ['-tq', archivePath], { stdio: 'pipe' });
  const archive = await unzipper.Open.file(archivePath);
  const prefix = variant.startsWith('macOS') ? name + '/' : '';
  const entries = new Map(archive.files.map(entry => [entry.path, entry]));
  const json = async path => JSON.parse((await entries.get(prefix + path).buffer()).toString('utf8'));
  const manifest = await json('extension/manifest.json');
  assert.equal(manifest.version, version);
  assert.deepEqual(manifest.content_scripts[0].js, ['content-script.js']);
  const contentScript = (await entries.get(prefix + 'extension/content-script.js').buffer()).toString('utf8');
  new Script(contentScript);
  assert(!/\bimport\s*\(/.test(contentScript), 'Content script still depends on a dynamic module loader');
  assert(contentScript.includes(`nodes-v${version}`) && contentScript.includes('frameQueryKeys'), 'Missing current Selector/SPA fixes');
  const decodedContent = contentScript.replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
  for (const marker of ['next-range-picker-body-show-time', 'next-time-picker-menu-', '主表单最终日期时间核验']) assert(decodedContent.includes(marker), `Missing date-time adapter: ${marker}`);
  assert.equal((await json('mcp-server/package.json')).version, mcpVersion);
  assert.equal(entries.has(prefix + 'page-agent-mcp.json'), false, 'Do not ship builder-machine client paths');
  assert.equal(entries.has(prefix + 'extension/mcp-local-config.json'), false, 'Setup must generate customer paths');
  assert.equal((await entries.get(prefix + 'setup.mjs').buffer()).toString('utf8'), await readFile(join(projectRoot, 'scripts/portable-setup.mjs'), 'utf8'));
  const launcher = variant.startsWith('Windows') ? 'Setup.cmd' : 'Setup.command';
  assert.equal((await entries.get(prefix + launcher).buffer()).toString('utf8'), await readFile(join(projectRoot, 'scripts', variant.startsWith('Windows') ? 'windows-setup.cmd' : 'macos-setup.command'), 'utf8'));
  for (const [guideName, content] of Object.entries(guides)) {
    assert.equal((await entries.get(prefix + guideName).buffer()).toString('utf8'), content);
  }
  for (const entry of archive.files) {
    if (entry.type === 'Directory') continue;
    const localPath = entry.path.slice(prefix.length);
    const buildPath = localPath.startsWith('extension/') ? join(projectRoot, 'dist', localPath.slice('extension/'.length))
      : localPath.startsWith('mcp-server/dist/') ? join(projectRoot, localPath) : null;
    if (buildPath) {
      const payload = await entry.buffer();
      assert(payload.equals(await readFile(buildPath)), `Stale build payload: ${entry.path}`);
      if (localPath.startsWith('extension/') && localPath.endsWith('.js')) {
        assert(!payload.includes(Buffer.from(join(projectRoot, 'mcp-server/dist/index.js'))), `Builder MCP path leaked: ${entry.path}`);
        assert(!payload.includes(Buffer.from(process.execPath)), `Builder runtime path leaked: ${entry.path}`);
      }
    }
  }
  const mcpEntry = (await entries.get(prefix + 'mcp-server/dist/index.js').buffer()).toString('utf8');
  for (const event of ['focusin', 'focusout', 'mouseLeave', 'change', 'reset']) assert(mcpEntry.includes(`'${event}'`));
  assert(mcpEntry.includes('outputNode:') && mcpEntry.includes('businessOk'), 'Missing latest Output toolkit');
  const readme = (await entries.get(prefix + 'README.txt').buffer()).toString('utf8');
  assert(readme.includes(`Page Agent ${version}`) && readme.includes('重命名') && readme.includes('本次解压目录'));
  assert(readme.includes('Output') && readme.includes('手动输入历史'), 'Missing current feature guide');
  assert(readme.includes('processId') && readme.includes('FRAME_DOCUMENT_MISMATCH'), 'Missing Selector/dynamic-page instructions');
  assert(readme.includes('时分秒') && readme.includes('activity_start_time') && readme.includes('activity_end_time'), 'Missing date-time instructions');
  const destination = join(sandbox, `${variant} 客户 解压目录`);
  execFileSync('/usr/bin/unzip', ['-q', archivePath, '-d', destination]);
  let bundle = prefix ? join(destination, name) : destination;
  const binary = join(bundle, 'runtime', variant.startsWith('Windows') ? 'node.exe' : 'node');
  const binaryType = execFileSync('/usr/bin/file', ['-b', binary], { encoding: 'utf8' }).trim();
  assert(variant === 'Windows-x64' ? /PE32\+.*x86-64/.test(binaryType) : binaryType.includes(variant.endsWith('arm64') ? 'arm64' : 'x86_64'));
  const canExecute = variant === `macOS-${process.arch}` && process.platform === 'darwin';
  let runtimeTest = 'not executed on this OS/architecture';
  if (canExecute) {
    assert.equal(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(), 'v22.23.3');
    const runSetup = async () => {
      const output = execFileSync(join(bundle, 'Setup.command'), ['--no-clipboard'], { cwd: tmpdir(), env: { ...process.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
      assert(output.includes(`Package version: ${version}`));
      const root = await realpath(bundle);
      const client = JSON.parse(await readFile(join(bundle, 'page-agent-mcp.json'), 'utf8'));
      const local = JSON.parse(await readFile(join(bundle, 'extension/mcp-local-config.json'), 'utf8'));
      const expected = { command: join(root, 'runtime/node'), args: [join(root, 'mcp-server/dist/index.js')], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } };
      assert.deepEqual(client.mcpServers['page-agent'], expected);
      assert.deepEqual(local.mcpServers, client.mcpServers);
      assert.equal(local.pageAgentSetup.version, version);
      for (const path of [expected.command, expected.args[0]]) await access(path);
      return { client, revision: local.pageAgentSetup.revision };
    };
    // Reproduce the customer upgrade case: a valid new package must overwrite
    // stale generated client/extension files, not retain an older release path.
    const stale = { mcpServers: { 'page-agent': { command: '/old/Page-Agent-0.10.37/runtime/node', args: ['/old/Page-Agent-0.10.37/mcp-server/dist/index.js'] } }, pageAgentSetup: { version: '0.10.37', revision: 'old-release' } };
    await writeFile(join(bundle, 'page-agent-mcp.json'), JSON.stringify(stale), 'utf8');
    await writeFile(join(bundle, 'extension/mcp-local-config.json'), JSON.stringify(stale), 'utf8');
    const first = await runSetup();
    assert(!JSON.stringify(first.client).includes('0.10.37'), 'Setup retained an old release path');
    const moved = join(sandbox, `${variant} 移动后 最新目录`);
    await rename(bundle, moved);
    bundle = moved;
    const second = await runSetup();
    assert.notEqual(first.client.mcpServers['page-agent'].args[0], second.client.mcpServers['page-agent'].args[0]);
    assert.notEqual(first.revision, second.revision);
    const third = await runSetup();
    assert.notEqual(second.revision, third.revision, 'Same-folder Setup must invalidate old overrides');
    const sdk = join(bundle, 'mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/');
    const { Client } = await import(pathToFileURL(join(sdk, 'index.js')).href);
    const { StdioClientTransport } = await import(pathToFileURL(join(sdk, 'stdio.js')).href);
    const config = third.client.mcpServers['page-agent'];
    const client = new Client({ name: 'portable-release-check', version: '1.0.0' });
    const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().version, mcpVersion);
      const tools = await client.listTools();
      assert(tools.tools.some(tool => tool.name === 'run_page_workflow'));
      const result = await client.callTool({ name: 'get_page_workflow_toolkit', arguments: {} });
      assert(!result.isError);
      const toolkit = JSON.parse(result.content.find(item => item.type === 'text').text);
      for (const event of ['focusin', 'focusout', 'mouseLeave', 'change', 'reset']) assert(toolkit.events.includes(event));
      assert.equal(toolkit.templates.output.kind, 'output');
      assert(toolkit.outputNode.result.includes('businessOk'));
      runtimeTest = `bundled runtime + stale-path upgrade + setup + relocation + MCP ${mcpVersion} handshake/toolkit passed`;
    } finally { await client.close(); }
  }
  console.log(JSON.stringify({ name, pluginVersion: version, mcpVersion, binaryType, runtimeTest, sha256: createHash('sha256').update(await readFile(archivePath)).digest('hex') }));
}
console.log(`Extracted verification fixtures retained at ${resolve(sandbox)}`);
