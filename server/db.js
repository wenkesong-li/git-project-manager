// SQLite 数据库（better-sqlite3），库文件存放于用户主目录，不随项目上传
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('./sqlite');
const { DATA_DIR } = require('./crypto');

const DB_FILE = path.join(DATA_DIR, 'data.db');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('codeup','gitlab','gitee','github','generic')),
  base_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  token_enc TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER,
  name TEXT NOT NULL,
  remote_url TEXT NOT NULL DEFAULT '',
  local_path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL DEFAULT '',
  last_sync_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (host_id) REFERENCES hosts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// 迁移：旧库补充 org_id 列（云效 Codeup 组织 ID，可选）
try {
  db.prepare("ALTER TABLE hosts ADD COLUMN org_id TEXT NOT NULL DEFAULT ''").run();
} catch (e) {
  if (!/duplicate column/i.test(String(e.message))) throw e;
}

// ---------- settings ----------
function getSetting(key, defVal) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defVal;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// ---------- hosts ----------
const HOST_COLS = ['id', 'name', 'type', 'base_url', 'username', 'org_id', 'token_enc', 'created_at', 'updated_at'];
function rowToHost(row) {
  return row ? Object.fromEntries(HOST_COLS.map((c) => [c, row[c]])) : null;
}
function listHosts() {
  return db.prepare('SELECT * FROM hosts ORDER BY id').all().map(rowToHost);
}
function getHost(id) {
  return rowToHost(db.prepare('SELECT * FROM hosts WHERE id = ?').get(id));
}
function insertHost({ name, type, base_url, username, org_id, token_enc }) {
  const info = db.prepare(
    'INSERT INTO hosts (name, type, base_url, username, org_id, token_enc) VALUES (?,?,?,?,?,?)'
  ).run(name, type, base_url || '', username || '', org_id || '', token_enc || '');
  return getHost(info.lastInsertRowid);
}
function updateHost(id, fields) {
  const allowed = ['name', 'type', 'base_url', 'username', 'org_id', 'token_enc'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return getHost(id);
  sets.push(`updated_at = datetime('now','localtime')`);
  vals.push(id);
  db.prepare(`UPDATE hosts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getHost(id);
}
function deleteHost(id) {
  db.prepare('UPDATE projects SET host_id = NULL WHERE host_id = ?').run(id);
  db.prepare('DELETE FROM hosts WHERE id = ?').run(id);
}

// ---------- projects ----------
const PROJ_COLS = ['id', 'host_id', 'name', 'remote_url', 'local_path', 'default_branch', 'last_sync_at', 'created_at'];
function rowToProject(row) {
  return row ? Object.fromEntries(PROJ_COLS.map((c) => [c, row[c]])) : null;
}
function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY name').all().map(rowToProject);
}
function getProject(id) {
  return rowToProject(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}
function insertProject({ host_id, name, remote_url, local_path, default_branch }) {
  const info = db.prepare(
    'INSERT INTO projects (host_id, name, remote_url, local_path, default_branch) VALUES (?,?,?,?,?)'
  ).run(host_id ?? null, name, remote_url || '', local_path, default_branch || '');
  touchSync(info.lastInsertRowid);
  return getProject(info.lastInsertRowid);
}
function updateProject(id, fields) {
  const allowed = ['name', 'remote_url', 'local_path', 'default_branch', 'last_sync_at'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (!sets.length) return getProject(id);
  vals.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getProject(id);
}
function deleteProject(id) {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
function touchSync(id) {
  db.prepare(`UPDATE projects SET last_sync_at = datetime('now','localtime') WHERE id = ?`).run(id);
}
function findByLocalPath(p) {
  return rowToProject(db.prepare('SELECT * FROM projects WHERE local_path = ?').get(p));
}

module.exports = {
  db, DB_FILE,
  getSetting, setSetting,
  listHosts, getHost, insertHost, updateHost, deleteHost,
  listProjects, getProject, insertProject, updateProject, deleteProject, touchSync, findByLocalPath,
};
