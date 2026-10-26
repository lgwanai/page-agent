import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Marked, lexer } from 'marked';
import { ZipArchive } from 'archiver';
import { baseline, chapters, slug } from './catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docsRoot = resolve(root, 'docs');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
const mcp = JSON.parse(await readFile(resolve(root, 'mcp-server/package.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byPath = new Map(chapters.map(doc => [resolve(docsRoot, doc.file), doc]));
const sources = new Map();
const addSource = async path => {
  const bytes = await readFile(resolve(root, path));
  sources.set(path, createHash('sha256').update(bytes).digest('hex'));
  return bytes.toString('utf8');
};
const css = await addSource('scripts/docs/manual.css');
const js = await addSource('scripts/docs/manual.js');
await addSource('scripts/docs/catalog.mjs');
for (const doc of chapters) {
  doc.source = await addSource(`docs/${doc.file}`);
  doc.headings = []; doc.anchors = new Map();
  const counts = new Map();
  for (const token of lexer(doc.source)) {
    if (token.type !== 'heading') continue;
    const base = slug(token.text), count = counts.get(base) || 0; counts.set(base, count + 1);
    const key = base + (count ? `-${count}` : '');
    const id = token.depth === 1 ? doc.id : `${doc.id}--${key}`;
    doc.anchors.set(key, id); doc.headings.push({ id, key, text: token.text, depth: token.depth });
  }
}
for (const file of ['greeting.page-agent.json', 'request.page-agent.json', 'loop.page-agent.json', 'practice.html', 'sample-response.json', 'README.md']) await addSource(`docs/examples/${file}`);

for (const doc of chapters) {
  let headingIndex = 0;
  const parser = new Marked({ gfm: true, breaks: false });
  parser.use({ renderer: {
    heading({ tokens, depth }) {
      const item = doc.headings[headingIndex++];
      if (depth === 1) return '';
      return `<h${depth} id="${item.id}">${this.parser.parseInline(tokens)}<a class="heading-link" href="#${item.id}" aria-label="链接到本节">#</a></h${depth}>`;
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (/^https?:\/\//i.test(href)) return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      const [file, fragment] = href.split('#');
      const absolute = file ? resolve(dirname(resolve(docsRoot, doc.file)), decodeURIComponent(file)) : resolve(docsRoot, doc.file);
      if (absolute === resolve(docsRoot, 'user-manual.html')) return `<a href="#cover">${label}</a>`;
      const destination = byPath.get(absolute);
      if (destination) {
        const id = fragment ? destination.anchors.get(decodeURIComponent(fragment)) : destination.id;
        if (!id) throw new Error(`Missing manual anchor: ${doc.file} -> ${href}`);
        return `<a href="#${id}">${label}</a>`;
      }
      if (!absolute.startsWith(root + sep)) throw new Error(`External local link: ${href}`);
      const bytes = readFileSync(absolute), mime = extname(absolute) === '.json' ? 'application/json' : extname(absolute) === '.html' ? 'text/html' : 'text/plain';
      sources.set(relative(root, absolute), createHash('sha256').update(bytes).digest('hex'));
      return `<a class="download-link" href="data:${mime};base64,${bytes.toString('base64')}" download="${escape(absolute.split(sep).at(-1))}">${label}<span aria-hidden="true"> ↓</span></a>`;
    },
    code({ text, lang }) {
      return `<div class="code-block"><div class="code-head"><span>${escape(lang || 'text')}</span><button type="button" class="copy-code">复制代码</button></div><pre><code>${escape(text)}</code></pre></div>`;
    },
    html({ text }) { return escape(text); },
    table(token) {
      const row = (cells, header) => cells.map(cell => `<${header ? 'th scope="col"' : 'td'}>${this.parser.parseInline(cell.tokens)}</${header ? 'th' : 'td'}>`).join('');
      return `<div class="table-wrap" tabindex="0" role="region" aria-label="参考表格"><table><thead><tr>${row(token.header, true)}</tr></thead><tbody>${token.rows.map(cells => `<tr>${row(cells, false)}</tr>`).join('')}</tbody></table></div>`;
    },
  } });
  doc.html = `<section id="${doc.id}" class="document" data-document data-title="${escape(doc.title)}" aria-labelledby="${doc.id}-title"><header class="chapter-head"><span class="eyebrow">${doc.number} / ${doc.group}</span><h1 id="${doc.id}-title">${doc.title}</h1><p>${doc.description}</p></header><details class="chapter-toc"><summary>本章目录</summary><nav>${doc.headings.filter(h => h.depth === 2).map(h => `<a href="#${h.id}">${escape(h.text)}</a>`).join('')}</nav></details><article class="prose">${parser.parse(doc.source)}</article><a class="back-top" href="#cover">返回手册首页 ↑</a></section>`;
}
const groups = [...new Set(chapters.map(doc => doc.group))];
const nav = groups.map(group => `<div class="nav-group"><h2>${group}</h2>${chapters.filter(doc => doc.group === group).map(doc => `<a data-nav="${doc.id}" href="#${doc.id}"><span>${doc.number}</span>${doc.title}</a>`).join('')}</div>`).join('');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="description" content="Page Agent 使用手册：安装、录制、画布、17 类节点、参数、MCP 接入、运行调试与故障排查。支持离线搜索和打印。">
<title>Page Agent 使用手册 · ${manifest.version}</title><style>${css}</style></head><body>
<a class="skip" href="#content">跳转到正文</a>
<aside class="sidebar" id="navigation"><a class="brand" href="#cover"><span class="brand-icon">P</span><span>Page Agent<small>用户使用手册</small></span></a><div class="search"><label for="manual-search">搜索手册</label><div><input id="manual-search" type="search" placeholder="节点、上传、快捷键…" autocomplete="off"><button id="clear-search" type="button" aria-label="清除搜索" hidden>×</button></div><small id="search-status" role="status" aria-live="polite">${chapters.length} 章 · 支持离线搜索</small></div><nav aria-label="手册章节">${nav}</nav><footer>扩展 ${manifest.version} / MCP ${mcp.version}<br>核对基线 ${baseline}</footer></aside>
<div class="shell"><header class="topbar"><button id="menu-toggle" type="button" aria-expanded="false" aria-controls="navigation">☰ 目录</button><span>文档中心 <span class="separator">/</span> 使用手册</span><button id="print-manual" type="button">打印 / 保存 PDF</button></header>
<main id="content"><section class="cover" id="cover"><span class="eyebrow">PAGE AGENT / USER HANDBOOK</span><h1>从第一次录制<br>到可复用的工作流</h1><p class="lead">安装、编排、验证与集成，一份按任务组织的使用手册。</p><dl class="edition"><div><dt>扩展版本</dt><dd>${manifest.version}</dd></div><div><dt>MCP 服务</dt><dd>${mcp.version}</dd></div><div><dt>文档核对</dt><dd>${baseline}</dd></div><div><dt>内容范围</dt><dd>17 类节点 · ${chapters.length} 章</dd></div></dl><div class="start-links"><a class="primary" href="#quick-start">开始第一个流程 →</a><a href="#nodes">查找节点配置 →</a><a href="#troubleshooting">解决使用问题 →</a></div><div class="journey"><span>01 安装</span><span>02 创建</span><span>03 配置</span><span>04 验证</span><span>05 复用</span></div><p class="cover-note">可直接离线阅读、搜索和打印。业务名称与变量引用以实际工作流为准；历史版本记录与当前操作说明分开维护。</p></section><p id="empty-results" hidden>没有匹配的章节。请缩短关键词，或使用“请求”“iframe”“上传”等功能名称。</p><noscript><p>当前脚本未启用，仍可通过目录阅读全文并使用浏览器打印。</p></noscript>${chapters.map(doc => doc.html).join('\n')}<footer class="end"><strong>Page Agent</strong><span>用户使用手册 · ${baseline}</span><a href="#cover">返回首页 ↑</a></footer></main></div><div id="copy-status" class="toast" role="status" aria-live="polite" hidden></div><script>${js}</script></body></html>`;
await writeFile(resolve(docsRoot, 'user-manual.html'), html);
await mkdir(resolve(root, 'deliverables'), { recursive: true });
const metadata = { baseline, pluginVersion: manifest.version, mcpVersion: mcp.version, chapters: chapters.length, nodeTypes: 17, sources: Object.fromEntries(sources), htmlSha256: createHash('sha256').update(html).digest('hex'), bytes: Buffer.byteLength(html) };
await writeFile(resolve(docsRoot, 'manual-build.json'), JSON.stringify(metadata, null, 2) + '\n');
const zip = resolve(root, `deliverables/page-agent-user-manual-${manifest.version}.zip`);
const output = createWriteStream(zip), archive = new ZipArchive({ zlib: { level: 9 } });
const done = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
archive.pipe(output);
archive.directory(docsRoot, 'docs', entry => entry.name === 'customer-portable-guide.html' ? false : entry);
archive.file(resolve(root, 'CHANGELOG.md'), { name: 'CHANGELOG.md' });
archive.file(resolve(root, 'scripts/docs/serve.mjs'), { name: 'scripts/docs/serve.mjs' });
archive.append(`Page Agent 用户使用手册\n\n双击 docs/user-manual.html 离线阅读、搜索和打印，无需安装依赖。\n文档源与目录：docs/README.md\n扩展 ${manifest.version} / MCP ${mcp.version} / 核对 ${baseline}\n\n有 Node.js 时可运行 node scripts/docs/serve.mjs，在 http://127.0.0.1:4180 打开手册与练习页。\n可导入练习 JSON 在 docs/examples/；示例仅使用本地演示数据。\n本包为文档包，不包含扩展、Node 或 MCP 运行时。\n`, { name: '请先阅读.txt' });
await archive.finalize(); await done;
console.log(JSON.stringify({ html: resolve(docsRoot, 'user-manual.html'), archive: zip, chapters: chapters.length, bytes: metadata.bytes }, null, 2));
