// 通用 Git 适配器 —— 无 API，只能通过 git ls-remote 枚举分支（可配用户名+令牌访问私有库）
'use strict';

module.exports = function createGenericAdapter() {
  return {
    kind: 'generic',
    noApi: true, // 前端据此显示"输入仓库地址查询分支"而不是项目列表

    async test() {
      return { identity: '通用 Git 平台（无需 API 测试）' };
    },

    async listProjects() {
      return { items: [], hasMore: false, unsupported: true };
    },

    async listBranches() {
      throw new Error('通用平台请在界面输入仓库地址，用 git ls-remote 查询分支');
    },
  };
};
