import { createHash } from 'node:crypto';
import { test as base, expect, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStartNode, type ScriptDefinition, type WorkflowNode } from '../src/types/workflow';
const site = 'http://127.0.0.1:4179';
const id = '11223344-1111-4111-8111-aabbccddeeff';
const makeWorkflow = (nodes: WorkflowNode[], name = '端到端验收'): ScriptDefinition => ({ id, name, createdAt: 1, updatedAt: 1, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge${index}`, sourceNodeId: nodes[index].id, targetNodeId: node.id, sourcePort: 'success' })) });
const test = base.extend<{ extension: { context: BrowserContext; panel: Page; worker: Worker; target: Page; panelUrl: string } }>({
  extension: async ({}, use, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'page-agent-e2e-'));
    const extensionPath = join(profile, 'extension');
    await cp(resolve('dist'), extensionPath, { recursive: true, filter: source => !source.endsWith('.map') });
    // Isolate the production transport from any MCP service running in the user's profile.
    const replaceTransport = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await replaceTransport(path);
        else if (entry.name.endsWith('.js') || entry.name === 'manifest.json') {
          const text = await readFile(path, 'utf8');
          await writeFile(path, text.replaceAll('127.0.0.1:17373', '127.0.0.1:4178').replace(/\b17373\b/g, '4178'));
        }
      }
    };
    await replaceTransport(extensionPath);
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 420, height: 840 }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      const target = await context.newPage(); await target.goto(`${site}/app`);
      const panel = await context.newPage(); const panelUrl = `chrome-extension://${extensionId}/src/sidepanel/index.html`;
      await panel.goto(panelUrl); await expect(panel.getByRole('button', { name: '创建工作流', exact: true })).toBeVisible();
      await expect(panel.locator('.bridge.online')).toBeVisible();
      await worker.evaluate(async () => { const tabs = await chrome.tabs.query({}); const target = tabs.find(tab => tab.url?.startsWith('http://127.0.0.1:4179/')); if (target?.id) await chrome.tabs.update(target.id, { active: true }); });
      await use({ context, panel, worker, target, panelUrl });
      if (!panel.isClosed()) await panel.screenshot({ path: testInfo.outputPath('panel.png'), fullPage: true });
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); await rm(testInfo.outputPath('large-files'), { recursive: true, force: true }); }
  },
});
async function seed(worker: Worker, panel: Page, workflow: ScriptDefinition) {
  await worker.evaluate(async workflow => { await chrome.storage.local.set({ pageAgentLibraryV2: { schemaVersion: 2, actions: [], scripts: [workflow] } }); }, workflow);
  await panel.reload(); await expect(panel.locator('.workflow-name')).toHaveText(workflow.name);
}
async function more(panel: Page, action: string) {
  await panel.getByRole('button', { name: /^更多操作/ }).first().click();
  await panel.getByRole('menuitem', { name: action, exact: true }).click();
}
test('records real form operations, saves, runs and runs again after reopening', async ({ extension: { panel, target, context, panelUrl } }) => {
  await panel.getByRole('button', { name: '创建工作流', exact: true }).click();
  await panel.getByRole('button', { name: /录制网页操作/ }).click();
  await expect(panel.getByText('录制中', { exact: true })).toBeVisible();
  await target.locator('#name').fill('端到端客户'); await target.locator('#apply').click();
  await expect(target.locator('#result')).toHaveText('端到端客户');
  await panel.getByRole('button', { name: '停止录制并编辑', exact: true }).click();
  await expect(panel.getByRole('button', { name: '保存工作流', exact: true })).toBeVisible();
  panel.once('dialog', dialog => dialog.accept('录制回放验收'));
  await panel.getByRole('button', { name: '保存工作流', exact: true }).click();
  await expect(panel.locator('.document-title strong')).toHaveText('录制回放验收');
  await panel.getByRole('button', { name: '‹ 返回列表', exact: true }).click();
  await target.reload();
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(target.locator('#result')).toHaveText('端到端客户');
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  await panel.close(); const reopened = await context.newPage(); await reopened.goto(panelUrl); await target.bringToFront();
  await reopened.getByRole('button', { name: '运行', exact: true }).click();
  await expect(reopened.getByText('流程执行完成', { exact: true })).toBeVisible();
  await expect(target.locator('#result')).toHaveText('端到端客户');
  await reopened.close();
});
test('stops a real background wait without executing its successor, persists history', async ({ extension: { panel, worker, target } }) => {
  const wait: WorkflowNode = { id: 'wait', name: '长等待', kind: 'wait', durationMs: 60000 };
  const input: WorkflowNode = { id: 'input', name: '禁止执行', kind: 'dom', target: { name: '输入', selector: '#name', frameId: 0, tagName: 'input', label: '' }, event: { type: 'input', value: 'should-not-run' } };
  await seed(worker, panel, makeWorkflow([wait, input]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await panel.getByRole('button', { name: '停止运行', exact: true }).click();
  await expect(panel.getByText('流程已停止', { exact: true })).toBeVisible();
  await expect(target.locator('#name')).toHaveValue('');
  await panel.reload(); await panel.getByRole('button', { name: '运行历史', exact: true }).click();
  await expect(panel.locator('.history-entry summary')).toContainText('已停止');
});
test('recovers a draft after panel close and preserves undo/redo edits', async ({ extension: { panel, worker, context, panelUrl } }) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  await seed(worker, panel, makeWorkflow([start])); await more(panel, '编辑');
  await panel.getByRole('button', { name: '新增节点', exact: true }).click();
  await panel.locator('.canvas-node-palette').getByRole('button', { name: '等待', exact: true }).click();
  await expect(panel.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(panel.getByRole('button', { name: '重做', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('pageAgentEditorDraftV1')).pageAgentEditorDraftV1?.nodes.length)).toBe(2);
  await panel.close(); const reopened = await context.newPage(); await reopened.goto(panelUrl);
  await reopened.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(reopened.locator('.document-title span')).toHaveText('尚未保存');
  await reopened.getByRole('button', { name: '更新工作流', exact: true }).click();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.length)).toBe(2);
  await reopened.close();
});
test('copies, searches, tags, recycles, restores and permanently deletes', async ({ extension: { panel, worker } }) => {
  await seed(worker, panel, makeWorkflow([createStartNode('start')]));
  await more(panel, '复制为新工作流'); await expect(panel.locator('.script-card')).toHaveCount(2);
  await panel.getByRole('searchbox', { name: '搜索工作流' }).fill('副本');
  await expect(panel.locator('.script-card')).toHaveCount(1);
  panel.once('dialog', dialog => dialog.accept('日常，报表')); await more(panel, '设置标签');
  await expect(panel.locator('.workflow-tags')).toContainText('报表');
  panel.once('dialog', dialog => dialog.accept()); await more(panel, '删除工作流');
  await expect(panel.locator('.script-card')).toHaveCount(0);
  await panel.getByRole('button', { name: '回收站', exact: true }).click();
  await panel.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(panel.locator('.trash-entry')).toHaveCount(0);
  await panel.getByRole('button', { name: '关闭回收站', exact: true }).click();
  await expect(panel.locator('.script-card')).toHaveCount(1);
  panel.once('dialog', dialog => dialog.accept()); await more(panel, '删除工作流');
  await panel.getByRole('button', { name: '回收站', exact: true }).click();
  panel.once('dialog', dialog => dialog.accept()); await panel.getByRole('button', { name: '彻底删除', exact: true }).click();
  await expect(panel.locator('.trash-entry')).toHaveCount(0);
  const data = await worker.evaluate(async () => chrome.storage.local.get(['pageAgentLibraryV2', 'pageAgentWorkflowKeysV1']));
  expect(data.pageAgentLibraryV2.scripts).toHaveLength(1);
  expect(Object.keys(data.pageAgentWorkflowKeysV1)).toEqual([id]);
});
test('runs across SPA navigation, iframe and a date input with real content scripts', async ({ extension: { panel, worker, target } }) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  const dom = (id: string, selector: string, event: { type: 'click' | 'input'; value?: string }, frameUrl?: string): WorkflowNode => ({ id, name: id, kind: 'dom', target: { name: id, selector, frameId: 0, tagName: event.type === 'click' ? 'button' : 'input', label: '', frameUrl }, event });
  const workflow = makeWorkflow([start, dom('route', '#route', { type: 'click' }), dom('frame', '#frame-input', { type: 'input', value: 'iframe verified' }, `${site}/frame`), dom('date', '#date', { type: 'input', value: '2026-10-19' }, `${site}/app?screen=detail`)]);
  await seed(worker, panel, workflow); await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  await expect(target).toHaveURL(`${site}/app?screen=detail`);
  await expect(target.frameLocator('iframe[src="/frame"]').locator('#frame-input')).toHaveValue('iframe verified');
  await expect(target.locator('#date')).toHaveValue('2026-10-19');
});

