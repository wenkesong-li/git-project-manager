'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const search = require('../server/workspace-search');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-search-'));
  for (const dir of ['src', 'node_modules', '.git']) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'src', 'Demo.ts'), 'const 中文 = "Hello";\nexport function add(a, b) { return a + b; }\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'Demo.ts'), 'Hello dependency');
  fs.writeFileSync(path.join(root, '.git', 'private.txt'), 'Hello metadata');
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 1, 2]));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('gitpm-search-')); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('workspace search supports name, path, content, regex and case modes with Unicode columns', async t => {
  const root = fixture(t);
  assert.deepEqual((await search.search(root, { q: 'demo', mode: 'name' })).items.map(x => x.path), ['src/Demo.ts']);
  assert.equal((await search.search(root, { q: 'src/Demo', mode: 'name' })).items.length, 0);
  assert.equal((await search.search(root, { q: 'src/Demo', mode: 'path' })).items.length, 1);
  assert.equal((await search.search(root, { q: 'demo', mode: 'name', case: 'true' })).items.length, 0);
  const result = await search.search(root, { q: 'H[a-z]+', mode: 'content', regex: 'true' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].line, 1);
  assert.equal(result.items[0].column, 13);
  assert.equal(result.items[0].endColumn, 18);
  assert.equal((await search.search(root, { q: 'Hello', mode: 'content', skipGenerated: 'false' })).items.length, 2);
  await assert.rejects(search.search(root, { q: '[invalid', mode: 'content', regex: 'true' }), /正则/);
  await assert.rejects(search.search(root, { q: '(?<=x)y', mode: 'name', regex: 'true' }), /正则/);
});
test('search limits results, supports cancellation and creates bounded script workspace', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'many.txt'), Array(400).fill('match').join('\n'));
  const result = await search.search(root, { q: 'match', mode: 'content' });
  assert.equal(result.items.length, 300);
  assert.equal(result.truncated, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(search.search(root, { q: 'x' }, controller.signal), /取消/);
  assert.deepEqual((await search.scriptWorkspace(root)).items.map(x => x.path), ['src/Demo.ts']);
});
test('relative imports and local tsconfig aliases resolve without traversing outside the repository', t => {
  const root = fixture(t), resolve = require('../server/imports');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}');
  const result = resolve(root, 'src/Demo.ts', ['./Demo', '@/Demo', '../../../outside', 'https://example.invalid/file']);
  assert.deepEqual(result.items, [{ specifier: './Demo', path: 'src/Demo.ts' }, { specifier: '@/Demo', path: 'src/Demo.ts' }]);
});
