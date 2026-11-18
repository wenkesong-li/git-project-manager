'use strict';
const { app, BrowserWindow, utilityProcess, ipcMain, shell, clipboard, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const appRoot = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
let window, child, origin, update = { state: 'idle', version: app.getVersion() };
if (process.env.GITPM_DATA_DIR) app.setPath('userData', path.resolve(process.env.GITPM_DATA_DIR));
if (process.env.GITPM_DESKTOP_SMOKE === '1' && process.env.GITPM_SMOKE_DATA) app.setPath('userData', process.env.GITPM_SMOKE_DATA);
const desktopPrefs = require('./preferences.cjs')(app.getPath('userData'));
let release = {};
try { release = JSON.parse(fs.readFileSync(path.join(appRoot, 'release.json'), 'utf8')); } catch {}
const repository = /^[\w.-]+\/[\w.-]+$/.test(release.repository || '') ? release.repository : '';
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  function trusted(event) { if (event.senderFrame?.url && new URL(event.senderFrame.url).origin === origin) return; throw new Error('不受信任的窗口'); }
  function notify(state, extra = {}) { update = { ...update, state, ...extra }; if (!window?.isDestroyed()) window?.webContents.send('gitpm:update', update); }
  ipcMain.handle('gitpm:info', event => { trusted(event); return { platform: process.platform, arch: process.arch, version: app.getVersion(), update, canUpdate: app.isPackaged && !!repository, packaged: app.isPackaged, preferences: desktopPrefs.get() }; });
  ipcMain.handle('gitpm:preferences', (event, patch) => { trusted(event); if (typeof patch?.openAtLogin === 'boolean') { if (!app.isPackaged) throw new Error('开机启动仅支持安装版客户端'); app.setLoginItemSettings({ openAtLogin: patch.openAtLogin }); } return desktopPrefs.set(patch || {}); });
  ipcMain.handle('gitpm:data-folder', event => { trusted(event); return shell.openPath(app.getPath('userData')); });
  ipcMain.handle('gitpm:save-configuration', async (event, content) => { trusted(event); if (typeof content !== 'string' || Buffer.byteLength(content) > 8 * 1024 * 1024) throw new Error('备份内容无效'); const result = await dialog.showSaveDialog(window, { title: '导出配置', defaultPath: path.join(app.getPath('documents'), `GitPM-${new Date().toISOString().slice(0,10)}.gitpm-backup.json`), filters: [{ name: 'GitPM 配置备份', extensions: ['json'] }] }); if (result.canceled || !result.filePath) return { canceled: true }; fs.writeFileSync(result.filePath, content, { mode: 0o600 }); return { saved: true }; });
  ipcMain.handle('gitpm:load-configuration', async event => { trusted(event); const result = await dialog.showOpenDialog(window, { title: '导入配置', properties: ['openFile'], filters: [{ name: 'GitPM 配置备份', extensions: ['json'] }] }); if (result.canceled) return null; if (fs.statSync(result.filePaths[0]).size > 8 * 1024 * 1024) throw new Error('备份文件超过 8MB'); return fs.readFileSync(result.filePaths[0], 'utf8'); });
  ipcMain.handle('gitpm:clipboard', (event, text) => { trusted(event); if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('复制内容过长'); clipboard.writeText(text); });
  ipcMain.handle('gitpm:update-check', async event => { trusted(event); if (!app.isPackaged || !repository) throw new Error('当前构建尚未配置自动更新'); return autoUpdater.checkForUpdates().then(() => update); });
  ipcMain.handle('gitpm:update-download', async event => { trusted(event); await autoUpdater.downloadUpdate(); return update; });
  ipcMain.handle('gitpm:update-install', event => { trusted(event); if (update.state !== 'downloaded') throw new Error('更新尚未下载'); autoUpdater.quitAndInstall(); });
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => notify('checking'));
  autoUpdater.on('update-available', info => notify('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => notify('current'));
  autoUpdater.on('download-progress', info => notify('downloading', { percent: Math.round(info.percent) }));
  autoUpdater.on('update-downloaded', info => notify('downloaded', { version: info.version }));
  autoUpdater.on('error', () => notify('error', { message: '更新失败，请在软件更新页面重试或查看发行版本' }));
  app.whenReady().then(async () => {
    child = utilityProcess.fork(path.join(appRoot, 'server/index.js'), [], { serviceName: 'Git Project Manager', env: { ...process.env, PORT: '0', NO_OPEN: '1', GITPM_DESKTOP: '1', GITPM_DATA_DIR: app.getPath('userData'), GITPM_WORKSPACE: path.join(app.getPath('documents'), 'GitProjects') }, stdio: 'pipe' });
    child.stdout?.resume(); child.stderr?.resume();
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 30000);
      child.on('message', message => { if (message.type === 'gitpm-ready') { clearTimeout(timer); resolve(message.url); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('本地服务启动失败')); });
    });
    origin = new URL(url).origin;
    let bounds = { width: 1380, height: 900 };
    if (desktopPrefs.get().rememberWindow && desktopPrefs.get().bounds) { const saved = desktopPrefs.get().bounds, work = screen.getDisplayMatching(saved).workArea; bounds = { width: Math.min(Math.max(saved.width,900),work.width), height: Math.min(Math.max(saved.height,620),work.height), x: Math.max(work.x, Math.min(saved.x, work.x + work.width - Math.min(saved.width,work.width))), y: Math.max(work.y, Math.min(saved.y, work.y + work.height - Math.min(saved.height,work.height))) }; }
    window = new BrowserWindow({ ...bounds, minWidth: 900, minHeight: 620, show: false, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    window.on('close', () => { if (desktopPrefs.get().rememberWindow && !window.isMinimized()) desktopPrefs.set({ bounds: window.getNormalBounds() }); });
    window.webContents.setWindowOpenHandler(({ url }) => { try { const target = new URL(url); if (['https:', 'http:'].includes(target.protocol)) shell.openExternal(target.href); } catch {} return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    window.once('ready-to-show', () => { if (process.env.GITPM_DESKTOP_SMOKE !== '1') window.show(); });
    await window.loadURL(url);
    if (app.isPackaged && repository) { const [owner, repo] = repository.split('/'); autoUpdater.setFeedURL({ provider: 'github', owner, repo }); if (desktopPrefs.get().autoCheckUpdates) autoUpdater.checkForUpdates().catch(() => {}); }
    if (process.env.GITPM_DESKTOP_SMOKE === '1') {
      const checks = { ready: true };
      if (process.env.GITPM_SMOKE_PROJECT) {
        async function api(endpoint, body) { const response = await fetch(url + endpoint, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; }
        const imported = await api('/api/local/import', { localPath: process.env.GITPM_SMOKE_PROJECT }), prefix = `/api/local/${imported.project.id}`;
        checks.search = (await api(prefix + '/file-search?mode=content&q=add')).items.length > 0;
        checks.typescript = (await api(prefix + '/script-intelligence', { path: 'main.ts', action: 'definition', line: 2, column: 15 })).items.some(item => item.path === 'math.ts');
        checks.java = (await api(prefix + '/java-intelligence', { path: 'Main.java', action: 'definition', line: 1, column: 33 })).items.some(item => item.path === 'Helper.java');
        if (!checks.search || !checks.typescript || !checks.java) throw new Error('打包客户端功能检查失败');
      }
      console.log('DESKTOP_READY', JSON.stringify(checks)); if (process.env.GITPM_SMOKE_MARKER) fs.writeFileSync(process.env.GITPM_SMOKE_MARKER, JSON.stringify(checks)); setTimeout(() => app.quit(), 1000);
    }
  }).catch(error => { if (process.env.GITPM_DESKTOP_SMOKE === '1') { console.error(error.message); app.exit(1); return; } require('electron').dialog.showErrorBox('启动失败', error.message); app.quit(); });
  app.on('before-quit', () => { child?.postMessage({ type: 'shutdown' }); setTimeout(() => child?.kill(), 1500).unref(); });
  app.on('window-all-closed', () => app.quit());
}
