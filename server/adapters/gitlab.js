// GitLab v4 兼容适配器 —— 覆盖 Codeup（云效）与 GitLab
// Codeup：https://codeup.aliyun.com 上的 /api/v4 接口与 GitLab 风格一致，用 Private-Token 头认证
'use strict';

const { apiGetJson, pick } = require('./helpers');

function normalizeBase(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v4$/i, '');
}

module.exports = function createGitlabAdapter(cfg) {
  const base = normalizeBase(cfg.baseUrl);
  if (!/^https?:\/\//.test(base)) throw new Error('平台地址必须以 http(s):// 开头');
  const api = `${base}/api/v4`;
  const headers = { 'Private-Token': cfg.token, Accept: 'application/json' };

  return {
    kind: 'gitlab',

    async test() {
      const u = await apiGetJson(`${api}/user`, headers);
      return { identity: pick(u, ['username', 'name', 'email'], '未知用户') };
    },

    async listProjects({ search, page = 1, pageSize = 20 } = {}) {
      const q = new URLSearchParams({
        membership: 'true',
        simple: 'true',
        order_by: 'updated_at',
        per_page: String(pageSize),
        page: String(page),
      });
      if (search) q.set('search', search);
      const list = await apiGetJson(`${api}/projects?${q}`, headers);
      const items = (Array.isArray(list) ? list : []).map((p) => ({
        id: String(pick(p, ['id'])),
        name: pick(p, ['path', 'name']),
        fullName: pick(p, ['path_with_namespace', 'name_with_namespace', 'name']),
        url: pick(p, ['http_url_to_repo', 'http_url', 'web_url'], ''),
        defaultBranch: pick(p, ['default_branch', 'default_branch_name']),
        visibility: p.visibility || '',
        lastActivity: pick(p, ['last_activity_at', 'updated_at']),
        desc: p.description || '',
      })).filter((p) => p.url).map((p) => (p.url.endsWith('.git') ? p : { ...p, url: `${p.url}.git` }));
      return { items, hasMore: items.length >= pageSize, page };
    },

    async listBranches({ repoId } = {}) {
      if (!repoId) throw new Error('缺少 repoId');
      const q = new URLSearchParams({ per_page: '100' });
      const list = await apiGetJson(
        `${api}/projects/${encodeURIComponent(repoId)}/repository/branches?${q}`,
        headers
      );
      return (Array.isArray(list) ? list : []).map((b) => {
        const c = b.commit || {};
        return {
          name: b.name,
          sha: pick(c, ['id', 'sha']),
          message: String(pick(c, ['message', 'title'])).split('\n')[0].slice(0, 120),
          author: pick(c, ['author_name'], (c.author && c.author.name) || ''),
          date: pick(c, ['committed_date', 'created_at']),
          protected: !!b.protected,
          merged: !!b.merged,
        };
      });
    },
  };
};
