import React from 'react';

const files = {
  java: ['J', 'warm'], kt: ['KT', 'violet'], scala: ['SC', 'warm'],
  js: ['JS', 'gold'], jsx: ['JS', 'gold'], mjs: ['JS', 'gold'], cjs: ['JS', 'gold'],
  ts: ['TS', 'blue'], tsx: ['TS', 'blue'], mts: ['TS', 'blue'], cts: ['TS', 'blue'],
  py: ['PY', 'blue'], rs: ['RS', 'warm'], go: ['GO', 'teal'], c: ['C', 'blue'],
  cpp: ['C+', 'violet'], h: ['H', 'violet'], cs: ['C#', 'violet'], php: ['PHP', 'violet'],
  rb: ['RB', 'warm'], swift: ['SW', 'warm'], sh: ['SH', 'green'], ps1: ['PS', 'blue'],
  bat: ['BAT', 'green'], cmd: ['CMD', 'green'], html: ['HT', 'warm'], css: ['CS', 'violet'],
  scss: ['SC', 'violet'], less: ['LS', 'violet'], vue: ['V', 'green'], svelte: ['SV', 'warm'],
  json: ['{}', 'gold'], jsonc: ['{}', 'gold'], json5: ['{}', 'gold'], xml: ['<>', 'warm'],
  yaml: ['Y', 'violet'], yml: ['Y', 'violet'], toml: ['T', 'violet'], properties: ['CFG', 'violet'],
  ini: ['CFG', 'violet'], env: ['ENV', 'gold'], sql: ['DB', 'teal'], db: ['DB', 'teal'],
  sqlite: ['DB', 'teal'], md: ['MD', 'blue'], mdx: ['MD', 'blue'], txt: ['TXT', 'neutral'],
  pdf: ['PDF', 'warm'], png: ['IMG', 'teal'], jpg: ['IMG', 'teal'], jpeg: ['IMG', 'teal'],
  gif: ['IMG', 'teal'], webp: ['IMG', 'teal'], avif: ['IMG', 'teal'], svg: ['SVG', 'teal'],
  ico: ['IMG', 'teal'], zip: ['ZIP', 'gold'], jar: ['JAR', 'warm'], gz: ['ARC', 'gold'],
  tar: ['ARC', 'gold'], class: ['BIN', 'neutral'], exe: ['BIN', 'neutral'],
};
const names = {
  'pom.xml': ['MVN', 'warm'], 'package.json': ['NPM', 'green'], 'package-lock.json': ['LCK', 'gold'],
  'pnpm-lock.yaml': ['LCK', 'gold'], 'yarn.lock': ['LCK', 'gold'], dockerfile: ['CTR', 'blue'],
  makefile: ['MK', 'warm'], '.gitignore': ['GIT', 'warm'], '.gitattributes': ['GIT', 'warm'],
  'tsconfig.json': ['TS', 'blue'], 'license': ['LIC', 'gold'],
};
const folders = {
  src: ['S', 'blue'], source: ['S', 'blue'], java: ['J', 'warm'], main: ['S', 'blue'],
  test: ['T', 'green'], tests: ['T', 'green'], __tests__: ['T', 'green'],
  target: ['B', 'warm'], build: ['B', 'warm'], dist: ['B', 'warm'], out: ['B', 'warm'],
  node_modules: ['D', 'neutral'], vendor: ['D', 'neutral'], lib: ['L', 'teal'],
  config: ['C', 'violet'], '.github': ['C', 'violet'], '.mvn': ['M', 'warm'],
  resources: ['R', 'teal'], public: ['R', 'teal'], assets: ['A', 'teal'], images: ['A', 'teal'],
  docs: ['P', 'blue'], scripts: ['>', 'green'], generated: ['G', 'gold'],
};

export default function TreeIcon({ name, directory = false, open = false, link = false }) {
  const lower = name.toLowerCase();
  const extension = lower.includes('.') ? lower.split('.').pop() : '';
  const lookup = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
  const [mark, tone] = directory
    ? lookup(folders, lower) || ['', 'neutral']
    : lookup(names, lower) || (lower.startsWith('.env.') && files.env) || lookup(files, extension) || ['', 'neutral'];
  return (
    <svg className={`tree-type-icon tree-tone-${tone}`} viewBox="0 0 24 20" aria-hidden="true">
      {directory ? (
        <path d={open ? 'M2 6V3h7l3 3h10l-3 11H2z' : 'M2 3h7l3 3h10v11H2z'}
          fill="currentColor" fillOpacity=".2" stroke="currentColor" />
      ) : (
        <path d="M4 1h11l5 5v13H4z M15 1v5h5" fill="currentColor" fillOpacity=".13" stroke="currentColor" />
      )}
      {mark && <text x="12" y={directory ? 14 : 15} textAnchor="middle" fill="currentColor"
        fontFamily="sans-serif" fontWeight="800" fontSize={mark.length > 2 ? 5 : 7}>{mark}</text>}
      {link && <path d="M16 18l5-5m-4 0h4v4" stroke="currentColor" fill="none" />}
    </svg>
  );
}
