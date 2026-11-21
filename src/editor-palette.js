import { sanitizePalette } from '../server/editor-palette';

export const palettes = {
  daylight: {
    background: '#ffffff', foreground: '#263248', keyword: '#7032ab', string: '#176c43',
    number: '#a44a10', comment: '#626e7e', type: '#155980', function: '#244aa5',
    property: '#8b3154', selection: '#dce8ff',
  },
  night: {
    background: '#1c2230', foreground: '#dbe2ee', keyword: '#d2a8ff', string: '#a6d89e',
    number: '#f6be83', comment: '#9ba8bc', type: '#81d2db', function: '#a2baff',
    property: '#f1a4ba', selection: '#3c5075',
  },
  gray: {
    background: '#ffffff', foreground: '#262626', keyword: '#262626', string: '#454545',
    number: '#454545', comment: '#626262', type: '#353535', function: '#353535',
    property: '#404040', selection: '#e0e0e0',
  },
};

export function editorColors(editor, dark = document.body.dataset.mode === 'dark') {
  const base = palettes[dark ? 'night' : 'daylight'];
  if (editor.palette === 'custom') return { ...base, ...sanitizePalette(editor.colors) };
  if (editor.palette === 'auto' || !editor.palette) return base;
  return palettes[editor.palette] || base;
}

const openIdeaTokens = {
  background: '--bg-editor', foreground: '--fg-editor', keyword: '--syn-keyword', string: '--syn-string',
  number: '--syn-number', comment: '--syn-comment', type: '--syn-type', function: '--syn-function',
  property: '--syn-property', selection: '--bg-selection',
};
const vsCodeColors = { background: 'editor.background', foreground: 'editor.foreground', selection: 'editor.selectionBackground' };
const ideaAttributes = {
  keyword: ['DEFAULT_KEYWORD'], string: ['DEFAULT_STRING'], number: ['DEFAULT_NUMBER'],
  comment: ['DEFAULT_LINE_COMMENT', 'DEFAULT_BLOCK_COMMENT'], type: ['DEFAULT_CLASS_NAME'],
  function: ['DEFAULT_FUNCTION_DECLARATION', 'DEFAULT_FUNCTION_CALL'],
  property: ['DEFAULT_INSTANCE_FIELD', 'DEFAULT_STATIC_FIELD'],
};

function xmlPalette(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不支持含 DTD 的颜色方案');
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.documentElement.localName !== 'scheme' || xml.querySelector('parsererror')) throw new Error('无效的 IntelliJ 颜色方案');
  const normalize = value => /^[0-9a-f]{6}$/i.test(value || '') ? '#' + value : value;
  const option = (parent, name) => Array.from(parent?.children || []).find(node => node.localName === 'option' && node.getAttribute('name') === name);
  const attributes = xml.documentElement.querySelector('attributes');
  const readAttribute = (name, field) => normalize(option(option(attributes, name)?.querySelector('value'), field)?.getAttribute('value'));
  const colors = {
    background: readAttribute('TEXT', 'BACKGROUND'),
    foreground: readAttribute('TEXT', 'FOREGROUND'),
    selection: normalize(option(xml.documentElement.querySelector('colors'), 'SELECTION_BACKGROUND')?.getAttribute('value')),
  };
  for (const [role, names] of Object.entries(ideaAttributes)) {
    colors[role] = names.map(name => readAttribute(name, 'FOREGROUND')).find(Boolean);
  }
  return colors;
}

export function importEditorPalette(text, filename) {
  let candidate;
  if (/\.(icls|xml)$/i.test(filename)) {
    candidate = xmlPalette(text);
  } else {
    const data = JSON.parse(text);
    if (data?.format === 'gitpm-editor-theme' && data.version === 1) candidate = data.colors;
    else if (data?.tokens) {
      candidate = Object.fromEntries(Object.entries(openIdeaTokens).map(([role, token]) => [role, data.tokens[token]]));
    } else if (data?.colors) {
      candidate = Object.fromEntries(Object.entries(vsCodeColors).map(([role, token]) => [role, data.colors[token]]));
      for (const { scope, settings } of Array.isArray(data.tokenColors) ? data.tokenColors : []) {
        const scopes = Array.isArray(scope) ? scope : String(scope || '').split(/\s*,\s*/);
        const prefixes = { keyword: 'keyword', string: 'string', number: 'constant.numeric', comment: 'comment', type: 'entity.name.type', function: 'entity.name.function', property: 'variable.other.property' };
        for (const [role, prefix] of Object.entries(prefixes)) {
          if (!candidate[role] && scopes.some(value => typeof value === 'string' && (value === prefix || value.startsWith(prefix + '.')))) {
            candidate[role] = settings?.foreground;
          }
        }
      }
    } else candidate = data;
  }
  const colors = sanitizePalette(candidate);
  if (!Object.keys(colors).length) throw new Error('没有找到可用的编辑器颜色');
  return colors;
}
