import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../../docs'));
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 4180);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口需为 1–65535 的整数');
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Read-only documentation server'); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
    const file = await realpath(resolve(root, pathname === '/' ? 'user-manual.html' : '.' + pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(403); response.end('Forbidden'); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Page Agent 使用手册：http://127.0.0.1:${port}/\n练习页：http://127.0.0.1:${port}/examples/practice.html\n仅提供只读静态文件；Ctrl+C 停止。`));
