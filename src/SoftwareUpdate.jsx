import React, { useEffect, useState } from 'react';
import { confirm, get } from './api';
import { Button } from './ui-kit';
import { useAction } from './ui';
export default function SoftwareUpdate({ appInfo, version }) {
  const [update, setUpdate] = useState(appInfo?.update || null), [release, setRelease] = useState(null), [busy, run] = useAction();
  useEffect(() => { if (appInfo?.update) setUpdate(appInfo.update); return window.gitpmDesktop?.onUpdate?.(setUpdate); }, [appInfo]);
  useEffect(() => { get('/api/client-release').then(setRelease).catch(() => {}); }, []);
  const labels = { idle: '可手动检查新版本', checking: '正在检查更新…', available: '发现新版本', current: '当前已是最新版本', downloading: '正在下载更新', downloaded: '更新已下载，可以重启安装', error: '更新暂不可用' };
  return <div><div className="update-version-card"><span className="settings-eyebrow">当前版本</span><strong>{version}</strong><p>{appInfo ? `${appInfo.platform === 'darwin' ? 'macOS' : 'Windows'} · ${appInfo.arch}` : '网页版'}</p></div><h3>{labels[update?.state || 'idle']}</h3>{!appInfo && <p className="muted">网页版随本地服务更新；安装客户端后可在这里检查、下载并安装软件更新。</p>}{appInfo && !appInfo.canUpdate && <p className="muted">当前构建尚未连接发行仓库，自动更新暂不可用。已安装的配置和项目数据会保留在本机。</p>}
    <div className="button-group"><Button type="primary" disabled={busy || !appInfo?.canUpdate || ['checking','downloading'].includes(update?.state)} onClick={() => run(async () => setUpdate(await window.gitpmDesktop.checkForUpdates()))}>检查更新</Button>{update?.state === 'available' && <Button disabled={busy} onClick={() => run(async () => setUpdate(await window.gitpmDesktop.downloadUpdate()))}>下载 {update.version}</Button>}{update?.state === 'downloaded' && <Button type="primary" onClick={() => run(async () => { if (await confirm('重启并安装更新', '客户端将关闭并安装更新，请先保存正在编辑的文件。')) await window.gitpmDesktop.installUpdate(); })}>重启并安装</Button>}{release?.releaseUrl && <a className="settings-text-link" href={release.releaseUrl} target="_blank" rel="noreferrer">查看发行版本</a>}</div>
    {update?.state === 'downloading' && <div className="update-progress"><progress value={update.percent || 0} max="100" /><span>{update.percent || 0}%</span></div>}{update?.state === 'error' && <p className="muted">{update.message}</p>}<section className="settings-section"><h3>更新方式</h3><p className="muted">启用自动检查后，启动客户端时会提示新版本。下载和重启安装由你决定。</p></section></div>;
}
