'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function desktopPreferences(directory) {
  const file = path.join(directory, 'desktop-preferences.json');
  let values = { autoCheckUpdates: true, rememberWindow: true, openAtLogin: false };
  try { values = { ...values, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  return { get: () => ({ ...values }), set(patch) { const next = { ...values }; for (const key of ['autoCheckUpdates','rememberWindow','openAtLogin']) if (typeof patch[key] === 'boolean') next[key] = patch[key]; if (patch.bounds && ['width','height','x','y'].every(key => Number.isFinite(patch.bounds[key]))) next.bounds = patch.bounds; fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(next)); fs.renameSync(file + '.tmp', file); values = next; return { ...values }; } };
};
