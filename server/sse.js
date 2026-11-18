// SSE 日志总线：实时把 git 输出推送到前端控制台；保留最近 500 行重放
'use strict';

const clients = new Set();
const backlog = [];
const BACKLOG_MAX = 500;

function push(eventName, data) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { /* 忽略断开 */ }
  }
}

/**
 * 记录日志行。level: info | cmd | out | err | ok
 * text 传入前应已脱敏（runGit 已内置）。
 */
function log(text, level = 'info', tag = '') {
  const entry = { t: Date.now(), level, tag, text: String(text) };
  backlog.push(entry);
  if (backlog.length > BACKLOG_MAX) backlog.shift();
  push('log', entry);
}

function handler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  // 重放历史日志
  res.write(`event: backlog\ndata: ${JSON.stringify(backlog)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

module.exports = { handler, log };
