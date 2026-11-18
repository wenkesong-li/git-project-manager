'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// GitHub passes unset secrets as empty strings; electron-builder treats an
// empty CSC_LINK as the current directory instead of an absent certificate.
for (const name of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']) {
  if (typeof process.env[name] === 'string' && !process.env[name].trim()) delete process.env[name];
}
const root = path.resolve(__dirname, '..'), stage = path.join(root, '.desktop-build');
const pkg = require('../package.json');
const version = (process.env.GITHUB_REF_NAME || '').replace(/^v/, '');
if (process.env.GITHUB_REF_TYPE === 'tag' && version !== pkg.version) throw new Error('版本标签必须与 package.json version 一致');
if (fs.existsSync(stage)) {
  if (path.dirname(path.resolve(stage)) !== root || path.basename(stage) !== '.desktop-build') throw new Error('构建目录无效');
  fs.rmSync(stage, { recursive: true, force: true });
}
fs.mkdirSync(stage);
for (const name of ['desktop', 'server', 'public', 'third-party']) fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
fs.copyFileSync(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
fs.copyFileSync(path.join(root,'DISCLAIMER.md'),path.join(stage,'DISCLAIMER.txt'));
const repository = process.env.GITPM_RELEASE_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('发行仓库格式应为 owner/repo');
fs.writeFileSync(path.join(stage, 'release.json'), JSON.stringify({ repository, version: pkg.version }));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ ...pkg, main: 'desktop/main.cjs', scripts: {}, devDependencies: {}, optionalDependencies: {} }, null, 2));
fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(stage, 'package-lock.json'));
function run(command, args, cwd) { const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: false }); if (result.error) throw result.error; if (result.status !== 0) process.exit(result.status || 1); }
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('请通过 npm run desktop:build 执行打包');
run(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
run(process.execPath, [path.join(root, 'node_modules/electron-builder/out/cli/cli.js'), '--projectDir', stage, '--config', path.join(root, 'electron-builder.cjs'), ...process.argv.slice(2)], root);
const dist = path.join(root, 'dist');
const assets = fs.readdirSync(dist).filter(name => name.startsWith(`GitProjectManager-${pkg.version}-`) && /^GitProjectManager-[\w.+-]+\.(exe|dmg|zip)$/.test(name)).map(name => { const stat = fs.statSync(path.join(dist, name)); return { name, size: stat.size, mtimeMs: stat.mtimeMs }; });
fs.writeFileSync(path.join(dist, 'client-release.json'), JSON.stringify({ version: pkg.version, assets }));
