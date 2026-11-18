// 本地项目管理路由：克隆 / 导入 / 拉取 / 切换分支 / 分支管理 / 批量操作
'use strict';

const fs = require('fs');
const path = require('path');
const git = require('../git');
const { parseStatus } = require('../status');
const repositoryFiles = require('../files');
const { openPath, openTerminal } = require('../open');
const { resolveAuth } = require('../auth');
const { stripAuth, urlKey, hostMatchesUrl } = require('../urlutil');

const BRANCH_NAME_RE = /^[A-Za-z0-9._\-/]+$/; // 合法分支名（简化校验，防注入参数）
const CLONE_TIMEOUT = 30 * 60 * 1000;   // 克隆上限 30 分钟
const PULL_TIMEOUT = 10 * 60 * 1000;    // 拉取上限 10 分钟
const { DEFAULT_WORKSPACE } = require('../paths');

// 「检索本地目录」结果缓存：url -> [本地路径]，batch-check 据此匹配散落的旧克隆
const scanCache = { at: 0, byUrl: new Map() };
const SKIP_SCAN_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', 'vendor', '.next', '.cache',
  '.venv', 'venv', '__pycache__', '$RECYCLE.BIN', 'System Volume Information',
]);
const SCAN_CAP = 500;   // 最多收录仓库数
const SCAN_DEPTH = 5;   // 递归层数上限

function assertPath(localPath) {
  const p = String(localPath || '').trim();
  if (!p) throw new Error('路径不能为空');
  if (!path.isAbsolute(p)) throw new Error('必须使用绝对路径，例如 E:\\repos\\my-project');
  return path.resolve(p);
}

function getProjectOr404(dbm, id) {
  const p = dbm.getProject(id);
  if (!p) throw new Error('项目不存在（可能已被移除）');
  return p;
}

/** 项目列表（附带本地状态） */
async function projectVo(dbm, p) {
  const exists = fs.existsSync(p.local_path);
  const vo = { ...p, exists, branch: null, dirty: -1 };
  if (!exists) return vo;
  const [branch, dirty] = await Promise.all([
    git.currentBranch(p.local_path),
    git.dirtyCount(p.local_path),
  ]);
  vo.branch = branch;
  vo.dirty = dirty;
  return vo;
}