test('imports an archived ID as a new workflow and can save subsequent edits', async ({ extension: { panel, worker } }) => {
  const workflow = makeWorkflow([createStartNode('start')]);
  await seed(worker, panel, workflow);
  panel.once('dialog', dialog => dialog.accept()); await more(panel, '删除工作流');
  await expect(panel.locator('.script-card')).toHaveCount(0);
  await panel.locator('input[type="file"]').setInputFiles({ name: 'workflow.page-agent.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'page-agent-workflow', schemaVersion: 1, workflow })) });
  await expect(panel.locator('.document-title strong')).toHaveText(workflow.name);
  await panel.getByRole('button', { name: '新增节点', exact: true }).click();
  await panel.locator('.canvas-node-palette').getByRole('button', { name: '等待', exact: true }).click();
  await panel.getByRole('button', { name: '更新工作流', exact: true }).click();
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.length)).toBe(2);
  const library = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2);
  expect(library.scripts[0].id).not.toBe(id);
  expect(library.scripts[0].nodes).toHaveLength(2);
  expect(library.trash[0].workflow.id).toBe(id);
});

for (const scope of ['main', 'iframe', 'cross-origin'] as const) test(`uploads paths through the real MCP bridge and sends exact file bytes from a ${scope} control`, async ({ extension: { panel, worker, target } }, testInfo) => {
  const folder = testInfo.outputPath('local-files');
  const { mkdir } = await import('node:fs/promises'); await mkdir(folder, { recursive: true });
  const first = join(folder, '中文 report.txt'); const second = join(folder, 'payload.bin');
  const content = Buffer.from('文件上传验收\nwith spaces, commas'); const binary = Buffer.from([0, 1, 2, 127, 255, 13, 10]);
  await writeFile(first, content); await writeFile(second, binary);
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  start.inputs = [{ id: 'paths', name: '文件路径', type: 'array', required: true }];
  const upload: WorkflowNode = { id: 'upload', name: '上传文件', kind: 'dom', target: { name: '上传', selector: '#upload-label', frameId: 0, frameUrl: scope === 'cross-origin' ? 'http://localhost:4179/upload-frame' : `${site}/${scope === 'main' ? 'app' : 'upload-frame'}`, tagName: 'label', label: '上传文件' }, event: { type: 'upload', value: '{{文件路径}}' } };
  await seed(worker, panel, makeWorkflow([start, upload], '路径上传验收'));
  // Exercise the same typed workflow API used by MCP, preserving array input types.
  const response = await panel.evaluate(async data => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: data.id, variables: { 文件路径: data.paths } }), { id, paths: [first, second] });
  expect(response.result?.ok, JSON.stringify(response.result)).toBe(true);
  expect(response.result.steps.at(-1).data).toMatchObject({ filesSelected: true, serverUploadVerified: false, totalBytes: content.length + binary.length });
  const receipt = scope === 'main' ? target.locator('#upload-receipt') : target.frameLocator(scope === 'cross-origin' ? '#cross-upload-iframe' : '#upload-iframe').locator('#upload-receipt');
  await expect(receipt).not.toHaveText('');
  const server = JSON.parse((await receipt.textContent())!);
  expect(server.files).toMatchObject([
    { name: '中文 report.txt', size: content.length, sha256: createHash('sha256').update(content).digest('hex') },
    { name: 'payload.bin', size: binary.length, sha256: createHash('sha256').update(binary).digest('hex') },
  ]);
  expect(JSON.stringify(response.result)).not.toContain(content.toString('base64'));
});

test('rejects a missing disk file and a disallowed extension without changing the upload control', async ({ extension: { panel, worker, target } }, testInfo) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  const upload: WorkflowNode = { id: 'upload', name: '上传文件', kind: 'dom', target: { name: '上传', selector: '#single-file', frameId: 0, frameUrl: `${site}/app`, tagName: 'input', label: '', attributes: { type: 'file' } }, event: { type: 'upload', value: '{{path}}' } };
  await seed(worker, panel, makeWorkflow([start, upload]));
  const run = (path: string) => panel.evaluate(async data => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: data.id, variables: { path: data.path } }), { id, path });
  const missing = await run(testInfo.outputPath('does-not-exist.txt'));
  expect(missing.result.ok).toBe(false); expect(missing.result.error).toContain('不存在');
  const wrong = testInfo.outputPath('wrong.pdf'); await writeFile(wrong, 'PDF sample');
  const invalid = await run(wrong);
  expect(invalid.result.ok).toBe(false); expect(invalid.result.error).toContain('不符合');
  expect(await target.locator('#single-file').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  await expect(target.locator('#upload-receipt')).toHaveText('');
  const empty = testInfo.outputPath('empty.txt'); await writeFile(empty, '');
  const valid = await run(empty);
  expect(valid.result.ok, JSON.stringify(valid.result)).toBe(true);
  expect(valid.result.steps.at(-1).data.files).toMatchObject([{ name: 'empty.txt', size: 0 }]);
  await expect(target.locator('#upload-receipt')).not.toHaveText('');
});

for (const scenario of [
  { scope: 'main', sizesMiB: [256] },
  { scope: 'iframe', sizesMiB: [64, 96] },
  { scope: 'cross-origin', sizesMiB: [128] },
] as const) test(`streams large disk files in ${scenario.scope} (${scenario.sizesMiB.join('+')} MiB) with matching server hashes`, async ({ extension: { panel, worker, target } }, testInfo) => {
  test.setTimeout(120000);
  const { open, mkdir } = await import('node:fs/promises');
  const folder = testInfo.outputPath('large-files'); await mkdir(folder, { recursive: true });
  const expected = [], paths: string[] = [];
  for (const [index, size] of scenario.sizesMiB.entries()) {
    const name = `large-${index}-${size}MiB.bin`, path = join(folder, name);
    const block = Buffer.alloc(1024 ** 2, 65 + index), hash = createHash('sha256');
    const handle = await open(path, 'w');
    try { for (let part = 0; part < size; part++) { await handle.writeFile(block); hash.update(block); } }
    finally { await handle.close(); }
    paths.push(path); expected.push({ name, size: size * 1024 ** 2, sha256: hash.digest('hex') });
  }
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  const frameUrl = scenario.scope === 'cross-origin' ? 'http://localhost:4179/upload-frame' : `${site}/${scenario.scope === 'main' ? 'app' : 'upload-frame'}`;
  const upload: WorkflowNode = { id: 'upload', kind: 'dom', name: '大文件上传', target: { name: '上传', selector: '#upload-label', frameId: 0, frameUrl, tagName: 'label', label: '上传文件' }, event: { type: 'upload', value: '{{paths}}' } };
  await seed(worker, panel, makeWorkflow([start, upload], '原生大文件上传验收'));
  const response = await panel.evaluate(async data => chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: data.id, variables: { paths: data.paths } }), { id, paths });
  expect(response.result?.ok, JSON.stringify(response.result)).toBe(true);
  expect(JSON.stringify(response.result).length).toBeLessThan(10000);
  expect(JSON.stringify(response.result)).not.toContain(folder);
  const receipt = scenario.scope === 'main' ? target.locator('#upload-receipt') : target.frameLocator(scenario.scope === 'iframe' ? '#upload-iframe' : '#cross-upload-iframe').locator('#upload-receipt');
  await expect(receipt).not.toHaveText('', { timeout: 60000 });
  const server = JSON.parse((await receipt.textContent())!);
  expect(server.files).toMatchObject(expected);
  expect(server.totalBytes).toBe(expected.reduce((total, file) => total + file.size, 0));
});

