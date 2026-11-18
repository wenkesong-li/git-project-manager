// 远程仓库认证解析：根据仓库 URL 匹配已存平台，产出带令牌的访问 URL
'use strict';

const urlutil = require('./urlutil');
const { addSecret } = require('./git');

/**
 * 解析仓库 URL 的访问方式。
 * @param {object} dbm  db 模块
 * @param {string} remoteUrl 仓库地址（可能已含令牌，会先剥离）
 * @param {number|null} preferHostId 优先使用的平台 id（如从平台页发起的克隆）
 * @returns {{cleanUrl:string, authUrl:string, host:object|null}}
 */
function resolveAuth(dbm, remoteUrl, preferHostId) {
  const cleanUrl = urlutil.stripAuth(remoteUrl);
  let host = preferHostId ? dbm.getHost(preferHostId) : null;
  if (!host || !urlutil.hostMatchesUrl(host, cleanUrl)) {
    host = dbm.listHosts().find((h) => urlutil.hostMatchesUrl(h, cleanUrl)) || null;
  }
  if (!host || !host.token_enc) {
    // 无凭证（公开仓库可直接访问）；私有库 git 会报错并提示配置令牌
    return { cleanUrl, authUrl: cleanUrl, host };
  }
  // 延迟 require 避免循环依赖
  const { decrypt } = require('./crypto');
  let token = '';
  try {
    token = decrypt(host.token_enc);
  } catch {
    token = '';
  }
  if (token) addSecret(token);
  const user = urlutil.defaultUser(host.type, host.username);
  return {
    cleanUrl,
    authUrl: urlutil.embedAuth(cleanUrl, user, token),
    host,
  };
}

module.exports = { resolveAuth };
