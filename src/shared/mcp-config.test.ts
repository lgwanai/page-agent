import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMcpClientConfig, DEFAULT_MCP_OPTIONS, loadMcpOptions, mcpOptionsError, saveMcpOptions, mcpOptionsForHost, parseMcpClientConfig } from './mcp-config';

afterEach(() => { vi.unstubAllGlobals(); });
describe('MCP client configuration', () => {
  it('invalidates an old explicit override after Setup runs again at the same path', async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { runtime: { getURL: () => 'chrome-extension://test/mcp-local-config.json' }, storage: { local: {
      get: vi.fn(async () => ({ ...storage })), set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
    } } });
    const setup = { command: '/new/runtime/node', serverPath: '/new/mcp-server/dist/index.js' };
    let revision = 'first';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...buildMcpClientConfig(setup), pageAgentSetup: { revision } }) })));
    const imported = { command: '/old/runtime/node', serverPath: '/old/mcp-server/dist/index.js' };
    await saveMcpOptions(imported);
    expect(await loadMcpOptions()).toEqual(imported);
    revision = 'new-setup-run';
    expect(await loadMcpOptions()).toEqual(setup);
  });
  it('remembers an explicit import over the unchanged old Setup, but uses a newly loaded package config', async () => {
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', { runtime: { getURL: () => 'chrome-extension://test/mcp-local-config.json' }, storage: { local: {
      get: vi.fn(async () => ({ ...storage })), set: vi.fn(async (values: Record<string, unknown>) => Object.assign(storage, values)),
    } } });
    let setup = { command: '/v37/runtime/node', serverPath: '/v37/mcp-server/dist/index.js' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => buildMcpClientConfig(setup) })));
    const imported = { command: '/v39/runtime/node', serverPath: '/v39/mcp-server/dist/index.js' };
    await saveMcpOptions(imported);
    expect(await loadMcpOptions()).toEqual(imported);
    setup = { command: '/v40/runtime/node', serverPath: '/v40/mcp-server/dist/index.js' };
    expect(await loadMcpOptions()).toEqual(setup);
  });
  it('discards a legacy saved placeholder instead of exposing it as a local directory', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ pageAgentMcpClientOptionsV1: { command: 'node', serverPath: '/完整路径/page-agent/mcp-server/dist/index.js' } }) } } });
    expect(await loadMcpOptions()).toEqual(DEFAULT_MCP_OPTIONS);
  });
  it('reads the actual setup-generated configuration from the extension directory', async () => {
    vi.stubGlobal('chrome', { runtime: { getURL: () => 'chrome-extension://test/mcp-local-config.json' }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } });
    const options = { command: '/Applications/Page Agent/runtime/node', serverPath: '/Applications/Page Agent/mcp-server/dist/index.js' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => buildMcpClientConfig(options) }));
    expect(await loadMcpOptions()).toEqual(options);
    expect(fetch).toHaveBeenCalledWith('chrome-extension://test/mcp-local-config.json', { cache: 'no-store' });
  });
  it('rejects placeholders and malformed imports instead of displaying a template', () => {
    expect(() => parseMcpClientConfig({ mcpServers: { 'page-agent': { command: 'node', args: ['/完整路径/page-agent/index.js'] } } })).toThrow('占位');
    expect(() => parseMcpClientConfig({})).toThrow('page-agent-mcp.json');
  });
  it('does not reuse build-machine or saved paths from a different OS', () => {
    expect(mcpOptionsForHost({ command: '/opt/homebrew/bin/node', serverPath: '/Users/user/project/index.js' }, true)).toEqual({ command: 'node', serverPath: '' });
    expect(mcpOptionsForHost({ command: 'C:\\Program Files\\nodejs\\node.exe', serverPath: 'C:\\项目\\index.js' }, false)).toEqual({ command: 'node', serverPath: '' });
    expect(mcpOptionsForHost({ command: 'node', serverPath: '\\\\server\\share\\index.js' }, true).serverPath).toBe('\\\\server\\share\\index.js');
  });
  it('accepts Windows copy-as-path quotes without passing literal quotes to spawn', () => {
    const config = buildMcpClientConfig({ command: '"C:\\Program Files\\nodejs\\node.exe"', serverPath: '"C:\\项目 文件\\mcp-server\\dist\\index.js"' });
    expect(config.mcpServers['page-agent'].command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(config.mcpServers['page-agent'].args).toEqual(['C:\\项目 文件\\mcp-server\\dist\\index.js']);
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });
  it('blocks Mac paths and shell wrappers on Windows with actionable diagnostics', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0', platform: 'Win32' });
    expect(mcpOptionsError({ command: '/opt/node', serverPath: '/Users/user/index.js' })).toContain('Windows');
    expect(mcpOptionsError({ command: 'npx.cmd', serverPath: 'C:\\project\\index.js' })).toContain('node.exe');
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ pageAgentMcpClientOptionsV1: { command: '/opt/node', serverPath: '/Users/user/index.js' } }) } } });
    expect(await loadMcpOptions()).toEqual({ command: 'node', serverPath: '' });
  });
  it('does not present build-machine paths as local customer configuration', () => {
    expect(DEFAULT_MCP_OPTIONS).toEqual({ command: 'node', serverPath: '' });
    expect(mcpOptionsError(DEFAULT_MCP_OPTIONS)).not.toBeNull();
  });

  it('uses auto-detected paths for an old empty configuration without modifying storage', async () => {
    const set = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ pageAgentMcpClientOptionsV1: { command: ' ', serverPath: '' } }), set } } });
    expect(await loadMcpOptions()).toEqual(DEFAULT_MCP_OPTIONS);
    expect(set).not.toHaveBeenCalled();
  });

  it('generates stdio configuration with the matching bridge port and preserves paths with spaces', () => {
    expect(buildMcpClientConfig({ command: '/opt/node/bin/node', serverPath: '/Users/user/My Project/mcp-server/dist/index.js' })).toEqual({ mcpServers: { 'page-agent': { command: '/opt/node/bin/node', args: ['/Users/user/My Project/mcp-server/dist/index.js'], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } } } });
    expect(buildMcpClientConfig({ command: 'node', serverPath: 'C:\\Page Agent\\mcp-server\\dist\\index.js' }).mcpServers['page-agent'].args).toEqual(['C:\\Page Agent\\mcp-server\\dist\\index.js']);
  });
  it('rejects missing and relative script paths instead of copying a non-working template', () => {
    for (const serverPath of ['', '~/page-agent/dist/index.js', './dist/index.js']) expect(() => buildMcpClientConfig({ command: 'node', serverPath })).toThrow();
    expect(mcpOptionsError({ command: '', serverPath: '/dist/index.js' })).toContain('Node');
  });
  it('persists client options separately from workflows', async () => {
    const storage: Record<string, unknown> = {};
    const set = vi.fn(async (value: Record<string, unknown>) => Object.assign(storage, value));
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async (key: string) => ({ [key]: storage[key] })), set } } });
    expect(await loadMcpOptions()).toEqual(DEFAULT_MCP_OPTIONS);
    const options = { command: 'node', serverPath: '/project/mcp-server/dist/index.js' };
    await saveMcpOptions(options);
    expect(await loadMcpOptions()).toEqual(options);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ pageAgentMcpClientOptionsV1: options }));
  });
});
