// Codeup（阿里云云效）适配器 —— 走云效官方 MCP 端点（JSON-RPC over HTTP）
// 参考 codeup-manager 项目实测：codeup.aliyun.com/api/v4 对程序化访问返回 HTML 页面，不可用；
// 官方可用通道是 https://openapi-rdc.aliyuncs.com/ai/mcp?toolsets=code-management
// 认证：Authorization: Bearer <个人访问令牌>
'use strict';

const { mask } = require('../git');

const ENDPOINT = 'https://openapi-rdc.aliyuncs.com/ai/mcp?toolsets=code-management';
const RPC_TIMEOUT = 30000;
const PER_PAGE = 100;

module.exports = function createCodeupAdapter(cfg) {
  /** 原始 JSON-RPC 调用（兼容 JSON 与 SSE 两种返回格式） */
  async function rpc(method, params) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT),
        redirect: 'error',
      });
    } catch (e) {
      throw new Error(`云效网络请求失败：${e.cause ? e.cause.code || e.cause.message : e.message}`);
    }
    const text = await res.text();

    let data = null;
    try {
      data = text.trimStart().startsWith('{')
        ? JSON.parse(text)
        : text
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
            .find((v) => v && (v.result || v.error));
    } catch { data = null; }

    if (!res.ok) {
      const snippet = mask(text).slice(0, 200);
      throw new Error(`云效 MCP HTTP ${res.status}${snippet ? `：${snippet}` : ''}`);
    }
    if (!data) throw new Error(`云效 MCP 返回无法解析的内容（可能令牌无效或接口变更）`);
    if (data.error) {
      const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : String(data.error);
      throw new Error(`云效 MCP 错误：${mask(msg).slice(0, 200)}`);
    }
    if (data.result && data.result.isError) {
      const t = (data.result.content || []).find((c) => c.type === 'text');
      throw new Error(`云效 MCP 调用失败：${mask(t ? t.text : '无详情').slice(0, 200)}`);
    }
    return data.result;
  }

  /** 调用 MCP 工具并解析业务 JSON */
  async function callTool(name, args) {
    const result = await rpc('tools/call', { name, arguments: args });
    const item = (result.content || []).find((c) => c.type === 'text');
    if (!item) throw new Error('云效 MCP 未返回文本内容');
    try {
      return JSON.parse(item.text);
    } catch {
      throw new Error(`云效 MCP 返回无法解析：${mask(item.text).slice(0, 150)}`);
    }
  }

  /** 组织 ID：优先用户配置，否则取当前用户最近访问的组织 */
  async function resolveOrgId() {
    if (cfg.orgId) return cfg.orgId;
    const u = await callTool('get_current_user', {});
    return u.lastOrganization || (Array.isArray(u.organizations) && u.organizations[0] ? u.organizations[0].id : '') || '';
  }

  function mapRepo(r, organizationId) {
    const url = `${String(r.webUrl || '').replace(/\.git$/, '')}.git`;
    let fullName = r.name;
    try {
      // pathname 形如 /{组织ID}/{分组...}/{仓库}，展示时去掉组织 ID 前缀
      const segs = decodeURIComponent(new URL(r.webUrl).pathname).split('/').filter(Boolean);
      if (segs.length && (!organizationId || segs[0] === organizationId)) segs.shift();
      fullName = segs.join('/') || r.name;
    } catch { /* 保底 name */ }
    return {
      id: String(r.id),
      name: r.path || r.name,
      fullName,
      url,
      defaultBranch: '',
      visibility: '',
      lastActivity: '',
      desc: '',
    };
  }

  function mapBranch(b) {
    const c = b.commit || {};
    return {
      name: b.name,
      sha: c.id || c.shortId || '',
      message: String(c.title || c.message || '').split('\n')[0].slice(0, 120),
      author: c.authorName || '',
      date: c.committedDate || '',
      protected: !!b.protected,
      merged: false,
      isDefault: !!b.defaultBranch,
    };
  }

  return {
    kind: 'codeup',

    async test() {
      const u = await callTool('get_current_user', {});
      let organizations = [];
      try {
        organizations = await callTool('get_user_organizations', {});
        if (!Array.isArray(organizations)) organizations = [];
      } catch { /* 组织列表可选 */ }
      return {
        identity: u.name || u.email || u.id || '未知用户',
        organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
        lastOrganization: u.lastOrganization || '',
      };
    },

    async listProjects({ search, page = 1, pageSize = 20 } = {}) {
      const organizationId = await resolveOrgId();
      if (!organizationId) throw new Error('无法确定组织 ID：请在平台「编辑」中手动填写组织 ID（云效网页地址栏 codeup.aliyun.com/ 后面那串）');

      if (search) {
        // MCP 列表接口不支持关键字过滤：全量拉取（上限 20 页）后本地过滤
        const q = search.toLowerCase();
        const matched = [];
        for (let p = 1; p <= 20; p++) {
          const rows = await callTool('list_repositories', { organizationId, page: p, perPage: PER_PAGE });
          if (!Array.isArray(rows) || !rows.length) break;
          matched.push(...rows.filter((r) =>
            [r.name, r.path, r.webUrl].some((v) => String(v || '').toLowerCase().includes(q))
          ));
          if (rows.length < PER_PAGE) break;
        }
        const start = (page - 1) * pageSize;
        return {
          items: matched.slice(start, start + pageSize).map((r) => mapRepo(r, organizationId)),
          hasMore: matched.length > start + pageSize,
          page,
          organizationId,
          total: matched.length,
        };
      }

      const rows = await callTool('list_repositories', { organizationId, page, perPage: pageSize });
      const arr = Array.isArray(rows) ? rows : [];
      return { items: arr.map((r) => mapRepo(r, organizationId)), hasMore: arr.length >= pageSize, page, organizationId };
    },

    async listBranches({ repoId } = {}) {
      if (!repoId) throw new Error('缺少 repoId');
      const organizationId = await resolveOrgId();
      const all = [];
      for (let p = 1; p <= 5; p++) {
        const rows = await callTool('list_branches', {
          organizationId,
          repositoryId: String(repoId),
          page: p,
          perPage: PER_PAGE,
        });
        if (!Array.isArray(rows) || !rows.length) break;
        all.push(...rows);
        if (rows.length < PER_PAGE) break;
      }
      return all.map(mapBranch);
    },

    /** 轻量单页拉取（列表"最近分支"列渐进补全用，避免全量翻页） */
    async recentBranches({ repoId } = {}) {
      if (!repoId) throw new Error('缺少 repoId');
      const organizationId = await resolveOrgId();
      const rows = await callTool('list_branches', {
        organizationId,
        repositoryId: String(repoId),
        page: 1,
        perPage: 8,
      });
      return (Array.isArray(rows) ? rows : []).map(mapBranch);
    },
  };
};
