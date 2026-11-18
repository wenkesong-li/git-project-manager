// git 命令封装：spawn + 流式输出 + 令牌脱敏 + 超时
'use strict';

const { spawn } = require('child_process');

// ---------- 令牌脱敏注册表 ----------
const secrets = new Set();
function addSecret(s) {
  if (s && String(s).length >= 4) secrets.add(String(s));
}
function mask(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

class GitError extends Error {
  constructor(message, detail = '') {
    super(message);
    this.name = 'GitError';
    this.detail = detail;
  }
}

/** 找到最早的换行符（\n 或 \r）位置 */
function lineBreak(s) {
  const a = s.indexOf('\n');
  const b = s.indexOf('\r');
  if (a < 0 && b < 0) return -1;
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

/**
 * 运行 git 命令。
 * @param {string[]} args
 * @param {object} opts { cwd, timeout(ms, 0=不限), onLine(line, isStderr) }
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runGit(args, opts = {}) {
  const { cwd, timeout = 0, onLine } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',   // 禁止终端交互提示（避免卡死）
          GCM_INTERACTIVE: 'never',   // 禁止 Git Credential Manager 弹窗
          GIT_ASKPASS: 'echo',        // 凭证请求直接失败而非挂起
        },
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: `无法启动 git：${e.message}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';

    const pump = (chunk, isErr) => {
      const text = mask(chunk.toString('utf8'));
      if (isErr) stderr += text;
      else stdout += text;
      pending += text;
      // git 进度用 \r 刷新同一行，也按行切分，避免日志并成超长行
      let idx;
      while ((idx = lineBreak(pending)) >= 0) {
        const ch = pending[idx];
        const skip = ch === '\r' && pending[idx + 1] === '\n' ? 2 : 1;
        const line = pending.slice(0, idx);
        pending = pending.slice(idx + skip);
        if (onLine && line) onLine(line, isErr);
      }
    };

    child.stdout.on('data', (d) => pump(d, false));
    child.stderr.on('data', (d) => pump(d, true));

    let timer = null;
    if (timeout > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
        pending += `\n[超时] 命令超过 ${timeout}ms 已终止\n`;
      }, timeout);
    }

    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e.message) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (pending && onLine) onLine(pending.replace(/\r$/, ''), true);
      resolve({ code: code === null ? -1 : code, stdout, stderr });
    });
  });
}

/** 运行 git，非 0 退出码时抛 GitError（信息已脱敏） */
async function gitOk(args, opts = {}) {
  const r = await runGit(args, opts);
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-6).join('\n');
    throw new GitError(`git ${args[0]} 失败（退出码 ${r.code}）：${tail || '无输出'}`, tail);
  }
  return r;
}

// ---------- 常用查询 ----------

async function currentBranch(cwd) {
  const r = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (r.code !== 0) return null;
  const b = r.stdout.trim();
  return b === 'HEAD' ? null : b; // detached HEAD -> null
}

async function dirtyCount(cwd) {
  const r = await runGit(['status', '--porcelain', '-z', '--untracked-files=all'], { cwd });
  if (r.code !== 0) return -1;
  return require('./status').parseStatus(r.stdout).length;
}

async function localBranches(cwd) {
  const r = await runGit(['branch', '--format=%(refname:short)'], { cwd });
  if (r.code !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function branchExists(cwd, name) {
  const r = await runGit(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { cwd });
  return r.code === 0;
}

/** git ls-remote --heads，返回 [{name, sha}]；失败抛 GitError */
async function lsRemoteHeads(url, opts = {}) {
  const r = await runGit(['ls-remote', '--heads', url], opts);
  if (r.code !== 0) {
    const tail = (r.stderr || '').trim().split('\n').slice(-4).join('\n');
    throw new GitError(`无法访问远程仓库：${tail || '无输出'}`, tail);
  }
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split(/\t/);
    return { name: ref.replace(/^refs\/heads\//, ''), sha };
  });
}

/** HEAD...FETCH_HEAD 的 领先/落后 计数，返回 {ahead, behind} */
async function aheadBehind(cwd) {
  const r = await runGit(['rev-list', '--left-right', '--count', 'HEAD...FETCH_HEAD'], { cwd });
  if (r.code !== 0) return null;
  const [ahead, behind] = r.stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

module.exports = {
  addSecret, mask, GitError,
  runGit, gitOk,
  currentBranch, dirtyCount, localBranches, branchExists, lsRemoteHeads, aheadBehind,
};
