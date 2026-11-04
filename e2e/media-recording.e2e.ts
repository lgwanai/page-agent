import { test, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { MediaRecordingResult } from '../src/shared/media-recording';
import type { MediaRecordingNode } from '../src/types/workflow';

test.describe('real media capture', () => {
  let context: BrowserContext, panel: Page, target: Page, worker: Worker, profile: string, extensionId: string, tabId: number;
  test.beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'page-agent-media-e2e-'));
    const extension = join(profile, 'extension');
    await cp(resolve('dist'), extension, { recursive: true });
    async function isolate(directory: string) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await isolate(path);
        else if (entry.name.endsWith('.js') || entry.name === 'manifest.json') await writeFile(path, (await readFile(path, 'utf8')).replaceAll('127.0.0.1:17373', '127.0.0.1:4178').replace(/\b17373\b/g, '4178'));
      }
    }
    await isolate(extension);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 900, height: 600 }, acceptDownloads: true, downloadsPath: join(profile, 'downloads'), ignoreDefaultArgs: ['--mute-audio'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging'] });
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;
    target = await context.newPage(); await target.goto('http://127.0.0.1:4179/recording-fixture');
    await target.locator('#play').click();
    panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await expect(panel.getByRole('button', { name: '录屏与录音', exact: true })).toBeVisible();
    tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url?.includes('/recording-fixture'))!.id!);
    await target.bringToFront();
  });
  test.afterEach(async () => { await context?.close(); if (profile) await rm(profile, { recursive: true, force: true }); });
  async function invokeToolbar() {
    const cdp = await context.newCDPSession(target);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.detach();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets', { filter: [{ type: 'tab' }, { exclude: true }] });
    const tabs = targetInfos.filter(info => info.url === target.url());
    expect(tabs.length, JSON.stringify({ page: targetInfo, tabs: targetInfos })).toBe(1);
    await browserSession.send('Extensions.triggerAction', { id: extensionId, targetId: tabs[0].targetId });
    await browserSession.detach();
  }
  async function saved() {
    return worker.evaluate(async () => (await chrome.storage.local.get('pageAgentMediaRecordingV1')).pageAgentMediaRecordingV1 as MediaRecordingResult | undefined);
  }
  const node = (patch: Partial<MediaRecordingNode> = {}): MediaRecordingNode => ({ id: 'capture', name: '录制验收', kind: 'mediaRecording', action: 'record', mode: 'videoAudio', durationMs: 3000, fileName: '真实录制验收', ...patch });

  test('requires the real toolbar invocation, records in an offscreen document after the panel closes, and confirms the saved file', async ({}, info) => {
    const denied = await panel.evaluate(async tabId => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_RECORDING', operation: 'start', tabId, options: { mode: 'videoAudio', fileName: '权限验收', durationMs: 4000 } }), tabId);
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('未取得网页录制权限') });
    await invokeToolbar();
    const started = await panel.evaluate(async node => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_NODES', nodes: [node] }), node({ action: 'start', durationMs: 5000 }));
    expect(started.result?.ok, JSON.stringify(started)).toBe(true);
    expect(started.result.steps[0].data).toMatchObject({ state: 'recording', audioTracks: 1, videoTracks: 1 });
    await panel.close();
    const background = await context.newPage(); await background.goto('about:blank');
    await expect.poll(async () => (await saved())?.state, { timeout: 15000 }).toBe('saved');
    const result = (await saved())!;
    expect(result.durationMs).toBeGreaterThanOrEqual(4900); expect(result.bytes).toBeGreaterThan(10000);
    expect(result.audioPeak).toBeGreaterThan(0.01); expect(result.audibleSamples).toBeGreaterThan(0);
    expect(result.stopReason).toBe('duration');
    const [download] = await worker.evaluate(async id => chrome.downloads.search({ id }), result.downloadId!);
    expect(download.state).toBe('complete'); expect((await stat(result.savedPath!)).size).toBe(result.bytes);
    await cp(result.savedPath!, info.outputPath('recorded.webm'));
    await writeFile(info.outputPath('result.json'), JSON.stringify(result, null, 2));
  });
  test('MCP returns an async URL before recording ends; polling and file download work after MCP disconnects', async ({}, info) => {
    await target.goto('http://127.0.0.1:4179/recording-fixture?pending=1', { waitUntil: 'domcontentloaded' });
    await target.locator('#play').click();
    expect(await worker.evaluate(async id => (await chrome.tabs.get(id)).status, tabId)).toBe('loading');
    const { Client } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
    const { StdioClientTransport } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
    const client = new Client({ name: 'async-recording-e2e', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-server/dist/index.js')], env: { ...process.env as Record<string, string>, PAGE_AGENT_BRIDGE_PORT: '4178' }, stderr: 'pipe' }));
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 4000 });
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(result.isError, JSON.stringify(content)).not.toBe(true);
      return JSON.parse(content.find(block => block.type === 'text')!.text!);
    };
    let receipt: MediaRecordingResult;
    try {
      const instanceId = (await call('list_page_agent_instances', {}))[0].instanceId;
      const created = await call('create_page_workflow', { instanceId, name: '异步音频录制', targetUrl: target.url() });
      const auth = { instanceId, workflowId: created.workflow.id, key: created.key };
      const capture = node({ mode: 'audio', durationMs: 8000 });
      await call('edit_page_workflow', { ...auth, expectedUpdatedAt: created.workflow.updatedAt, operations: [
        { type: 'update_node', nodeId: 'start', patch: { keepCurrentPage: true, settleDelayMs: 0 } },
        { type: 'add_node', node: capture },
        { type: 'add_node', node: { id: 'output', name: '状态地址', kind: 'output', source: 'variable', value: '{{录制验收.statusUrl}}', outcome: 'success' } },
        { type: 'connect', edge: { id: 'start-capture', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'capture' } },
        { type: 'connect', edge: { id: 'capture-output', sourceNodeId: 'capture', sourcePort: 'success', targetNodeId: 'output' } },
      ] });
      await invokeToolbar();
      const began = Date.now();
      const result = await call('run_page_workflow', auth);
      const responseMs = Date.now() - began;
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(responseMs).toBeLessThan(4000);
      receipt = result.steps.find((step: { nodeId: string }) => step.nodeId === 'capture').data;
      expect(receipt).toMatchObject({ state: 'recording', audioTracks: 1, videoTracks: 0 });
      expect(result.output).toBe(receipt.statusUrl); expect(receipt.savedPath).toBeUndefined();
      expect(await (await fetch(receipt.statusUrl!)).json()).toMatchObject({ status: 'recording', done: false });
      await writeFile(info.outputPath('initial-response.json'), JSON.stringify({ responseMs, result }, null, 2));
    } finally { await client.close(); }
    await panel.close(); const background = await context.newPage(); await background.goto('about:blank');
    await expect.poll(async () => (await (await fetch(receipt!.statusUrl!)).json()).status, { timeout: 15000 }).toBe('completed');
    const completed = await (await fetch(receipt!.statusUrl!)).json();
    expect(completed).toMatchObject({ done: true, success: true });
    expect(completed.durationMs).toBeGreaterThanOrEqual(7900);
    const file = Buffer.from(await (await fetch(completed.fileUrl)).arrayBuffer());
    expect(file).toEqual(await readFile(completed.filePath)); expect(file.length).toBe(completed.bytes);
    expect((await saved())?.audioPeak).toBeGreaterThan(0.01);
    await writeFile(info.outputPath('completed-response.json'), JSON.stringify(completed, null, 2));
    await writeFile(info.outputPath('async-recording.audio.webm'), file);
  });
  test('an accepted task survives workflow completion and a separate stop node returns the same URL', async () => {
    await invokeToolbar();
    const result = await panel.evaluate(async capture => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_GRAPH', nodes: [capture, { id: 'after', name: '立即继续', kind: 'output', source: 'text', value: 'accepted' }], edges: [{ id: 'edge', sourceNodeId: 'capture', sourcePort: 'success', targetNodeId: 'after' }] }), node({ action: 'start', durationMs: 15000 }));
    expect(result.result?.ok, JSON.stringify(result)).toBe(true); expect(result.result.output).toBe('accepted');
    const receipt = result.result.steps[0].data as MediaRecordingResult;
    await expect.poll(async () => (await worker.evaluate(async () => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_OFFSCREEN', operation: 'status' })))?.result?.bytes ?? 0).toBeGreaterThan(10000);
    expect(await (await fetch(receipt.statusUrl!)).json()).toMatchObject({ status: 'recording', done: false });
    const stopped = await panel.evaluate(async capture => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_NODES', nodes: [capture] }), node({ action: 'stop', recordingId: receipt.id }));
    expect(stopped.result?.ok, JSON.stringify(stopped)).toBe(true);
    expect(stopped.result.steps[0].data.statusUrl).toBe(receipt.statusUrl);
    await expect.poll(async () => (await (await fetch(receipt.statusUrl!)).json()).status).toBe('completed');
    expect(await saved()).toMatchObject({ state: 'saved', stopReason: 'manual' });
  });
  test('closing the captured tab makes the URL report failure and a saved partial file', async () => {
    await invokeToolbar();
    const result = await panel.evaluate(async capture => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_NODES', nodes: [capture] }), node({ durationMs: 15000 }));
    expect(result.result?.ok, JSON.stringify(result)).toBe(true);
    const receipt = result.result.steps[0].data as MediaRecordingResult;
    await expect.poll(async () => (await worker.evaluate(async () => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_MEDIA_OFFSCREEN', operation: 'status' })))?.result?.bytes ?? 0).toBeGreaterThan(10000);
    await target.close();
    await expect.poll(async () => (await (await fetch(receipt.statusUrl!)).json()).status).toBe('failed');
    const status = await (await fetch(receipt.statusUrl!)).json();
    expect(status).toMatchObject({ done: true, success: false, stopReason: 'source-ended', partialFile: { filePath: expect.any(String) } });
    expect(status.filePath).toBeUndefined();
    const metadata = (await saved())!; expect(metadata.durationMs).toBeLessThan(15000);
    expect((await stat(status.partialFile.filePath)).size).toBe(metadata.bytes);
  });
  test('creates, configures, saves and reopens the recording node using the actual editor', async ({}, info) => {
    await panel.getByRole('button', { name: '创建工作流', exact: true }).click();
    await panel.getByRole('button', { name: /手动画布编辑/ }).click();
    await panel.getByRole('button', { name: '新增节点', exact: true }).click();
    await panel.locator('.canvas-node-palette').getByRole('button', { name: '网页录制', exact: true }).click();
    await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
    await expect(panel.locator('.inspector-head [lang="en"]')).toHaveText('Web Recording');
    await panel.getByRole('combobox', { name: '录制操作', exact: true }).selectOption('start');
    await panel.getByRole('combobox', { name: '录制内容', exact: true }).selectOption('audio');
    await panel.getByRole('spinbutton', { name: '自动停止上限（秒）', exact: true }).fill('4');
    await panel.getByRole('textbox', { name: '录制文件名', exact: true }).fill('声音-{{主播}}');
    panel.once('dialog', dialog => dialog.accept('录制节点界面验收'));
    await panel.getByRole('button', { name: '保存工作流', exact: true }).click();
    await expect(panel.locator('.document-title span')).toHaveText('已保存');
    const workflow = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0]);
    expect(workflow.nodes.find((entry: MediaRecordingNode) => entry.kind === 'mediaRecording')).toMatchObject({ action: 'start', mode: 'audio', durationMs: 4000, fileName: '声音-{{主播}}' });
    await panel.reload();
    await panel.getByRole('button', { name: /^更多操作/ }).first().click();
    await panel.getByRole('menuitem', { name: '编辑', exact: true }).click();
    await panel.locator('.canvas-node-head strong').filter({ hasText: '网页录制' }).click();
    await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: '录制操作', exact: true })).toHaveValue('start');
    await expect(panel.getByRole('textbox', { name: '录制文件名', exact: true })).toHaveValue('声音-{{主播}}');
    await panel.screenshot({ path: info.outputPath('recording-node.png'), fullPage: true });
  });
});
