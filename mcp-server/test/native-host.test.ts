import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
vi.mock('../src/shared-bridge.js', () => ({ SharedBridge: vi.fn(() => ({ connect: connect, close: close })) }));
const { connect, close } = vi.hoisted(() => ({ connect: vi.fn().mockResolvedValue(undefined), close: vi.fn() }));
import { chromeExtensionId, installNativeHost, readNativeRequest, startLocalBridge } from '../src/native-host';
import { SharedBridge } from '../src/shared-bridge';
const folders: string[] = [];
const temp = () => { const folder = mkdtempSync(join(tmpdir(), 'page-agent-native-')); folders.push(folder); return folder; };
const id = 'abcdefghijklmnopabcdefghijklmnop';
afterEach(() => { folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.clearAllMocks(); });
describe('Chrome native host registration', () => {
  it('matches Chromium native path byte hashing and respects manifest public keys', () => {
    // Chromium normalizes the Windows drive letter, preserves the rest of the
    // native path, and hashes UTF-16LE. POSIX FilePath uses UTF-8 bytes.
    expect(chromeExtensionId('c:\\客户 A\\extension', {}, 'win32')).toBe(chromeExtensionId('C:\\客户 A\\extension', {}, 'win32'));
    expect(chromeExtensionId('C:\\客户 A\\extension', {}, 'win32')).not.toBe(chromeExtensionId('C:\\客户 A\\extension', {}, 'darwin'));
    const key = Buffer.from('public-key-fixture').toString('base64');
    expect(chromeExtensionId('/old/path', { key }, 'darwin')).toBe(chromeExtensionId('/new/path', { key }, 'linux'));
    expect(chromeExtensionId('/old/path', {}, 'darwin')).not.toBe(chromeExtensionId('/new/path', {}, 'darwin'));
  });
  it('registers only specific IDs and preserves other profiles when reinstalled', () => {
    const home = temp();
    const options = { home, platform: 'darwin' as const, runtime: "/应用 A/o'neil/node", script: '/服务 A/native-host.js' };
    const path = installNativeHost(id, options);
    const next = 'p'.repeat(32);
    installNativeHost(next, options); installNativeHost(id, options);
    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(config).toMatchObject({ name: 'com.page_agent.launcher', type: 'stdio', allowed_origins: [`chrome-extension://${id}/`, `chrome-extension://${next}/`] });
    expect(readFileSync(config.path, 'utf8')).toContain("exec '/应用 A/o'\\''neil/node' '/服务 A/native-host.js' \"$@\"");
    expect(() => installNativeHost('*', options)).toThrow('插件 ID');
  });
  it('uses current-user Windows registration and literal batch paths', () => {
    const register = vi.fn();
    const path = installNativeHost(id, { platform: 'win32', localAppData: temp(), register, runtime: 'C:\\100%\\node.exe', script: 'C:\\客户 A\\native-host.js' });
    expect(register).toHaveBeenCalledWith(path);
    const config = JSON.parse(readFileSync(path, 'utf8'));
    expect(readFileSync(config.path, 'utf8')).toContain('"C:\\100%%\\node.exe" "C:\\客户 A\\native-host.js" %*');
  });
  it('parses fragmented native frames and rejects oversized/truncated input', async () => {
    const input = new PassThrough();
    const body = Buffer.from(JSON.stringify({ type: 'ensure_server' }));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    const request = readNativeRequest(input);
    input.write(header.subarray(0, 2)); input.write(Buffer.concat([header.subarray(2), body]));
    await expect(request).resolves.toEqual({ type: 'ensure_server' });
    const invalid = new PassThrough(); const bad = expect(readNativeRequest(invalid)).rejects.toThrow('长度');
    const huge = Buffer.alloc(4); huge.writeUInt32LE(9999999); invalid.write(huge); await bad;
    const truncated = new PassThrough(); const incomplete = expect(readNativeRequest(truncated)).rejects.toThrow('不完整'); truncated.end(Buffer.from([1])); await incomplete;
  });
  it('reuses the shared bridge startup path and closes the temporary client', async () => {
    await expect(startLocalBridge({ type: 'ensure_server' })).resolves.toMatchObject({ ok: true, clientOptions: { command: process.execPath, serverPath: expect.stringMatching(/index\.js$/) } });
    expect(SharedBridge).toHaveBeenCalledWith(17373);
    expect(connect).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it('the built executable emits a correctly framed error without running commands', () => {
    const payload = Buffer.from(JSON.stringify({ type: 'ensure_server', command: '/never-execute' }));
    const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../dist/native-host.js', import.meta.url))], { input: Buffer.concat([header, payload]), timeout: 5000 });
    expect(output.readUInt32LE(0)).toBe(output.length - 4);
    expect(JSON.parse(output.subarray(4).toString('utf8'))).toMatchObject({ ok: false, error: expect.stringContaining('只接受') });
  });
  it('rejects paths/commands and never forwards them to a process', async () => {
    for (const request of [{ type: 'ensure_server', command: '/bad' }, { type: 'execute' }, null, []]) await expect(startLocalBridge(request)).rejects.toThrow('只接受');
    expect(connect).not.toHaveBeenCalled();
  });
});
