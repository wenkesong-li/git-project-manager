'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');
test('release workflow keeps diagnostic files private and builds all requested platforms', () => {
  const workflow = YAML.parse(fs.readFileSync(path.resolve(__dirname, '../.github/workflows/release.yml'), 'utf8'));
  assert.equal(workflow.jobs.build.strategy.matrix.include.length, 3);
  const upload = workflow.jobs.build.steps.find(step => step.uses?.startsWith('actions/upload-artifact'));
  assert.ok(upload.with.path.includes('dist/latest*.yml'));
  assert.ok(!upload.with.path.includes('dist/*.yml'));
  const builder = require('../electron-builder.cjs');
  assert.ok(builder.files.includes('!**/.env*'));
  assert.ok(builder.files.includes('!**/*.db*'));
});
test('update manifests preserve both Mac architectures instead of overwriting one', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-release-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('gitpm-release-')); fs.rmSync(root, { recursive: true, force: true }); });
  for (const arch of ['x64', 'arm64']) { const directory = path.join(root, arch); fs.mkdirSync(directory); fs.writeFileSync(path.join(directory, 'latest-mac.yml'), YAML.stringify({ version: '1.0.0', files: [{ url: `client-mac-${arch}.zip`, sha512: arch, size: 100 }] })); }
  execFileSync(process.execPath, [path.resolve(__dirname, '../scripts/merge-update-manifests.js'), root], { windowsHide: true });
  const merged = YAML.parse(fs.readFileSync(path.join(root, 'latest-mac.yml'), 'utf8'));
  assert.equal(merged.files.length, 2);
});
