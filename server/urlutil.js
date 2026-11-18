// URL 工具：认证信息嵌入/剥离、host 匹配
'use strict';

const URL_RE = /^(https?:\/\/)(?:([^@/]+)@)?([^/:]+)(?::\d+)?(\/.*)?$/i;

function parse(url) {
  const m = String(url || '').trim().match(URL_RE);
  if (!m) return null;
  return { scheme: m[1], userinfo: m[2] || '', host: m[3], path: m[4] || '' };
}

/** 去掉 URL 中的用户凭证，得到干净 URL */
function stripAuth(url) {
  const p = parse(url);
  if (!p) return String(url || '').trim();
  return `${p.scheme}${p.host}${p.path}`;
}

/** host（含端口场景按域名比较即可） */
function hostOf(url) {
  const p = parse(url);
  return p ? p.host.toLowerCase() : '';
}

/** 任意写法（https/ssh/git@）的 host 提取，基于归一化键 */
function hostOfAny(url) {
  return urlKey(url).split('/')[0] || '';
}

/**
 * 把认证嵌入 HTTPS URL：
 *  - token 为空：返回干净 URL（公开仓库直接可用）
 *  - username 为空：https://{token}@host/path
 *  - 都有：https://{username}:{token}@host/path
 */
function embedAuth(url, username, token) {
  const p = parse(url);
  if (!p) return String(url || '').trim();
  let auth = '';
  if (token) {
    auth = username
      ? `${encodeURIComponent(username)}:${encodeURIComponent(token)}@`
      : `${encodeURIComponent(token)}@`;
  }
  return `${p.scheme}${auth}${p.host}${p.path}`;
}

/** 判断某个已存平台（host 行）与仓库 URL 是否同一服务器（兼容 ssh/git@ 写法） */
function hostMatchesUrl(hostRow, url) {
  const a = hostOf(hostRow.base_url || '');
  const b = /^https?:\/\//i.test(String(url || '')) ? hostOf(url) : hostOfAny(url);
  return !!(a && b && a === b);
}

/** 各平台 HTTPS 克隆默认用户名（PAT 作为密码时的惯例） */
function defaultUser(type, username) {
  if (username) return username;
  if (type === 'github') return 'x-access-token';
  return 'oauth2';
}

/**
 * 仓库地址归一化键：https / ssh / git@ 三种写法、.git 后缀有无、大小写，
 * 全部归一为 host/path（小写），用于"同一仓库"匹配。
 * 例：git@codeup.aliyun.com:org/repo.git 与 https://codeup.aliyun.com/org/repo.git → codeup.aliyun.com/org/repo
 */
function urlKey(u) {
  let s = String(u || '').trim().toLowerCase();
  const m1 = s.match(/^git@([^:]+):(.+)$/);            // git@host:path
  const m2 = s.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);   // ssh://git@host/path
  if (m1) s = `${m1[1]}/${m1[2]}`;
  else if (m2) s = `${m2[1]}/${m2[2]}`;
  else {
    const p = parse(s);
    if (p) s = `${p.host}${p.path}`;
  }
  s = s.replace(/\.git$/, '').replace(/\/+$/, '');
  return s;
}

module.exports = { parse, stripAuth, hostOf, hostOfAny, embedAuth, hostMatchesUrl, defaultUser, urlKey };
