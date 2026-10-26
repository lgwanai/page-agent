import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lexer, walkTokens } from 'marked';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import unzipper from 'unzipper';
import { chapters, baseline, slug } from './catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const text = path => readFile(resolve(root, path), 'utf8');
const metadata = JSON.parse(await text('docs/manual-build.json'));
const manifest = JSON.parse(await text('manifest.json'));
const mcp = JSON.parse(await text('mcp-server/package.json'));
assert.equal(metadata.baseline, baseline); assert.equal(metadata.pluginVersion, manifest.version); assert.equal(metadata.mcpVersion, mcp.version);
assert.equal(metadata.chapters, chapters.length);
for (const [path, hash] of Object.entries(metadata.sources)) assert.equal(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'), hash, `手册内容已过期，请重新构建：${path}`);

const paths = [...new Set(['README.md', 'CHANGELOG.md', ...Object.keys(metadata.sources).filter(path => path.endsWith('.md') && !path.startsWith('docs/enterprise/'))])];
let links = 0, jsonBlocks = 0;
function anchors(source) {
  const result = new Set(), counts = new Map();
  for (const token of lexer(source)) if (token.type === 'heading') { const base = slug(token.text), count = counts.get(base) || 0; counts.set(base, count + 1); result.add(base + (count ? `-${count}` : '')); }
  return result;
}
for (const path of paths) {
  const tokens = lexer(await text(path));
  const found = [];
  walkTokens(tokens, token => {
    if (['link', 'image'].includes(token.type)) found.push(token.href);
    if (/^docs\/(guide|nodes|reference|examples)\//.test(path) && token.type === 'code' && token.lang === 'json') { JSON.parse(token.text); jsonBlocks++; }
  });
  for (const href of found) {
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    const [name, fragment] = href.split('#');
    const target = name ? resolve(root, dirname(path), decodeURIComponent(name)) : resolve(root, path);
    assert((await stat(target)).isFile(), `无效链接 ${path} -> ${href}`); links++;
    if (fragment && target.endsWith('.md')) assert(anchors(await readFile(target, 'utf8')).has(decodeURIComponent(fragment)), `无效锚点 ${path} -> ${href}`);
  }
}

// Bundle only the actual pure import validator and public type labels. This
// imports no background entrypoint and never accesses a live Chrome profile.
const bundle = await build({ stdin: { contents: 'export { importWorkflow } from "./src/shared/workflow-file"; export { NODE_KIND_LABELS, NODE_KIND_ENGLISH } from "./src/types/workflow";', resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', write: false, tsconfig: resolve(root, 'tsconfig.json') });
const { importWorkflow, NODE_KIND_LABELS, NODE_KIND_ENGLISH } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const catalog = await text('docs/nodes/README.md');
for (const [kind, label] of Object.entries(NODE_KIND_LABELS)) {
  assert(catalog.includes('`' + kind + '`'), `节点目录缺少 ${kind}`);
  assert(catalog.includes(label) && catalog.includes(NODE_KIND_ENGLISH[kind]), `节点双语名称缺失：${kind}`);
}
const index = await text('mcp-server/src/index.ts'), guide = await text('docs/guide/mcp.md');
const tools = [...index.matchAll(/server\.registerTool\('([^']+)'/g), ...index.matchAll(/\{ name: '([^']+)', method:/g)].map(match => match[1]);
for (const name of tools) assert(guide.includes('`' + name + '`'), `MCP 使用指南缺少 ${name}`);

const examples = (await readdir(resolve(root, 'docs/examples'))).filter(file => file.endsWith('.page-agent.json'));
const practice = new JSDOM(await text('docs/examples/practice.html'));
for (const file of examples) {
  const raw = JSON.parse(await text(`docs/examples/${file}`));
  const imported = importWorkflow(raw, []);
  assert.equal(imported.idChanged, false, `${file} 的示例 UUID 无效`);
  assert.deepEqual(imported.workflow.nodes, raw.workflow.nodes, `${file} 导入时发生非预期迁移`);
  assert.equal(raw.workflow.nodes.filter(node => node.kind === 'start').length, 1);
  const ids = new Set(), names = new Set();
  function scope(nodes, edges) {
    const local = new Set(nodes.map(node => node.id));
    for (const node of nodes) {
      assert(!ids.has(node.id) && !names.has(node.name), `${file} ID/名称重复`); ids.add(node.id); names.add(node.name);
      if (node.target) { assert(practice.window.document.querySelector(node.target.selector), `${file} Selector 不存在`); assert(new URL(node.target.frameUrl).hostname === '127.0.0.1'); }
      if (node.kind === 'start') assert.equal(new URL(node.targetUrl).origin, 'http://127.0.0.1:4180');
      if (node.kind === 'request') assert.equal(new URL(node.url).origin, 'http://127.0.0.1:4180');
      if (node.kind === 'loop') { assert(local.has(node.id)); scope(node.body.nodes, node.body.edges); }
    }
    for (const edge of edges) { assert(local.has(edge.sourceNodeId) && local.has(edge.targetNodeId)); const source = nodes.find(node => node.id === edge.sourceNodeId); assert((source.kind === 'loop' ? ['done', 'failure'] : ['success', 'failure']).includes(edge.sourcePort)); }
  }
  scope(raw.workflow.nodes, raw.workflow.edges);
}
practice.window.close();
const html = await text('docs/user-manual.html');
assert.equal(createHash('sha256').update(html).digest('hex'), metadata.htmlSha256);
let copied = '', printCount = 0;
const document = new JSDOM(html, { url: 'file:///page-agent/user-manual.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(window) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.print = () => { printCount++; };
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
} }), ids = new Set();
for (const element of document.window.document.querySelectorAll('[id]')) { assert(!ids.has(element.id), `重复 HTML id：${element.id}`); ids.add(element.id); }
for (const link of document.window.document.querySelectorAll('a[href^="#"]')) assert(ids.has(decodeURIComponent(link.hash.slice(1))), `HTML 链接目标不存在：${link.hash}`);
assert.equal(document.window.document.querySelectorAll('[data-document]').length, chapters.length);
assert.equal(document.window.document.querySelectorAll('script[src],link[rel="stylesheet"]').length, 0);
for (const id of ['manual-search', 'clear-search', 'menu-toggle', 'print-manual', 'empty-results']) assert(ids.has(id));
const dom = document.window.document, input = dom.getElementById('manual-search');
input.value = '上传'; input.dispatchEvent(new document.window.Event('input', { bubbles: true }));
assert(dom.getElementById('cover').hidden);
assert([...dom.querySelectorAll('[data-document]')].filter(section => !section.hidden).every(section => section.textContent.includes('上传')));
input.value = 'no-document-matches-123456'; input.dispatchEvent(new document.window.Event('input', { bubbles: true }));
assert(!dom.getElementById('empty-results').hidden);
dom.getElementById('clear-search').click(); assert.equal(dom.querySelectorAll('[data-document][hidden]').length, 0);
dom.getElementById('menu-toggle').click(); assert(dom.body.classList.contains('menu-open'));
dom.dispatchEvent(new document.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(!dom.body.classList.contains('menu-open'));
dom.querySelector('.copy-code').click(); await new Promise(resolve => setTimeout(resolve, 0)); assert(copied.length > 0);
dom.getElementById('print-manual').click(); assert.equal(printCount, 1);
document.window.location.hash = '#request'; document.window.dispatchEvent(new document.window.HashChangeEvent('hashchange')); assert.equal(dom.querySelector('[data-nav="request"]').getAttribute('aria-current'), 'location');
document.window.close();
const archive = await unzipper.Open.file(resolve(root, `deliverables/page-agent-user-manual-${manifest.version}.zip`));
assert(archive.files.some(file => file.path === 'docs/user-manual.html'));
assert(archive.files.some(file => file.path === 'scripts/docs/serve.mjs'));
console.log(JSON.stringify({ result: 'passed', markdownFiles: paths.length, localLinks: links, jsonExamplesInText: jsonBlocks, chapters: chapters.length, nodeTypes: Object.keys(NODE_KIND_LABELS).length, mcpTools: tools.length, importableExamples: examples.length, interactiveChecks: 8, htmlBytes: metadata.bytes, baseline }, null, 2));
