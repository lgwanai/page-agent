import Busboy from 'busboy';
import { createHash } from 'node:crypto';
import { ExtensionBridge } from '../../mcp-server/dist/bridge.js';
const bridge = new ExtensionBridge(4178);
await bridge.ready;
import { createServer } from 'node:http';
const style = '<style>body{font:16px system-ui;padding:30px}label,button{display:block;margin:14px 0}input{padding:8px}iframe{width:600px;height:220px}</style>';
const apiCounts = new Map();
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4179');
  if (url.pathname.startsWith('/request-api/')) {
    const key = url.searchParams.get('run') || 'default';
    const stats = apiCounts.get(key) || { calls: 0, aborted: 0 }; apiCounts.set(key, stats);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (url.pathname === '/request-api/stats') return response.end(JSON.stringify(stats));
    stats.calls++;
    if (url.pathname === '/request-api/slow') {
      response.on('close', () => { if (!response.writableEnded) stats.aborted++; });
      const timer = setTimeout(() => { if (!response.destroyed) response.end('{"late":true}'); }, 2000);
      response.on('close', () => clearTimeout(timer)); return;
    }
    if (url.pathname === '/request-api/text') { response.setHeader('Content-Type', 'text/plain; charset=utf-8'); return response.end('文本返回 ✓'); }
    if (url.pathname === '/request-api/bad-json') return response.end('this is not json');
    if (url.pathname === '/request-api/status') { response.statusCode = 503; return response.end('{"error":"unavailable"}'); }
    let body = ''; for await (const chunk of request) body += chunk;
    return response.end(JSON.stringify({ message: '请求成功', method: request.method, header: request.headers['x-test'], body, query: Object.fromEntries(url.searchParams) }));
  }
  if (request.method === 'POST' && request.url === '/upload') {
    const files = [];
    const parser = Busboy({ headers: request.headers, defParamCharset: 'utf8' });
    parser.on('file', (_name, stream, info) => {
      const result = { name: info.filename, size: 0, sha256: '', mimeType: info.mimeType }; files.push(result);
      const hash = createHash('sha256');
      stream.on('data', chunk => { result.size += chunk.length; hash.update(chunk); });
      stream.on('end', () => { result.sha256 = hash.digest('hex'); });
    });
    parser.on('error', () => { response.statusCode = 400; response.end('invalid multipart'); });
    parser.on('close', () => { if (!response.writableEnded) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ files, totalBytes: files.reduce((total, file) => total + file.size, 0) })); } });
    request.pipe(parser); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const uploadUI = `<label for="upload-file" id="upload-label">上传文件</label><div id="upload-wrapper"><input hidden type="file" id="upload-file" name="files" accept=".txt,.pdf,.bin" multiple></div><input id="single-file" type="file" accept=".txt"><output id="upload-receipt"></output><script>for (const input of document.querySelectorAll('input[type=file]')) input.onchange=async()=>{const data=new FormData();for(const file of input.files)data.append('files',file);const response=await fetch('/upload',{method:'POST',body:data});document.querySelector('#upload-receipt').textContent=JSON.stringify(await response.json());};</script>`;
  if (request.url === '/dialogs') return response.end(`${style}<title>原生弹窗验收</title><button id="confirm-button">确认操作</button><button id="prompt-button">输入备注</button><button id="alert-button">提示</button><button id="delayed-button">延迟弹窗</button><button id="none-button">没有弹窗</button><button id="arm-unload">开启离开确认</button><a id="leave" href="/after-dialog">离开</a><output id="dialog-result"></output><output id="trigger-count">0</output><script>
    function count(){const el=document.querySelector('#trigger-count');el.textContent=String(Number(el.textContent)+1);}
    document.querySelector('#confirm-button').onclick=()=>{count();document.querySelector('#dialog-result').textContent=String(confirm('确认操作？'));};
    document.querySelector('#prompt-button').onclick=()=>{count();const value=prompt('请输入备注','默认备注');document.querySelector('#dialog-result').textContent=value===null?'[cancelled]':value;};
    document.querySelector('#alert-button').onclick=()=>{count();alert('操作完成');document.querySelector('#dialog-result').textContent='alert-closed';};
    document.querySelector('#none-button').onclick=()=>count();
    document.querySelector('#delayed-button').onclick=()=>{count();setTimeout(()=>{document.querySelector('#dialog-result').textContent=String(confirm('延迟确认'));},150);};
    document.querySelector('#arm-unload').onclick=()=>{window.onbeforeunload=e=>{e.preventDefault();e.returnValue='';};};
    </script>`);
  if (request.url === '/upload-frame') return response.end(style + uploadUI);
  if (new URL(request.url, 'http://localhost').pathname === '/selector-frame') return response.end(style + '<section id="toolbar"><button>提交</button><button>取消</button></section><button>提交</button><output id="click-count">0</output><script>document.querySelector("#toolbar button").onclick=()=>document.querySelector("#click-count").textContent=String(Number(document.querySelector("#click-count").textContent)+1)</script>');
  if (request.url === '/frame') return response.end(`${style}<label>嵌套输入<input id="frame-input"></label><output id="frame-output"></output><script>document.querySelector('input').addEventListener('input',e=>document.querySelector('output').textContent=e.target.value)</script>`);
  response.end(`${style}<title>Page Agent 本机验收</title><h1>本机工作流验收</h1><label>客户名<input id="name"></label><button id="apply">更新结果</button><output id="result"></output><label>日期<input id="date" type="date"></label><button id="route">切换 SPA 路由</button><iframe src="/frame"></iframe>${uploadUI}<iframe id="upload-iframe" src="/upload-frame"></iframe><iframe id="cross-upload-iframe" src="http://localhost:4179/upload-frame"></iframe><script>
  document.querySelector('#apply').onclick=()=>{document.querySelector('#result').textContent=document.querySelector('#name').value;};
  document.querySelector('#route').onclick=()=>{history.pushState({},'', '/app?screen=detail');document.querySelector('h1').textContent='详情页面';};
  </script>`);
}).listen(4179, '127.0.0.1', () => console.log('Fixture ready http://127.0.0.1:4179'));
