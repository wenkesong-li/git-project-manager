'use strict';

const colorKeys = [
  'background', 'foreground', 'keyword', 'string', 'number', 'comment',
  'type', 'function', 'property', 'selection',
];

function sanitizePalette(value) {
  const colors = {};
  for (const key of colorKeys) {
    const color = value?.[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) colors[key] = color.toLowerCase();
  }
  return colors;
}

module.exports = { colorKeys, sanitizePalette };
