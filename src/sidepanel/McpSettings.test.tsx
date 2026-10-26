// @vitest-environment jsdom
import manifest from '../../manifest.json';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@/types/messages';
import { McpSettings } from './McpSettings';
import { DEFAULT_MCP_OPTIONS } from '@/shared/mcp-config';

const info = { protocolVersion: 1, serverVersion: '0.10.12', instanceId: 'instance-A', connected: false, connecting: false, bridgeUrl: 'ws://127.0.0.1:17373/extension', clientOptions: { command: 'node', serverPath: '/project/mcp-server/dist/index.js' } };
let root: Root;
let container: HTMLDivElement;
let listeners: Array<(message: RuntimeMessage) => void>;
const send = vi.fn();
const clipboard = vi.fn();
const onClose = vi.fn();
const notify = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  listeners = [];
  send.mockResolvedValue({ ok: true, result: info });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('chrome', { runtime: { getManifest: () => manifest, sendMessage: send, onMessage: { addListener: (listener: (message: RuntimeMessage) => void) => listeners.push(listener), removeListener: (listener: (message: RuntimeMessage) => void) => { listeners = listeners.filter((item) => item !== listener); } } } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard.mockResolvedValue(undefined) } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<McpSettings instanceId="instance-A" connected={false} onClose={onClose} notify={notify} />));
}
function button(text: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((item) => item.textContent === text)!;
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('MCP configuration panel', () => {
  it('imports the real local JSON and enables copying without manual path edits', async () => {
    send.mockResolvedValue({ ok: true, result: { ...info, clientOptions: DEFAULT_MCP_OPTIONS } });
    await render();
    const local = { command: '/Applications/Page Agent/runtime/node', args: ['/Applications/Page Agent/mcp-server/dist/index.js'] };
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [{ text: async () => JSON.stringify({ mcpServers: { 'page-agent': local } }) }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS', options: { command: local.command, serverPath: local.args[0] } });
    expect(button('复制 MCP 配置').disabled).toBe(false);
    await act(async () => button('复制 MCP 配置').click());
    expect(JSON.parse(clipboard.mock.calls[0][0]).mcpServers['page-agent']).toMatchObject(local);
  });
  it('refreshes configuration from the actual connected service', async () => {
    send.mockResolvedValue({ ok: true, result: { ...info, clientOptions: DEFAULT_MCP_OPTIONS } });
    await render();
    send.mockResolvedValue({ ok: true, result: info });
    await act(async () => listeners.forEach(listener => listener({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected: true })));
    expect(button('复制 MCP 配置').disabled).toBe(false);
    expect(container.querySelector('textarea')?.value).toContain(info.clientOptions.serverPath);
  });
  it('shows unconfigured without rendering or copying placeholder JSON', async () => {
    send.mockResolvedValue({ ok: true, result: { ...info, clientOptions: DEFAULT_MCP_OPTIONS } });
    await render();
    expect(container.textContent).toContain('尚未配置');
    expect(container.querySelector('textarea[aria-label="MCP 客户端 JSON 配置"]')).toBeNull();
    expect(button('复制 MCP 配置').disabled).toBe(true);
    expect(container.textContent).not.toContain('配置模板');
    expect(container.textContent).not.toContain('/完整路径/');
    await act(async () => button('复制 MCP 配置').click());
    expect(clipboard).not.toHaveBeenCalled();
  });
  it('lets the user copy automatically detected configuration without entering paths', async () => {
    send.mockResolvedValue({ ok: true, result: info });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="本机 MCP 服务脚本路径"]')!;
    expect(input.value).toBe(info.clientOptions.serverPath);
    expect(button('复制 MCP 配置').disabled).toBe(false);
    await act(async () => button('复制 MCP 配置').click());
    const config = JSON.parse(clipboard.mock.calls[0][0]);
    expect(config.mcpServers['page-agent']).toMatchObject({ command: info.clientOptions.command, args: [info.clientOptions.serverPath] });
  });

  it('re-reads generated local configuration rather than resetting to empty defaults', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="本机 MCP 服务脚本路径"]')!;
    expect(input.value).toBe(info.clientOptions.serverPath);
    const updated = { command: '/v40/runtime/node', serverPath: '/v40/mcp-server/dist/index.js' };
    send.mockResolvedValue({ ok: true, result: { ...info, clientOptions: updated } });
    await act(async () => button('重新读取本机配置').click());
    expect(input.value).toBe(updated.serverPath);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS' }));
  });

  it('shows an old running service separately without copying its path over the new configuration', async () => {
    const current = { command: '/v40/runtime/node', serverPath: '/v40/mcp-server/dist/index.js' };
    const running = { command: '/v37/runtime/node', serverPath: '/v37/mcp-server/dist/index.js' };
    send.mockResolvedValue({ ok: true, result: { ...info, connected: true, clientOptions: current, runningClientOptions: running, configurationMismatch: true, clientOptionsSource: 'setup' } });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('当前连接的服务与本机配置路径不一致');
    expect(container.textContent).toContain(running.serverPath);
    expect(container.querySelector('textarea')?.value).toContain(current.serverPath);
    await act(async () => button('复制 MCP 配置').click());
    expect(clipboard.mock.calls[0][0]).not.toContain('/v37');
  });

  it('does not overwrite unsaved path edits on a bridge status notification', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="本机 MCP 服务脚本路径"]')!;
    await change(input, '/edited/mcp-server/dist/index.js');
    await act(async () => listeners.forEach(listener => listener({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected: true })));
    expect(input.value).toBe('/edited/mcp-server/dist/index.js');
  });

  it('shows connection info and copies a usable Node stdio configuration, not a WebSocket URL', async () => {
    await render();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('尚未连接本机 MCP 服务');
    expect(container.querySelector('input[readonly]')?.getAttribute('value')).toBe(info.bridgeUrl);
    await act(async () => button('复制 MCP 配置').click());
    const copied = JSON.parse(clipboard.mock.calls[0][0]) as { mcpServers: Record<string, unknown> };
    expect(copied.mcpServers['page-agent']).toEqual({ command: 'node', args: ['/project/mcp-server/dist/index.js'], env: { PAGE_AGENT_BRIDGE_PORT: '17373' } });
  });

  it('validates edited paths and remembers an explicitly saved configuration', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="本机 MCP 服务脚本路径"]')!;
    await change(input, '~/relative/index.js');
    expect(button('复制 MCP 配置').disabled).toBe(true);
    expect(container.textContent).toContain('不能使用相对路径或 ~');
    await change(input, '/new folder/mcp-server/dist/index.js');
    await act(async () => button('记住配置').click());
    expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS', options: { command: 'node', serverPath: '/new folder/mcp-server/dist/index.js' } });
  });

  it('retries a disconnected service and updates live status without interrupting a healthy connection', async () => {
    await render();
    await act(async () => button('重试连接').click());
    expect(send).toHaveBeenCalledWith({ type: 'PAGE_AGENT_RECONNECT_MCP' });
    send.mockResolvedValue({ ok: true, result: { ...info, connected: true } });
    await act(async () => listeners.forEach((listener) => listener({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected: true })));
    expect(container.textContent).toContain('已连接本机 MCP 服务');
    expect(button('重试连接').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