module.exports = function registerLocalRoutes(add, ctx) {
  const { dbm, bus } = ctx;
  const fileOps = ctx.fileOps;

  /** 项目列表（含当前分支/脏文件数） */
  add('GET', '/api/local', async () => {
    const list = await Promise.all(dbm.listProjects().map((p) => projectVo(dbm, p)));
    return { items: list };
  });

  /** 单项目详情 */
  add('GET', '/api/local/:id', async ({ params }) => {
    return projectVo(dbm, getProjectOr404(dbm, params.id));
  });

  /** 远程分支列表（供切换分支对话框用，统一走 git ls-remote） */
  add('GET', '/api/local/:id/remote-branches', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!p.remote_url) throw new Error('该项目没有远程地址记录，请手动 fetch');
    const { authUrl, cleanUrl } = resolveAuth(dbm, p.remote_url, p.host_id);
    bus.log(`git ls-remote --heads ${cleanUrl}`, 'cmd');
    const list = await git.lsRemoteHeads(authUrl, { timeout: 30000 });
    return { branches: list.map((b) => b.name) };
  });

  /** 本地分支列表 */
  add('GET', '/api/local/:id/branches', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    const [branches, current] = await Promise.all([
      git.localBranches(p.local_path),
      git.currentBranch(p.local_path),
    ]);
    return { branches, current };
  });

  /**
   * 克隆仓库到本地。
   * body: { hostId?, remoteUrl, branch?, localPath, shallow?, name? }
   */
  add('POST', '/api/local/clone', async ({ body }) => {
    const { hostId, remoteUrl, branch, localPath, shallow, name } = body || {};
    // 支持 HTTPS（自动带令牌）与 SSH（git@host:path / ssh://，走本机已配置的密钥）
    if (!remoteUrl || !/^(https?:\/\/|git@|ssh:\/\/)/.test(String(remoteUrl).trim())) {
      throw new Error('仓库地址需以 https://、git@ 或 ssh:// 开头');
    }
    const target = assertPath(localPath);
    if (fs.existsSync(target)) throw new Error(`目标目录已存在：${target}`);

    const { authUrl, cleanUrl, host } = resolveAuth(dbm, remoteUrl, hostId || null);
    const args = ['clone', '--progress'];
    if (branch) {
      if (!BRANCH_NAME_RE.test(branch)) throw new Error('分支名含有非法字符');
      args.push('--branch', branch);
    }
    if (shallow) args.push('--depth', '1');
    args.push(authUrl, target);

    bus.log(`git clone ${branch ? `--branch ${branch} ` : ''}${shallow ? '--depth 1 ' : ''}${cleanUrl} → ${target}`, 'cmd');
    const r = await git.runGit(args, { timeout: CLONE_TIMEOUT, onLine: (l, isErr) => bus.log(l, isErr ? 'out' : 'out') });
    if (r.code !== 0) {
      const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join('\n');
      bus.log('克隆失败', 'err');
      throw new Error(`克隆失败：${tail || '无输出'}`);
    }
    // 关键安全步骤：把 origin 重置为干净 URL，令牌绝不写入 .git/config
    await git.gitOk(['remote', 'set-url', 'origin', cleanUrl], { cwd: target });
    bus.log('已清除 origin 中的凭证信息（令牌不落盘）', 'ok');

    const proj = dbm.insertProject({
      host_id: host ? host.id : null,
      name: (name || path.basename(target)),
      remote_url: cleanUrl,
      local_path: target,
      default_branch: branch || '',
    });
    bus.log(`克隆完成并已登记：${proj.name}`, 'ok');
    return { ok: true, project: await projectVo(dbm, proj) };
  });

  /** 导入本地已有仓库 */
  add('POST', '/api/local/import', async ({ body }) => {
    let target = assertPath(body && body.localPath);
    if (!fs.existsSync(target)) throw new Error(`目录不存在：${target}`);
    const isRepo = await git.runGit(['rev-parse', '--is-inside-work-tree'], { cwd: target });
    if (isRepo.code !== 0 || isRepo.stdout.trim() !== 'true') {
      throw new Error('该目录不是 git 仓库（未找到 .git）');
    }
    // 若选中的是子目录，定位到仓库根
    const top = await git.runGit(['rev-parse', '--show-toplevel'], { cwd: target });
    if (top.code === 0 && top.stdout.trim()) target = top.stdout.trim().replace(/[\\/]+$/, '');

    const existed = dbm.findByLocalPath(target);
    if (existed) return { ok: true, project: await projectVo(dbm, existed), alreadyRegistered: true };

    const remote = await git.runGit(['remote', 'get-url', 'origin'], { cwd: target });
    const cleanUrl = remote.code === 0 ? stripAuth(remote.stdout.trim()) : '';
    const branch = await git.currentBranch(target);
    const host = cleanUrl ? (resolveAuth(dbm, cleanUrl, null).host || null) : null;

    const proj = dbm.insertProject({
      host_id: host ? host.id : null,
      name: path.basename(target),
      remote_url: cleanUrl,
      local_path: target,
      default_branch: branch || '',
    });
    bus.log(`已导入本地仓库：${proj.name}（${target}）`, 'ok');
    return { ok: true, project: await projectVo(dbm, proj) };
  });

  /** 拉取当前分支（--ff-only，避免意外合并提交） */
  add('POST', '/api/local/:id/pull', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    if (!p.remote_url) throw new Error('该项目没有远程地址（纯本地仓库），无法拉取');
    const branch = await git.currentBranch(p.local_path);
    if (!branch) throw new Error('当前处于 detached HEAD 状态，请先切换到分支');
    const result = await doPull(dbm, bus, p, branch);
    return { ok: true, branch, ...result };
  });

  /** 获取（fetch，不合并），返回领先/落后计数 */
  add('POST', '/api/local/:id/fetch', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    const branch = await git.currentBranch(p.local_path);
    if (!branch) throw new Error('当前处于 detached HEAD 状态，请先切换到分支');
    const { authUrl, cleanUrl } = resolveAuth(dbm, p.remote_url, p.host_id);
    bus.log(`git fetch ${cleanUrl} ${branch}（${p.name}）`, 'cmd');
    await git.gitOk(['fetch', '--progress', authUrl, branch], {
      cwd: p.local_path,
      timeout: PULL_TIMEOUT,
      onLine: (l) => bus.log(l, 'out'),
    });
    const ab = await git.aheadBehind(p.local_path);
    bus.log(`${p.name}：领先 ${ab ? ab.ahead : '?'} / 落后 ${ab ? ab.behind : '?'}`, 'ok');
    return { ok: true, ahead: ab && ab.ahead, behind: ab && ab.behind };
  });

  /**
   * 切换分支。body: { branch, stash? }
   * 脏工作区时：stash=true 先暂存再切换、切完自动 pop；否则返回 dirty 提示由前端确认。
   */
  add('POST', '/api/local/:id/checkout', async ({ params, body }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    const { branch, stash } = body || {};
    if (!branch || !BRANCH_NAME_RE.test(branch)) throw new Error('分支名非法');
    if (branch === '..' || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
      throw new Error('分支名非法');
    }

    const { authUrl, cleanUrl } = resolveAuth(dbm, p.remote_url, p.host_id);
    const dirty = (await git.dirtyCount(p.local_path)) > 0;
    if (dirty && !stash) {
      return { dirty: true, needConfirm: true, message: '工作区有未提交修改，切换可能冲突。选择"暂存并切换"可自动 stash。' };
    }
    if (dirty && stash) {
      bus.log('工作区有修改，自动 stash 暂存…', 'cmd');
      await git.gitOk(['stash', 'push', '-u', '-m', `gpm-switch-${Date.now()}`], { cwd: p.local_path });
    }

    const existsLocally = await git.branchExists(p.local_path, branch);
    try {
      if (existsLocally) {
        bus.log(`git checkout ${branch}（${p.name}）`, 'cmd');
        await git.gitOk(['checkout', branch], { cwd: p.local_path, onLine: (l) => bus.log(l, 'out') });
      } else {
        bus.log(`拉取远程分支 ${cleanUrl} ${branch} 并创建本地分支`, 'cmd');
        await git.gitOk(['fetch', '--progress', authUrl, branch], {
          cwd: p.local_path, timeout: PULL_TIMEOUT, onLine: (l) => bus.log(l, 'out'),
        });
        await git.gitOk(['checkout', '-b', branch, 'FETCH_HEAD'], { cwd: p.local_path, onLine: (l) => bus.log(l, 'out') });
      }
    } catch (e) {
      if (dirty && stash) {
        // 切换失败时恢复 stash，尽量回到原状
        await git.runGit(['stash', 'pop'], { cwd: p.local_path });
        bus.log('切换失败，已尝试恢复暂存的修改', 'err');
      }
      throw e;
    }

    if (dirty && stash) {
      const pop = await git.runGit(['stash', 'pop'], { cwd: p.local_path });
      if (pop.code !== 0) {
        bus.log('stash pop 出现冲突：修改仍保存在 stash 中，请手动处理', 'err');
      } else {
        bus.log('已恢复暂存的修改', 'ok');
      }
    }
    bus.log(`已切换到分支 ${branch}`, 'ok');
    return { ok: true, branch };
  });

  /** 新建本地分支（基于当前 HEAD） */
  add('POST', '/api/local/:id/create-branch', async ({ params, body }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    const { name } = body || {};
    if (!name || !BRANCH_NAME_RE.test(name) || name.includes('..')) throw new Error('分支名非法');
    if (await git.branchExists(p.local_path, name)) throw new Error(`分支已存在：${name}`);
    bus.log(`git checkout -b ${name}（${p.name}）`, 'cmd');
    await git.gitOk(['checkout', '-b', name], { cwd: p.local_path });
    bus.log(`已创建并切换到新分支 ${name}`, 'ok');
    return { ok: true, branch: name };
  });

  /** 删除本地分支（禁止删除当前分支） */
  add('POST', '/api/local/:id/delete-branch', async ({ params, body }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    const { name, force } = body || {};
    if (!name || !BRANCH_NAME_RE.test(name)) throw new Error('分支名非法');
    const current = await git.currentBranch(p.local_path);
    if (current === name) throw new Error('不能删除当前所在分支，请先切换到其他分支');
    bus.log(`git branch ${force ? '-D' : '-d'} ${name}（${p.name}）`, 'cmd');
    await git.gitOk(['branch', force ? '-D' : '-d', name], { cwd: p.local_path });
    bus.log(`已删除本地分支 ${name}`, 'ok');
    return { ok: true };
  });

  /** 一键全部拉取（可选 body.ids 只拉指定项目） */
  add('POST', '/api/local/pull-all', async ({ body }) => {
    const ids = Array.isArray(body && body.ids) ? body.ids.map((x) => String(x)) : null;
    const projects = dbm.listProjects().filter((p) => !ids || ids.includes(String(p.id)));
    const results = [];
    bus.log(`════ 开始批量拉取 ${projects.length} 个项目 ════`, 'cmd');
    for (const p of projects) {
      if (!fs.existsSync(p.local_path)) {
        results.push({ id: p.id, name: p.name, ok: false, error: '本地目录不存在' });
        continue;
      }
      if (!p.remote_url) {
        results.push({ id: p.id, name: p.name, ok: true, note: '无远程地址，跳过' });
        continue;
      }
      const branch = await git.currentBranch(p.local_path);
      if (!branch) {
        results.push({ id: p.id, name: p.name, ok: false, error: 'detached HEAD，跳过' });
        continue;
      }
      bus.log(`── ${p.name}（${branch}）──`, 'cmd');
      try {
        const r = await doPull(dbm, bus, p, branch);
        results.push({ id: p.id, name: p.name, ok: true, ...r });
      } catch (e) {
        results.push({ id: p.id, name: p.name, ok: false, error: e.message });
        bus.log(`${p.name} 拉取失败：${e.message}`, 'err');
      }
    }
    const okN = results.filter((r) => r.ok).length;
    bus.log(`════ 批量拉取完成：成功 ${okN} / ${results.length} ════`, okN === results.length ? 'ok' : 'err');
    return { results, okCount: okN, total: results.length };
  });

  /** 在系统文件管理器中打开（Windows 资源管理器 / macOS Finder） */
  add('POST', '/api/local/:id/open', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
    await openPath(p.local_path);
    return { ok: true };
  });

  /**
   * 批量检查：所选远程项目在本地的存在状态
   * body: { items: [{url, name}] }
   * 返回逐项状态：registered（已登记，含 exists 标记）| disk（磁盘上发现未登记的同源仓库）| missing
   */
  add('POST', '/api/local/batch-check', async ({ body }) => {
    const items = Array.isArray(body && body.items) ? body.items : [];
    if (!items.length) throw new Error('未选择任何项目');
    const workspace = dbm.getSetting('workspace', DEFAULT_WORKSPACE);
    const registered = dbm.listProjects();
    const matched = new Set(); // 同一登记记录只分配给一个勾选项（同 URL 多副本场景）
    const out = [];
    for (const it of items) {
      const clean = stripAuth(String(it.url || ''));
      const key = urlKey(clean);
      const reg = registered.find((p) => urlKey(p.remote_url) === key && !matched.has(p.id));
      if (reg) {
        matched.add(reg.id);
        const exists = fs.existsSync(reg.local_path);
        // paths：登记副本（主）+ 扫描到的其他副本（各带未提交数），展示用
        const paths = [];
        if (exists) {
          const d = await git.dirtyCount(reg.local_path);
          paths.push({ localPath: reg.local_path, registered: true, projectId: reg.id, dirty: d < 0 ? null : d });
          if (scanCache.at > 0) {
            const extras = (scanCache.byUrl.get(key) || [])
              .filter((p) => p !== reg.local_path && fs.existsSync(path.join(p, '.git')))
              .slice(0, 3); // 最多展示 3 个额外副本
            for (const ex of extras) {
              const d2 = await git.dirtyCount(ex);
              paths.push({ localPath: ex, registered: false, projectId: null, dirty: d2 < 0 ? null : d2 });
            }
          }
        }
        out.push({
          url: clean, name: it.name,
          status: 'registered',
          projectId: reg.id, localPath: reg.local_path,
          exists,
          dirty: paths.length ? paths[0].dirty : null,
          paths,
        });
        continue;
      }
      // 磁盘发现 → 主副本直接登记进 SQLite；paths 收齐全部副本（最短者为主，最多 1+3）
      let cands = [];
      for (const base of [workspace, DEFAULT_WORKSPACE]) {
        const cand = path.join(base, safeDirName(it.name));
        if (fs.existsSync(path.join(cand, '.git'))) {
          const r = await git.runGit(['remote', 'get-url', 'origin'], { cwd: cand });
          if (r.code === 0 && urlKey(r.stdout.trim()) === key) { cands.push(cand); break; }
        }
      }
      if (scanCache.at > 0) {
        for (const p of (scanCache.byUrl.get(key) || [])) {
          if (fs.existsSync(path.join(p, '.git')) && !cands.includes(p)) cands.push(p);
        }
      }
      if (cands.length) {
        cands = cands.slice().sort((a, b) => a.length - b.length).slice(0, 4);
        registerIfNew(dbm, clean, cands[0], it.name);
        const paths = [];
        for (const c of cands) {
          const d = await git.dirtyCount(c);
          const row = dbm.findByLocalPath(c);
          paths.push({ localPath: c, registered: !!row, projectId: row ? row.id : null, dirty: d < 0 ? null : d });
        }
        out.push({
          url: clean, name: it.name,
          status: 'registered',
          projectId: paths[0].projectId,
          localPath: cands[0],
          exists: true,
          dirty: paths[0].dirty,
          paths,
        });
        continue;
      }
      out.push({ url: clean, name: it.name, status: 'missing', paths: [] });
    }
    return { items: out };
  });

  /**
   * 检索本地目录：递归查找 git 仓库并读取远程地址，结果缓存供勾选检查匹配。
   * body: { roots: [目录...] }（同时持久化到 settings.scan_roots）
   */
  add('POST', '/api/local/scan', async ({ body }) => {
    const rawRoots = [...new Set(
      (Array.isArray(body && body.roots) ? body.roots : []).map((s) => String(s || '').trim()).filter(Boolean)
    )];
    if (!rawRoots.length) throw new Error('请至少提供一个检索根目录');
    const roots = [];
    const invalid = [];
    for (const r of rawRoots) {
      if (!path.isAbsolute(r)) { invalid.push(`${r}（非绝对路径）`); continue; }
      if (!fs.existsSync(r)) { invalid.push(`${r}（目录不存在）`); continue; }
      roots.push(path.resolve(r));
    }
    if (!roots.length) throw new Error(`没有可用的检索目录：${invalid.join('；')}`);
    dbm.setSetting('scan_roots', JSON.stringify(roots));

    bus.log(`════ 检索本地仓库：${roots.length} 个根目录 ════`, 'cmd');
    const dirs = [];
    const walk = (dir, depth) => {
      if (dirs.length >= SCAN_CAP) return;
      try {
        if (fs.existsSync(path.join(dir, '.git'))) { dirs.push(dir); return; } // 是仓库：收录且不再深入
        if (depth >= SCAN_DEPTH) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (dirs.length >= SCAN_CAP) return;
          if (!e.isDirectory() || e.name.startsWith('.') || SKIP_SCAN_DIRS.has(e.name)) continue;
          walk(path.join(dir, e.name), depth + 1);
        }
      } catch { /* 无权限等目录直接跳过 */ }
    };
    roots.forEach((r) => walk(r, 0));
    bus.log(`发现 ${dirs.length} 个 git 仓库，读取远程地址…`, 'cmd');

    const repos = [];
    for (const d of dirs) {
      const r = await git.runGit(['remote', 'get-url', 'origin'], { cwd: d });
      repos.push({ name: path.basename(d), localPath: d, url: r.code === 0 ? stripAuth(r.stdout.trim()) : '' });
      if (repos.length % 25 === 0) bus.log(`…已读取 ${repos.length}/${dirs.length}`, 'out');
    }
    // 更新缓存：勾选检查时自动按远程地址匹配（归一化键，兼容 https/ssh 写法差异）
    scanCache.at = Date.now();
    scanCache.byUrl = new Map();
    for (const x of repos) {
      if (!x.url) continue;
      const k = urlKey(x.url);
      if (!scanCache.byUrl.has(k)) scanCache.byUrl.set(k, []);
      scanCache.byUrl.get(k).push(x.localPath);
    }
    // 自动登记：发现的仓库直接写入 SQLite（同路径/同远程去重，按域名关联平台）
    let registeredCount = 0;
    for (const x of repos) {
      if (registerIfNew(dbm, x.url, x.localPath, x.name)) registeredCount++;
    }
    if (registeredCount) bus.log(`已自动登记 ${registeredCount} 个本地仓库到数据库`, 'ok');
    const matched = repos.filter((x) => x.url).length;
    bus.log(`════ 检索完成：${repos.length} 个仓库（新登记 ${registeredCount}）════`, 'ok');
    return { repos, total: repos.length, withUrl: matched, registeredCount, roots, invalidRoots: invalid, cachedAt: scanCache.at };
  });

  /**
   * 批量克隆/迁移：把选中的项目统一归置到同一目录。
   * body: { hostId?, targetDir, shallow?, plan: [{url, name, action, projectId?, localPath?}] }
   *   action: clone（克隆）| move（把本地已有目录迁移过来并登记）| skip（跳过）
   */
  add('POST', '/api/local/batch-clone', async ({ body }) => {
    const { hostId, targetDir, shallow, plan } = body || {};
    const plan_ = Array.isArray(plan) ? plan : [];
    if (!plan_.length) throw new Error('执行计划为空');
    const target = assertPath(targetDir);
    fs.mkdirSync(target, { recursive: true });

    const results = [];
    bus.log(`════ 批量整理 ${plan_.length} 项 → ${target} ════`, 'cmd');
    for (const it of plan_) {
      const name = safeDirName(it.name);
      const dest = path.join(target, name);
      try {
        if (it.action === 'skip') {
          results.push({ name, action: 'skip', ok: true });
          bus.log(`跳过：${name}`, 'info');
          continue;
        }
        if (it.action === 'clone') {
          if (fs.existsSync(dest)) throw new Error(`目标已存在：${dest}`);
          // 每个项目可单独指定克隆分支（批量弹窗中选择）
          const branch = String(it.branch || '').trim();
          if (branch && !BRANCH_NAME_RE.test(branch)) throw new Error(`分支名非法：${branch}`);
          const { authUrl, cleanUrl, host } = resolveAuth(dbm, it.url, hostId || null);
          const args = ['clone', '--progress'];
          if (branch) args.push('--branch', branch);
          if (shallow) args.push('--depth', '1');
          args.push(authUrl, dest);
          bus.log(`git clone ${branch ? `--branch ${branch} ` : ''}${shallow ? '--depth 1 ' : ''}${cleanUrl} → ${dest}`, 'cmd');
          const r = await git.runGit(args, { timeout: CLONE_TIMEOUT, onLine: (l) => bus.log(l, 'out') });
          if (r.code !== 0) throw new Error(`克隆失败：${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
          await git.gitOk(['remote', 'set-url', 'origin', cleanUrl], { cwd: dest }); // 令牌不落盘
          dbm.insertProject({ host_id: host ? host.id : (hostId || null), name, remote_url: cleanUrl, local_path: dest, default_branch: branch });
          results.push({ name, action: 'clone', ok: true, path: dest, branch });
          bus.log(`克隆完成：${name}${branch ? `（${branch}）` : ''}`, 'ok');
        } else if (it.action === 'move') {
          const src = assertPath(it.localPath);
          if (!fs.existsSync(src)) throw new Error(`源目录不存在：${src}`);
          if (path.resolve(dest) === path.resolve(src)) {
            // 已在目标目录：仅补登记
            if (!it.projectId) dbm.insertProject({ host_id: hostId || null, name, remote_url: stripAuth(it.url), local_path: dest, default_branch: '' });
            results.push({ name, action: 'move', ok: true, path: dest, note: '已在目标目录' });
            bus.log(`${name} 已在目标目录`, 'ok');
          } else {
            if (fs.existsSync(dest)) throw new Error(`目标已存在：${dest}`);
            bus.log(`迁移：${src} → ${dest}`, 'cmd');
            await moveDir(src, dest);
            if (it.projectId) {
              const p = dbm.getProject(it.projectId);
              if (p) dbm.updateProject(p.id, { local_path: dest });
            } else {
              dbm.insertProject({ host_id: hostId || null, name, remote_url: stripAuth(it.url), local_path: dest, default_branch: '' });
            }
            results.push({ name, action: 'move', ok: true, path: dest });
            bus.log(`迁移完成：${name}`, 'ok');
          }
        } else {
          throw new Error(`未知动作：${it.action}`);
        }
      } catch (e) {
        results.push({ name, action: it.action, ok: false, error: e.message });
        bus.log(`${name} 失败：${e.message}`, 'err');
      }
    }
    const okN = results.filter((r) => r.ok).length;
    bus.log(`════ 批量整理完成：成功 ${okN}/${results.length} ════`, okN === results.length ? 'ok' : 'err');
    return { results, okCount: okN, total: results.length, targetDir: target };
  });

  /** 移除登记（不删除磁盘文件） */
  add('DELETE', '/api/local/:id', async ({ params }) => {
    const p = getProjectOr404(dbm, params.id);
    dbm.deleteProject(p.id);
    bus.log(`已从列表移除：${p.name}（磁盘文件未删除）`, 'ok');
    return { ok: true };
  });
// ---------- 未提交修改：列表 / 对比 / 预览编辑 / 还原（SourceTree 式工作副本面板） ----------

/** 仓库内相对路径安全校验（拒绝绝对路径/..越界） */
function assertRepoPath(rel) {
  const s = String(rel || '');
  const segments = s.replace(/\\/g, '/').split('/');
  if (!s || s.includes('\0') || /^[a-zA-Z]:/.test(s) || /^[\\/]/.test(s) || s.startsWith('-') || segments.some((part) => part === '..' || part.toLowerCase() === '.git')) {
    throw new Error(`非法文件路径：${s}`);
  }
  return s;
}
function isBinaryBuf(buf) { return buf.includes(0); }

/** 未提交修改列表（含未跟踪文件） */
add('GET', '/api/local/:id/changes', async ({ params }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const r = await git.gitOk(['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: p.local_path });
  return { items: parseStatus(r.stdout) };
});

/** 单文件与 HEAD 的差异（unified diff；未跟踪文件展示为全文新增） */
add('GET', '/api/local/:id/diff', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const rel = assertRepoPath(query.get('path'));
  const st = await git.gitOk(['status', '--porcelain', '-z', '--', rel], { cwd: p.local_path });
  const code = st.stdout.slice(0, 2);
  if (code.startsWith('??')) {
    const abs = path.join(p.local_path, rel);
    if (!fs.existsSync(abs)) throw new Error('文件不存在');
    const buf = fs.readFileSync(abs);
    if (isBinaryBuf(buf)) return { path: rel, binary: true, text: '' };
    return { path: rel, newFile: true, text: buf.toString('utf8').split('\n').map((l) => `+${l}`).join('\n') };
  }
  const head = await git.runGit(['rev-parse', '--verify', 'HEAD'], { cwd: p.local_path });
  const r = await git.gitOk(head.code === 0 ? ['diff', 'HEAD', '--', rel] : ['diff', '--cached', '--', rel], { cwd: p.local_path });
  const binary = /Binary files .* differ/.test(r.stdout);
  return { path: rel, binary, text: binary ? '' : (r.stdout || '（与上次提交无差异）') };
});

/** 读取当前文件内容（预览/编辑） */
add('GET', '/api/local/:id/files', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  const offset = Math.max(0, Number.parseInt(query.get('offset') || '0', 10) || 0);
  return repositoryFiles.listDirectory(p.local_path, query.get('path') || '', offset, 200);
});
add('GET','/api/local/:id/file-search',async({params,query,req,res})=>{
  const p=getProjectOr404(dbm,params.id);
  const controller=new AbortController();
  const abort=()=>controller.abort();req?.once('aborted',abort);
  res?.once('close',abort);
  try{return await require('../workspace-search').search(p.local_path,Object.fromEntries(query),controller.signal);}
  finally{req?.off('aborted',abort);res?.off('close',abort);}
});
add('GET','/api/local/:id/script-workspace',async({params})=>require('../workspace-search').scriptWorkspace(getProjectOr404(dbm,params.id).local_path));
add('POST','/api/local/:id/resolve-imports',async({params,body})=>require('../imports')(getProjectOr404(dbm,params.id).local_path,String(body.path||''),Array.isArray(body.specifiers)?body.specifiers:[]));
add('POST','/api/local/:id/script-intelligence',async({params,body})=>require('../script-intelligence')(getProjectOr404(dbm,params.id),body));
add('GET','/api/local/:id/file-operations',async({params,query})=>fileOps.list(getProjectOr404(dbm,params.id),Math.max(0,Number(query.get('before'))||0)));
add('GET','/api/local/:id/java-status',async({params})=>{getProjectOr404(dbm,params.id);return ctx.javaIntelligence.runtime.status();});
add('POST','/api/local/:id/java-install',async({params})=>{getProjectOr404(dbm,params.id);await ctx.runner.prepare();return ctx.javaIntelligence.runtime.install();});
add('POST','/api/local/:id/java-intelligence',async({params,body})=>{const project=getProjectOr404(dbm,params.id);await ctx.runner.prepare();return ctx.javaIntelligence.query(project,body);});
add('POST','/api/local/:id/file-operation',async({params,body})=>{
  const p=getProjectOr404(dbm,params.id),relative=String(body.path||'');
  repositoryFiles.resolveEntry(p.local_path,relative);
  if(body.action!=='copy')throw new Error('不支持的文件操作');
  fileOps.record(p,relative,'copy',body.scope==='selection'?'复制选中内容':body.scope==='path'?'复制相对路径':'复制全部内容');return {ok:true};
});
add('POST','/api/local/:id/delete-file',async({params,body})=>fileOps.remove(getProjectOr404(dbm,params.id),String(body.path||'')));
add('POST','/api/local/:id/restore-file',async({params,body})=>fileOps.restore(getProjectOr404(dbm,params.id),Number(body.operationId)));
add('POST','/api/local/:id/format',async({params,body})=>{
  const p=getProjectOr404(dbm,params.id),relative=String(body.path||'');
  repositoryFiles.resolveEntry(p.local_path,relative);
  const content=await require('../format')(relative,String(body.content??''));
  fileOps.record(p,relative,'format','已格式化编辑区，尚未保存');
  return {content};
});

add('GET', '/api/local/:id/file', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  const rel = String(query.get('path') || '');
  return repositoryFiles.readFile(p.local_path, rel);
});

/** 保存文件内容（编辑） */
add('PUT', '/api/local/:id/file', async ({ params, body }) => {
  const p = getProjectOr404(dbm, params.id);
  const rel = String(body && body.path || '');
  const result = await fileOps.save(p,rel,String(body.content ?? ''),body.revision);
  bus.log(`已保存文件：${p.name}/${rel}`, 'ok');
  return result;
});

/** 还原到上次提交（tracked: checkout HEAD --；未跟踪: clean） */
add('POST', '/api/local/:id/discard', async ({ params, body }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const paths = (Array.isArray(body && body.paths) ? body.paths : []).map(assertRepoPath).slice(0, 200);
  if (!paths.length) throw new Error('未选择要还原的文件');
  const tracked = [];
  const untracked = [];
  for (const rel of paths) {
    const st = await git.gitOk(['status', '--porcelain', '-z', '--', rel], { cwd: p.local_path });
    const code = st.stdout.slice(0, 2);
    if (code.startsWith('??')) untracked.push(rel); else tracked.push(rel);
  }
  let done = 0;
  if (tracked.length) {
    const r = await git.runGit(['checkout', 'HEAD', '--', ...tracked], { cwd: p.local_path });
    if (r.code === 0) done += tracked.length;
    else throw new Error(`还原失败：${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  }
  if (untracked.length) {
    const r = await git.runGit(['clean', '-f', '--', ...untracked], { cwd: p.local_path });
    if (r.code === 0) done += untracked.length;
    else throw new Error(`删除未跟踪文件失败：${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  }
  bus.log(`${p.name}：已还原 ${done} 个文件到上次提交`, 'ok');
  return { ok: true, discarded: done };
});

/** 暂存 / 取消暂存（SourceTree stage/unstage） */
add('POST', '/api/local/:id/stage', async ({ params, body }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const paths = (Array.isArray(body && body.paths) ? body.paths : []).map(assertRepoPath).slice(0, 200);
  if (!paths.length) throw new Error('未选择文件');
  const head = body.unstage ? await git.runGit(['rev-parse', '--verify', 'HEAD'], { cwd: p.local_path }) : null;
  const args = body.unstage
    ? head.code === 0 ? ['reset', 'HEAD', '--', ...paths] : ['rm', '--cached', '--', ...paths]
    : ['add', '--', ...paths];
  const r = await git.runGit(args, { cwd: p.local_path });
  if (r.code !== 0) throw new Error(`${body.unstage ? '取消暂存' : '暂存'}失败：${(r.stderr || '').trim().split('\n').slice(-2).join(' ')}`);
  bus.log(`${p.name}：${body.unstage ? '取消暂存' : '暂存'} ${paths.length} 个文件`, 'ok');
  return { ok: true };
});

/** 提交：勾选文件则只提交这些路径（自动 add），否则提交暂存区 */
add('POST', '/api/local/:id/commit', async ({ params, body }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const message = String((body && body.message) || '').trim();
  if (!message) throw new Error('请填写提交说明');
  const paths = (Array.isArray(body && body.paths) ? body.paths : []).map(assertRepoPath).slice(0, 200);
  let r;
  if (paths.length) {
    await git.gitOk(['add', '--', ...paths], { cwd: p.local_path });
    r = await git.runGit(['commit', '-m', message, '--', ...paths], { cwd: p.local_path });
  } else {
    r = await git.runGit(['commit', '-m', message], { cwd: p.local_path });
  }
  if (r.code !== 0) {
    const tail = (r.stdout || r.stderr || '').trim().split('\n').filter(Boolean).slice(-3).join(' ');
    throw new Error(`提交失败：${tail || '暂存区可能为空'}`);
  }
  const head = await git.runGit(['rev-parse', '--short', 'HEAD'], { cwd: p.local_path });
  bus.log(`${p.name}：提交 ${head.stdout.trim() || '?'} — ${message.split('\n')[0]}`, 'ok');
  return { ok: true, sha: head.stdout.trim() };
});

/** 提交历史 */
add('GET', '/api/local/:id/log', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const limit = Math.min(Math.max(parseInt(query.get('limit') || '30', 10) || 30, 1), 100);
  const head = await git.runGit(['rev-parse', '--verify', 'HEAD'], { cwd: p.local_path });
  if (head.code !== 0) return { items: [] };
  const r = await git.gitOk([
    'log', `--max-count=${limit}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s',
  ], { cwd: p.local_path });
  const items = r.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, short, author, ts, subject] = line.split('\x1f');
    const d = new Date(Number(ts) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return {
      hash, short, author, subject,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  });
  return { items };
});

/** 某次提交的文件列表 */
add('GET', '/api/local/:id/commit-info', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  const sha = String(query.get('sha') || '').trim();
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new Error('非法提交号');
  const r = await git.gitOk(['show', '--name-status', '--pretty=format:', sha], { cwd: p.local_path });
  const stMap = { A: 'added', M: 'modified', D: 'deleted', R: 'modified', C: 'modified' };
  const files = r.stdout.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^([ARMDC])\d*\s+(.+)$/);
    if (!m) return null;
    let f = m[2].includes('\t') ? m[2].split('\t').pop() : m[2];
    return { path: f.replace(/^"|"$/g, ''), state: stMap[m[1]] || 'modified' };
  }).filter(Boolean);
  return { files };
});

