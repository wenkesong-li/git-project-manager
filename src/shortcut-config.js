import { defaults, sanitize } from '../server/keybindings';

export { defaults, sanitize };
export const labels = {
  save: '保存文件', format: '格式化代码', definition: '转到定义', references: '查找引用',
  find: '文件内查找与替换', gotoLine: '跳转行号', fold: '折叠代码', unfold: '展开代码',
  completion: '触发代码补全', toggleCase: '切换字母大小写', undo: '撤销', redo: '重做',
  comment: '切换行注释', projectSearch: '搜索项目', toggleTree: '展开或收起文件树',
};
export const ideaPreset = {
  format: ['Ctrl-Alt-l', 'Ctrl-Shift-f', 'Alt-Shift-f'],
  completion: ['Alt-/'],
  toggleCase: ['Ctrl-Shift-u', 'Ctrl-Shift-x'],
  redo: [],
};
const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const modifiers = ['Mod', 'Ctrl', 'Cmd', 'Alt', 'Shift'];

export function eventKey(event) {
  const key = event.code === 'Space' ? 'Space' : event.key.toLowerCase().length === 1 ? event.key.toLowerCase() : event.key;
  const physical = {
    Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Backquote: '`',
  };
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1]?.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  return [event.ctrlKey && 'Ctrl', event.metaKey && 'Cmd', event.altKey && 'Alt', event.shiftKey && 'Shift',
    letter || digit || physical[event.code] || key].filter(Boolean).join('-');
}
function platformKey(key) {
  const parts = key.replace(/^Mod-/, mac() ? 'Cmd-' : 'Ctrl-').match(/^(?:(?:Ctrl|Cmd|Alt|Shift)-)*/)[0];
  return [...new Set(parts.split('-').filter(Boolean))].sort().join('-') + '|' + key.replace(/^Mod-/, mac() ? 'Cmd-' : 'Ctrl-').slice(parts.length);
}
export const shortcutMatches = (event, action, overrides) =>
  (overrides?.[action] ?? defaults[action]).some(key => platformKey(key) === platformKey(eventKey(event)));
export function conflicts(bindings) {
  const seen = new Map();
  for (const [action, keys] of Object.entries({ ...defaults, ...bindings })) {
    for (const key of keys) {
      const normalized = platformKey(key);
      const previous = seen.get(normalized);
      if (previous && previous !== action) return `${key} 同时分配给「${labels[previous]}」和「${labels[action]}」`;
      seen.set(normalized, action);
    }
  }
  return '';
}
export function displayKey(key) {
  return key.replace(/^(?:(?:Mod|Ctrl|Cmd|Alt|Shift)-)*/, prefix => prefix.replaceAll('Mod-', mac() ? '⌘+' : 'Ctrl+').replaceAll('-', '+'));
}

const ideaActions = {
  SaveAll: 'save', ReformatCode: 'format', GotoDeclaration: 'definition', FindUsages: 'references',
  Find: 'find', Replace: 'find', GotoLine: 'gotoLine', CollapseAllRegions: 'fold', ExpandAllRegions: 'unfold',
  CodeCompletion: 'completion', ClassNameCompletion: 'completion', EditorToggleCase: 'toggleCase',
  $Undo: 'undo', $Redo: 'redo', CommentByLineComment: 'comment', ActivateProjectToolWindow: 'toggleTree',
};
const javaKeys = {
  slash: '/', back_slash: '\\', space: 'Space', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  minus: '-', equals: '=', comma: ',', period: '.', semicolon: ';', quote: "'", open_bracket: '[', close_bracket: ']',
  enter: 'Enter', escape: 'Escape', tab: 'Tab', back_space: 'Backspace', delete: 'Delete',
  home: 'Home', end: 'End', page_up: 'PageUp', page_down: 'PageDown',
};
export function ideaBinding(text) {
  const words = text.toLowerCase().trim().split(/\s+/).filter(word => word !== 'pressed');
  const raw = words.pop();
  if (!raw) return '';
  const mods = words.map(word => ({ control: 'Ctrl', ctrl: 'Ctrl', meta: 'Cmd', alt: 'Alt', shift: 'Shift' })[word]);
  if (mods.some(mod => !mod)) return '';
  const key = javaKeys[raw] || (/^f\d+$/.test(raw) ? raw.toUpperCase() : raw);
  return [...new Set(mods)].sort((a, b) => modifiers.indexOf(a) - modifiers.indexOf(b)).concat(key).join('-');
}
export function parseIdeaKeymap(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('不支持包含 DTD 的快捷键配置');
  const xml = new DOMParser().parseFromString(source, 'text/xml');
  if (xml.documentElement.localName !== 'keymap' || xml.querySelector('parsererror')) throw new Error('无效的 IDEA 快捷键 XML');
  const bindings = {};
  let skipped = 0;
  for (const action of xml.querySelectorAll('keymap > action')) {
    const actionId = action.getAttribute('id');
    const id = Object.hasOwn(ideaActions, actionId) ? ideaActions[actionId] : null;
    const shortcuts = [...action.querySelectorAll('keyboard-shortcut')];
    if (!id) { skipped += shortcuts.length; continue; }
    if (!shortcuts.length && !action.children.length) { bindings[id] ??= []; continue; }
    for (const shortcut of shortcuts) {
      const key = ideaBinding(shortcut.getAttribute('first-keystroke') || '');
      if (shortcut.hasAttribute('second-keystroke') || !sanitize({ [id]: [key] })[id]?.length) { skipped++; continue; }
      (bindings[id] ||= []).push(key);
    }
  }
  return { name: xml.documentElement.getAttribute('name') || 'IDEA 快捷键', bindings: sanitize(bindings), skipped };
}
