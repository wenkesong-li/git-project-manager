// 令牌加密存储：AES-256-GCM，密钥文件与数据库均放在用户主目录 %USERPROFILE%\.gitpm\
// 该目录不在任何 git 仓库内，确保密钥不会被提交上传。
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./paths');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

function loadKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  }
  const key = fs.readFileSync(KEY_FILE);
  if (key.length !== 32) {
    throw new Error(`密钥文件异常（${KEY_FILE}），长度必须为 32 字节。请删除该文件后重启（注意：旧数据将无法解密）`);
  }
  return key;
}

const KEY = loadKey();

/** 加密明文字符串 -> base64（iv + tag + 密文） */
function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 解密 base64 -> 明文；失败抛错 */
function decrypt(b64) {
  if (!b64) return '';
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 29) throw new Error('密文格式非法');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, DATA_DIR };