/** 某次提交中单文件的差异 */
add('GET', '/api/local/:id/commit-diff', async ({ params, query }) => {
  const p = getProjectOr404(dbm, params.id);
  const sha = String(query.get('sha') || '').trim();
  const rel = assertRepoPath(query.get('path'));
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha)) throw new Error('非法提交号');
  const r = await git.gitOk(['show', sha, '--', rel], { cwd: p.local_path });
  return { path: rel, text: r.stdout || '（无差异）' };
});

/** 贮藏（stash）列表 */
add('GET', '/api/local/:id/stashes', async ({ params }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const r = await git.runGit(['stash', 'list'], { cwd: p.local_path });
  const items = r.stdout.split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
    return m ? { index: Number(m[1]), label: m[2] } : { index: -1, label: line };
  });
  return { items };
});

/** 贮藏操作：push(新建，含未跟踪)/apply/pop/drop */
add('POST', '/api/local/:id/stash', async ({ params, body }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  const { action } = body || {};
  let r;
  if (action === 'push') {
    r = await git.runGit(['stash', 'push', '-u', '-m', String(body.message || `gpm-${Date.now()}`).slice(0, 100)], { cwd: p.local_path });
  } else if (['apply', 'pop', 'drop'].includes(action)) {
    const idx = Number(body.index);
    if (!(Number.isInteger(idx) && idx >= 0)) throw new Error('非法贮藏序号');
    r = await git.runGit(['stash', action, `stash@{${idx}}`], { cwd: p.local_path });
  } else {
    throw new Error('未知操作');
  }
  if (r.code !== 0) throw new Error(`贮藏操作失败：${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' ')}`);
  bus.log(`${p.name}：stash ${action} 完成`, 'ok');
  return { ok: true };
});
/** 推送当前分支到远程（推送前确认由前端完成） */
add('POST', '/api/local/:id/push', async ({ params }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  if (!p.remote_url) throw new Error('该项目没有远程地址（纯本地仓库），无法推送');
  const branch = await git.currentBranch(p.local_path);
  if (!branch) throw new Error('当前处于 detached HEAD 状态，无法推送');
  await doPush(dbm, bus, p, branch);
  return { ok: true, branch };
});