test('semantic recording and manual selection agree and survive DOM layout changes', async ({ extension: { panel, worker, target } }) => {
  await target.evaluate(() => {
    const button = document.querySelector('#apply')!;
    const toolbar = document.createElement('section'); toolbar.id = 'toolbar';
    button.replaceWith(toolbar); toolbar.append(button); button.removeAttribute('id'); button.textContent = '提交';
    toolbar.insertAdjacentHTML('beforeend','<button>取消</button>');
    document.body.insertAdjacentHTML('beforeend','<button>提交</button>');
  });
  await panel.getByRole('button',{name:'创建工作流',exact:true}).click();
  await panel.getByRole('button',{name:/录制网页操作/}).click();
  await expect(panel.getByText('录制中',{exact:true})).toBeVisible();
  await target.locator('#toolbar button').first().click();
  await panel.getByRole('button',{name:'停止录制并编辑',exact:true}).click();
  panel.once('dialog', dialog => dialog.accept('语义定位验收'));
  await panel.getByRole('button',{name:'保存工作流',exact:true}).click();
  const recorded = await worker.evaluate(async () => {
    const library = (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2;
    return library.scripts[0].nodes.find((node: WorkflowNode) => node.kind === 'dom').target;
  });
  expect(recorded.selector).toBe('#toolbar button');
  expect(recorded.locator.candidates[0]).toMatchObject({kind:'ancestor-exact',match:{kind:'text',value:'提交'}});
  await worker.evaluate(async () => {
    (globalThis as any).__selectedTarget = null;
    chrome.runtime.onMessage.addListener(message => { if(message.type === 'PAGE_AGENT_SELECTED') (globalThis as any).__selectedTarget = message.target; });
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://127.0.0.1:4179/'))!;
    await chrome.tabs.sendMessage(tab.id!,{type:'PAGE_AGENT_START_SELECT'},{frameId:0});
  });
  await target.locator('#toolbar button').first().click({force:true});
  await expect.poll(() => worker.evaluate(() => (globalThis as any).__selectedTarget?.locator)).toEqual(recorded.locator);
  await target.evaluate(() => {
    const button = document.querySelector('#toolbar button')!;
    button.className = 'new-rendered active';
    const wrapper = document.createElement('div'); button.replaceWith(wrapper); wrapper.append(button);
    document.querySelector('#toolbar')!.insertAdjacentHTML('afterbegin','<button>新建</button>');
    document.querySelector<HTMLInputElement>('#name')!.value = '布局变化后仍正确';
  });
  const node: WorkflowNode = { id:'click',name:'稳健提交',kind:'dom',target:recorded,event:{type:'click'} };
  await seed(worker,panel,makeWorkflow([node],'布局变化回放'));
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(target.locator('#result')).toHaveText('布局变化后仍正确');
  await expect(panel.getByText('流程执行完成',{exact:true})).toBeVisible();
});

test('relocates a rebuilt cross-origin iframe while retaining business URL guards', async ({ extension:{panel,worker,target} }) => {
  await target.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('#cross-upload-iframe')!;
    frame.name = 'business-form'; frame.src = 'http://localhost:4179/selector-frame?activityId=123&processId=old';
  });
  const frame = target.frameLocator('#cross-upload-iframe');
  await expect(frame.locator('#toolbar')).toBeVisible();
  const originalFrameId = await worker.evaluate(async () => {
    (globalThis as any).__selectedTarget = null;
    chrome.runtime.onMessage.addListener(message => { if(message.type === 'PAGE_AGENT_SELECTED') (globalThis as any).__selectedTarget = message.target; });
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith('http://127.0.0.1:4179/'))!;
    const frames = await chrome.webNavigation.getAllFrames({tabId:tab.id!});
    const frame = frames!.find(frame => frame.url.includes('/selector-frame'))!;
    await chrome.tabs.sendMessage(tab.id!,{type:'PAGE_AGENT_START_SELECT'},{frameId:frame.frameId});
    return frame.frameId;
  });
  await expect(frame.locator('#__page_agent_select_overlay__')).toBeAttached();
  // Dispatch in the child viewport to avoid headless OOPIF pointer routing.
  // The production selector overlay and capture listener still create the target.
  await frame.locator('#toolbar button').first().evaluate(element => {
    const box = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2}));
  });
  await expect.poll(() => worker.evaluate(() => (globalThis as any).__selectedTarget?.selector)).toBe('#toolbar button');
  const captured = await worker.evaluate(() => (globalThis as any).__selectedTarget);
  captured.frameId = originalFrameId;
  expect(captured.frameQueryKeys).toEqual(['activityId']);
  await target.evaluate(() => {
    const old = document.querySelector<HTMLIFrameElement>('#cross-upload-iframe')!;
    const fresh = old.cloneNode() as HTMLIFrameElement;
    fresh.src = fresh.src.replace('processId=old','processId=new'); old.replaceWith(fresh);
  });
  await expect(frame.locator('#toolbar')).toBeVisible();
  await seed(worker,panel,makeWorkflow([{id:'click',name:'跨域 frame 提交',kind:'dom',target:captured,event:{type:'click'}}]));
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(frame.locator('#click-count')).toHaveText('1');
  await expect(panel.getByText('流程执行完成',{exact:true})).toBeVisible();
});

test('automatically repairs and persists an existing numeric selector, then reuses it after reopening', async ({extension:{panel,worker,target}})=>{
  await target.evaluate(()=>{
    document.querySelector('#apply')!.outerHTML='<section id="legacy-tools"><button>新建</button><div><button>保存</button></div><button>取消</button></section><button>保存</button>';
    document.querySelector('#legacy-tools div button')!.addEventListener('click',()=>document.querySelector('#result')!.textContent='已正确保存');
    document.querySelector('#legacy-tools > button:last-child')!.addEventListener('click',()=>document.querySelector('#result')!.textContent='误点取消');
  });
  const legacyTarget={name:'旧保存按钮',label:'保存',selector:'#legacy-tools > button:nth-of-type(2)',tagName:'button',text:'保存',attributes:{},frameId:0,frameUrl:site+'/app'};
  await seed(worker,panel,makeWorkflow([{id:'save',name:'旧保存节点',kind:'dom',target:legacyTarget,event:{type:'click'}}],'旧流程自动修复'));
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(target.locator('#result')).toHaveText('已正确保存');
  await expect(panel.getByText('已自动修复并保存（保留原配置备份）',{exact:false})).toBeVisible();
  const stored=await worker.evaluate(async()=> (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0]);
  expect(stored.nodes.find((node: WorkflowNode)=>node.id==='save').target.selector).toBe('#legacy-tools button');
  expect(stored.nodes.find((node: WorkflowNode)=>node.id==='save').target.selectorUpgrade.previous).toEqual(legacyTarget);
  expect(stored.nodes.find((node: WorkflowNode)=>node.id==='save').target.locator.version).toBe(1);
  await panel.reload();
  await target.evaluate(()=>{
    const button=document.querySelector('#legacy-tools div button')!;
    const wrapper=document.createElement('section');button.replaceWith(wrapper);wrapper.append(button);
    document.querySelector('#legacy-tools')!.insertAdjacentHTML('afterbegin','<button>新增</button>');
    document.querySelector('#result')!.textContent='';
  });
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(target.locator('#result')).toHaveText('已正确保存');
  await expect(panel.getByText('流程执行完成',{exact:true})).toBeVisible();
});

