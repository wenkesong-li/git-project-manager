import React, { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { Button } from './ui-kit';

const fullImage = { top: 0, right: 0, bottom: 0, left: 0 };
const edges = [
  ['top', 'bottom', '上'], ['bottom', 'top', '下'],
  ['left', 'right', '左'], ['right', 'left', '右'],
];

export function ImageEditor({ image, onApply, onCancel, busy }) {
  const preview = useRef(null);
  const [rotation, setRotation] = useState(0);
  const [crop, setCrop] = useState(fullImage);

  useEffect(() => {
    const canvas = preview.current;
    const turned = rotation % 180 !== 0;
    canvas.width = turned ? image.height : image.width;
    canvas.height = turned ? image.width : image.height;
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
  }, [image, rotation]);

  function rotate(delta) {
    setRotation(value => (value + delta + 360) % 360);
    setCrop(({ top, right, bottom, left }) => delta > 0
      ? { top: left, right: top, bottom: right, left: bottom }
      : { top: right, right: bottom, bottom: left, left: top });
  }

  return <section className="image-editor" aria-label="背景图编辑">
    <div className="image-editor-preview">
      <div className="image-editor-frame">
        <canvas ref={preview} role="img" aria-label="所选图片与裁剪范围" />
        <div className="image-editor-crop" aria-hidden="true"
          style={{ inset: `${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%` }} />
      </div>
    </div>
    <div className="image-editor-controls">
      <div className="button-group">
        <Button disabled={busy} icon={<RotateCcw size={15} />} onClick={() => rotate(-90)}>向左旋转</Button>
        <Button disabled={busy} icon={<RotateCw size={15} />} onClick={() => rotate(90)}>向右旋转</Button>
        <Button disabled={busy || (rotation === 0 && Object.values(crop).every(value => value === 0))}
          icon={<Undo2 size={15} />} onClick={() => { setRotation(0); setCrop(fullImage); }}>重置</Button>
      </div>
      <fieldset className="image-editor-edges" disabled={busy}>
        <legend>裁剪边缘</legend>
        {edges.map(([edge, opposite, label]) => <label key={edge}>
          <span>{label} {crop[edge]}%</span>
          <input type="range" aria-label={label + '边裁剪'} min="0" max={95 - crop[opposite]} value={crop[edge]}
            onChange={event => setCrop({ ...crop, [edge]: Number(event.target.value) })} />
        </label>)}
      </fieldset>
      <div className="button-group image-editor-footer">
        <Button disabled={busy} onClick={onCancel}>取消</Button>
        <Button type="primary" icon={<Check size={15} />} loading={busy}
          onClick={() => onApply(preview.current, crop)}>应用背景</Button>
      </div>
    </div>
  </section>;
}
