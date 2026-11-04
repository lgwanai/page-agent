/** Chrome Native Messaging host. Accepts only a fixed, local bridge-start request. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SharedBridge } from './shared-bridge.js';

export const HOST_NAME = 'com.page_agent.launcher';
const entry = fileURLToPath(import.meta.url);
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Match Chromium id_util.cc: native FilePath bytes (UTF-16LE on Windows).
 * https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc
 * Preserve manifest public keys and existing unpacked IDs; do not change identity.
 */
export function chromeExtensionId(extensionPath: string, manifest: { key?: unknown } = {}, platform: NodeJS.Platform = process.platform): string {
  const normalized = platform === 'win32' ? extensionPath.replace(/^[a-z]:/, value => value.toUpperCase()) : extensionPath;
  let bytes: Buffer;
  if (typeof manifest.key === 'string') {
    bytes = Buffer.from(manifest.key.replace(/\s/g, ''), 'base64');
    if (!bytes.length) throw new Error('扩展 manifest.key 无效，无法注册本机启动器。');
  } else bytes = Buffer.from(normalized, platform === 'win32' ? 'utf16le' : 'utf8');
  return createHash('sha256').update(bytes).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, char => String.fromCharCode(97 + parseInt(char, 16)));
}

export function extensionIdForDirectory(extensionPath: string): string {
  return chromeExtensionId(extensionPath, JSON.parse(readFileSync(join(extensionPath, 'manifest.json'), 'utf8')));
}

export function installNativeHost(extensionId: string, options: {
  platform?: NodeJS.Platform; home?: string; localAppData?: string;
  runtime?: string; script?: string; register?: (manifestPath: string) => void;
} = {}): string {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Chrome 插件 ID 必须是 32 位 a-p 字母，请从插件 MCP 页面复制安装命令。');
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const runtime = options.runtime ?? process.execPath;
  const script = options.script ?? entry;
  if (![runtime, script].every(value => !/[\r\n\0"]/.test(value))) throw new Error('启动器路径包含不支持的字符。');
  let directory: string;
  if (platform === 'darwin') directory = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  else if (platform === 'linux') directory = join(home, '.config', 'google-chrome', 'NativeMessagingHosts');
  else if (platform === 'win32') {
    const local = options.localAppData ?? process.env.LOCALAPPDATA;
    if (!local) throw new Error('找不到 LOCALAPPDATA，无法安装本机启动器。');
    directory = join(local, 'PageAgent', 'NativeMessagingHosts');
  } else throw new Error(`本机启动器不支持 ${platform}`);
  mkdirSync(directory, { recursive: true });
  const manifestPath = join(directory, `${HOST_NAME}.json`);
  const launcherPath = join(directory, platform === 'win32' ? 'page-agent-launcher.cmd' : 'page-agent-launcher');
  let origins: string[] = [];
  try {
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Preserve registrations for other Chrome profiles, but never a wildcard.
    origins = (previous.allowed_origins ?? []).filter((value: unknown) => typeof value === 'string' && /^chrome-extension:\/\/[a-p]{32}\/$/.test(value));
  } catch { /* first installation */ }
  const percent = (value: string) => value.replaceAll('%', '%%');
  const launcher = platform === 'win32'
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${percent(runtime)}" "${percent(script)}" %*\r\n`
    : `#!/bin/sh\nexec ${shellQuote(runtime)} ${shellQuote(script)} "$@"\n`;
  writeFileSync(launcherPath, launcher, { mode: 0o700 });
  writeFileSync(manifestPath, JSON.stringify({ name: HOST_NAME, description: 'Start the local Page Agent MCP bridge', path: launcherPath,
    type: 'stdio', allowed_origins: [...new Set([...origins, `chrome-extension://${extensionId}/`])] }, null, 2) + '\n', { mode: 0o600 });
  if (platform === 'win32') {
    const register = options.register ?? ((path: string) => {
      execFileSync('reg.exe', ['add', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', path, '/f'], { windowsHide: true });
    });
    register(manifestPath);
  }
  return manifestPath;
}

export function readNativeRequest(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const finish = (error?: Error, value?: unknown) => {
      clearTimeout(timer); input.removeListener('data', data); input.removeListener('end', end); input.removeListener('error', fail);
      if (error) reject(error); else resolve(value);
    };
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32LE(0);
      if (size < 2 || size > 64 * 1024) return finish(new Error('本机启动请求长度无效'));
      if (buffer.length < size + 4) return;
      try { finish(undefined, JSON.parse(buffer.subarray(4, size + 4).toString('utf8'))); }
      catch { finish(new Error('本机启动请求格式无效')); }
    };
    const end = () => finish(new Error('本机启动请求不完整'));
    const fail = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error('本机启动请求超时')), 5000);
    input.on('data', data); input.on('end', end); input.on('error', fail);
  });
}

export async function startLocalBridge(request: unknown): Promise<{ ok: true; clientOptions: { command: string; serverPath: string } }> {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).length !== 1 || (request as { type?: string }).type !== 'ensure_server') throw new Error('启动器只接受 ensure_server，不接受路径、命令或网页操作。');
  // Never inherit a client-selected port or executable from the incoming message.
  const bridge = new SharedBridge(17373);
  try { await bridge.connect(); return { ok: true, clientOptions: { command: process.execPath, serverPath: fileURLToPath(new URL('./index.js', import.meta.url)) } }; }
  finally { bridge.close(); }
}

async function main() {
  if (process.argv[2] === '--install') {
    const path = installNativeHost(process.argv[3] ?? '');
    console.log(`本机启动器已安装：${path}\n回到插件 MCP 页面，点击「启动本机服务」。以后插件打开时会自动检测并启动。`);
    return;
  }
  let response: unknown;
  try { response = await startLocalBridge(await readNativeRequest(process.stdin)); }
  catch (error) { response = { ok: false, error: (error as Error).message }; }
  const body = Buffer.from(JSON.stringify(response), 'utf8');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}
