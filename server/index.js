// 服务入口：原生 http 服务（仅绑定 127.0.0.1），静态文件 + JSON API + SSE
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const dbm = require('./db');
const bus = require('./sse');
const { mask } = require('./git');
const { DATA_DIR } = require('./crypto');
const { openUrl } = require('./open');
const sseHandler = require('./sse').handler;

const ctx = {
  dbm,
  bus,
  DATA_DIR,
  DB_FILE: dbm.DB_FILE,
  fileOps: require('./file-operations')(dbm.db, path.join(DATA_DIR,'file-trash')),
  javaIntelligence: null,
  runner: require('./runner')(dbm, DATA_DIR),
};
ctx.javaIntelligence = require('./java-intelligence')(DATA_DIR, (project,minimum) => ctx.runner.analysisEnvironment(project,minimum), project=>ctx.runner.effectiveEnvironment(project));
process.on('exit', () => ctx.javaIntelligence.close());
process.on('exit', () => ctx.runner.close());
process.parentPort?.on('message', event => { if (event.data?.type === 'shutdown') { ctx.runner.close(); ctx.javaIntelligence.close(); process.exit(0); } });

// ---------- 路由表 ----------
const routes = [];
function add(method, pattern, handler) {
  // '/api/hosts/:id/test' -> 正则 + 参数名
  const names = [];
  const rx = new RegExp(
    '^' +
      pattern.replace(/:[^/]+/g, (m) => {
        names.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, rx, names, handler });
}

require('./routes/hosts')(add, ctx);
require('./routes/local')(add, ctx);
require('./routes/settings')(add, ctx);
require('./routes/runner')(add, ctx);
require('./routes/client')(add, ctx);
require('./routes/configuration')(add, ctx);

// ---------- 工具 ----------
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 静态文件 ----------
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = decodeURIComponent(rel);

  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

// ---------- 请求处理 ----------
async function handle(req, res) {
  const host = new URL(`http://${req.headers.host || '127.0.0.1'}`);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return json(res, 403, { error: '仅允许本机访问' });
  if (req.headers.origin && req.headers.origin !== host.origin) return json(res, 403, { error: '不允许跨站访问本地服务' });
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/api/events') return sseHandler(req, res);

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  const route = routes.find((r) => r.method === req.method && r.rx.test(pathname));
  if (!route) return json(res, 404, { error: '接口不存在' });

  const m = pathname.match(route.rx);
  const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));

  try {
    const fileBody = /^\/api\/local\/[^/]+\/(file|format|java-intelligence|script-intelligence)$/.test(pathname);
    const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req,fileBody || pathname.startsWith('/api/configuration/') ? 12*1024*1024 : 1024*1024) : {};
    const result = await route.handler({ req, res, params, query: url.searchParams, body });
    if (!res.writableEnded) json(res, 200, result ?? { ok: true });
  } catch (e) {
    const msg = mask(e.message || String(e));
    bus.log(`[接口错误] ${req.method} ${pathname} → ${msg}`, 'err');
    if (!res.writableEnded) json(res, 400, { error: msg });
  }
}

// ---------- 启动 ----------
const PORT0 = parseInt(process.env.PORT || '7456', 10);
let port = PORT0;
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    try { json(res, 500, { error: mask(String(e && e.message || e)) }); } catch { /* noop */ }
  });
});

function listen() {
  server.listen(port, '127.0.0.1');
}
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < PORT0 + 10) {
    console.log(`端口 ${port} 被占用，尝试 ${port + 1} …`);
    port += 1;
    listen();
  } else {
    console.error('启动失败：', e.message);
    process.exit(1);
  }
});
server.on('listening', () => {
  port = server.address().port;
  const urlStr = `http://127.0.0.1:${port}`;
  console.log('┌────────────────────────────────────────────┐');
  console.log('│       Git 项目管家 · 本地管理工具           │');
  console.log(`│  访问地址：  ${urlStr.padEnd(30)}│`);
  console.log(`│  数据目录：  ${DATA_DIR.padEnd(30, ' ').slice(0, 30)}│`);
  console.log('│  令牌加密存储于本机，绝不上传               │');
  console.log('└────────────────────────────────────────────┘');
  bus.log('服务已启动', 'ok');
  if (process.send && process.connected) process.send({ type: 'gitpm-ready', url: urlStr });
  if (process.parentPort) process.parentPort.postMessage({ type: 'gitpm-ready', url: urlStr });
  if (!process.env.NO_OPEN && process.env.GITPM_DESKTOP !== '1') {
    setTimeout(() => { openUrl(urlStr).catch((e) => console.error('打开浏览器失败：', e.message)); }, 500);
  }
  // 启动后台检索：按已保存的扫描根目录自动登记本地仓库（免手动首扫，失败静默）
  setTimeout(() => {
    (async () => {
      try {
        const ws = dbm.getSetting('scan_roots', '[]');
        const roots = JSON.parse(ws);
        if (Array.isArray(roots) && roots.length) {
          const res = await fetch(`http://127.0.0.1:${port}/api/local/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roots }),
          });
          const r = await res.json();
          if (r && r.registeredCount > 0) bus.log(`启动自动检索：新登记 ${r.registeredCount} 个本地仓库`, 'ok');
        }
      } catch { /* 静默 */ }
    })();
  }, 1500);
});

process.on('SIGINT', () => {
  console.log('\n再见！');
  process.exit(0);
});

listen();
