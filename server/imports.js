'use strict';
const fs = require('fs');
const path = require('path');
const { resolveEntry } = require('./files');
module.exports = function resolveImports(root, from, specifiers) {
  resolveEntry(root, from);
  const base = fs.realpathSync(root);
  let options = {};
  for (const config of ['tsconfig.json', 'jsconfig.json']) {
    try { const target = resolveEntry(base, config); if (fs.statSync(target).size < 1024 * 1024) options = require('jsonc-parser').parse(fs.readFileSync(target, 'utf8'))?.compilerOptions || {}; break; } catch {}
  }
  function locate(candidate) {
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
    for (const extension of extensions) {
      try { const relative = path.relative(base, path.resolve(base, candidate + extension)); const target = resolveEntry(base, relative); if (fs.statSync(target).isFile()) return relative.replace(/\\/g, '/'); } catch {}
    }
    return null;
  }
  const items = [];
  for (const raw of specifiers.slice(0, 200)) {
    const specifier = String(raw);
    if (specifier.length > 500 || /[\0\r\n]/.test(specifier)) continue;
    const candidates = [];
    if (specifier.startsWith('.')) candidates.push(path.join(path.dirname(from), specifier));
    else {
      for (const [pattern, targets] of Object.entries(options.paths || {})) {
        const star = pattern.indexOf('*'), prefix = star < 0 ? pattern : pattern.slice(0, star), suffix = star < 0 ? '' : pattern.slice(star + 1);
        if (star < 0 ? specifier !== pattern : !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
        const middle = star < 0 ? '' : specifier.slice(prefix.length, suffix ? -suffix.length : undefined);
        for (const target of Array.isArray(targets) ? targets : []) if (typeof target === 'string') candidates.push(path.join(String(options.baseUrl || '.'), target.replace('*', middle)));
      }
      if (specifier.startsWith('@/')) candidates.push(path.join('src', specifier.slice(2)));
      if (options.baseUrl) candidates.push(path.join(String(options.baseUrl), specifier));
    }
    const target = candidates.map(locate).find(Boolean);
    if (target) items.push({ specifier, path: target });
  }
  return { items };
};
