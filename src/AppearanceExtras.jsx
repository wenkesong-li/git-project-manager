import React, { useRef, useState } from 'react';
import { ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { Button, Message } from './ui-kit';
import { Field, useAction } from './ui';
import { editorColors, importEditorPalette } from './editor-palette';
import { ImageEditor } from './ImageEditor';

const fields = {
  background: '背景', foreground: '正文', keyword: '关键字', string: '字符串', number: '数字',
  comment: '注释', type: '类型', function: '函数', property: '属性', selection: '选区',
};
export function EditorPaletteSettings({ editor, onChange }) {
  const input = useRef(null);
  const colors = editorColors(editor);
  async function load(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('颜色方案超过 2 MB');
      onChange({ ...editor, palette: 'custom', colors: importEditorPalette(await file.text(), file.name) });
      Message.success('颜色方案已预览，保存后生效');
    } catch (error) { Message.error(error.message); }
  }
  return <section className="settings-section">
    <h3>代码配色</h3>
    <Field label="编辑器主题">
      <select aria-label="编辑器主题" value={editor.palette || 'auto'} onChange={event => onChange({ ...editor, palette: event.target.value })}>
        <option value="auto">随界面切换明暗</option><option value="daylight">白底彩色</option>
        <option value="night">深底彩色</option><option value="gray">纯灰度</option><option value="custom">自定义颜色</option>
      </select>
    </Field>
    <pre className="palette-sample" style={{ background: colors.background, color: colors.foreground }}>
      <span style={{ color: colors.comment }}>// 语法颜色预览</span>{'\n'}
      <span style={{ color: colors.keyword }}>const</span>{' message = '}<span style={{ color: colors.string }}>"Hello"</span>{';\n'}
      <span style={{ color: colors.function }}>print</span>{'(message, '}<span style={{ color: colors.number }}>42</span>{');'}
    </pre>
    <Button onClick={() => input.current.click()}>导入编辑器主题</Button>
    <input type="file" accept=".json,.icls,.xml" hidden ref={input} onChange={load} />
    <p className="muted">支持 OpenIDEA / VS Code 主题 JSON、IntelliJ IDEA .icls 颜色方案和十六进制配色 JSON。</p>
    <div className="palette-fields">
      {Object.entries(fields).map(([key, label]) => <label key={key}>{label}
        <input type="color" aria-label={label + '颜色'} value={colors[key]} onChange={event => onChange({
          ...editor, palette: 'custom', colors: { ...colors, [key]: event.target.value },
        })} />
      </label>)}
    </div>
  </section>;
}

async function prepareImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error('请选择 12 MB 以内的 JPG、PNG 或 WebP 图片');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const preview = document.createElement('canvas');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    preview.width = Math.max(1, Math.round(bitmap.width * scale));
    preview.height = Math.max(1, Math.round(bitmap.height * scale));
    preview.getContext('2d').drawImage(bitmap, 0, 0, preview.width, preview.height);
    return preview;
  } finally { bitmap.close(); }
}

async function compressWallpaper(source, crop) {
  const x = Math.floor(source.width * crop.left / 100);
  const y = Math.floor(source.height * crop.top / 100);
  const width = Math.max(1, Math.round(source.width * (100 - crop.left - crop.right) / 100));
  const height = Math.max(1, Math.round(source.height * (100 - crop.top - crop.bottom) / 100));
  const canvas = document.createElement('canvas');
  let scale = Math.min(1, 1920 / Math.max(width, height));
  for (let attempt = 0; attempt < 7; attempt++) {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .78));
    if (!blob || blob.type !== 'image/webp') throw new Error('无法编码背景图');
    if (blob.size <= 337000) return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取编辑后的背景图'));
      reader.readAsDataURL(blob);
    });
    scale *= .76;
  }
  throw new Error('图片压缩后仍然过大');
}

export function WallpaperSettings({ value, onChange }) {
  const input = useRef(null);
  const [busy, run] = useAction();
  const [draft, setDraft] = useState(null);
  function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) run(async () => setDraft(await prepareImage(file)));
  }
  function edit() {
    run(async () => setDraft(await prepareImage(await (await fetch(value.image)).blob())));
  }
  function apply(source, crop) {
    run(async () => {
      const image = await compressWallpaper(source, crop);
      onChange({ area: 'both', layout: 'continuous', opacity: 22, ...value, image });
      setDraft(null);
    });
  }
  return <section className="settings-section">
    <h3>工作区背景图</h3>
    <div className="wallpaper-actions">
      <Button icon={<ImagePlus size={16} />} loading={busy && !draft} disabled={!!draft}
        onClick={() => input.current.click()}>
        {value ? '更换图片' : '上传图片'}
      </Button>
      {value && <Button icon={<Pencil size={15} />} disabled={busy || !!draft} onClick={edit}>编辑图片</Button>}
      {value && <Button status="danger" icon={<Trash2 size={15} />}
        disabled={busy || !!draft} onClick={() => onChange(null)}>移除图片</Button>}
    </div>
    <input type="file" accept="image/png,image/jpeg,image/webp" ref={input} hidden onChange={upload} />
    {draft && <ImageEditor image={draft} busy={busy}
      onApply={apply} onCancel={() => setDraft(null)} />}
    {value && <>
      <div className="form-grid">
        <Field label="应用区域"><select disabled={busy} value={value.area} onChange={event => onChange({ ...value, area: event.target.value })}>
          <option value="sidebar">仅左侧项目导航</option><option value="workspace">仅中间工作区</option><option value="both">两边同时</option>
        </select></Field>
        {value.area === 'both' && <Field label="图片布局"><select disabled={busy} value={value.layout} onChange={event => onChange({ ...value, layout: event.target.value })}>
          <option value="continuous">一张图跨两区连续显示</option><option value="separate">两区各自显示同一张图</option>
        </select></Field>}
      </div>
      <label className="wallpaper-opacity">图片强度 {value.opacity}% <input type="range" min="5" max="40" value={value.opacity}
        disabled={busy} onChange={event => onChange({ ...value, opacity: Number(event.target.value) })} /></label>
      <div className={`wallpaper-sample wallpaper-sample-${value.area} wallpaper-sample-${value.layout}`}
        aria-label="背景图预览" style={{ '--wallpaper-image': `url("${value.image}")`, '--wallpaper-opacity': `${value.opacity}%` }}>
        <span>左侧导航</span><span>中间工作区</span>
      </div>
    </>}
  </section>;
}
