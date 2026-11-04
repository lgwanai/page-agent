// Offline release check. All installation writes stay in a disposable home.
// Never starts or stops the user's broker, or registers with the user's Chrome.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const project = JSON.parse(await readFile('package.json', 'utf8'));
const version = project.version;
const mcpVersion = JSON.parse(await readFile('mcp-server/package.json', 'utf8')).version;
const name = `Page-Agent-${version}-macOS-${process.arch}`;
const archivePath = resolve(process.argv[2] ?? `deliverables/${name}.zip`);
const scratch = await mkdtemp(join(tmpdir(), 'page-agent-native-release-'));
try {
  execFileSync('/usr/bin/unzip', ['-q', archivePath, '-d', scratch]);
  const bundle = join(scratch, name);
  const manifest = JSON.parse(await readFile(join(bundle, 'extension/manifest.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert(manifest.permissions.includes('nativeMessaging'));
  assert.equal(JSON.parse(await readFile(join(bundle, 'mcp-server/package.json'), 'utf8')).version, mcpVersion);
  async function compare(source, packaged) {
    for (const item of await readdir(source, { withFileTypes: true })) {
      if (item.isDirectory()) await compare(join(source, item.name), join(packaged, item.name));
      else assert((await readFile(join(source, item.name))).equals(await readFile(join(packaged, item.name))), `Stale payload: ${source}/${item.name}`);
    }
  }
  await compare('dist', join(bundle, 'extension'));
  await compare('mcp-server/dist', join(bundle, 'mcp-server/dist'));
  const runtime = join(bundle, 'runtime/node');
  const host = join(bundle, 'mcp-server/dist/native-host.js');
  const id = execFileSync(runtime, ['--input-type=module', '-e', `const {extensionIdForDirectory}=await import(${JSON.stringify(pathToFileURL(host).href)}); console.log(extensionIdForDirectory(${JSON.stringify(await realpath(join(bundle, 'extension')))}));`], {encoding:'utf8'}).trim();
  const home = join(scratch, 'isolated home');
  const isolatedEnv = { ...process.env, HOME: home };
  // Verify HOME isolation before allowing Setup to register a native host.
  assert.equal(execFileSync(runtime, ['-e', "console.log(require('node:os').homedir())"], { env: isolatedEnv, encoding: 'utf8' }).trim(), home);
  const setupOutput = execFileSync(runtime, [join(bundle, 'setup.mjs'), '--no-clipboard'], { env: isolatedEnv, encoding: 'utf8', timeout: 10000 });
  assert(setupOutput.includes('本机启动器已自动注册'));
  const installed = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.page_agent.launcher.json');
  const localConfig = JSON.parse(await readFile(join(bundle, 'extension/mcp-local-config.json'), 'utf8'));
  assert.equal(localConfig.mcpServers['page-agent'].command, execFileSync(runtime, ['-p', 'process.execPath'], { encoding: 'utf8' }).trim());
  const registration = JSON.parse(await readFile(installed, 'utf8'));
  assert.deepEqual(registration.allowed_origins, [`chrome-extension://${id}/`]);
  const payload = Buffer.from(JSON.stringify({ type: 'ensure_server', command: '/must-not-execute' }));
  const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
  const reply = execFileSync(registration.path, [], { input: Buffer.concat([header, payload]), timeout: 5000 });
  assert.equal(reply.readUInt32LE(0), reply.length - 4);
  const result = JSON.parse(reply.subarray(4).toString('utf8'));
  assert.equal(result.ok, false);
  assert.match(result.error, /只接受/);
  assert((await readFile(join(bundle, '客户使用说明.html'), 'utf8')).includes('配置并启动'));
  console.log(JSON.stringify({ archive: archivePath, version, mcpVersion, checks: ['current extension/MCP payloads', 'nativeMessaging permission', 'bundled runtime', 'Setup automatically registers the extension and writes config in an isolated home', 'executable launcher and binary protocol', 'arbitrary command rejection', 'customer startup instructions'] }, null, 2));
} finally { await rm(scratch, { recursive: true, force: true }); }
