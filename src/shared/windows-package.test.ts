import { describe, expect, it } from 'vitest';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import project from '../../package.json';

describe('portable customer setup', () => {
  it.skipIf(process.platform === 'win32')('runs the macOS launcher through its runtime entry independently of PATH and working directory', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'page-agent-mac-')), '客户 Mac 安装包');
    mkdirSync(join(folder, 'mcp-server', 'dist'), { recursive: true });
    mkdirSync(join(folder, 'runtime'));
    mkdirSync(join(folder, 'extension'));
    writeFileSync(join(folder, 'extension', 'manifest.json'), JSON.stringify({ version: project.version }));
    writeFileSync(join(folder, 'mcp-server', 'dist', 'index.js'), '');
    // Fixture wrapper: Homebrew Node is dynamically linked and cannot be relocated.
    // Official portable Node is exercised separately against the packaged artifact.
    const quotedNode = `'${process.execPath.replaceAll("'", "'\\''")}'`;
    writeFileSync(join(folder, 'runtime', 'node'), `#!/bin/bash\nexec ${quotedNode} "$@"\n`);
    chmodSync(join(folder, 'runtime', 'node'), 0o755);
    cpSync(resolve('scripts/portable-setup.mjs'), join(folder, 'setup.mjs'));
    cpSync(resolve('scripts/macos-setup.command'), join(folder, 'Setup.command'));
    chmodSync(join(folder, 'Setup.command'), 0o755);
    execFileSync(join(folder, 'Setup.command'), ['--no-clipboard', '--no-native-host'], { cwd: tmpdir(), env: { ...process.env, PATH: '/usr/bin:/bin' } });
    const config = JSON.parse(readFileSync(join(folder, 'page-agent-mcp.json'), 'utf8'));
    expect(config.mcpServers['page-agent'].command).toBe(join(realpathSync(folder), 'runtime', 'node'));
    expect(config.mcpServers['page-agent'].args).toEqual([join(realpathSync(folder), 'mcp-server', 'dist', 'index.js')]);
  });
  it.skipIf(process.platform !== 'darwin')('Setup automatically registers the native host and writes config without imports or commands', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'page-agent-auto-setup-'));
    const folder = join(scratch, '客户 安装包');
    const home = join(scratch, 'isolated home');
    try {
      mkdirSync(join(folder, 'mcp-server', 'dist'), { recursive: true });
      mkdirSync(join(folder, 'runtime')); mkdirSync(join(folder, 'extension'));
      writeFileSync(join(folder, 'runtime/node'), 'fixture runtime');
      writeFileSync(join(folder, 'extension/manifest.json'), JSON.stringify({ version: project.version }));
      writeFileSync(join(folder, 'mcp-server/package.json'), '{"type":"module"}');
      writeFileSync(join(folder, 'mcp-server/dist/index.js'), '');
      const realHost = pathToFileURL(resolve('mcp-server/dist/native-host.js')).href;
      writeFileSync(join(folder, 'mcp-server/dist/native-host.js'), `export {installNativeHost,extensionIdForDirectory} from ${JSON.stringify(realHost)};`);
      cpSync(resolve('scripts/portable-setup.mjs'), join(folder, 'setup.mjs'));
      const env = { ...process.env, HOME: home };
      expect(execFileSync(process.execPath, ['-p', "require('node:os').homedir()"], { env, encoding: 'utf8' }).trim()).toBe(home);
      const output = execFileSync(process.execPath, [join(folder, 'setup.mjs'), '--no-clipboard'], { env, encoding: 'utf8' });
      const registrationPath = join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.page_agent.launcher.json');
      const registration = JSON.parse(readFileSync(registrationPath, 'utf8'));
      expect(registration.allowed_origins).toHaveLength(1);
      expect(registration.allowed_origins[0]).toMatch(/^chrome-extension:\/\/[a-p]{32}\/$/);
      expect(readFileSync(registration.path, 'utf8')).toContain(join(realpathSync(folder), 'runtime/node'));
      const config = JSON.parse(readFileSync(join(folder, 'extension/mcp-local-config.json'), 'utf8'));
      expect(config.mcpServers['page-agent'].args[0]).toBe(join(realpathSync(folder), 'mcp-server/dist/index.js'));
      expect(output).toContain('无需导入文件或执行终端命令');
      execFileSync(process.execPath, [join(folder, 'setup.mjs'), '--no-clipboard'], { env });
      expect(JSON.parse(readFileSync(registrationPath, 'utf8')).allowed_origins).toEqual(registration.allowed_origins);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
  it('generates local absolute paths from an extracted folder containing spaces and Chinese characters', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'page-agent-setup-')), '客户 安装包');
    mkdirSync(join(folder, 'mcp-server', 'dist'), { recursive: true });
    mkdirSync(join(folder, 'extension'));
    mkdirSync(join(folder, 'runtime'));
    const runtime = join(folder, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    writeFileSync(runtime, 'test runtime');
    writeFileSync(join(folder, 'extension', 'manifest.json'), '{}');
    writeFileSync(join(folder, 'mcp-server', 'dist', 'index.js'), '');
    cpSync(resolve('scripts/portable-setup.mjs'), join(folder, 'setup.mjs'));
    writeFileSync(join(folder, 'other-client.json'), 'do not touch');
    execFileSync(process.execPath, [join(folder, 'setup.mjs'), '--no-clipboard', '--no-native-host'], { cwd: tmpdir() });
    const config = JSON.parse(readFileSync(join(folder, 'page-agent-mcp.json'), 'utf8'));
    const localConfig = JSON.parse(readFileSync(join(folder, 'extension', 'mcp-local-config.json'), 'utf8'));
    expect(localConfig).toMatchObject(config);
    expect(localConfig.pageAgentSetup.revision).toEqual(expect.any(String));
    expect(config.mcpServers['page-agent']).toEqual({ command: join(realpathSync(folder), 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'), args: [join(realpathSync(folder), 'mcp-server', 'dist', 'index.js')], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } });
    execFileSync(process.execPath, [join(folder, 'setup.mjs'), '--no-clipboard', '--no-native-host']);
    expect(JSON.parse(readFileSync(join(folder, 'extension', 'mcp-local-config.json'), 'utf8')).pageAgentSetup.revision).not.toBe(localConfig.pageAgentSetup.revision);
    expect(readFileSync(join(folder, 'other-client.json'), 'utf8')).toBe('do not touch');
    expect(existsSync(join(folder, 'page-agent-mcp.json.tmp'))).toBe(false);
    const relocated = join(dirname(folder), '搬家后 新目录');
    renameSync(folder, relocated);
    execFileSync(process.execPath, [join(relocated, 'setup.mjs'), '--no-clipboard', '--no-native-host'], { cwd: tmpdir() });
    const moved = JSON.parse(readFileSync(join(relocated, 'page-agent-mcp.json'), 'utf8'));
    const currentRoot = realpathSync(relocated);
    expect(moved.mcpServers['page-agent'].command).toBe(join(currentRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
    expect(moved.mcpServers['page-agent'].args).toEqual([join(currentRoot, 'mcp-server', 'dist', 'index.js')]);
    expect(JSON.parse(readFileSync(join(relocated, 'extension', 'mcp-local-config.json'), 'utf8')).mcpServers).toEqual(moved.mcpServers);
  });
  it('fails clearly when run from an incomplete extraction', () => {
    const folder = mkdtempSync(join(tmpdir(), 'page-agent-incomplete-'));
    cpSync(resolve('scripts/portable-setup.mjs'), join(folder, 'setup.mjs'));
    expect(() => execFileSync(process.execPath, [join(folder, 'setup.mjs')], { stdio: 'pipe' })).toThrow();
    expect(existsSync(join(folder, 'page-agent-mcp.json'))).toBe(false);
  });
  it('replaces an old package configuration and revision with the current package paths', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'page-agent-upgrade-')), `客户 ${project.version} 新包`);
    mkdirSync(join(folder, 'mcp-server', 'dist'), { recursive: true });
    mkdirSync(join(folder, 'extension'));
    mkdirSync(join(folder, 'runtime'));
    writeFileSync(join(folder, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'), 'fixture runtime');
    writeFileSync(join(folder, 'extension', 'manifest.json'), JSON.stringify({ version: project.version }));
    writeFileSync(join(folder, 'mcp-server', 'dist', 'index.js'), '');
    cpSync(resolve('scripts/portable-setup.mjs'), join(folder, 'setup.mjs'));
    const oldConfig = { mcpServers: { 'page-agent': { command: '/old/0.10.37/runtime/node', args: ['/old/0.10.37/mcp-server/dist/index.js'] } }, pageAgentSetup: { revision: 'old-revision', version: '0.10.37' } };
    writeFileSync(join(folder, 'page-agent-mcp.json'), JSON.stringify(oldConfig));
    writeFileSync(join(folder, 'extension', 'mcp-local-config.json'), JSON.stringify(oldConfig));
    const output = execFileSync(process.execPath, [join(folder, 'setup.mjs'), '--no-clipboard', '--no-native-host'], { cwd: tmpdir(), encoding: 'utf8' });
    const config = JSON.parse(readFileSync(join(folder, 'page-agent-mcp.json'), 'utf8'));
    const local = JSON.parse(readFileSync(join(folder, 'extension', 'mcp-local-config.json'), 'utf8'));
    const current = realpathSync(folder);
    expect(config.mcpServers['page-agent']).toEqual({ command: join(current, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'), args: [join(current, 'mcp-server', 'dist', 'index.js')], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } });
    expect(local.mcpServers).toEqual(config.mcpServers);
    expect(local.pageAgentSetup).toEqual({ version: project.version, revision: expect.any(String) });
    expect(local.pageAgentSetup.revision).not.toBe('old-revision');
    expect(output).toContain(`Package version: ${project.version}`);
    expect(output).not.toContain('/old/0.10.37');
  });
});
