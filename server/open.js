// 跨平台系统操作：Windows 使用原生程序，macOS 使用 open。
'use strict';

const { spawn } = require('child_process');

function launch(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** 在系统文件管理器中打开目录 */
function openPath(p) {
  if (process.platform === 'win32') return launch('explorer.exe', [p]);
  if (process.platform === 'darwin') return launch('open', [p]);
  return launch('xdg-open', [p]);
}

/** 用系统默认浏览器打开 URL */
function openUrl(u) {
  if (process.platform === 'win32') return launch('rundll32.exe', ['url.dll,FileProtocolHandler', u]);
  if (process.platform === 'darwin') return launch('open', [u]);
  return launch('xdg-open', [u]);
}

function openTerminal(directory) {
  if (process.platform === 'win32') {
    const literal = String(directory).replace(/'/g, "''");
    const script = `Start-Process -FilePath $env:ComSpec -WorkingDirectory '${literal}'`;
    return launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  }
  if (process.platform === 'darwin') return launch('open', ['-a', 'Terminal', directory]);
  return Promise.reject(new Error('当前系统暂不支持打开终端，请手动打开'));
}

module.exports = { openPath, openUrl, openTerminal };