test('keeps an ambiguous old workflow unchanged and sends no click',async({extension:{panel,worker,target}})=>{
  await target.evaluate(()=>{
    document.querySelector('#apply')!.outerHTML='<section id="legacy-tools"><button>保存</button><button>保存</button></section>';
    document.querySelectorAll('#legacy-tools button').forEach(button=>button.addEventListener('click',()=>document.querySelector('#result')!.textContent='误点击'));
  });
  const legacyTarget={name:'保存',label:'保存',selector:'#legacy-tools > button:nth-child(1)',tagName:'button',text:'保存',frameId:0,frameUrl:site+'/app'};
  await seed(worker,panel,makeWorkflow([{id:'save',name:'重复按钮',kind:'dom',target:legacyTarget,event:{type:'click'}}]));
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(panel.getByText('流程执行失败',{exact:true})).toBeVisible();
  await expect(target.locator('#result')).toHaveText('');
  const stored=await worker.evaluate(async()=> (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.find((node: WorkflowNode)=>node.id==='save').target);
  expect(stored).toEqual(legacyTarget);
  await expect(panel.getByText(/Selector 自动升级：0 项成功/)).toBeVisible();
});

test('repairs a legacy iframe target after its ID and runtime URL change, and persists guards',async({extension:{panel,worker,target}})=>{
  await target.evaluate(()=>{
    const iframe=document.querySelector<HTMLIFrameElement>('#cross-upload-iframe')!;
    const fresh=iframe.cloneNode() as HTMLIFrameElement;
    fresh.name='business-form';fresh.src='http://localhost:4179/selector-frame?activityId=123&processId=new';iframe.replaceWith(fresh);
  });
  const frame=target.frameLocator('#cross-upload-iframe');await expect(frame.locator('#toolbar')).toBeVisible();
  const legacyTarget={name:'旧 frame 提交',label:'提交',selector:'#toolbar > div:nth-child(3) > button',tagName:'button',text:'提交',frameId:54321,frameUrl:'http://localhost:4179/selector-frame?activityId=123&processId=old'};
  await seed(worker,panel,makeWorkflow([{id:'submit',name:'旧 iframe 节点',kind:'dom',target:legacyTarget,event:{type:'click'}}]));
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(frame.locator('#click-count')).toHaveText('1');
  await expect(panel.getByText('流程执行完成',{exact:true})).toBeVisible();
  const stored=await worker.evaluate(async()=> (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.find((node: WorkflowNode)=>node.id==='submit').target);
  expect(stored.frameId).not.toBe(54321);expect(stored.frameQueryKeys).toEqual(['activityId']);
  expect(stored.frameName).toBe('business-form');
  expect(stored.selectorUpgrade.previous).toEqual(legacyTarget);
  await target.evaluate(()=>{const iframe=document.querySelector<HTMLIFrameElement>('#cross-upload-iframe')!;iframe.src=iframe.src.replace('processId=new','processId=again');});
  await expect(frame.locator('#click-count')).toHaveText('0');
  await panel.getByRole('button',{name:'运行',exact:true}).click();
  await expect(frame.locator('#click-count')).toHaveText('1');
});

test('keeps an open editor synchronized after automatic repair and allows saving without losing the upgrade',async({extension:{panel,worker,target}})=>{
  const start=createStartNode('start');start.keepCurrentPage=true;start.settleDelayMs=0;
  const legacyTarget={name:'客户',label:'客户',selector:'div.old > input:nth-child(9)',tagName:'input',attributes:{id:'name'},frameId:0,frameUrl:site+'/app'};
  await seed(worker,panel,makeWorkflow([start,{id:'customer',name:'输入客户',kind:'dom',target:legacyTarget,event:{type:'input',value:'编辑器自动升级'}}],'编辑器升级'));
  await more(panel,'编辑');
  await panel.getByRole('button',{name:'▶ 运行画布',exact:true}).click();
  await expect(target.locator('#name')).toHaveValue('编辑器自动升级');
  await expect(panel.getByRole('button',{name:'▶ 运行画布',exact:true})).toBeEnabled();
  await panel.getByRole('button',{name:'更新工作流',exact:true}).click();
  await expect(panel.getByText('已更新 工作流：编辑器升级',{exact:true})).toBeVisible();
  const stored=await worker.evaluate(async()=> (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.find((node:WorkflowNode)=>node.id==='customer').target);
  expect(stored.selector).toBe('#name');expect(stored.locator.version).toBe(1);
  expect(stored.selectorUpgrade.previous).toEqual(legacyTarget);
});

test('deletes workflow nodes through an actual stdio MCP client and persists the Chrome graph',async({extension:{panel,target}})=>{
  const { Client }=await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport }=await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const client=new Client({name:'node-delete-e2e',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('mcp-server/dist/index.js')],env:{...process.env as Record<string,string>,PAGE_AGENT_BRIDGE_PORT:'4178'},stderr:'pipe'});
  await client.connect(transport);
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:args});
    const block=result.content as Array<{type:string;text?:string}>;
    return {error:result.isError===true,data:JSON.parse(block.find(item=>item.type==='text')!.text!)};
  };
  try{
    expect((await client.listTools()).tools.some(tool=>tool.name==='delete_page_node')).toBe(true);
    const instances=await call('list_page_agent_instances',{});
    expect(instances.data).toHaveLength(1);
    const instanceId=instances.data[0].instanceId;
    const created=await call('create_page_workflow',{instanceId,name:'MCP节点删除验收'});
    expect(created.error).toBe(false);
    const auth={instanceId,workflowId:created.data.workflow.id,key:created.data.key};
    const edited=await call('edit_page_workflow',{...auth,expectedUpdatedAt:created.data.workflow.updatedAt,operations:[
      {type:'add_node',node:{id:'wait',name:'要删除的等待',kind:'wait',durationMs:0}},
      {type:'add_node',node:{id:'tail',name:'保留的节点',kind:'wait',durationMs:0}},
      {type:'add_node',node:{id:'loop',name:'要删除的容器',kind:'loop',items:'[1]',itemVariable:'item',indexVariable:'index',maxIterations:2,body:{entryNodeId:'child1',nodes:[{id:'child1',name:'内部一',kind:'wait',durationMs:0},{id:'child2',name:'内部二',kind:'wait',durationMs:0}],edges:[{id:'inner',sourceNodeId:'child1',targetNodeId:'child2',sourcePort:'success'}]}}},
      {type:'connect',edge:{id:'in',sourceNodeId:'start',targetNodeId:'wait',sourcePort:'success'}},
      {type:'connect',edge:{id:'out',sourceNodeId:'wait',targetNodeId:'tail',sourcePort:'success'}},
      {type:'connect',edge:{id:'to-loop',sourceNodeId:'tail',targetNodeId:'loop',sourcePort:'success'}},
    ]});
    expect(edited.error).toBe(false);
    const child=await call('delete_page_node',{...auth,expectedUpdatedAt:edited.data.updatedAt,nodeId:'child1'});
    expect(child.error).toBe(false);
    expect(child.data.nodes.find((node:WorkflowNode)=>node.id==='loop').body).toMatchObject({nodes:[{id:'child2'}],edges:[]});
    const root=await call('delete_page_node',{...auth,expectedUpdatedAt:child.data.updatedAt,nodeId:'wait'});
    expect(root.error).toBe(false);expect(root.data.edges.map((edge:{id:string})=>edge.id)).toEqual(['to-loop']);
    const container=await call('delete_page_node',{...auth,expectedUpdatedAt:root.data.updatedAt,nodeId:'loop'});
    expect(container.error).toBe(false);
    expect(container.data.nodes.map((node:WorkflowNode)=>node.id)).toEqual(['start','tail']);expect(container.data.edges).toEqual([]);
    for(const request of [
      {...auth,nodeId:'start',expectedUpdatedAt:container.data.updatedAt},
      {...auth,nodeId:'missing',expectedUpdatedAt:container.data.updatedAt},
      {...auth,nodeId:'tail',expectedUpdatedAt:edited.data.updatedAt},
      {...auth,key:'wrong',nodeId:'tail',expectedUpdatedAt:container.data.updatedAt},
    ]) expect((await call('delete_page_node',request)).error).toBe(true);
    const reopened=await call('get_page_workflow',auth);
    expect(reopened.data.nodes.map((node:WorkflowNode)=>node.id)).toEqual(['start','tail']);
    expect(reopened.data.updatedAt).toBe(container.data.updatedAt);
    await panel.reload();await expect(panel.locator('.workflow-name')).toHaveText('MCP节点删除验收');
    await more(panel,'编辑');await expect(panel.locator('.canvas-node-head strong')).toHaveText(['开始','保留的节点']);
    await expect(target.locator('#result')).toHaveText('');
  }finally{await client.close();}
});

function dialogNode(selector: string, dialogType: 'alert' | 'confirm' | 'prompt' | 'beforeunload' = 'confirm', action: 'accept' | 'dismiss' = 'accept'): WorkflowNode {
  return { id: 'dialog', name: '处理浏览器弹窗', kind: 'dialog', target: { name: '弹窗触发控件', selector, frameId: 0, tagName: selector === '#leave' ? 'a' : 'button', label: '' }, event: { type: 'click' }, dialogType, action, message: '', promptText: '中文备注', timeoutMs: 3000 };
}
test('native dialog nodes confirm accept/cancel, prompt input/cancel/empty, alert and delayed dialog execute once', async ({ extension: { worker, panel, target } }) => {
  test.setTimeout(90000);
  await target.goto(`${site}/dialogs`);
  // Observe only: Playwright must not auto-dismiss dialogs; the extension owns the response.
  const observed: string[] = []; target.on('dialog', dialog => { observed.push(dialog.type()); });
  const scenarios = [
    { selector: '#confirm-button', type: 'confirm' as const, action: 'accept' as const, expected: 'true' },
    { selector: '#confirm-button', type: 'confirm' as const, action: 'dismiss' as const, expected: 'false' },
    { selector: '#prompt-button', type: 'prompt' as const, action: 'accept' as const, expected: '中文备注' },
    { selector: '#prompt-button', type: 'prompt' as const, action: 'dismiss' as const, expected: '[cancelled]' },
    { selector: '#prompt-button', type: 'prompt' as const, action: 'accept' as const, expected: '' },
    { selector: '#alert-button', type: 'alert' as const, action: 'accept' as const, expected: 'alert-closed' },
    { selector: '#delayed-button', type: 'confirm' as const, action: 'dismiss' as const, expected: 'false' },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const node = dialogNode(scenario.selector, scenario.type, scenario.action);
    if (node.kind === 'dialog' && scenario.type === 'prompt') node.promptText = scenario.expected === '' ? '' : '{{备注}}';
    const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
    if (scenario.type === 'prompt') start.inputs = [{ id: 'memo', name: '备注', type: 'string', required: false }];
    await seed(worker, panel, makeWorkflow([start, node]));
    await panel.getByRole('button', { name: '运行', exact: true }).click();
    if (scenario.type === 'prompt') { await panel.getByRole('textbox', { name: '备注', exact: true }).fill(scenario.expected); await panel.getByRole('button', { name: '开始运行', exact: true }).click(); }
    await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
    await expect(target.locator('#dialog-result')).toHaveText(scenario.expected);
    await expect(target.locator('#trigger-count')).toHaveText(String(index + 1));
  }
  expect(observed).toEqual(scenarios.map(scenario => scenario.type));
});
test('native dialog mismatch and missing dialog fail without retry or successor execution', async ({ extension: { worker, panel, target } }) => {
  await target.goto(`${site}/dialogs`);
  let pending: import('@playwright/test').Dialog | undefined;
  target.on('dialog', dialog => { pending = dialog; });
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  const node = dialogNode('#confirm-button'); if (node.kind === 'dialog') node.message = '错误的文字';
  const next: WorkflowNode = { id: 'next', name: '禁止后续', kind: 'dom', target: { name: '不执行', selector: '#none-button', frameId: 0, tagName: 'button', label: '' }, event: { type: 'click' } };
  await seed(worker, panel, makeWorkflow([start, node, next]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).not.toBeVisible();
  await expect(panel.getByText(/浏览器弹窗不匹配/).first()).toBeVisible();
  if (pending) await pending.dismiss().catch(() => {});
  await expect(target.locator('#trigger-count')).toHaveText('1');
  const noDialog = dialogNode('#none-button'); if (noDialog.kind === 'dialog') noDialog.timeoutMs = 500;
  await seed(worker, panel, makeWorkflow([start, noDialog, next]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText(/浏览器弹窗节点等待超过/).first()).toBeVisible();
  await expect(target.locator('#trigger-count')).toHaveText('2');
});

test('native dialog node handles an out-of-process cross-origin iframe', async ({ extension: { worker, panel, target } }) => {
  await target.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'dialog-frame'; frame.src = 'http://localhost:4179/dialogs'; document.body.prepend(frame); });
  const frame = target.frameLocator('#dialog-frame'); await expect(frame.locator('#confirm-button')).toBeVisible();
  target.on('dialog', () => {});
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  const node = dialogNode('#confirm-button', 'confirm', 'dismiss');
  if (node.kind === 'dialog') node.target.frameUrl = 'http://localhost:4179/dialogs';
  await seed(worker, panel, makeWorkflow([start, node]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  await expect(frame.locator('#dialog-result')).toHaveText('false');
  await expect(frame.locator('#trigger-count')).toHaveText('1');
});
test('native dialog node cancels and accepts beforeunload after a trusted user gesture', async ({ extension: { worker, panel, target } }) => {
  await target.goto(`${site}/dialogs`); target.on('dialog', () => {});
  await target.locator('#arm-unload').click();
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  await seed(worker, panel, makeWorkflow([start, dialogNode('#leave', 'beforeunload', 'dismiss')]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  expect(target.url()).toBe(`${site}/dialogs`);
  // Chrome reports cancellation correctly; Playwright's separate CDP client still considers navigation pending.
  const document = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === 'http://127.0.0.1:4179/dialogs')!;
    return (await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => ({ href: location.href, present: !!document.querySelector('#confirm-button') }) }))[0].result;
  });
  expect(document).toEqual({ href: `${site}/dialogs`, present: true });
  await seed(worker, panel, makeWorkflow([start, dialogNode('#leave', 'beforeunload', 'accept')]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  await expect(target).toHaveURL(`${site}/after-dialog`);
});

test('native dialog node can be created, configured, debugged and exported through real MCP', async ({ extension: { target, panel } }) => {
  await target.goto(`${site}/dialogs`); target.on('dialog', () => {});
  const { Client } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const client = new Client({ name: 'dialog-e2e', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-server/dist/index.js')], env: { ...process.env as Record<string, string>, PAGE_AGENT_BRIDGE_PORT: '4178' }, stderr: 'pipe' }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const blocks = result.content as Array<{ type: string; text?: string }>;
    expect(result.isError, blocks.find(block => block.text)?.text).not.toBe(true);
    return JSON.parse(blocks.find(block => block.type === 'text')!.text!);
  };
  try {
    const toolkit = await call('get_page_workflow_toolkit', {});
    expect(toolkit.templates.dialog).toMatchObject({ kind: 'dialog', dialogType: 'confirm', action: 'accept' });
    const instanceId = (await call('list_page_agent_instances', {}))[0].instanceId;
    const created = await call('create_page_workflow', { instanceId, name: 'MCP原生弹窗', targetUrl: `${site}/dialogs` });
    const auth = { instanceId, workflowId: created.workflow.id, key: created.key };
    const node = dialogNode('#prompt-button', 'prompt', 'accept');
    if (node.kind === 'dialog') { node.promptText = '{{memo}}'; node.message = '请输入备注'; }
    const edited = await call('edit_page_workflow', { ...auth, expectedUpdatedAt: created.workflow.updatedAt, operations: [
      { type: 'update_node', nodeId: 'start', patch: { inputs: [{ id: 'memo', name: 'memo', type: 'string', required: true }], keepCurrentPage: true, settleDelayMs: 0 } },
      { type: 'add_node', node }, { type: 'connect', edge: { id: 'edge', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: node.id } },
    ] });
    expect(edited.nodes.find((item: WorkflowNode) => item.kind === 'dialog')).toMatchObject(node);
    const debugged = await call('debug_page_node', { ...auth, nodeId: node.id, data: { memo: 'MCP备注' } });
    expect(debugged.result).toMatchObject({ ok: true, steps: [{ data: { type: 'prompt', accepted: true, promptText: 'MCP备注' }, verification: { ok: true } }] });
    await expect(target.locator('#dialog-result')).toHaveText('MCP备注'); await expect(target.locator('#trigger-count')).toHaveText('1');
    const exported = await call('export_page_workflow', auth);
    const exportedDialog = exported.workflow.nodes.find((item: WorkflowNode) => item.kind === 'dialog');
    expect(exportedDialog).toMatchObject({ ...node, target: { ...('target' in node ? node.target : {}), label: '输入备注' } });
    expect(exportedDialog.target.locator.confidence).toBe('high');
    expect(exportedDialog.target.selectorUpgrade.previous).toMatchObject('target' in node ? node.target : {});
    await panel.reload(); await more(panel, '编辑');
    await panel.locator('.canvas-node-head strong').filter({ hasText: node.name }).click();
    await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: '弹窗类型', exact: true })).toHaveValue('prompt');
    await expect(panel.getByRole('textbox', { name: '弹窗输入内容', exact: true })).toHaveValue('{{memo}}');
  } finally { await client.close(); }
});

