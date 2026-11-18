'use strict';
module.exports = {
  appId: 'dev.gitpm.desktop', productName: 'Git Project Manager',
  electronVersion: require('./package.json').devDependencies.electron.replace(/^[~^]/, ''),
  electronDist: process.env.GITPM_ELECTRON_DIST || undefined,
  directories: { output: '../dist' },
  files: ['desktop/**', 'server/**', 'public/**', 'third-party/**', 'LICENSE', 'DISCLAIMER.txt', 'release.json', 'package.json', 'node_modules/**', '!**/*.md', '!**/test/**', '!**/tests/**', '!**/.env*', '!**/*.db*', '!**/secret.key'],
  asar: true,
  asarUnpack: ['**/*.node', '**/node_modules/@vscode/ripgrep*/**', '**/node_modules/@vscode/ripgrep-*/**'],
  npmRebuild: false,
  artifactName: 'GitProjectManager-${version}-${os}-${arch}.${ext}',
  win: { target: ['nsis'] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, createDesktopShortcut: true },
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.developer-tools' },
  publish: process.env.GITPM_RELEASE_REPOSITORY ? [{ provider: 'github', owner: process.env.GITPM_RELEASE_REPOSITORY.split('/')[0], repo: process.env.GITPM_RELEASE_REPOSITORY.split('/')[1], releaseType: 'release' }] : [{ provider: 'generic', url: 'https://example.invalid/gitpm-updates' }],
};
