// GitHub 适配器 —— REST API v3，Bearer token 认证
'use strict';

const { apiGetJson, pick } = require('./helpers');

function resolveApiBase(baseUrl) {
  const u = String(baseUrl || 'https://github.com').trim().replace(/\/+$/, '').replace(/\/api\/v3$/i, '');
  if (!/^https?:\/\//.test(u)) throw new Error('平台地址必须以 http(s):// 开头');
  const host = u.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  // github.com -> api.github.com；GitHub 企业版（自建域名）-> <host>/api/v3
  if (host === 'api.github.com') return u;
  if (host === 'github.com') return 'https://api.github.com';
  return `${u}/api/v3`;
}

module.exports = function createGithubAdapter(cfg) {
  const base = String(cfg.baseUrl || 'https://github.com').trim().replace(/\/+$/, '');
  const api = resolveApiBase(base);
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    kind: 'github',

    async test() {
      const u = await apiGetJson(`${api}/user`, headers);
      return { identity: pick(u, ['login', 'name'], '未知用户') };
    },

    async listProjects({ search, page = 1, pageSize = 20 } = {}) {
      const q = new URLSearchParams({
        per_page: String(pageSize),
        page: String(page),
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      });
      const path = search ? `search/repositories?q=${encodeURIComponent(search)}&per_page=${pageSize}&page=${page}` : `user/repos?${q}`;
      const data = await apiGetJson(`${api}/${path}`, headers);
      const arr = Array.isArray(data) ? data : (data.items || []);
      const items = arr.map((r) => ({
        id: String(r.id),
        name: r.name,
        fullName: r.full_name,
        url: r.clone_url,
        defaultBranch: r.default_branch || '',
        visibility: r.private ? 'private' : 'public',
        lastActivity: r.updated_at || '',
        desc: r.description || '',
      }));
      return { items, hasMore: items.length >= pageSize, page };
    },

    async listBranches({ fullName } = {}) {
      if (!fullName) throw new Error('缺少 fullName');
      const q = new URLSearchParams({ per_page: '100' });
      const list = await apiGetJson(`${api}/repos/${fullName}/branches?${q}`, headers);
      return (Array.isArray(list) ? list : []).map((b) => {
        const c = (b.commit && b.commit.commit) || {};
        return {
          name: b.name,
          sha: pick(b.commit || {}, ['sha']),
          message: String(pick(c, ['message'])).split('\n')[0].slice(0, 120),
          author: pick(c.author || {}, ['name']),
          date: pick(c.committer || c.author || {}, ['date']),
          protected: !!b.protected,
          merged: false,
        };
      });
    },
  };
};
