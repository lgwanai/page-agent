import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMcpClientConfig, DEFAULT_MCP_OPTIONS, loadMcpOptions, mcpOptionsError, saveMcpOptions } from './mcp-config';
import { fileURLToPath } from 'node:url';

afterEach(() => { vi.unstubAllGlobals(); });
describe('MCP client configuration', () => {
  it('automatically includes the local Node executable and project MCP entry at build time', () => {
    expect(DEFAULT_MCP_OPTIONS.command).toBe(process.execPath);
    expect(DEFAULT_MCP_OPTIONS.serverPath).toBe(fileURLToPath(new URL('../../mcp-server/dist/index.js', import.meta.url)));
    expect(mcpOptionsError(DEFAULT_MCP_OPTIONS)).toBeNull();
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
    expect(set).toHaveBeenCalledWith({ pageAgentMcpClientOptionsV1: options });
  });
});
