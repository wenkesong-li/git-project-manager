// Gitee（码云）适配器 —— OpenAPI v5，access_token 查询参数认证
'use strict';

const { apiGetJson, pick } = require('./helpers');

module.exports = function createGiteeAdapter(cfg) {
  const base = String(cfg.baseUrl || 'https://gitee.com').trim().replace(/\/+$/, '');
  const token = cfg.token;

  const qs = (extra) => {
    const p = new URLSearchParams({ ...(extra || {}) });
    if (token) p.set('access_token', token);
    return p;
  };

  return {
    kind: 'gitee',

    async test() {
      const u = await apiGetJson(`${base}/api/v5/user?${qs()}`);
      return { identity: pick(u, ['login', 'name'], '未知用户') };
    },

    async listProjects({ search, page = 1, pageSize = 20 } = {}) {
      const p = new URLSearchParams({
        visibility: 'all',
        affiliation: 'owner,collaborator,organization_member',
        sort: 'updated',
        direction: 'desc',
        per_page: String(pageSize),
        page: String(page),
      });
      if (token) p.set('access_token', token);
      if (search) p.set('q', search);
      const list = await apiGetJson(`${base}/api/v5/user/repos?${p}`);
      const items = (Array.isArray(list) ? list : []).map((r) => ({
        id: String(pick(r, ['id'])),
        name: pick(r, ['path', 'name']),
        fullName: pick(r, ['full_name']),
        url: `${pick(r, ['html_url', 'url'])}.git`,
        defaultBranch: pick(r, ['default_branch']),
        visibility: r.private === true ? 'private' : 'public',
        lastActivity: pick(r, ['updated_at']),
        desc: r.description || '',
      }));
      return { items, hasMore: items.length >= pageSize, page };
    },

    async listBranches({ fullName } = {}) {
      if (!fullName) throw new Error('缺少 fullName');
      const p = new URLSearchParams({ per_page: '100' });
      if (token) p.set('access_token', token);
      const list = await apiGetJson(`${base}/api/v5/repos/${fullName}/branches?${p}`);
      return (Array.isArray(list) ? list : []).map((b) => {
        const c = (b.commit && b.commit.commit) || {};
        return {
          name: b.name,
          sha: pick(b.commit || {}, ['sha']),
          message: String(pick(c, ['message'])).split('\n')[0].slice(0, 120),
          author: pick(c.author || {}, ['name']),
          date: pick(c.author || {}, ['date']),
          protected: !!b.protected,
          merged: false,
        };
      });
    },
  };
};
