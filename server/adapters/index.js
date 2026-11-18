// 适配器工厂：host 数据库行 -> 平台适配器实例（token 已解密）
'use strict';

const createGitlab = require('./gitlab');
const createCodeup = require('./codeup');
const createGitee = require('./gitee');
const createGithub = require('./github');
const createGeneric = require('./generic');
const { decrypt } = require('../crypto');
const { addSecret } = require('../git');

/**
 * @param {object} hostRow db.hosts 行（含 token_enc）
 * @param {string} [plainToken] 已解密的令牌（优先使用；例如测试连接时表单里新填的令牌）
 */
function createAdapter(hostRow, plainToken) {
  const token = plainToken !== undefined ? plainToken : (hostRow.token_enc ? decrypt(hostRow.token_enc) : '');
  if (token) addSecret(token); // 注册脱敏，防泄漏到日志
  const cfg = {
    name: hostRow.name,
    type: hostRow.type,
    baseUrl: hostRow.base_url,
    username: hostRow.username,
    orgId: hostRow.org_id || '',
    token,
  };
  switch (hostRow.type) {
    case 'codeup':
      // 云效 Codeup：走官方 MCP 端点（openapi-rdc.aliyuncs.com），见 codeup.js
      return createCodeup(cfg);
    case 'gitlab':
      return createGitlab(cfg);
    case 'gitee':
      return createGitee(cfg);
    case 'github':
      return createGithub(cfg);
    case 'generic':
      return createGeneric(cfg);
    default:
      throw new Error(`未知平台类型：${hostRow.type}`);
  }
}

module.exports = { createAdapter };
