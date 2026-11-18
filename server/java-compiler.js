'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { resolveEntry } = require('./files');
let active = 0;
module.exports = async function javaCompiler(dataDir, runtime, project, body) {
  if (body.action === 'documentHighlight' && active) return { result: [] };
  if (active >= 2) throw new Error('Java 分析正在进行，请稍后重试');
  active++;
  try {
  const target = path.relative(fs.realpathSync(project.local_path), resolveEntry(project.local_path, String(body.path))).replace(/\\/g, '/');
  const source = String(body.content ?? fs.readFileSync(resolveEntry(project.local_path, target), 'utf8'));
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new Error('文件超过 2MB');
  const workspace = await require('./workspace-search').javaWorkspace(project.local_path);
  if (!workspace.items.includes(target)) workspace.items.push(target);
  const directory = path.join(dataDir, 'language-workspaces', 'compiler-requests'); fs.mkdirSync(directory, { recursive: true });
  const helper = path.join(directory, 'Navigate.java'), helperSource = fs.readFileSync(path.join(__dirname, 'java', 'Navigate.java'), 'utf8');
  if (!fs.existsSync(helper) || fs.readFileSync(helper, 'utf8') !== helperSource) fs.writeFileSync(helper, helperSource);
  const request = path.join(directory, crypto.randomUUID() + '.txt');
  fs.writeFileSync(request, [fs.realpathSync(project.local_path), body.action, target, String(Math.max(1, Number(body.line) || 1)), String(Math.max(1, Number(body.column) || 1)), source, ...workspace.items].map(value => Buffer.from(value).toString('base64')).join('\n'), { mode: 0o600 });
  let child;
  try {
    const result = await new Promise((resolve, reject) => {
      child = spawn(runtime.java, ['--source', '17', helper, request, String(runtime.targetRelease || '')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Java 工程分析超时，建议启用 JDT 深度分析')); }, 25000);
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 4 * 1024 * 1024) child.kill(); }); child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); reject(new Error('未找到 JDK，请在设置中配置 JDK 安装目录')); });
      child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Java 导航需要 JDK 17+，请检查 JDK 设置或启用 JDT 深度分析')); else { try { resolve(JSON.parse(output)); } catch { reject(new Error('Java 分析结果读取失败')); } } });
    });
    if (body.action === 'documentHighlight') return { result: result.items.map(item => ({ range: item.range, kind: item.kind })) };
    return { ...result, truncated: workspace.truncated };
  } finally { if (fs.existsSync(request)) fs.unlinkSync(request); }
  } finally { active--; }
};
