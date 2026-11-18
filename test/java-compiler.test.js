'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('JDK semantic navigation distinguishes overloaded methods and unrelated names across files', { skip: process.env.GITPM_TEST_JAVA !== '1', timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-java-symbols-')), repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('gitpm-java-symbols-')); fs.rmSync(root, { recursive: true, force: true }); });
  const helper = 'class Helper { static int parse(int value) { return value; } static String parse(String value) { return value; } }';
  const main = 'class Main { int value = Helper.parse(1); String text = Helper.parse("x"); }';
  fs.writeFileSync(path.join(repo, 'Helper.java'), helper); fs.writeFileSync(path.join(repo, 'Main.java'), main); fs.writeFileSync(path.join(repo, 'Other.java'), 'class Other { int parse(int value) { return value; } }');
  const query = require('../server/java-compiler'), runtime = { java: 'java' }, project = { id: 1, local_path: repo };
  const definition = await query(root, runtime, project, { path: 'Main.java', line: 1, column: main.indexOf('parse') + 1, action: 'definition' });
  assert.equal(definition.items.length, 1); assert.equal(definition.items[0].path, 'Helper.java'); assert.equal(definition.items[0].range.start.character, helper.indexOf('parse'));
  const references = await query(root, runtime, project, { path: 'Helper.java', line: 1, column: helper.indexOf('parse') + 1, action: 'references' });
  assert.equal(references.items.length, 2); assert.ok(!references.items.some(item => item.path === 'Other.java')); assert.ok(references.items.some(item => item.path === 'Main.java' && item.range.start.character === main.indexOf('parse')));
});
