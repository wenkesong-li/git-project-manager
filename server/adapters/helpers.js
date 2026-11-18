// 适配器公共 HTTP 助手
'use strict';

const API_TIMEOUT = 15000;

const { mask } = require('../git');

/**
 * GET 请求返回 JSON；非 2xx 抛错（错误信息经令牌脱敏）
 */
async function apiGetJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT) });
  } catch (e) {
    throw new Error(`网络请求失败：${e.cause ? e.cause.code || e.cause.message : e.message}（${mask(url)}）`);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    let msg = text.slice(0, 300);
    if (data && typeof data === 'object') {
      msg = data.message || data.error || (typeof data.message === 'object' ? JSON.stringify(data.message) : '') || msg;
    }
    throw new Error(`API ${res.status}：${mask(String(msg)).slice(0, 300)}`);
  }
  if (data === null) throw new Error(`API 返回非 JSON：${text.slice(0, 120)}`);
  return data;
}

/** 数组安全取值（Codeup/GitLab 各版本字段名略有差异，做兼容读取） */
function pick(obj, keys, defVal = '') {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return defVal;
}

module.exports = { apiGetJson, pick };
