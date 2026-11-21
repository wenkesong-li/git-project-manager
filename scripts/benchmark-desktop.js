'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');

function size(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((bytes, entry) => {
    const target = path.join(directory, entry.name);
    return bytes + (entry.isDirectory() ? size(target) : entry.isFile() ? fs.statSync(target).size : 0);
  }, 0);
}

async function measure(executable, profile) {
  const marker = path.join(profile, 'ready.json');
  const start = performance.now();
  const child = spawn(executable, [], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, GITPM_DESKTOP_SMOKE: '1', GITPM_SMOKE_DATA: profile, GITPM_SMOKE_MARKER: marker, GITPM_SMOKE_PROJECT: '' },
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  try {
    for (;;) {
      if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).ready) break;
      if (child.exitCode !== null || performance.now() - start > 30000) throw new Error('客户端未报告就绪');
      await delay(20);
    }
    const readyMs = Math.round(performance.now() - start);
    if (await exit !== 0) throw new Error('客户端退出异常');
    const database = path.join(profile, 'data.db');
    return { readyMs, profileBytes: size(profile) - fs.statSync(marker).size, databaseBytes: fs.existsSync(database) ? fs.statSync(database).size : 0 };
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function main() {
  const executable = path.resolve(process.argv[2] || 'dist/win-unpacked/Git Project Manager.exe');
  const installer = path.resolve(process.argv[3] || `dist/GitProjectManager-${require('../package.json').version}-win-x64.exe`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-bench-'));
  try {
    const samples = [];
    for (let i = 0; i < 6; i++) samples.push(await measure(executable, path.join(root, String(i))));
    const results = samples.slice(1);
    const median = key => results.map(sample => sample[key]).sort((a, b) => a - b)[2];
    console.log(JSON.stringify({
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model, memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
      readyMs: results.map(sample => sample.readyMs), readyMedianMs: median('readyMs'),
      installerBytes: fs.statSync(installer).size, applicationBytes: size(path.dirname(executable)),
      profileMedianBytes: median('profileBytes'), databaseMedianBytes: median('databaseBytes'),
    }, null, 2));
  } finally {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('gitpm-bench-')) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