test('native dialog node creation captures the trigger and keeps the configured choice after saving', async ({ extension: { worker, panel, target } }) => {
  await target.goto(`${site}/dialogs`); target.on('dialog', () => {});
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  await seed(worker, panel, makeWorkflow([start], '手动弹窗验收')); await more(panel, '编辑');
  await panel.getByRole('button', { name: '新增节点', exact: true }).click();
  await panel.locator('.canvas-node-palette').getByRole('button', { name: '浏览器弹窗', exact: true }).click();
  await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: '弹窗类型', exact: true })).toHaveValue('confirm');
  await panel.getByRole('combobox', { name: '应答方式', exact: true }).selectOption('dismiss');
  await panel.getByRole('button', { name: /选择触发弹窗的控件/ }).click();
  await expect(panel.getByText('Selector 已开启', { exact: true })).toBeVisible();
  await expect(target.locator('#__page_agent_select_overlay__')).toBeVisible();
  await target.locator('#confirm-button').click({ force: true });
  await expect(panel.getByRole('textbox', { name: 'Selector', exact: true })).toHaveValue('#confirm-button');
  await panel.getByRole('button', { name: '更新工作流', exact: true }).click();
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0]);
  const node = saved.nodes.find((item: WorkflowNode) => item.kind === 'dialog');
  expect(node).toMatchObject({ action: 'dismiss', target: { selector: '#confirm-button', tagName: 'button', locator: { confidence: 'high' } } });
  // A toolbar-created node is intentionally unconnected; connect it through the stored graph for replay.
  saved.edges.push({ id: 'dialog-edge', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: node.id });
  await seed(worker, panel, saved);
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect(panel.getByText('流程执行完成', { exact: true })).toBeVisible();
  await expect(target.locator('#dialog-result')).toHaveText('false'); await expect(target.locator('#trigger-count')).toHaveText('1');
});

test('property handler preserves a usable canvas at narrow and wide widths and dragging collapses details', async ({ extension: { worker, panel } }, testInfo) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.settleDelayMs = 0;
  for (const [width, height] of [[360, 600], [360, 840], [420, 840], [1000, 840]]) {
    await panel.setViewportSize({ width, height });
    // Each viewport sample starts from the saved graph, discarding only this test's previous drag draft.
    await worker.evaluate(async () => { await chrome.storage.local.set({ pageAgentEditorDraftV1: null }); });
    await seed(worker, panel, makeWorkflow([start])); await more(panel, '编辑');
    await panel.locator('.canvas-node-head strong').filter({ hasText: '开始' }).click();
    await expect(panel.locator('.node-inspector')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '展开节点属性', exact: true })).toBeVisible();
    const collapsed = await panel.locator('.canvas-surface').boundingBox();
    expect(collapsed!.height).toBeGreaterThan(Math.min(400, height - 330));
    await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
    await expect(panel.locator('.node-inspector')).toBeVisible();
    const canvas = await panel.locator('.canvas-surface').boundingBox(), details = await panel.locator('.property-dock').boundingBox();
    expect(canvas!.height).toBeGreaterThanOrEqual(160); expect(details!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
    expect(details!.width).toBeLessThanOrEqual(width);
    if (width === 360 && height === 840) await panel.locator('.canvas-layout').screenshot({ path: testInfo.outputPath('properties-expanded.png') });
    const node = await panel.locator('.canvas-node-head').first().boundingBox();
    await panel.mouse.move(node!.x + 130, node!.y + 18);
    await panel.mouse.down(); await panel.mouse.move(node!.x + 150, node!.y + 48, { steps: 8 }); await panel.mouse.up();
    await expect(panel.locator('.node-inspector')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '展开节点属性', exact: true })).toBeVisible();
    if (width === 360 && height === 840) await panel.locator('.canvas-layout').screenshot({ path: testInfo.outputPath('properties-collapsed.png') });
  }
});
test('auto arrange separates branches and containers, fits the graph and persists one-step undo redo', async ({ extension: { worker, panel } }) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.position = { x: 60, y: 70 };
  const wait = (id: string): WorkflowNode => ({ id, name: id, kind: 'wait', durationMs: 0, position: { x: 60, y: 70 } });
  const container: WorkflowNode = { id: 'loop', kind: 'loop', name: '循环容器', items: '[1]', itemVariable: 'item', indexVariable: 'index', maxIterations: 2, position: { x: 60, y: 70 }, body: { entryNodeId: 'child1', nodes: [wait('child1'), wait('child2')], edges: [{ id: 'child-edge', sourceNodeId: 'child1', sourcePort: 'success', targetNodeId: 'child2' }] } };
  const workflow = makeWorkflow([start, wait('success'), wait('failure'), wait('merge'), container], '画布布局验收');
  workflow.edges = [
    { id: 'a', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'success' }, { id: 'b', sourceNodeId: 'start', sourcePort: 'failure', targetNodeId: 'failure' },
    { id: 'c', sourceNodeId: 'success', sourcePort: 'success', targetNodeId: 'merge' }, { id: 'd', sourceNodeId: 'failure', sourcePort: 'success', targetNodeId: 'merge' },
    { id: 'e', sourceNodeId: 'merge', sourcePort: 'success', targetNodeId: 'loop' },
  ];
  await seed(worker, panel, workflow); await more(panel, '编辑');
  await panel.getByRole('button', { name: '自动整理画布', exact: true }).click();
  await expect(panel.getByText('画布已整理，可撤销恢复原布局', { exact: true })).toBeVisible();
  const draft = () => worker.evaluate(async () => (await chrome.storage.local.get('pageAgentEditorDraftV1')).pageAgentEditorDraftV1);
  await expect.poll(async () => (await draft())?.nodes.find((node: WorkflowNode) => node.id === 'success')?.position.x).not.toBe(60);
  const arranged = await draft();
  expect(arranged.edges).toEqual(workflow.edges);
  const positions = Object.fromEntries(arranged.nodes.map((node: WorkflowNode) => [node.id, node.position]));
  expect(positions.start.x).toBeLessThan(positions.success.x); expect(positions.success.x).toBeLessThan(positions.merge.x);
  expect(positions.success.y).not.toBe(positions.failure.y);
  const child = arranged.nodes.find((node: WorkflowNode) => node.kind === 'loop').body;
  expect(child.entryNodeId).toBe('child1'); expect(child.edges).toEqual(container.body?.edges);
  expect(child.nodes[0].position.x).toBeLessThan(child.nodes[1].position.x);
  const boxes = await panel.locator('.pa-canvas-node').evaluateAll(nodes => nodes.filter(node => !node.closest('.workflow-canvas')?.classList.contains('nested-canvas')).map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  expect(boxes).toHaveLength(5);
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const x = boxes[a], y = boxes[b]; expect(x.x + x.width <= y.x + 1 || y.x + y.width <= x.x + 1 || x.y + x.height <= y.y + 1 || y.y + y.height <= x.y + 1).toBe(true);
  }
  await panel.getByRole('button', { name: '撤销', exact: true }).click();
  // Undo returns to the saved graph, so the automatic draft backup is removed.
  await expect.poll(async () => await draft()).toBeNull();
  await panel.getByRole('button', { name: '重做', exact: true }).click();
  await expect.poll(async () => (await draft())?.nodes.map((node: WorkflowNode) => node.position)).toEqual(arranged.nodes.map((node: WorkflowNode) => node.position));
  await panel.getByRole('button', { name: '更新工作流', exact: true }).click();
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0]);
  expect(saved.nodes).toEqual(arranged.nodes); expect(saved.edges).toEqual(workflow.edges);
  await expect(panel.getByText('已更新 工作流：画布布局验收', { exact: true })).toBeVisible();
  await expect.poll(async () => await draft()).toBeNull();
  await panel.reload(); await more(panel, '编辑');
  await expect(panel.getByRole('button', { name: '新增节点', exact: true })).toBeVisible();
  await expect.poll(async () => panel.locator('.canvas-surface').evaluate(surface => {
    const canvas = surface.getBoundingClientRect();
    const nodes = [...surface.querySelectorAll('.pa-canvas-node')].filter(node => !node.closest('.workflow-canvas')?.classList.contains('nested-canvas'));
    return nodes.length === 5 && nodes.every(node => { const r = node.getBoundingClientRect(); return r.x >= canvas.x - 2 && r.y >= canvas.y - 2 && r.right <= canvas.right + 2 && r.bottom <= canvas.bottom + 2; });
  })).toBe(true);
});

