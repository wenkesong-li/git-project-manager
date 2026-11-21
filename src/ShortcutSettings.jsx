import React, { useRef, useState } from 'react';
import { Button, Message } from './ui-kit';
import { conflicts, defaults, displayKey, eventKey, ideaPreset, labels, parseIdeaKeymap, sanitize } from './shortcut-config';

const maxImport = 64 * 1024 * 1024;
const keymapEntry = /^keymaps\/[^/]+\.xml$/i;
const activeEntry = /^options\/(?:[^/]+\/)?keymap\.xml$/i;

async function readImport(file) {
  if (file.size > maxImport) throw new Error('快捷键导入文件超过 64 MB');
  if (/\.json$/i.test(file.name)) {
    if (file.size > 256 * 1024) throw new Error("快捷键 JSON 超过 256 KB");
    const data = JSON.parse(await file.text());
    if (data?.format !== 'gitpm-shortcuts' || data.version !== 1 || !data.bindings || typeof data.bindings !== 'object') {
      throw new Error('无法识别此快捷键 JSON');
    }
    const bindings = sanitize(data.bindings);
    for (const [action, keys] of Object.entries(data.bindings)) {
      if (!Object.hasOwn(bindings, action) || !Array.isArray(keys) || keys.length !== bindings[action].length) {
        throw new Error('快捷键 JSON 包含无效动作或按键');
      }
    }
    return { bindings };
  }
  if (/\.xml$/i.test(file.name)) {
    if (file.size > 256 * 1024) throw new Error('快捷键 XML 超过 256 KB');
    return { profiles: [parseIdeaKeymap(await file.text())], selected: 0 };
  }
  const { unzipSync } = await import('fflate');
  let count = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
    if (!keymapEntry.test(entry.name) && !activeEntry.test(entry.name)) return false;
    if (++count > 64 || entry.originalSize > 256 * 1024) throw new Error('IDEA 快捷键文件数量或大小超过限制');
    return true;
  } });
  const decoder = new TextDecoder('utf-8');
  const profiles = Object.entries(entries).filter(([name]) => keymapEntry.test(name))
    .map(([, bytes]) => parseIdeaKeymap(decoder.decode(bytes)));
  if (!profiles.length) throw new Error('此 IDEA 设置包没有导出的自定义快捷键');
  const platform = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'windows' : 'linux';
  const activeFiles = Object.keys(entries).filter(name => activeEntry.test(name));
  const preferred = [`options/${platform}/keymap.xml`, 'options/keymap.xml'];
  const active = [...preferred.filter(name => Object.hasOwn(entries, name)), ...activeFiles]
    .map(name => {
      const source = decoder.decode(entries[name]);
      if (/<!DOCTYPE|<!ENTITY/i.test(source)) return null;
      return new DOMParser().parseFromString(source, 'text/xml').querySelector('active_keymap')?.getAttribute('name');
    }).find(name => profiles.some(profile => profile.name === name));
  return { profiles, selected: Math.max(0, profiles.findIndex(profile => profile.name === active)) };
}

export default function ShortcutSettings({ bindings, onChange }) {
  const [recording, setRecording] = useState(null);
  const [pending, setPending] = useState(null);
  const [selected, setSelected] = useState(0);
  const [importing, setImporting] = useState(false);
  const input = useRef(null);

  function apply(next) {
    const conflict = conflicts(next);
    if (conflict) { Message.error(conflict); return false; }
    onChange(next);
    return true;
  }
  async function importFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setPending(null);
    setImporting(true);
    try {
      const data = await readImport(file);
      if (data.profiles) {
        setSelected(data.selected);
        setPending(data.profiles);
      } else if (apply(data.bindings)) Message.success('快捷键已导入，保存后保留');
    } catch (error) { Message.error(error.message || '快捷键导入失败'); }
    finally { setImporting(false); }
  }
  function exportFile() {
    const data = { format: 'gitpm-shortcuts', version: 1, bindings: { ...defaults, ...bindings } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'GitPM-keymap.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function record(event, action, keys) {
    if (!recording || recording !== action) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') { setRecording(null); return; }
    if (event.repeat || ['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    const key = eventKey(event);
    if (!sanitize({ [action]: [key] })[action]?.length) {
      Message.warning('请输入带修饰键的组合键或功能键');
      return;
    }
    if (keys.includes(key) || apply({ ...bindings, [action]: [...keys, key] })) setRecording(null);
  }
  const profile = pending?.[selected];
  return (
    <section className="settings-section shortcut-settings">
      <p className="muted">点击「添加」后按下组合键。可为同一操作设置多个快捷键。</p>
      <div className="button-group">
        <Button disabled={importing} onClick={() => input.current.click()}>{importing ? '读取中…' : '导入快捷键'}</Button>
        <Button onClick={exportFile}>导出 JSON</Button>
        <Button onClick={() => apply({ ...bindings, ...ideaPreset })}>应用 IDEA 参考方案</Button>
        <Button onClick={() => apply({})}>恢复默认</Button>
      </div>
      <input ref={input} type="file" accept=".zip,.xml,.json" hidden onChange={importFile} />
      {profile && <div className="shortcut-import-preview">
        <label>IDEA 方案 <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
          {pending.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
        </select></label>
        <p className="muted">可应用 {Object.keys(profile.bindings).length} 个操作，跳过 {profile.skipped} 条不支持的绑定。导入自定义差异，未列出的操作保留当前设置。</p>
        <Button disabled={!Object.keys(profile.bindings).length} onClick={() => {
          if (apply({ ...bindings, ...profile.bindings })) { setPending(null); Message.success('IDEA 快捷键已导入，保存后保留'); }
        }}>应用此方案</Button>
      </div>}
      <div className="shortcut-editor-list">
        {Object.entries(labels).map(([action, label]) => {
          const keys = bindings[action] ?? defaults[action];
          return <div className="shortcut-editor-row" key={action}>
            <span>{label}</span>
            <div className="shortcut-keys">
              {keys.map(key => <button key={key} type="button" title="移除此快捷键" aria-label={`移除 ${label} ${displayKey(key)}`}
                onClick={() => apply({ ...bindings, [action]: keys.filter(value => value !== key) })}><kbd>{displayKey(key)}</kbd> ×</button>)}
              {!keys.length && <span className="muted">未绑定</span>}
            </div>
            <button type="button" className="ui-btn ui-btn-mini" disabled={recording !== action && keys.length >= 5}
              aria-label={`添加${label}快捷键`} onClick={() => setRecording(action)} onBlur={() => setRecording(null)}
              onKeyDown={event => record(event, action, keys)}>{recording === action ? '请按键 · Esc 取消' : '添加'}</button>
          </div>;
        })}
      </div>
    </section>
  );
}
