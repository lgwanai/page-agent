import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Documentation-only build. No plugin code, credentials, runtime data or network requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const markedModule = process.env.PAGE_AGENT_MARKED_MODULE || require.resolve('marked');
const { Marked } = await import(pathToFileURL(markedModule).href);
const out = path.join(root, 'deliverables');
const docs = [
  { id: 'overview', file: 'docs/enterprise/README.md', title: '交付总览', eyebrow: 'DOCUMENT OVERVIEW', note: '产品定位、文档基线与企业评估要点', group: '核心文档' },
  { id: 'architecture', file: 'docs/enterprise/architecture.md', title: '技术架构与设计', eyebrow: 'SYSTEM ARCHITECTURE', note: '部署边界、组件职责与工作流执行机制', group: '核心文档' },
  { id: 'api', file: 'docs/enterprise/api-reference.md', title: 'MCP 接口说明', eyebrow: 'INTERFACE REFERENCE', note: '21 个工具、参数约定、返回值与错误处理', group: '核心文档' },
  { id: 'security', file: 'docs/enterprise/data-security.md', title: '数据安全与风险', eyebrow: 'DATA SECURITY', note: '数据生命周期、外发链路、访问控制与上线要求', group: '核心文档' },
  { id: 'operations', file: 'docs/enterprise/deployment-operations.md', title: '部署与运维', eyebrow: 'DEPLOYMENT & OPERATIONS', note: '安装、升级、备份、故障排查与验收清单', group: '核心文档' },
  { id: 'workflow', file: 'docs/workflow-spec.md', title: '工作流 JSON 规范', eyebrow: 'APPENDIX A', note: '工作流交换格式与 Query 节点约定', group: '技术附录' },
  { id: 'calendar', file: 'docs/calendar-node.md', title: '日历节点说明', eyebrow: 'APPENDIX B', note: '配置、规则识别、翻页与操作自校验', group: '技术附录' },
  { id: 'agent', file: 'docs/mcp-authoring.md', title: 'Agent 编排指南', eyebrow: 'APPENDIX C', note: '创建画布、页面读取、节点调试与截图示例', group: '技术附录' },
  { id: 'schema', file: 'docs/workflow.schema.json', title: '机器可读 Schema', eyebrow: 'APPENDIX D', note: 'JSON Schema 原文；可复制或下载', group: '技术附录' },
];
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byPath = new Map(docs.map((d) => [path.join(root, d.file), d]));
const css = await fs.readFile(path.join(root, 'scripts/customer-docs/styles.css'), 'utf8');
const js = await fs.readFile(path.join(root, 'scripts/customer-docs/app.js'), 'utf8');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp-server/package.json'), 'utf8'));
let articleCount = 0;
const sourceCounts = [];
for (const doc of docs) {
  const headings = [];
  let headingIndex = 0;
  const parser = new Marked({ gfm: true, breaks: false });
  const renderer = {
    heading({ tokens, depth }) {
      const label = this.parser.parseInline(tokens);
      if (depth === 1) return '';
      const id = `${doc.id}-h${++headingIndex}`;
      if (depth === 2) headings.push({ id, label: label.replace(/<[^>]+>/g, '') });
      return `<h${depth} id="${id}">${label}<a class="heading-anchor" href="#${id}" aria-label="链接到本节">#</a></h${depth}>`;
    },
    link({ href, tokens, title }) {
      const label = this.parser.parseInline(tokens);
      if (/^https?:\/\//.test(href)) return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}<span class="external-mark" aria-hidden="true">↗</span></a>`;
      if (href.startsWith('#')) return `<a href="${escape(href)}">${label}</a>`;
      const resolved = path.resolve(path.dirname(path.join(root, doc.file)), href.split('#')[0]);
      const destination = byPath.get(resolved);
      if (destination) return `<a href="#${destination.id}">${label}</a>`;
      if (resolved.endsWith('.svg')) {
        const encoded = doc.svgAssets?.get(resolved);
        if (encoded) return `<a href="${encoded}" download="${path.basename(resolved)}">${label}</a>`;
      }
      // Source paths are references, not broken links to files absent from delivery.
      if (resolved.startsWith(root + path.sep)) return `<span class="source-ref" title="源码参考：${escape(path.relative(root, resolved))}">${label}</span>`;
      return `<span>${label}</span>`;
    },
    image({ href, text }) {
      const resolved = path.resolve(path.dirname(path.join(root, doc.file)), href);
      const encoded = doc.svgAssets?.get(resolved);
      if (!encoded) throw new Error(`Unknown diagram: ${href}`);
      return `<figure class="architecture-figure"><button type="button" class="figure-open" aria-label="放大${escape(text)}"><img src="${encoded}" alt="${escape(text)}"/><span class="figure-zoom">放大查看 ↗</span></button><figcaption>${escape(text)} · 可放大浏览 / 下载矢量原图</figcaption></figure>`;
    },
    code({ text, lang }) {
      const code = escape(text);
      return `<div class="code-block"><div class="code-toolbar"><span>${escape(lang || 'TEXT').toUpperCase()}</span><button type="button" class="copy-code" aria-label="复制代码">复制</button></div><pre><code class="language-${escape(lang || 'text')}">${code}</code></pre></div>`;
    },
    table(token) {
      const cell = (row, header) => row.map((item, i) => `<${header ? 'th scope="col"' : 'td'}${token.align[i] ? ` style="text-align:${token.align[i]}"` : ''}>${this.parser.parseInline(item.tokens)}</${header ? 'th' : 'td'}>`).join('');
      return `<div class="table-wrap" role="region" aria-label="数据表格" tabindex="0"><table><thead><tr>${cell(token.header, true)}</tr></thead><tbody>${token.rows.map((row) => `<tr>${cell(row, false)}</tr>`).join('')}</tbody></table></div>`;
    },
  };
  doc.svgAssets = new Map();
  for (const asset of ['system-architecture.svg', 'component-modules.svg']) {
    const absolute = path.join(root, 'docs/enterprise/diagrams', asset);
    const data = await fs.readFile(absolute);
    doc.svgAssets.set(absolute, `data:image/svg+xml;base64,${data.toString('base64')}`);
  }
  parser.use({ renderer });
  let source = await fs.readFile(path.join(root, doc.file), 'utf8');
  sourceCounts.push({ file: doc.file, chars: source.length });
  if (doc.id === 'overview') source = source.replace('当前工作区包含尚未提交的功能改动；部署时应另外记录实际交付的 Git 提交、构建产物摘要和依赖锁文件。', '部署时应记录实际交付的 Git 提交、构建产物摘要和依赖锁文件，并确认与本手册基线一致。');
  if (doc.id === 'schema') source = `## JSON Schema\n\n以下为交付基线的机器可读约束原文。\n\n\`\`\`json\n${JSON.stringify(JSON.parse(source), null, 2)}\n\`\`\``;
  const content = parser.parse(source);
  articleCount += headings.length;
  const sectionClass = doc.id === 'security' ? 'document security-document' : 'document';
  doc.html = `<section class="${sectionClass}" id="${doc.id}" aria-labelledby="${doc.id}-title"><header class="document-header"><span class="eyebrow">${doc.eyebrow}</span><h1 id="${doc.id}-title">${doc.title}</h1><p>${doc.note}</p></header><div class="document-grid"><article class="prose">${content}</article><aside class="section-toc" aria-label="${doc.title}本章目录"><strong>本章目录</strong>${headings.map((h) => `<a href="#${h.id}">${h.label}</a>`).join('')}</aside></div></section>`;
}
const nav = ['核心文档', '技术附录'].map((group) => `<div class="nav-group"><div class="nav-group-label">${group}</div>${docs.filter((d) => d.group === group).map((d, i) => `<a href="#${d.id}" class="nav-link"><span class="nav-number">${String(i + (group === '核心文档' ? 1 : 6)).padStart(2, '0')}</span><span>${d.title}</span></a>`).join('')}</div>`).join('');
const schema = await fs.readFile(path.join(root, 'docs/workflow.schema.json'));
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"/>
<meta name="description" content="Page Agent 企业技术架构、MCP 接口、数据安全与部署运维手册。离线交付版。"/>
<title>Page Agent｜企业技术与数据安全手册</title><style>${css}</style></head><body>
<a class="skip-link" href="#main">跳转到文档内容</a>
<aside class="sidebar" id="navigation"><a class="brand" href="#cover"><span class="brand-symbol">P</span><span>Page Agent<small>ENTERPRISE DOCUMENTATION</small></span></a><div class="sidebar-rule"></div><nav aria-label="文档章节">${nav}</nav><div class="sidebar-footer"><span class="offline-dot"></span>离线交付版 · 无外部资源依赖<br/><small>基线核对日期 2026.10.10</small></div></aside>
<div class="page-shell"><header class="topbar"><button type="button" id="menu-toggle" aria-expanded="false" aria-controls="navigation">☰ 目录</button><span class="breadcrumb">企业技术文档 <span>/</span> 客户交付手册</span><div class="top-actions"><button type="button" id="print">打印 / 保存 PDF</button><a class="schema-download" href="data:application/json;base64,${schema.toString('base64')}" download="workflow.schema.json">下载 Schema ↗</a></div></header>
<main id="main"><section class="cover" id="cover" aria-labelledby="cover-title"><span class="cover-label">TECHNICAL & SECURITY HANDBOOK</span><h1 id="cover-title">让企业网页操作<br/>成为可复用的工作流</h1><p class="cover-description">Page Agent 企业技术与数据安全手册</p><p class="cover-intro">面向架构、信息安全、系统集成与运维团队，完整说明部署结构、执行机制、接口契约，以及数据处理与授权边界。</p><div class="cover-meta"><div><span>插件版本</span><strong>${escape(metadata.version)}</strong></div><div><span>MCP SERVER</span><strong>${escape(mcp.version)}</strong></div><div><span>文档基线</span><strong>2026.10.10</strong></div><div><span>交付形式</span><strong>离线 HTML</strong></div></div><div class="cover-links"><a href="#architecture">阅读技术架构 <span>→</span></a><a href="#security">查看数据安全 <span>→</span></a><a href="#api">查询 MCP 接口 <span>→</span></a></div><div class="scope-note"><span>评估范围</span><p>本文说明当前实现，不是安全认证、渗透测试报告或服务等级承诺。敏感生产部署须结合安全缺口、企业控制措施与实际验收结果评估。</p></div></section>
${docs.map((d) => d.html).join('\n')}
<footer class="document-footer"><strong>Page Agent</strong><span>企业技术与数据安全手册 · 2026.10.10 · 离线交付版</span><a href="#cover">返回封面 ↑</a></footer></main></div>
<dialog id="figure-dialog" aria-label="架构图大图"><div class="dialog-toolbar"><strong id="figure-caption">架构图</strong><span><a id="figure-download" download="architecture.svg">下载 SVG</a><button type="button" id="figure-close">关闭 ×</button></span></div><div class="diagram-scroll"><img id="figure-image" alt=""/></div></dialog><div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${js}</script></body></html>`;
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'page-agent-enterprise-handbook.html'), html);
await fs.writeFile(path.join(out, 'page-agent-docs-build.json'), JSON.stringify({ pluginVersion: metadata.version, mcpVersion: mcp.version, baseline: '2026-10-10', documents: docs.length, sectionHeadings: articleCount, bytes: Buffer.byteLength(html), sources: sourceCounts }, null, 2));
console.log(JSON.stringify({ output: path.join(out, 'page-agent-enterprise-handbook.html'), documents: docs.length, sectionHeadings: articleCount, bytes: Buffer.byteLength(html) }, null, 2));