test('auto arrange handles a cycle, an isolated node and an empty child canvas without changing links', async ({ extension: { worker, panel } }) => {
  const start = createStartNode('start'); start.keepCurrentPage = true; start.position = { x: 40, y: 50 };
  const wait = (id: string): WorkflowNode => ({ id, kind: 'wait', name: id, durationMs: 0, position: { x: 40, y: 50 } });
  const workflow = makeWorkflow([start, wait('a'), wait('b'), wait('isolated'), { id: 'empty', kind: 'loop', name: '空容器', items: '[]', itemVariable: 'item', indexVariable: 'index', maxIterations: 1, position: { x: 40, y: 50 }, body: { nodes: [], edges: [] } }]);
  workflow.edges = [{ id: 'start-a', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: 'a' }, { id: 'a-b', sourceNodeId: 'a', sourcePort: 'success', targetNodeId: 'b' }, { id: 'b-a', sourceNodeId: 'b', sourcePort: 'success', targetNodeId: 'a' }];
  await seed(worker, panel, workflow); await more(panel, '编辑');
  await panel.getByRole('button', { name: '自动整理画布', exact: true }).click();
  await expect(panel.getByText('画布已整理，可撤销恢复原布局', { exact: true })).toBeVisible();
  const arranged = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentEditorDraftV1')).pageAgentEditorDraftV1);
  expect(arranged.edges).toEqual(workflow.edges);
  const positions = arranged.nodes.map((node: WorkflowNode) => node.position);
  expect(new Set(positions.map((position: { x: number; y: number }) => `${position.x},${position.y}`)).size).toBe(5);
  for (const position of positions) expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
  const empty = arranged.nodes.find((node: WorkflowNode) => node.id === 'empty');
  expect(empty.body).toEqual({ nodes: [], edges: [] });
});

async function graphIsVisible(panel: Page, count: number) {
  return panel.locator('.canvas-surface').evaluate((surface, count) => {
    const canvas = surface.getBoundingClientRect();
    const nodes = [...surface.querySelectorAll('.pa-canvas-node')].filter(node => !node.closest('.workflow-canvas')?.classList.contains('nested-canvas'));
    return nodes.length === count && nodes.every(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= canvas.x - 2 && r.y >= canvas.y - 2 && r.right <= canvas.right + 2 && r.bottom <= canvas.bottom + 2; });
  }, count);
}
test('opens a saved offscreen graph without arranging it, including an initially hidden editor', async ({ extension: { worker, panel } }) => {
  const start = createStartNode('start'); start.position = { x: -9000, y: 7000 };
  const next: WorkflowNode = { id: 'next', name: '远处节点', kind: 'wait', durationMs: 0, position: { x: -8600, y: 7200 } };
  const workflow = makeWorkflow([start, next], '初始视野验收');
  for (const hidden of [false, true]) {
    await seed(worker, panel, workflow);
    const style = hidden ? await panel.addStyleTag({ content: '.compose-view {display:none!important}' }) : undefined;
    await more(panel, '编辑');
    if (style) {
      await expect(panel.locator('.canvas-node-head strong')).toHaveCount(2);
      // Keep it hidden across multiple animation frames, as a side panel being opened/resized can be.
      await panel.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await style.evaluate(element => element.remove());
    }
    await expect.poll(() => graphIsVisible(panel, 2)).toBe(true);
    await expect(panel.locator('.document-title span')).toHaveText('已保存');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.map((node: WorkflowNode) => node.position))).toEqual(workflow.nodes.map(node => node.position));
  }
});
test('toolbar zooms around the viewport, resets to 100 percent and fits without changing the graph', async ({ extension: { worker, panel } }) => {
  const start = createStartNode('start'); start.position = { x: 1000, y: 2000 };
  const next: WorkflowNode = { id: 'next', name: '节点二', kind: 'wait', durationMs: 0, position: { x: 1350, y: 2100 } };
  const workflow = makeWorkflow([start, next]); await seed(worker, panel, workflow); await more(panel, '编辑');
  await expect.poll(() => graphIsVisible(panel, 2)).toBe(true);
  const percent = panel.getByRole('button', { name: '重置画布缩放为100%', exact: true });
  const zoom = async () => Number((await percent.textContent())!.replace('%', ''));
  const initial = await zoom();
  await panel.getByRole('button', { name: '放大画布', exact: true }).click(); await expect.poll(zoom).toBeGreaterThan(initial);
  const increased = await zoom();
  await panel.getByRole('button', { name: '缩小画布', exact: true }).click(); await expect.poll(zoom).toBeLessThan(increased);
  await percent.click(); await expect(percent).toHaveText('100%');
  await panel.getByRole('button', { name: '适应全部节点', exact: true }).click(); await expect.poll(() => graphIsVisible(panel, 2)).toBe(true);
  await expect(panel.locator('.document-title span')).toHaveText('已保存');
  await expect(panel.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '新增节点', exact: true }).click(); await expect(panel.locator('.canvas-node-palette')).toBeVisible();
  expect(await panel.getByRole('button', { name: '新增节点', exact: true }).locator('svg path').count()).toBe(1);
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes.map((node: WorkflowNode) => node.position))).toEqual(workflow.nodes.map(node => node.position));
});

async function canvasGeometryErrors(panel: Page) {
  return panel.locator('.workflow-canvas').evaluateAll(canvases => {
    const errors: string[] = [];
    for (const canvas of canvases) {
      const frame = canvas.getBoundingClientRect();
      const nodes = [...canvas.querySelectorAll('.pa-canvas-node')].filter(node => node.closest('.workflow-canvas') === canvas);
      const label = (node: Element) => node.querySelector('.canvas-node-head strong')?.textContent ?? '入口';
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (canvas.classList.contains('nested-canvas') && (r.left < frame.left - 1 || r.top < frame.top - 1 || r.right > frame.right + 1 || r.bottom > frame.bottom + 1)) errors.push(`裁切: ${label(node)}`);
        const body = node.querySelector(':scope > .container-subcanvas');
        const header = node.querySelector(':scope > .canvas-node-content');
        if (body && header && header.getBoundingClientRect().bottom > body.getBoundingClientRect().top + 1) errors.push(`标题遮挡: ${label(node)}`);
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].getBoundingClientRect(), b = nodes[j].getBoundingClientRect();
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) errors.push(`重叠: ${label(nodes[i])}, ${label(nodes[j])}`);
      }
    }
    return errors;
  });
}

