'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-editor-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const db = new (require('../server/sqlite'))(':memory:');
  const project = { id: 1, name: 'fixture', local_path: repo };
  const fileOps = require('../server/file-operations')(db, path.join(root, 'trash'));
  const routes = new Map();
  require('../server/routes/local')((method, url, handler) => routes.set(`${method} ${url}`, handler), { dbm: { getProject: () => project }, fileOps, bus: { log() {} } });
  t.after(() => {
    db.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('gitpm-editor-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { repo, fileOps, project, call: (method, endpoint, body = {}, query = {}) => routes.get(`${method} /api/local/:id/${endpoint}`)({ params: { id: 1 }, body, query: new URLSearchParams(query) }) };
}

test('search finds ignored nested filenames and excludes git metadata and external links', async t => {
  const { repo, call } = fixture(t);
  for (const dir of ['ignored', '.git']) fs.mkdirSync(path.join(repo, dir));
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored/');
  fs.writeFileSync(path.join(repo, 'ignored', 'Demo.java'), 'class Demo {}');
  fs.writeFileSync(path.join(repo, '.git', 'Demo.java'), 'metadata');
  const result = await call('GET', 'file-search', {}, { q: 'DEMO.JAVA' });
  assert.deepEqual(result.items.map(x => x.path), ['ignored/Demo.java']);
  assert.equal(result.truncated, false);
});

test('save prevents stale overwrites and records metadata without contents', async t => {
  const { repo, call } = fixture(t);
  const target = path.join(repo, 'data.json');
  fs.writeFileSync(target, '{"before":1}');
  const read = await call('GET', 'file', {}, { path: 'data.json' });
  fs.writeFileSync(target, '{"external":2}');
  await assert.rejects(call('PUT', 'file', { path: 'data.json', revision: read.revision, content: 'stale' }), /其他程序修改/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"external":2}');
  const fresh = await call('GET', 'file', {}, { path: 'data.json' });
  await call('PUT', 'file', { path: 'data.json', revision: fresh.revision, content: '{"changed":3}' });
  await call('POST', 'file-operation', { path: 'data.json', action: 'copy', scope: 'selection', content: 'not-recorded' });
  const log = await call('GET', 'file-operations');
  assert.deepEqual(log.items.map(x => x.action), ['copy', 'save']);
  assert.ok(!JSON.stringify(log).includes('not-recorded'));
  assert.ok(!JSON.stringify(log).includes('changed'));
});

test('delete and restore preserve bytes and never overwrite an existing file', async t => {
  const { repo, call } = fixture(t);
  const target = path.join(repo, 'sample.bin'), original = Buffer.from([0, 1, 2, 255]);
  fs.writeFileSync(target, original);
  const deleted = await call('POST', 'delete-file', { path: 'sample.bin' });
  assert.equal(fs.existsSync(target), false);
  assert.equal((await call('GET', 'file-operations')).items[0].canRestore, true);
  fs.writeFileSync(target, 'existing');
  await assert.rejects(call('POST', 'restore-file', { operationId: deleted.operationId }), /同名文件/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'existing');
  fs.unlinkSync(target);
  await call('POST', 'restore-file', { operationId: deleted.operationId });
  assert.deepEqual(fs.readFileSync(target), original);
  await assert.rejects(call('POST', 'restore-file', { operationId: deleted.operationId }), /已恢复/);
  await assert.rejects(call('POST', 'delete-file', { path: '../outside' }), /非法/);
});

test('JSON, Java and XML format buffers without writing disk; syntax errors leave files intact', async t => {
  const { repo, call } = fixture(t);
  for (const [file, input] of [['data.json', '{"value":1}'], ['Demo.java', 'class Demo{int value=1;}'], ['data.xml', '<root><item>1</item></root>']]) {
    fs.writeFileSync(path.join(repo, file), input);
    const result = await call('POST', 'format', { path: file, content: input });
    assert.ok(result.content.endsWith('\n'));
    assert.equal(fs.readFileSync(path.join(repo, file), 'utf8'), input);
    if (file.endsWith('.java')) assert.match(result.content, /    int value = 1;/);
  }
  await assert.rejects(call('POST', 'format', { path: 'data.json', content: '{ broken' }));
  assert.equal(fs.readFileSync(path.join(repo, 'data.json'), 'utf8'), '{"value":1}');
  assert.equal((await call('GET', 'file-operations')).items.length, 3);
});
