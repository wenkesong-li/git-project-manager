// 平台（hosts）管理路由 + 远程项目/分支代理
'use strict';

const { createAdapter } = require('../adapters');
const { encrypt, decrypt } = require('../crypto');
const { lsRemoteHeads } = require('../git');
const { stripAuth } = require('../urlutil');

// 永不把令牌原文返回给前端
function toHostVo(row) {
  if (!row) return null;
  let tokenHint = '';
  if (row.token_enc) {
    try {
      const t = decrypt(row.token_enc);
      tokenHint = t.length > 6 ? `****${t.slice(-4)}` : '****';
    } catch {
      tokenHint = '****（解密失败）';
    }
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    username: row.username,
    orgId: row.org_id || '',
    hasToken: !!row.token_enc,
    tokenHint,
    createdAt: row.created_at,
  };
}

module.exports = function registerHostsRoutes(add, ctx) {
  const { dbm, bus } = ctx;

  add('GET', '/api/hosts', async () => dbm.listHosts().map(toHostVo));

  add('POST', '/api/hosts', async ({ body }) => {
    const { name, type, baseUrl, username, orgId, token } = body || {};
    if (!name || !name.trim()) throw new Error('平台名称不能为空');
    if (!['codeup', 'gitlab', 'gitee', 'github', 'generic'].includes(type)) throw new Error('平台类型非法');
    if (type !== 'generic' && !/^https?:\/\//.test(String(baseUrl || '').trim())) {
      throw new Error('平台地址必须以 http(s):// 开头');
    }
    const row = dbm.insertHost({
      name: name.trim(),
      type,
      base_url: String(baseUrl || '').trim().replace(/\/+$/, ''),
      username: String(username || '').trim(),
      org_id: String(orgId || '').trim(),
      token_enc: token ? encrypt(String(token).trim()) : '',
    });
    bus.log(`新增平台：${row.name}（${row.type}）`, 'ok');
    return toHostVo(row);
  });

  add('PUT', '/api/hosts/:id', async ({ params, body }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    const fields = {};
    if (body.name !== undefined) {
      if (!String(body.name).trim()) throw new Error('平台名称不能为空');
      fields.name = String(body.name).trim();
    }
    if (body.type !== undefined) {
      if (!['codeup', 'gitlab', 'gitee', 'github', 'generic'].includes(body.type)) throw new Error('平台类型非法');
      fields.type = body.type;
    }
    if (body.baseUrl !== undefined) fields.base_url = String(body.baseUrl).trim().replace(/\/+$/, '');
    if (body.username !== undefined) fields.username = String(body.username).trim();
    if (body.orgId !== undefined) fields.org_id = String(body.orgId).trim();
    if (body.token !== undefined) {
      // null = 清除令牌；空字符串 = 保持不变；非空 = 替换
      if (body.token === null) fields.token_enc = '';
      else if (String(body.token).length > 0) fields.token_enc = encrypt(String(body.token).trim());
    }
    const updated = dbm.updateHost(params.id, fields);
    bus.log(`更新平台：${updated.name}`, 'ok');
    return toHostVo(updated);
  });

  add('DELETE', '/api/hosts/:id', async ({ params }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    dbm.deleteHost(params.id);
    bus.log(`删除平台：${row.name}（本地项目记录保留，仅解除关联）`, 'ok');
    return { ok: true };
  });

  // 测试连接：调平台 API 验证令牌（generic 无 API，跳过）
  add('POST', '/api/hosts/:id/test', async ({ params, body }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    const plain = body && body.token ? String(body.token).trim() : undefined;
    const adapter = createAdapter(row, plain);
    const result = await adapter.test();
    return { ok: true, ...result };
  });

  // 远程项目列表
  add('GET', '/api/hosts/:id/projects', async ({ params, query }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    if (!row.token_enc && row.type !== 'generic') {
      throw new Error('该平台未配置访问令牌，请先编辑并填入令牌');
    }
    const adapter = createAdapter(row);
    const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1);
    const search = (query.get('search') || '').trim();
    const requestedSize = Number(query.get('pageSize') || 20);
    const pageSize = [10, 20, 50, 100].includes(requestedSize) ? requestedSize : 20;
    const result = await adapter.listProjects({ search, page, pageSize });
    return { ...result, page, pageSize };
  });

  // 「最近分支」批量补全：?ids=a,b,c（Codeup 专用轻量分支拉取；非 Codeup 平台列表自带字段，直接跳过）
  add('GET', '/api/hosts/:id/repos-info', async ({ params, query }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    if (row.type !== 'codeup') return { items: [] };
    const ids = String(query.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 24);
    if (!ids.length) return { items: [] };

    const adapter = createAdapter(row);
    const out = [];
    for (const batch of chunk(ids, 4)) {
      await Promise.all(batch.map(async (id) => {
        const key = `${row.id}:${id}`;
        const cached = repoInfoCache.get(key);
        if (cached && Date.now() - cached.at < REPO_INFO_TTL) {
          out.push({ id, ...cached.data });
          return;
        }
        try {
          const branches = await adapter.recentBranches({ repoId: id });
          const withDate = branches.filter((b) => b.date);
          const lastActivity = withDate.length
            ? withDate.map((b) => b.date).sort().slice(-1)[0]
            : '';
          const def = branches.find((b) => b.isDefault);
          // 最近分支：默认分支优先，其余按提交时间倒序，最多 4 个
          const others = withDate.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
          const picked = [];
          if (def) picked.push(def);
          for (const b of others) {
            if (picked.length >= 4) break;
            if (!picked.some((x) => x.name === b.name)) picked.push(b);
          }
          const data = {
            defaultBranch: def ? def.name : '',
            lastActivity,
            branches: picked.map((b) => ({ name: b.name, isDefault: b.isDefault, date: b.date })),
          };
          repoInfoCache.set(key, { data, at: Date.now() });
          out.push({ id, ...data });
        } catch (e) {
          out.push({ id, error: String(e.message).slice(0, 120) });
        }
      }));
    }
    return { items: out };
  });

  // 远程分支列表：优先平台 API；generic 或 API 失败时降级 git ls-remote
  add('GET', '/api/hosts/:id/branches', async ({ params, query }) => {
    const row = dbm.getHost(params.id);
    if (!row) throw new Error('平台不存在');
    const repoId = query.get('repoId') || '';
    const fullName = query.get('fullName') || '';
    const repoUrl = query.get('url') || '';

    if (row.type === 'generic') {
      if (!repoUrl) throw new Error('通用平台查询分支需要提供仓库地址');
      const branches = await lsRemoteBranchesViaGit(ctx, row, repoUrl);
      return { branches, source: 'git' };
    }

    try {
      const adapter = createAdapter(row);
      const branches = await adapter.listBranches({ repoId, fullName });
      return { branches, source: 'api' };
    } catch (e) {
      if (!repoUrl) throw e;
      bus.log(`平台 API 查询分支失败（${e.message}），降级使用 git ls-remote`, 'err');
      const branches = await lsRemoteBranchesViaGit(ctx, row, repoUrl);
      return { branches, source: 'git' };
    }
  });
};

/** 用 git ls-remote 枚举分支（通用兜底） */
async function lsRemoteBranchesViaGit(ctx, hostRow, repoUrl) {
  const { resolveAuth } = require('../auth');
  const { authUrl, cleanUrl } = resolveAuth(ctx.dbm, repoUrl, hostRow.id);
  ctx.bus.log(`git ls-remote --heads ${cleanUrl}`, 'cmd');
  const list = await lsRemoteHeads(authUrl, { timeout: 30000 });
  ctx.bus.log(`查询到 ${list.length} 个远程分支`, 'ok');
  return list.map((b) => ({
    name: b.name,
    sha: b.sha,
    message: '',
    author: '',
    date: '',
    protected: false,
    merged: false,
  }));
}

// 「最近分支」补全缓存：hostId:repoId -> { data, at }（10 分钟）
const repoInfoCache = new Map();
const REPO_INFO_TTL = 10 * 60 * 1000;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

module.exports.stripAuthForVo = stripAuth;
