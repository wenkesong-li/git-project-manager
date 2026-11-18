import React, { useRef, useState } from 'react';
import { get, post } from './api';
import { Button, Input, Message } from './ui-kit';
import { Field, FolderInput, useAction } from './ui';
import { applyPreferences, readPreferences } from './preferences';

export default function DataTransfer({ ctx, sources = [], firstRun = false, onImported }) {
  const [source, setSource] = useState(sources[0]?.path || ''), [preview, setPreview] = useState(sources[0] ? { ...sources[0], kind: 'legacy' } : null);
  const [backup, setBackup] = useState(null), [filename, setFilename] = useState(''), [password, setPassword] = useState('');
  const [includeSecrets, setIncludeSecrets] = useState(false), [exportPassword, setExportPassword] = useState('');
  const [busy, run] = useAction(), file = useRef(null);
  function load(text, name) {
    if (new Blob([text]).size > 8 * 1024 * 1024) throw new Error('备份文件超过 8MB');
    const value = JSON.parse(text); if (value.kind !== 'gitpm-config') throw new Error('请选择 GitPM 配置备份');
    setBackup(value); setFilename(name); setPassword(''); setPreview(null);
  }
  async function imported(result) {
    applyPreferences(result.preferences || {}); await ctx.refresh(); ctx.reloadProjectViews?.();
    Message.success(`已导入 ${result.projectsAdded} 个项目、${result.hostsAdded} 个平台${result.skipped ? `，保留 ${result.skipped} 个现有项目` : ''}`);
    setPreview(null); setPassword(''); await onImported?.();
  }
  return <div className="data-transfer">
    <section className="settings-section"><h3>{firstRun ? '继续使用已有配置' : '导入历史数据'}</h3><p className="muted">自动检测旧版网页工具的数据目录，也可以选择其他数据目录。导入平台、登录凭据、项目登记、运行环境和文件操作记录；现有项目不会被覆盖。</p>
      {sources.length > 0 && <div className="migration-found"><strong>发现本机历史配置</strong><span>{sources[0].projects} 个项目 · {sources[0].hosts} 个平台 · {sources[0].credentials} 份登录凭据</span></div>}
      <Field label="历史数据目录" hint="请选择同时包含 data.db 和 secret.key 的目录"><FolderInput value={source} onChange={value => { setSource(value); setPreview(null); }} /></Field>
      <Button disabled={busy || !source.trim()} onClick={() => run(async () => { const result = await post('/api/configuration/legacy-preview', { path: source.trim() }); setPreview({ ...result, kind: 'legacy' }); })}>预览历史配置</Button>
    </section>
    <section className="settings-section"><h3>从备份文件导入</h3><p className="muted">使用本应用导出的配置备份，可将设置迁移到另一台设备。</p><input ref={file} type="file" accept=".json" hidden onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) run(async () => { if (chosen.size > 8 * 1024 * 1024) throw new Error('备份文件超过 8MB'); load(await chosen.text(), chosen.name); }); }} />
      <Button disabled={busy} onClick={() => run(async () => { if (window.gitpmDesktop?.loadConfiguration) { const content = await window.gitpmDesktop.loadConfiguration(); if (content) load(content, '已选择配置备份'); } else file.current.click(); })}>选择备份文件</Button>{filename && <span className="backup-filename">{filename}</span>}
      {backup?.encrypted && <Field label="备份密码"><Input type="password" aria-label="导入备份密码" value={password} onChange={value => { setPassword(value); setPreview(null); }} /></Field>}
      {backup && <Button disabled={busy || backup.encrypted && !password} onClick={() => run(async () => { const result = await post('/api/configuration/preview', { backup, password }); setPreview({ ...result, kind: 'backup' }); })}>预览备份内容</Button>}
    </section>
    {preview && <section className="import-preview"><h3>导入预览</h3><div className="import-stat-grid"><span><strong>{preview.projects}</strong>项目</span><span><strong>{preview.hosts}</strong>平台</span><span><strong>{preview.credentials}</strong>登录凭据</span><span><strong>{preview.records}</strong>操作记录</span></div><p className="muted">{preview.hasEnvironment ? '包含本地运行环境配置。' : '不包含运行环境配置。'}{preview.missingProjects > 0 ? ` ${preview.missingProjects} 个项目路径在本机不存在，导入后可重新关联目录。` : ''}已存在的平台凭据和项目设置会保留。</p><Button type="primary" disabled={busy} onClick={() => run(async () => { const result = preview.kind === 'legacy' ? await post('/api/configuration/legacy-import', { path: preview.path }) : await post('/api/configuration/import', { backup, password }); await imported(result); })}>导入并保留现有配置</Button></section>}
    {!firstRun && <section className="settings-section"><h3>导出配置备份</h3><p className="muted">包含平台与项目登记、工作区、本地环境、偏好和样式；不包含仓库文件和回收站文件。备份含本地路径与平台地址，请保存到私人目录。</p><label className="settings-check"><input type="checkbox" checked={includeSecrets} onChange={event => setIncludeSecrets(event.target.checked)} />包含登录凭据（使用密码加密整个备份）</label><Field label="备份密码" hint={includeSecrets ? '至少 10 位，导入时需要此密码' : '可选，设置后整个备份将加密'}><Input type="password" aria-label="导出备份密码" value={exportPassword} onChange={setExportPassword} /></Field><Button disabled={busy || includeSecrets && exportPassword.length < 10} onClick={() => run(async () => {
      const result = await post('/api/configuration/export', { includeSecrets, password: exportPassword, preferences: readPreferences() }), content = JSON.stringify(result, null, 2);
      if (window.gitpmDesktop?.saveConfiguration) { const saved = await window.gitpmDesktop.saveConfiguration(content); if (saved.canceled) return; }
      else { const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = `GitPM-${new Date().toISOString().slice(0,10)}.gitpm-backup.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
      setExportPassword(''); Message.success('配置备份已导出');
    })}>导出配置</Button></section>}
  </div>;
}