/** 批量推送（body.ids 指定项目；缺省全部有远程的项目） */
add('POST', '/api/local/push-all', async ({ body }) => {
  const ids = Array.isArray(body && body.ids) ? body.ids.map((x) => String(x)) : null;
  const projects = dbm.listProjects().filter((p) => (!ids || ids.includes(String(p.id))) && p.remote_url);
  const results = [];
  bus.log(`════ 批量推送 ${projects.length} 个项目 ════`, 'cmd');
  for (const p of projects) {
    if (!fs.existsSync(p.local_path)) { results.push({ id: p.id, name: p.name, ok: false, error: '本地目录不存在' }); continue; }
    const branch = await git.currentBranch(p.local_path);
    if (!branch) { results.push({ id: p.id, name: p.name, ok: false, error: 'detached HEAD' }); continue; }
    bus.log(`── ${p.name}（${branch}）──`, 'cmd');
    try {
      await doPush(dbm, bus, p, branch);
      results.push({ id: p.id, name: p.name, ok: true });
    } catch (e) {
      results.push({ id: p.id, name: p.name, ok: false, error: e.message });
      bus.log(`${p.name} 推送失败：${e.message}`, 'err');
    }
  }
  const okN = results.filter((r) => r.ok).length;
  bus.log(`════ 批量推送完成：成功 ${okN}/${results.length} ════`, okN === results.length ? 'ok' : 'err');
  return { results, okCount: okN, total: results.length };
});

