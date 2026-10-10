// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMessage } from '@/types/messages';
import { McpSettings } from './McpSettings';
import { DEFAULT_MCP_OPTIONS } from '@/shared/mcp-config';

const info = { instanceId: 'instance-A', connected: false, connecting: false, bridgeUrl: 'ws://127.0.0.1:17373/extension', clientOptions: { command: 'node', serverPath: '/project/mcp-server/dist/index.js' } };
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
  vi.stubGlobal('chrome', { runtime: { sendMessage: send, onMessage: { addListener: (listener: (message: RuntimeMessage) => void) => listeners.push(listener), removeListener: (listener: (message: RuntimeMessage) => void) => { listeners = listeners.filter((item) => item !== listener); } } } });
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
  it('lets the user copy automatically detected configuration without entering paths', async () => {
    send.mockResolvedValue({ ok: true, result: { ...info, clientOptions: DEFAULT_MCP_OPTIONS } });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="例如"]')!;
    expect(input.value).toBe(DEFAULT_MCP_OPTIONS.serverPath);
    expect(button('复制 MCP 配置').disabled).toBe(false);
    await act(async () => button('复制 MCP 配置').click());
    const config = JSON.parse(clipboard.mock.calls[0][0]);
    expect(config.mcpServers['page-agent']).toMatchObject({ command: DEFAULT_MCP_OPTIONS.command, args: [DEFAULT_MCP_OPTIONS.serverPath] });
  });

  it('restores build-time defaults only when explicitly requested', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="例如"]')!;
    expect(input.value).toBe(info.clientOptions.serverPath);
    await act(async () => button('恢复本机自动配置').click());
    expect(input.value).toBe(DEFAULT_MCP_OPTIONS.serverPath);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'PAGE_AGENT_SAVE_MCP_OPTIONS' }));
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
    const input = container.querySelector<HTMLInputElement>('input[placeholder^="例如"]')!;
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
    await act(async () => listeners.forEach((listener) => listener({ type: 'PAGE_AGENT_BRIDGE_STATUS', connected: true })));
    expect(container.textContent).toContain('已连接本机 MCP 服务');
    expect(button('重试连接').disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
