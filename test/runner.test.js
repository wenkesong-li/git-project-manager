'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-run-')), repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  const settings = new Map(), project = { id: 1, local_path: repo }, runner = require('../server/runner')({ getSetting: (key, fallback) => settings.get(key) || fallback, setSetting: (key, value) => settings.set(key, value) }, root);
  runner.saveEnvironment({ nodePath: process.execPath });
  t.after(() => { runner.close(); assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('gitpm-run-')); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, repo, project, runner };
}
async function finish(runner, project) {
  const start = Date.now();
  while (runner.status(project).state === 'running') { if (Date.now() - start > 15000) throw new Error('runner timed out'); await new Promise(resolve => setTimeout(resolve, 50)); }
  return runner.status(project);
}
test('configured Node runs a local file, records output and handles exit failures', async t => {
  const { repo, runner, project } = fixture(t);
  fs.writeFileSync(path.join(repo, 'main.js'), 'console.log("fixture success");');
  runner.start(project, { action: 'node', path: 'main.js' });
  let result = await finish(runner, project); assert.equal(result.state, 'success'); assert.match(result.output, /fixture success/);
  fs.writeFileSync(path.join(repo, 'main.js'), 'process.exit(7)');
  runner.start(project, { action: 'node', path: 'main.js' });
  result = await finish(runner, project); assert.equal(result.state, 'failed'); assert.equal(result.exitCode, 7);
  assert.throws(() => runner.start(project, { action: 'node', path: '../outside.js' }), /非法/);
});
test('runner preserves Chinese text split across stdout and stderr chunks', async t => {
  const { repo, runner, project } = fixture(t);
  fs.writeFileSync(path.join(repo, 'log.js'), `
    const out = Buffer.from('编译完成'), err = Buffer.from('找不到符号');
    process.stdout.write(out.subarray(0, 1));
    process.stderr.write(err.subarray(0, 2));
    setTimeout(() => {
      process.stdout.write(out.subarray(1));
      process.stderr.write(err.subarray(2));
    }, 100);
  `);
  runner.start(project, { action: 'node', path: 'log.js' });
  const result = await finish(runner, project);
  assert.equal(result.state, 'success');
  assert.match(result.output, /编译完成/);
  assert.match(result.output, /找不到符号/);
  assert.doesNotMatch(result.output, /�/);
});
test('runner rejects concurrent tasks and can stop a running process', async t => {
  const { repo, runner, project } = fixture(t);
  fs.writeFileSync(path.join(repo, 'wait.js'), 'setInterval(()=>{},1000)');
  runner.start(project, { action: 'node', path: 'wait.js' });
  assert.throws(() => runner.start(project, { action: 'node', path: 'wait.js' }), /已有运行/);
  runner.stop(project); assert.equal((await finish(runner, project)).state, 'stopped');
});
test('npm scripts run through the configured Node executable without shell argument interpolation', async t => {
  const { repo, runner, project } = fixture(t);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { check: 'node check.js' } }));
  fs.writeFileSync(path.join(repo, 'check.js'), 'console.log("npm fixture success")');
  assert.deepEqual(runner.metadata(project).scripts, ['check']);
  runner.start(project, { action: 'npm', script: 'check' });
  const result = await finish(runner, project); assert.equal(result.state, 'success', result.output); assert.match(result.output, /npm fixture success/);
});
test('environment paths are local, validated and saved independently of source files', t => {
  const { runner } = fixture(t);
  assert.equal(runner.readEnvironment().nodePath, process.execPath);
  assert.throws(() => runner.saveEnvironment({ javaHome: '../invalid' }), /绝对路径/);
  assert.throws(() => runner.start({ id: 3, local_path: os.tmpdir() }, { action: 'maven', goal: 'arbitrary-command' }), /无效/);
});

test('project actions detect Maven plugins and Node scripts without executing arbitrary Maven goals', t=>{
  const {runner,repo,project}=fixture(t);
  fs.writeFileSync(path.join(repo,'pom.xml'),'<project><!-- <artifactId>exec-maven-plugin</artifactId> --><build><plugins><plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin></plugins></build></project>');
  let meta=runner.metadata(project);assert.equal(meta.type,'Maven');assert.deepEqual(meta.quickBuild,{action:'maven',goal:'compile'});assert.deepEqual(meta.quickRun,{action:'maven',goal:'spring-boot:run'});
  assert.throws(()=>runner.start(project,{action:'maven',goal:'exec:java'}),/无效/);
  fs.writeFileSync(path.join(repo,'pom.xml'),'<project/>');assert.equal(runner.metadata(project).quickRun,null);
  fs.unlinkSync(path.join(repo,'pom.xml'));fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({scripts:{build:'node build.js',start:'node main.js',dev:'node dev.js'}}));
  meta=runner.metadata(project);assert.equal(meta.type,'Node.js');assert.deepEqual(meta.quickRun,{action:'npm',script:'dev'});assert.deepEqual(meta.quickBuild,{action:'npm',script:'build'});
});
test('Windows Maven launch handles spaces in paths and command files', { skip: process.platform !== 'win32' }, async t => {
  const { root, repo, runner, project } = fixture(t), home = path.join(root, 'Maven SDK');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', 'mvn.cmd'), '@echo off\r\necho maven-fixture-ok %*\r\n');
  fs.writeFileSync(path.join(repo, 'pom.xml'), '<project/>');
  runner.saveEnvironment({ mavenHome: home });
  runner.start(project, { action: 'maven', goal: 'compile' });
  const result = await finish(runner, project); assert.equal(result.state, 'success', result.output); assert.match(result.output, /maven-fixture-ok --batch-mode compile/);
});
test('Java single-file compilation and execution use the configured JDK', { skip: process.env.GITPM_TEST_JAVA !== '1' }, async t => {
  const { repo, runner, project } = fixture(t);
  fs.writeFileSync(path.join(repo, 'Hello.java'), 'public class Hello { public static void main(String[] args) { System.out.println("java fixture success"); } }');
  runner.start(project, { action: 'java-run', path: 'Hello.java' });
  const result = await finish(runner, project); assert.equal(result.state, 'success', result.output); assert.match(result.output, /java fixture success/);
});