/** 在项目目录打开系统终端 */
add('POST', '/api/local/:id/terminal', async ({ params }) => {
  const p = getProjectOr404(dbm, params.id);
  if (!fs.existsSync(p.local_path)) throw new Error('本地目录不存在');
  await openTerminal(p.local_path);
  return { ok: true };
});

};

/** 推送实现（单项目与批量共用）：push 当前分支，非快进会被远程拒绝（安全默认，不强制） */
async function doPush(dbm, bus, p, branch) {
  const { authUrl, cleanUrl } = resolveAuth(dbm, p.remote_url, p.host_id);
  bus.log(`git push ${cleanUrl} ${branch}（${p.name}）`, 'cmd');
  const r = await git.runGit(['push', '--progress', authUrl, `${branch}:${branch}`], {
    cwd: p.local_path,
    timeout: PULL_TIMEOUT,
    onLine: (l) => bus.log(l, 'out'),
  });
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join('\n');
    throw new Error(tail || `git 退出码 ${r.code}`);
  }
  dbm.touchSync(p.id);
}

/** 拉取实现（单项目与批量共用）：fetch + ff-only 合并，返回领先/落后 */
async function doPull(dbm, bus, p, branch) {
  const { authUrl, cleanUrl } = resolveAuth(dbm, p.remote_url, p.host_id);
  bus.log(`git pull --ff-only ${cleanUrl} ${branch}（${p.name}）`, 'cmd');
  const r = await git.runGit(['pull', '--ff-only', '--progress', authUrl, branch], {
    cwd: p.local_path,
    timeout: PULL_TIMEOUT,
    onLine: (l) => bus.log(l, 'out'),
  });
  if (r.code !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join('\n');
    throw new Error(tail || `git 退出码 ${r.code}`);
  }
  dbm.touchSync(p.id);
  const ab = await git.aheadBehind(p.local_path);
  return { ahead: ab ? ab.ahead : null, behind: ab ? ab.behind : null };
}

/** 目录名净化（去掉 Windows 非法字符） */
function safeDirName(name) {
  return String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'repo';
}

/** 把磁盘上发现的仓库登记进 SQLite（已登记则跳过）：同路径或同远程地址视为重复；按域名自动关联平台 */
function registerIfNew(dbm, remoteUrl, localPath, name) {
  try {
    if (dbm.findByLocalPath(localPath)) return false;
    if (remoteUrl) {
      const k = urlKey(remoteUrl);
      const dup = dbm.listProjects().some((p) => p.remote_url && urlKey(p.remote_url) === k);
      if (dup) return false;
    }
    const hostRow = remoteUrl ? (dbm.listHosts().find((h) => hostMatchesUrl(h, remoteUrl)) || null) : null;
    dbm.insertProject({ host_id: hostRow ? hostRow.id : null, name, remote_url: remoteUrl, local_path: localPath, default_branch: '' });
    return true;
  } catch {
    return false;
  }
}

/** 目录迁移：同盘 rename，跨盘（EXDEV）退化为复制+删除 */
async function moveDir(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e && (e.code === 'EXDEV' || e.code === 'EPERM')) {
      fs.cpSync(src, dest, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}
