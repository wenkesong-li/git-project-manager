'use strict';

const defaults = {
  save: ['Mod-s'], format: ['Mod-Alt-l'], definition: ['F12', 'Mod-b'],
  references: ['Shift-F12'], find: ['Mod-f'], gotoLine: ['Mod-g'],
  fold: ['Mod-Shift-/'], unfold: ['Mod-Alt-/'], completion: ['Ctrl-Space'],
  toggleCase: [], undo: ['Mod-z'], redo: ['Mod-Shift-z', 'Mod-y'],
  comment: ['Mod-/'], projectSearch: ['Mod-k'], toggleTree: ['Alt-1'],
};

const keyPattern = /^(?:(?:Mod|Ctrl|Cmd|Alt|Shift)-){0,5}(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Left|Right|Up|Down)|Space|Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|[\/\\.,;=\x60\[\]'-])$/;
function sanitize(input) {
  const bindings = {};
  for (const action of Object.keys(defaults)) {
    if (!Array.isArray(input?.[action])) continue;
    bindings[action] = [...new Set(input[action].filter(key =>
      typeof key === 'string' && key.length <= 32 && keyPattern.test(key) &&
      (key.includes('-') && key !== '-' || /^F\d+$/.test(key))
    ))].slice(0, 5);
  }
  return bindings;
}
module.exports = { defaults, sanitize };
