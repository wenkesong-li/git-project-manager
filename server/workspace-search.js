'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { RE2 } = require('re2-wasm');
const files = require('./files');
const excluded = ['node_modules', 'vendor', 'dist', 'build', 'target', '.next', '.gradle'];

async function runRg(root, args, onItem, signal, nullSeparated = false) {
  const { rgPath } = await import('@vscode/ripgrep');
  if (signal?.aborted) throw new Error('搜索已取消');
  return new Promise((resolve, reject) => {
    const binary = process.versions.electron ? rgPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : rgPath;
    const child = spawn(binary, args, { cwd: fs.realpathSync(root), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '', stderr = '', stopped = false, timedOut = false;
    const stop = () => { stopped = true; child.kill(); };
    const abort = () => stop();
    const timer = setTimeout(() => { timedOut = true; stop(); }, 8000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      const delimiter = nullSeparated ? '\0' : '\n';
      let at;
      while (!stopped && (at = pending.indexOf(delimiter)) >= 0) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try { if (line && onItem(line) === false) stop(); }
        catch (error) { stop(); reject(error); }
      }
      if (pending.length > 4 * 1024 * 1024) stop();
    });
    child.stderr.on('data', chunk => { if (stderr.length < 2000) stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('搜索已取消'));
      if (code > 1 && !stopped) return reject(new Error(/regex|parse error/i.test(stderr) ? '正则表达式无效或包含不支持的语法' : '搜索失败，部分文件可能无法访问'));
      resolve({ truncated: stopped || timedOut });
    });
  });
}
function globs(skipGenerated) {
  return ['--glob', '!**/.git/**', ...(skipGenerated ? excluded.flatMap(dir => ['--glob', `!**/${dir}/**`]) : [])];
}
async function search(root, options, signal) {
  const query = String(options.q || '').trim();
  const mode = ['name', 'path', 'name-or-path', 'content'].includes(options.mode) ? options.mode : 'name';
  if (!query) return { items: [], truncated: false, mode };
  if (query.length > 500) throw new Error('搜索条件最长 500 个字符');
  const regex = options.regex === 'true', matchCase = options.case === 'true';
  let matcher;
  if (regex) {
    try { matcher = new RE2(query, matchCase ? 'u' : 'iu'); }
    catch { throw new Error('正则表达式无效（不支持回溯引用或环视）'); }
  }
  const match = value => regex ? matcher.test(value) : (matchCase ? value : value.toLowerCase()).includes(matchCase ? query : query.toLowerCase());
  const items = [], common = ['--hidden', '--no-ignore', ...globs(options.skipGenerated !== 'false')];
  let result;
  if (mode === 'content') {
    result = await runRg(root, ['--json', '--max-filesize', '2M', '--max-columns', '2000', ...common, ...(regex ? [] : ['--fixed-strings']), ...(matchCase ? [] : ['--ignore-case']), '-e', query, '.'], line => {
      const event = JSON.parse(line);
      if (event.type !== 'match' || !event.data.path.text || !event.data.lines.text) return;
      const data = event.data, relative = data.path.text.replace(/\\/g, '/').replace(/^\.\//, '');
      const text = data.lines.text.replace(/[\r\n]+$/, ''), sub = data.submatches[0];
      const column = sub ? Buffer.from(data.lines.text).subarray(0, sub.start).toString('utf8').length + 1 : 1;
      const endColumn = sub ? Buffer.from(data.lines.text).subarray(0, sub.end).toString('utf8').length + 1 : column;
      items.push({ name: path.basename(relative), path: relative, type: 'file', accessible: true, line: data.line_number, column, endColumn, preview: text.slice(0, 2000) });
      return items.length < 300;
    }, signal);
  } else {
    result = await runRg(root, ['--files', '--null', ...common], relative => {
      relative = relative.replace(/\\/g, '/');
      const name = path.posix.basename(relative);
      if (match(mode === 'name' ? name : relative) || (mode === 'name-or-path' && match(name))) {
        items.push({ name, path: relative, type: 'file', accessible: true });
      }
      return items.length < 300;
    }, signal, true);
  }
  return { ...result, items, mode, limit: 300 };
}
async function scriptWorkspace(root, signal) {
  const items = []; let size = 0;
  const result = await runRg(root, ['--files', '--null', '--hidden', '--no-ignore', '--glob', '*.{js,jsx,ts,tsx,mjs,cjs,json}', ...globs(true)], relative => {
    if (!/\.[cm]?[jt]sx?$/i.test(relative)) return;
    try {
      const preview = files.readFile(root, relative);
      if (!preview.binary) {
        size += preview.size;
        if (size > 8 * 1024 * 1024) return false;
        items.push({ path: relative.replace(/\\/g, '/'), content: preview.content });
      }
    } catch {}
    return items.length < 500;
  }, signal, true);
  return { items, truncated: result.truncated };
}
async function javaWorkspace(root) {
  const items = []; let size = 0;
  const result = await runRg(root, ['--files', '--null', '--hidden', '--no-ignore', '--glob', '*.java', ...globs(true)], relative => {
    try { const preview = files.readFile(root, relative); size += preview.size; if (size > 8 * 1024 * 1024) return false; if (!preview.binary) items.push(relative.replace(/\\/g, '/')); } catch {}
    return items.length < 300;
  }, undefined, true);
  return { items, truncated: result.truncated };
}
module.exports = { search, scriptWorkspace, javaWorkspace };
