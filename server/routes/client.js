'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (add) => {
  const root = path.resolve(__dirname, '../..'), dist = path.join(root, 'dist');
  let config = {}; try { config = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8')); } catch {}
  const repository = process.env.GITPM_RELEASE_REPOSITORY || config.repository || '';
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repository);
  let cache, cachedAt = 0;
  const allowed = name => /^GitProjectManager-[\w.+-]+\.(exe|dmg|zip)$/.test(name);
  function local() {
    try { const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'client-release.json'), 'utf8')); return manifest.assets.filter(asset => { if (!allowed(asset.name)) return false; const stat = fs.statSync(path.join(dist, asset.name)); return stat.size === asset.size && stat.mtimeMs === asset.mtimeMs; }).map(asset => ({ name: asset.name, size: asset.size, url: `/api/client-download/${encodeURIComponent(asset.name)}` })); } catch { return []; }
  }
  add('GET', '/api/client-release', async () => {
    if (cache && Date.now() - cachedAt < 5 * 60 * 1000) return cache;
    let assets = local(), version = require('../../package.json').version, error = '';
    if (valid) {
      try {
        const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw new Error('暂无可用的已发布版本');
        const release = await response.json(); version = String(release.tag_name || version).replace(/^v/, '');
        assets = release.assets.filter(asset => allowed(asset.name) && asset.browser_download_url?.startsWith(`https://github.com/${repository}/releases/download/`)).map(asset => ({ name: asset.name, url: asset.browser_download_url, size: asset.size }));
      } catch (e) { error = e.message; }
    }
    cache = { version, assets, configured: valid, releaseUrl: valid ? `https://github.com/${repository}/releases` : '', error, local: !valid };
    cachedAt = Date.now(); return cache;
  });
  add('GET', '/api/client-download/:file', async ({ params, res }) => {
    if (!local().some(asset => asset.name === params.file)) throw new Error('安装包不存在或仍在构建');
    const file = path.join(dist, params.file); if (!fs.existsSync(file)) throw new Error('安装包不存在');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${params.file}"` });
    await new Promise((resolve, reject) => { const stream = fs.createReadStream(file); stream.on('error', reject); res.once('close', () => { stream.destroy(); resolve(); }); stream.on('end', resolve); stream.pipe(res); });
  });
};
