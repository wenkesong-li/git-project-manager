'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const VERSION = '1.63.0';
const ARCHIVE = 'jdt-language-server-1.63.0-202610191322.tar.gz';
const SHA256 = 'b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4';
const ARCHIVE_SIZE = 51143565;
async function downloadArchive(url, destination) {
  const handle = await fs.promises.open(destination, 'w'); await handle.truncate(ARCHIVE_SIZE); await handle.close();
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 600000);
  const partSize = Math.ceil(ARCHIVE_SIZE / 8);
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, async (_, part) => {
      const start = part * partSize, end = Math.min(ARCHIVE_SIZE - 1, start + partSize - 1);
      try {
        const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${ARCHIVE_SIZE}`) throw new Error('Java 服务下载响应异常，请稍后重试');
        let received = 0;
        const { Transform } = require('stream');
        await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, callback) { received += chunk.length; callback(received > end - start + 1 ? new Error('下载数据超出预期') : null, chunk); } }), fs.createWriteStream(destination, { flags: 'r+', start }));
        if (received !== end - start + 1) throw new Error('Java 服务下载不完整');
      } catch (error) { controller.abort(); throw error; }
    }));
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason;
  } finally { clearTimeout(timeout); }
}

module.exports = function javaRuntime(dataDir, getEnvironment = () => ({})) {
  const home = process.env.GITPM_JDTLS_HOME || path.join(dataDir, 'language-servers', `jdtls-${VERSION}`);
  let installing = null;
  function javaCommand() { const home = getEnvironment().javaHome || process.env.JAVA_HOME; return home ? path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'; }
  function installed() { return fs.existsSync(path.join(home, 'plugins')) && fs.readdirSync(path.join(home, 'plugins')).some(n => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(n)); }
  function checkJava() {
    return new Promise((resolve, reject) => {
      const child = spawn(javaCommand(), ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const timeout = setTimeout(() => child.kill(), 5000);
      child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
      child.on('error', () => { clearTimeout(timeout); reject(new Error('Java 智能分析需要 JDK 25 或更新版本，请安装并配置 JAVA_HOME')); });
      child.on('close', code => { clearTimeout(timeout); const major = Number(output.match(/version\s+"?(\d+)/i)?.[1]); if (code !== 0 || major < 25 || !major) reject(new Error('Java 智能分析需要 JDK 25 或更新版本，请配置 JAVA_HOME')); else resolve(major); });
    });
  }
  async function install() {
    await checkJava();
    if (installed()) return { installed: true, version: VERSION };
    if (process.env.GITPM_JDTLS_HOME) throw new Error('GITPM_JDTLS_HOME 未包含有效的 JDT Language Server');
    if (!installing) installing = (async () => {
      const parent = path.dirname(home); fs.mkdirSync(parent, { recursive: true });
      const staging = fs.mkdtempSync(path.join(parent, '.jdtls-install-'));
      try {
        const archive = path.join(staging, 'runtime.tar.gz');
        await downloadArchive(`https://download.eclipse.org/jdtls/milestones/${VERSION}/${ARCHIVE}`, archive);
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
        if (hash.digest('hex') !== SHA256) throw new Error('Java 语言服务校验失败，已停止安装');
        const unpack = path.join(staging, 'unpack'); fs.mkdirSync(unpack);
        await require('tar').x({ file: archive, cwd: unpack, strict: true, filter: (name, entry) => ['File', 'Directory'].includes(entry.type) && !path.isAbsolute(name) && !name.split(/[\\/]/).includes('..') });
        if (fs.existsSync(home)) throw new Error('运行目录已存在但不完整，请配置有效的 GITPM_JDTLS_HOME');
        fs.renameSync(unpack, home);
        return { installed: true, version: VERSION };
      } finally {
        if (path.dirname(path.resolve(staging)) === path.resolve(parent) && path.basename(staging).startsWith('.jdtls-install-')) fs.rmSync(staging, { recursive: true, force: true });
      }
    })().catch(error => { if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('Java 语言服务下载中断，请检查网络后重试'); throw error; }).finally(() => { installing = null; });
    return installing;
  }
  return { home, get java() { return javaCommand(); }, checkJava, install, status: () => ({ installed: installed(), installing: !!installing, version: VERSION, requiredJava: 25 }) };
};