test('100 percent contains every nested node, clears expanded siblings and keeps a shared zoom', async ({ extension: { worker, panel } }, testInfo) => {
  const wait = (id: string, x: number, y: number): WorkflowNode => ({ id, name: id, kind: 'wait', durationMs: 0, position: { x, y } });
  const pagination: WorkflowNode = { id: 'pages', name: '分页子流程', kind: 'pagination', mode: 'all', page: '1', pageVariable: 'page', maxPages: 10, timeoutMs: 1000, settleMs: 0,
    target: { name: '分页', selector: '#pages', frameId: 0, tagName: 'div', label: '' }, position: { x: 500, y: 65 },
    body: { entryNodeId: 'deep-wait', nodes: [wait('deep-wait', 150, 65)], edges: [] } };
  const loop: WorkflowNode = { id: 'loop', name: '循环子流程', kind: 'loop', items: '[1]', itemVariable: 'item', indexVariable: 'index', maxIterations: 2, position: { x: 400, y: 70 },
    body: { entryNodeId: 'child-wait', nodes: [wait('child-wait', 150, 65), pagination], edges: [{ id: 'child-edge', sourceNodeId: 'child-wait', sourcePort: 'success', targetNodeId: 'pages' }] } };
  const start = createStartNode('start'); start.position = { x: 60, y: 70 };
  const workflow = makeWorkflow([start, wait('root-wait', 60, 240), loop, wait('after-container', 1130, 70)], '多层缩放验收');
  const percent = panel.getByRole('button', { name: '重置画布缩放为100%', exact: true });
  const widths = () => panel.locator('.canvas-node-head strong').evaluateAll(heads => Object.fromEntries(heads.filter(head => ['root-wait', 'child-wait', 'deep-wait'].includes(head.textContent!)).map(head => [head.textContent!, head.closest('.pa-canvas-node')!.getBoundingClientRect().width])));
  const scalesMatch = async () => {
    const sizes = await widths();
    const zoom = Number((await percent.textContent())!.replace('%', '')) / 100;
    return Object.keys(sizes).length === 3 && Object.values(sizes).every(width => Math.abs(width - 220 * zoom) < 2);
  };
  for (const reopen of [false, true]) {
    await panel.setViewportSize({ width: reopen ? 420 : 1800, height: reopen ? 840 : 1100 });
    if (!reopen) await seed(worker, panel, workflow); else await panel.reload();
    await more(panel, '编辑');
    await expect(panel.locator('.canvas-node-head strong')).toHaveCount(7);
    await expect.poll(() => graphIsVisible(panel, 4)).toBe(true);
    await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
    await percent.click(); await expect(percent).toHaveText('100%');
    await expect.poll(scalesMatch).toBe(true);
    await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
    if (!reopen) await panel.screenshot({ path: testInfo.outputPath('nested-100-percent.png') });
    // Wait beyond initial fitting frames: a pending child fit must not undo the reset.
    await panel.evaluate(() => new Promise<void>(resolve => { let frames = 12; const tick = () => --frames ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick); }));
    expect(await scalesMatch()).toBe(true);
    await panel.getByRole('button', { name: '放大画布', exact: true }).click(); await expect.poll(scalesMatch).toBe(true);
    await panel.getByRole('button', { name: '缩小画布', exact: true }).click(); await expect.poll(scalesMatch).toBe(true);
    await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
    await panel.getByRole('button', { name: '适应全部节点', exact: true }).click(); await expect.poll(() => graphIsVisible(panel, 4)).toBe(true);
    await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
    await percent.click(); await expect.poll(scalesMatch).toBe(true);
    await expect(panel.locator('.document-title span')).toHaveText('已保存');
    await expect(panel.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0])).toEqual(workflow);
  }
});


test('nested wheel and dragging use the outer scale, preserve the entry and support undo', async ({ extension: { worker, panel } }) => {
  await panel.setViewportSize({ width: 1200, height: 1000 });
  const child: WorkflowNode = { id: 'child', name: '可拖动的内部节点', kind: 'wait', durationMs: 0, position: { x: 222, y: 65 } };
  const loop: WorkflowNode = { id: 'loop', name: '拖动验收循环', kind: 'loop', items: '[1]', itemVariable: 'item', indexVariable: 'index', maxIterations: 2, position: { x: 550, y: 70 }, body: { nodes: [child], edges: [], entryNodeId: 'child' } };
  const start = createStartNode('start'); start.position = { x: 60, y: 70 };
  await seed(worker, panel, makeWorkflow([start, loop])); await more(panel, '编辑');
  const percent = panel.getByRole('button', { name: '重置画布缩放为100%', exact: true });
  await percent.click(); await expect(percent).toHaveText('100%');
  const head = panel.locator('.canvas-node-head').filter({ hasText: child.name });
  await head.click();
  const box = await head.boundingBox();
  await panel.mouse.move(box!.x + 100, box!.y + 20); await panel.mouse.wheel(0, 100);
  await expect.poll(async () => Number((await percent.textContent())!.replace('%', ''))).toBeLessThan(100);
  await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
  const zoom = Number((await percent.textContent())!.replace('%', '')) / 100;
  const before = await head.boundingBox();
  await panel.mouse.move(before!.x + 100 * zoom, before!.y + 18 * zoom);
  await panel.mouse.down(); await panel.mouse.move(before!.x + 100 * zoom + 20, before!.y + 18 * zoom + 15, { steps: 8 }); await panel.mouse.up();
  const draft = () => worker.evaluate(async () => (await chrome.storage.local.get('pageAgentEditorDraftV1')).pageAgentEditorDraftV1);
  await expect.poll(async () => (await draft())?.nodes.find((node: WorkflowNode) => node.id === 'loop')?.body.nodes[0].position.x).not.toBe(child.position!.x);
  const moved = (await draft()).nodes.find((node: WorkflowNode) => node.id === 'loop').body;
  expect(moved.entryNodeId).toBe('child'); expect(moved.edges).toEqual([]);
  expect(Math.abs(moved.nodes[0].position.x - child.position!.x - 20 / zoom)).toBeLessThan(4);
  expect(Math.abs(moved.nodes[0].position.y - child.position!.y - 15 / zoom)).toBeLessThan(4);
  await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
  for (let i = 0; i < 12 && await panel.getByRole('button', { name: '撤销', exact: true }).isEnabled(); i++) await panel.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(draft).toBeNull(); await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
});

test('legacy pagination and loop workflow stays contained at 100 percent and after arranging', async ({ extension: { worker, panel } }) => {
  const fixture = JSON.parse(await readFile(resolve('e2e/fixtures/legacy-nested-workflow.page-agent.json'), 'utf8')).workflow as ScriptDefinition;
  await panel.setViewportSize({ width: 926, height: 900 });
  await seed(worker, panel, { ...fixture, id, name: '已有嵌套工作流显示验收' }); await more(panel, '编辑');
  await expect(panel.locator('.canvas-with-body')).not.toHaveCount(0);
  await panel.getByRole('button', { name: '重置画布缩放为100%', exact: true }).click();
  await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
  await expect(panel.locator('.document-title span')).toHaveText('已保存');
  expect(await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0].nodes)).toEqual(fixture.nodes);
  await panel.getByRole('button', { name: '自动整理画布', exact: true }).click();
  await expect(panel.getByText('画布已整理，可撤销恢复原布局', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '重置画布缩放为100%', exact: true }).click();
  await expect.poll(() => canvasGeometryErrors(panel)).toEqual([]);
});


for (const platform of ['Win32', 'MacIntel']) test(`undo and redo shortcuts, tooltips and text editing on ${platform}`, async ({ extension: { worker, panel } }) => {
  await panel.addInitScript(platform => Object.defineProperty(navigator, 'platform', { value: platform, configurable: true }), platform);
  await seed(worker, panel, makeWorkflow([createStartNode('start')])); await more(panel, '编辑');
  const modifier = platform === 'MacIntel' ? 'Meta' : 'Control', label = platform === 'MacIntel' ? 'Command' : 'Ctrl';
  const undo = panel.getByRole('button', { name: '撤销', exact: true }), redo = panel.getByRole('button', { name: '重做', exact: true });
  await expect(undo).toHaveAttribute('title', `撤销（${label}+Z）`); await expect(redo).toHaveAttribute('title', `重做（${label}+Shift+Z）`);
  await panel.getByRole('button', { name: '新增节点', exact: true }).click(); await panel.locator('.canvas-node-palette').getByRole('button', { name: '等待', exact: true }).click();
  await expect(panel.locator('.canvas-node-head strong')).toHaveCount(2);
  await panel.keyboard.press(`${modifier}+z`); await expect(panel.locator('.canvas-node-head strong')).toHaveCount(1);
  await panel.keyboard.press(`${modifier}+Shift+z`); await expect(panel.locator('.canvas-node-head strong')).toHaveCount(2);
  await panel.locator('.canvas-node-head strong').filter({ hasText: '等待' }).click();
  await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
  const input = panel.locator('.node-inspector input').first(); await input.focus(); await panel.keyboard.press('End'); await panel.keyboard.type('文本');
  await panel.keyboard.press(`${modifier}+z`);
  await expect(panel.locator('.canvas-node-head strong')).toHaveCount(2); await expect(input).toBeFocused();
});

