// 设置路由
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function registerSettingsRoutes(add, ctx) {
  const { dbm } = ctx;

  const { APP_ROOT, DEFAULT_WORKSPACE } = require('../paths');

  add('GET', '/api/settings', async () => {
    let scanRoots = [];
    try { scanRoots = JSON.parse(dbm.getSetting('scan_roots', '[]')) || []; } catch { scanRoots = []; }
    return {
      workspace: dbm.getSetting('workspace', DEFAULT_WORKSPACE),
      scanRoots,
      dataDir: ctx.DATA_DIR,
      dbFile: ctx.DB_FILE,
      appRoot: APP_ROOT,
      version: require('../../package.json').version,
      runtime: process.versions.node,
      preferences: (() => { try { return require('../preferences')(JSON.parse(dbm.getSetting('ui_preferences', '{}'))); } catch { return {}; } })(),
    };
  });
  add('PUT', '/api/preferences', async ({ body }) => {
    let previous = {}; try { previous = JSON.parse(dbm.getSetting('ui_preferences', '{}')); } catch {}
    const patch = require('../preferences')(body.preferences);
    const preferences = { ...previous, ...patch, editor: { ...previous.editor, ...patch.editor } };
    dbm.setSetting('ui_preferences', JSON.stringify(preferences)); return { ok: true, preferences };
  });

  add('PUT', '/api/settings', async ({ body }) => {
    if (!body || body.workspace === undefined) return { ok: false, error: '缺少 workspace' };
    const ws = String(body.workspace).trim();
    if (!ws) throw new Error('工作区路径不能为空');
    if (!path.isAbsolute(ws)) throw new Error('必须使用绝对路径');
    fs.mkdirSync(ws, { recursive: true });
    dbm.setSetting('workspace', ws);
    if (body.scanRoots !== undefined) {
      const roots = [...new Set(
        (Array.isArray(body.scanRoots) ? body.scanRoots : []).map((s) => String(s || '').trim()).filter(Boolean)
      )];
      for (const r of roots) {
        if (!path.isAbsolute(r)) throw new Error(`检索目录必须为绝对路径：${r}`);
      }
      dbm.setSetting('scan_roots', JSON.stringify(roots));
    }
    return { ok: true, workspace: ws };
  });

  /**
   * 系统原生"选择文件夹"对话框（跨平台）。
   * Windows: PowerShell STA + Windows Forms；macOS: osascript choose folder；Linux: 不支持时返回错误。
   * ?timeout_ms= 最长等待（默认 300 秒）；用户取消/超时返回 { path: null }。
   */
  add('GET', '/api/pick-folder', async ({ query }) => {
    const timeoutMs = Math.min(Math.max(parseInt(query.get('timeout_ms') || '300000', 10) || 300000, 1000), 300000);

    let cmd;
    let args;
    if (process.platform === 'win32') {
      // OpenFileDialog + ValidateNames=false 的经典技巧：现代样式对话框可选文件夹，
      // 支持地址栏粘贴路径；FileName 占位符的父目录即所选目录
      const ps = [
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
        'Add-Type -AssemblyName System.Windows.Forms | Out-Null;',
        '$d = New-Object System.Windows.Forms.OpenFileDialog;',
        '$d.ValidateNames=$false; $d.CheckFileExists=$false; $d.CheckPathExists=$true;',
        "$d.FileName='选中此文件夹'; $d.Title='选择文件夹';",
        '$o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true};',
        'if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write((Split-Path -LiteralPath $d.FileName)) }',
      ].join(' ');
      cmd = 'powershell.exe';
      args = ['-NoProfile', '-STA', '-Command', ps];
    } else if (process.platform === 'darwin') {
      // macOS 原生文件夹选择框，返回 POSIX 路径（去尾斜杠）
      cmd = 'osascript';
      args = ['-e', 'POSIX path of (choose folder with prompt "选择文件夹")'];
    } else {
      return { path: null, error: '当前系统暂不支持图形化选目录，请手动输入路径' };
    }

    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        return resolve({ path: null, error: String(e && e.message) });
      }
      let out = '';
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => { try { child.kill(); } catch { /* noop */ } finish({ path: null, canceled: true }); }, timeoutMs);
      child.stdout.on('data', (d) => { out += d.toString('utf8'); });
      child.on('error', (e) => finish({ path: null, error: String(e && e.message) }));
      child.on('close', () => finish({ path: out.trim().replace(/\/+$/, '') || null }));
    });
  });
};
