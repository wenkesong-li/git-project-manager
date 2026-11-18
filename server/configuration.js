'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Database = require('./sqlite');
const settingKeys = ['workspace', 'scan_roots', 'local_environment', 'ui_preferences', 'environment_search_roots'];
function decipher(value, key) {
  if (!value) return '';
  const data = Buffer.from(value, 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
function seal(payload, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { kind: 'gitpm-config', version: 1, encrypted: true, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unpack(backup, password) {
  if (!backup || backup.kind !== 'gitpm-config' || backup.version !== 1) throw new Error('不是支持的配置备份文件');
  if (Buffer.byteLength(JSON.stringify(backup)) > 8 * 1024 * 1024) throw new Error('配置备份超过 8MB');
  if (!backup.encrypted) { if (backup.payload?.hosts?.some(host => host.token)) throw new Error('登录凭据必须使用加密备份'); return backup.payload; }
  try {
    const salt = Buffer.from(backup.salt, 'base64'), iv = Buffer.from(backup.iv, 'base64'), tag = Buffer.from(backup.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || String(password || '').length > 1024) throw new Error();
    const cipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(String(password || ''), salt, 32), iv); cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(backup.data, 'base64')), cipher.final()]).toString('utf8'));
  } catch { throw new Error('备份密码错误或文件已损坏'); }
}
function validate(payload) {
  if (!payload || !Array.isArray(payload.hosts) || !Array.isArray(payload.projects) || payload.hosts.length > 1000 || payload.projects.length > 10000) throw new Error('配置数据格式无效或数量超过上限');
  for (const host of payload.hosts) {
    if (!['codeup','gitlab','gitee','github','generic'].includes(host.type) || typeof host.name !== 'string' || !host.name.trim()) throw new Error('平台配置无效');
    for (const key of ['name','base_url','username','org_id','token']) if (host[key] != null && (typeof host[key] !== 'string' || host[key].length > (key === 'token' ? 65536 : 4096))) throw new Error('平台配置字段无效');
  }
  const ids = new Set(payload.hosts.map(host => String(host.id)));
  if (ids.size !== payload.hosts.length) throw new Error('平台标识重复');
  for (const project of payload.projects) if (typeof project.name !== 'string' || !project.name.trim() || typeof project.local_path !== 'string' || !(path.win32.isAbsolute(project.local_path) || path.posix.isAbsolute(project.local_path)) || project.local_path.length > 4096 || project.host_id != null && !ids.has(String(project.host_id))) throw new Error('项目配置无效，请检查本地路径及平台关联');
  for (const key of settingKeys) if (payload.settings?.[key] != null && (typeof payload.settings[key] !== 'string' || payload.settings[key].length > 65536)) throw new Error('设置内容无效');
  payload.settings = Object.fromEntries(settingKeys.filter(key => payload.settings?.[key] != null).map(key => [key, payload.settings[key]]));
  if (payload.settings.ui_preferences) { try { payload.settings.ui_preferences = JSON.stringify(require('./preferences')(JSON.parse(payload.settings.ui_preferences))); } catch { throw new Error('偏好设置格式无效'); } }
  if (payload.projectEnvironments != null && (!Array.isArray(payload.projectEnvironments) || payload.projectEnvironments.length > 10000)) throw new Error('项目环境格式无效');
  for (const item of payload.projectEnvironments || []) {
    if (!payload.projects.some(project=>String(project.id)===String(item.projectId)) || !item.environment || typeof item.environment!=='object') throw new Error('项目环境关联无效');
    for (const key of ['javaHome','mavenHome','nodePath']) { const value=item.environment[key]; if (value != null && (typeof value!=='string' || value.length>4096 || value && !(path.win32.isAbsolute(value)||path.posix.isAbsolute(value)))) throw new Error('项目环境路径无效'); }
  }
  return payload;
}
function summary(payload) { return { hosts: payload.hosts.length, projects: payload.projects.length, credentials: payload.hosts.filter(host => host.token).length, hasEnvironment: !!payload.settings?.local_environment, records: payload.records?.length || 0, missingProjects: payload.projects.filter(project => !fs.existsSync(project.local_path)).length }; }
module.exports = function configuration(ctx) {
  const { dbm, DATA_DIR } = ctx;
  const destinationCrypto = ctx.crypto || require('./crypto');
  function legacy(source, includeCredentials = false) {
    const directory = fs.realpathSync(String(source || ''));
    if (directory === fs.realpathSync(DATA_DIR)) throw new Error('不能从当前数据目录重复迁移');
    const file = path.join(directory, 'data.db'); if (!fs.statSync(file).isFile()) throw new Error('没有找到历史数据库');
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try {
      db.exec('BEGIN');
      const hosts = db.prepare('SELECT * FROM hosts LIMIT 1001').all().map(host => ({ id: host.id, name: host.name, type: host.type, base_url: host.base_url, username: host.username, org_id: host.org_id || '', token: '' }));
      const raw = db.prepare('SELECT id,token_enc FROM hosts').all();
      if (includeCredentials && raw.some(host => host.token_enc)) {
        const key = fs.readFileSync(path.join(directory, 'secret.key')); if (key.length !== 32) throw new Error('历史密钥不完整');
        try { for (const host of hosts) host.token = decipher(raw.find(row => row.id === host.id)?.token_enc || '', key); } catch { throw new Error('历史凭据无法解密，请检查数据目录中的密钥文件'); }
      }
      const settings = Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().filter(row => settingKeys.includes(row.key)).map(row => [row.key, row.value]));
      let records = [];
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='file_operations'").get()) records = db.prepare('SELECT * FROM file_operations ORDER BY id DESC LIMIT 10000').all();
      const payload = validate({ hosts, projects: db.prepare('SELECT * FROM projects LIMIT 10001').all(), settings, records, projectEnvironments: db.prepare("SELECT key,value FROM settings WHERE key LIKE 'project_environment_%'").all().map(row=>({projectId:row.key.slice(20),environment:JSON.parse(row.value)})) });
      db.exec('COMMIT');
      return { directory, payload, credentialCount: raw.filter(host => host.token_enc).length };
    } finally { db.close(); }
  }
  function discover() {
    const candidate = process.env.GITPM_LEGACY_DATA_DIR || path.join(os.homedir(), '.gitpm');
    try { const source = legacy(candidate); return [{ path: source.directory, ...summary(source.payload), credentials: source.credentialCount }]; } catch { return []; }
  }
  function apply(payload, legacyDirectory) {
    validate(payload);
    const copied = [], result = { hostsAdded: 0, projectsAdded: 0, skipped: 0, recordsAdded: 0 };
    const projectIds = new Map(), hostIds = new Map();
    try {
      dbm.db.transaction(() => {
        const existingHosts = dbm.listHosts();
        for (const host of payload.hosts) {
          let match = existingHosts.find(item => item.type === host.type && item.base_url.replace(/\/+$/, '') === String(host.base_url || '').replace(/\/+$/, '') && item.username === (host.username || '') && item.org_id === (host.org_id || ''));
          if (!match) { match = dbm.insertHost({ name: host.name, type: host.type, base_url: host.base_url, username: host.username, org_id: host.org_id, token_enc: destinationCrypto.encrypt(host.token || '') }); existingHosts.push(match); result.hostsAdded++; }
          else if (host.token && !match.token_enc) dbm.updateHost(match.id, { token_enc: destinationCrypto.encrypt(host.token) });
          hostIds.set(String(host.id), match.id);
        }
        const existing = dbm.listProjects();
        const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        for (const project of payload.projects) {
          let match = existing.find(item => canonical(item.local_path) === canonical(project.local_path));
          if (!match) { match = dbm.insertProject({ name: project.name, host_id: project.host_id == null ? null : hostIds.get(String(project.host_id)), local_path: project.local_path, remote_url: project.remote_url || '', default_branch: project.default_branch || '' }); existing.push(match); result.projectsAdded++; }
          else result.skipped++;
          projectIds.set(String(project.id), match.id);
        }
        for (const key of settingKeys) if (payload.settings?.[key] != null && dbm.getSetting(key, null) === null) {
          let value = payload.settings[key];
          if (key === 'ui_preferences') { const preferences = JSON.parse(value), match = preferences.lastRoute?.match(/^#\/project\/(\d+)$/); if (match) preferences.lastRoute = projectIds.has(match[1]) ? `#/project/${projectIds.get(match[1])}` : '#/'; value = JSON.stringify(preferences); }
          dbm.setSetting(key, value);
        }
        for (const item of payload.projectEnvironments || []) { const id=projectIds.get(String(item.projectId)); if(id && dbm.getSetting(`project_environment_${id}`,null)===null) dbm.setSetting(`project_environment_${id}`,JSON.stringify(item.environment)); }
        if (legacyDirectory) for (const row of payload.records || []) {
          const projectId = projectIds.get(String(row.project_id)); if (!projectId || !['save','copy','format','delete','restore'].includes(row.action)) continue;
          if (dbm.db.prepare('SELECT id FROM file_operations WHERE project_id=? AND path=? AND action=? AND created_at=? LIMIT 1').get(projectId, row.path, row.action, row.created_at)) continue;
          let backup = null;
          if (row.action === 'delete' && !row.restored && /^[a-f0-9-]{36}$/.test(row.backup_key || '')) {
            const source = path.join(legacyDirectory, 'file-trash', row.backup_key);
            if (fs.existsSync(source) && !fs.lstatSync(source).isSymbolicLink() && fs.statSync(source).isFile() && path.dirname(fs.realpathSync(source)) === fs.realpathSync(path.join(legacyDirectory, 'file-trash'))) { const directory = path.join(DATA_DIR, 'file-trash'); fs.mkdirSync(directory, { recursive: true }); backup = crypto.randomUUID(); const target = path.join(directory, backup); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); copied.push(target); }
          }
          dbm.db.prepare('INSERT INTO file_operations(project_id,project_name,path,action,detail,backup_key,restored,created_at) VALUES(?,?,?,?,?,?,?,?)').run(projectId, dbm.getProject(projectId).name, row.path, row.action, row.detail || '', backup, row.restored ? 1 : 0, row.created_at); result.recordsAdded++;
        }
        dbm.setSetting('onboarding_done', '1');
      })();
    } catch (error) { for (const file of copied) { try { fs.unlinkSync(file); } catch {} } throw error; }
      return { ...result, preferences: require('./preferences')(JSON.parse(dbm.getSetting('ui_preferences', '{}'))) };
  }
  return {
    onboarding: () => ({ required: process.env.GITPM_DESKTOP === '1' && dbm.getSetting('onboarding_done', '') !== '1' && dbm.listProjects().length === 0 && dbm.listHosts().length === 0, sources: discover() }),
    finish: () => { dbm.setSetting('onboarding_done', '1'); return { ok: true }; },
    inspectLegacy: source => { const value = legacy(source); return { path: value.directory, ...summary(value.payload), credentials: value.credentialCount }; },
    importLegacy: source => { const value = legacy(source, true); const result = apply(value.payload, value.directory); ctx.javaIntelligence?.close(); return result; },
    export(body) {
      const payload = { hosts: dbm.listHosts().map(host => ({ id: host.id, name: host.name, type: host.type, base_url: host.base_url, username: host.username, org_id: host.org_id, ...(body.includeSecrets ? { token: destinationCrypto.decrypt(host.token_enc) } : {}) })), projects: dbm.listProjects(), settings: Object.fromEntries(settingKeys.map(key => [key, dbm.getSetting(key, null)]).filter(([, value]) => value !== null)) };
      payload.projectEnvironments = payload.projects.map(project=>({projectId:project.id,environment:JSON.parse(dbm.getSetting(`project_environment_${project.id}`, '{}'))}));
      if (body.preferences) payload.settings.ui_preferences = JSON.stringify(require('./preferences')(body.preferences));
      if (body.includeSecrets && String(body.password || '').length < 10) throw new Error('包含凭据时，请设置至少 10 位备份密码');
      if (String(body.password || '').length > 1024) throw new Error('备份密码过长');
      const backup = body.includeSecrets || body.password ? seal(payload, String(body.password)) : { kind: 'gitpm-config', version: 1, encrypted: false, payload };
      if (Buffer.byteLength(JSON.stringify(backup)) > 8 * 1024 * 1024) throw new Error('配置备份超过 8MB');
      return backup;
    },
    inspectBackup: (backup, password) => summary(validate(unpack(backup, password))),
    importBackup: (backup, password) => { const result = apply(unpack(backup, password)); ctx.javaIntelligence?.close(); return result; },
  };
};