const httpNode = (url: string, responseType: 'json' | 'text' = 'json'): Extract<WorkflowNode, {kind: 'request'}> => ({ id: 'request', kind: 'request', name: '请求', url, method: 'GET', headers: '{}', body: '', responseType, timeoutMs: 3000 });
const httpStart = () => { const node = createStartNode('start'); node.keepCurrentPage = true; node.settleDelayMs = 0; return node; };

test('request nodes return typed JSON and text across origins and pass variables downstream', async ({ extension: { worker, panel } }) => {
  const start = httpStart(); start.inputs = [{ id: 'payload', name: 'payload', type: 'object', required: true }, { id: 'tag', name: 'tag', type: 'string', required: true }];
  const request = { ...httpNode('http://localhost:4179/request-api/json?value={{payload.name}}'), method: 'POST' as const, headers: '{"Content-Type":"application/json","X-Test":"{{tag}}"}', body: '{{payload}}' };
  const output: WorkflowNode = { id: 'out', name: '输出', kind: 'output', source: 'variable', value: '{{请求.output}}', outcome: 'neutral' };
  await seed(worker, panel, makeWorkflow([start, request, output]));
  const result = await panel.evaluate(async id => (await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: id, variables: { tag: 'header-value', payload: { id: 7, name: '中文' } } })).result, id);
  expect(result).toMatchObject({ ok: true, output: { message: '请求成功', method: 'POST', header: 'header-value', body: '{"id":7,"name":"中文"}', query: { value: '中文' } } });
  await seed(worker, panel, makeWorkflow([httpStart(), httpNode(`${site}/request-api/text`, 'text'), output]));
  const text = await panel.evaluate(async id => (await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: id })).result, id);
  expect(text).toMatchObject({ ok: true, output: '文本返回 ✓' });
});

test('request HTTP, JSON and timeout failures take failure edges with no automatic replay', async ({ extension: { worker, panel } }) => {
  for (const [path, error] of [['status', 'HTTP 503'], ['bad-json', 'JSON'], ['slow', '请求超时']]) {
    const run = crypto.randomUUID(); const request = { ...httpNode(`${site}/request-api/${path}?run=${run}`), timeoutMs: path === 'slow' ? 200 : 3000 };
    const failure: WorkflowNode = { id: 'failure', kind: 'output', name: '失败输出', source: 'text', value: '请求失败', outcome: 'failure' };
    const workflow = makeWorkflow([httpStart(), request, failure]); workflow.edges[1].sourcePort = 'failure';
    await seed(worker, panel, workflow);
    const result = await panel.evaluate(async id => (await chrome.runtime.sendMessage({ type: 'PAGE_AGENT_RUN_SCRIPT', scriptId: id })).result, id);
    expect(result).toMatchObject({ ok: true, output: '请求失败', businessOk: false });
    expect(result.steps.find((step: {nodeId:string}) => step.nodeId === 'request')).toMatchObject({ ok: false, outputPort: 'failure', message: expect.stringContaining(error) });
    expect(await (await fetch(`${site}/request-api/stats?run=${run}`)).json()).toMatchObject({ calls: 1 });
  }
});

test('stopping an active HTTP request aborts it and does not execute its successor', async ({ extension: { worker, panel } }) => {
  const run = crypto.randomUUID(); const output: WorkflowNode = { id: 'out', name: '禁止执行', kind: 'output', source: 'text', value: 'should-not-run', outcome: 'success' };
  await seed(worker, panel, makeWorkflow([httpStart(), httpNode(`${site}/request-api/slow?run=${run}`), output]));
  await panel.getByRole('button', { name: '运行', exact: true }).click();
  await expect.poll(async () => (await (await fetch(`${site}/request-api/stats?run=${run}`)).json()).calls).toBe(1);
  await panel.getByRole('button', { name: '停止运行', exact: true }).click();
  await expect(panel.getByText('流程已停止', { exact: true })).toBeVisible();
  await expect.poll(async () => (await (await fetch(`${site}/request-api/stats?run=${run}`)).json()).aborted).toBe(1);
  const record = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentRunHistoryV1')).pageAgentRunHistoryV1);
  expect(record[0]).toMatchObject({ status: 'cancelled' });
  expect(record[0].steps.some((step: {nodeId: string}) => step.nodeId === 'out')).toBe(false);
});

test('creates and reopens a request node with Chinese titles and English subtitles', async ({ extension: { worker, panel } }, testInfo) => {
  await seed(worker, panel, makeWorkflow([httpStart()], '请求节点界面验收')); await more(panel, '编辑');
  await panel.getByRole('button', { name: '新增节点', exact: true }).click();
  const palette = panel.locator('.canvas-node-palette');
  for (const button of await palette.locator('.node-picker-grid button').all()) {
    expect(await button.locator('strong').textContent()).toMatch(/^[\p{Script=Han}]/u);
    expect(await button.locator('small[lang="en"]').textContent()).toMatch(/[A-Za-z]/);
  }
  await palette.screenshot({ path: testInfo.outputPath('bilingual-palette.png') });
  await palette.getByRole('button', { name: '请求', exact: true }).click(); await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
  await expect(panel.locator('.inspector-head strong')).toHaveText('请求'); await expect(panel.locator('.inspector-head [lang="en"]')).toHaveText('HTTP Request');
  await panel.getByRole('textbox', { name: '请求链接', exact: true }).fill(`${site}/request-api/text`);
  await panel.getByRole('combobox', { name: '请求方法', exact: true }).selectOption('POST');
  await panel.getByRole('textbox', { name: '请求体', exact: true }).fill('{"name":"中文"}');
  await panel.getByRole('textbox', { name: '请求头（JSON 对象）', exact: true }).fill('{"Content-Type":"application/json"}');
  await panel.getByRole('combobox', { name: '请求方法', exact: true }).selectOption('GET');
  await expect(panel.getByRole('textbox', { name: '请求体', exact: true })).toHaveCount(0);
  await panel.getByRole('combobox', { name: '返回类型', exact: true }).selectOption('text');
  await panel.getByRole('button', { name: '更新工作流', exact: true }).click(); await expect(panel.locator('.document-title span')).toHaveText('已保存');
  const saved = await worker.evaluate(async () => (await chrome.storage.local.get('pageAgentLibraryV2')).pageAgentLibraryV2.scripts[0]);
  expect(saved.nodes.find((node: WorkflowNode) => node.kind === 'request')).toMatchObject({ url: `${site}/request-api/text`, responseType: 'text', body: '', headers: '{"Content-Type":"application/json"}' });
  await panel.reload(); await more(panel, '编辑');
  const head = panel.locator('.canvas-node-head strong').filter({ hasText: '请求' }); await head.click(); await panel.getByRole('button', { name: '展开节点属性', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: '请求链接', exact: true })).toHaveValue(`${site}/request-api/text`);
  await expect(panel.getByRole('combobox', { name: '返回类型', exact: true })).toHaveValue('text');
});

test('MCP discovers, creates, debugs and exports request nodes', async ({ extension: { panel } }) => {
  const { Client } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js');
  const { StdioClientTransport } = await import('../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js');
  const client = new Client({ name: 'request-e2e', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('mcp-server/dist/index.js')], env: { ...process.env as Record<string, string>, PAGE_AGENT_BRIDGE_PORT: '4178' }, stderr: 'pipe' }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }); const blocks = result.content as Array<{type:string;text?:string}>;
    expect(result.isError, blocks.find(block => block.text)?.text).not.toBe(true); return JSON.parse(blocks.find(block => block.type === 'text')!.text!);
  };
  try {
    const toolkit = await call('get_page_workflow_toolkit', {}); expect(toolkit.templates.request).toMatchObject({ kind: 'request', responseType: 'json' });
    const instanceId = (await call('list_page_agent_instances', {}))[0].instanceId;
    const created = await call('create_page_workflow', { instanceId, name: 'MCP请求节点', targetUrl: `${site}/app` }); const auth = { instanceId, workflowId: created.workflow.id, key: created.key };
    const node = { ...toolkit.templates.request, url: `${site}/request-api/text`, responseType: 'text' };
    const edited = await call('edit_page_workflow', { ...auth, expectedUpdatedAt: created.workflow.updatedAt, operations: [{ type: 'add_node', node }, { type: 'connect', edge: { id: 'request-edge', sourceNodeId: 'start', sourcePort: 'success', targetNodeId: node.id } }] });
    expect(edited.nodes).toContainEqual(expect.objectContaining(node));
    const debug = await call('debug_page_node', { ...auth, nodeId: node.id, data: {} }); expect(debug.result).toMatchObject({ ok: true, steps: [expect.objectContaining({ data: '文本返回 ✓' })] });
    const exported = await call('export_page_workflow', auth); expect(exported.workflow.nodes).toContainEqual(expect.objectContaining(node));
    await panel.reload(); await more(panel, '编辑'); await expect(panel.locator('.canvas-node-body [lang="en"]').filter({ hasText: 'HTTP Request' })).toHaveCount(1);
  } finally { await client.close(); }
});
