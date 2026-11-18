'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('../server/sqlite');
function cipher(key) {
  return { encrypt(value) { if (!value) return ''; const iv = crypto.randomBytes(12), instance = crypto.createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([instance.update(value, 'utf8'), instance.final()]); return Buffer.concat([iv, instance.getAuthTag(), data]).toString('base64'); }, decrypt(value) { if (!value) return ''; const data = Buffer.from(value, 'base64'), instance = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); instance.setAuthTag(data.subarray(12,28)); return Buffer.concat([instance.update(data.subarray(28)), instance.final()]).toString('utf8'); } };
}
function model(directory) {
  fs.mkdirSync(directory, { recursive: true }); const db = new Database(path.join(directory, 'data.db')); db.pragma('journal_mode=WAL');
  db.exec(`CREATE TABLE hosts(id INTEGER PRIMARY KEY,name TEXT,type TEXT,base_url TEXT,username TEXT,org_id TEXT,token_enc TEXT); CREATE TABLE projects(id INTEGER PRIMARY KEY,host_id INTEGER,name TEXT,remote_url TEXT,local_path TEXT UNIQUE,default_branch TEXT); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);`);
  require('../server/file-operations')(db, path.join(directory, 'file-trash'));
  return { db, listHosts: () => db.prepare('SELECT * FROM hosts').all(), listProjects: () => db.prepare('SELECT * FROM projects').all(), getHost: id => db.prepare('SELECT * FROM hosts WHERE id=?').get(id), getProject: id => db.prepare('SELECT * FROM projects WHERE id=?').get(id), getSetting: (key, fallback) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? fallback, setSetting: (key, value) => db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value), insertHost(value) { const info = db.prepare('INSERT INTO hosts(name,type,base_url,username,org_id,token_enc) VALUES(?,?,?,?,?,?)').run(value.name,value.type,value.base_url||'',value.username||'',value.org_id||'',value.token_enc||''); return this.getHost(info.lastInsertRowid); }, updateHost(id,value) { db.prepare('UPDATE hosts SET token_enc=? WHERE id=?').run(value.token_enc,id); }, insertProject(value) { const info = db.prepare('INSERT INTO projects(host_id,name,remote_url,local_path,default_branch) VALUES(?,?,?,?,?)').run(value.host_id,value.name,value.remote_url,value.local_path,value.default_branch); return this.getProject(info.lastInsertRowid); } };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpm-config-')), sourceDir = path.join(root,'source'), destination = path.join(root,'destination'), repo = path.join(root,'repo'); fs.mkdirSync(repo);
  const source = model(sourceDir), target = model(destination), sourceKey = crypto.randomBytes(32), targetCipher = cipher(crypto.randomBytes(32)), token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(sourceDir,'secret.key'),sourceKey);
  source.db.prepare('INSERT INTO hosts VALUES(7,?,?,?,?,?,?)').run('fixture','github','https://example.invalid','','',cipher(sourceKey).encrypt(token));
  source.db.prepare('INSERT INTO projects VALUES(10,7,?,?,?,?)').run('fixture','',repo,'main');
  source.setSetting('local_environment',JSON.stringify({ nodePath:process.execPath })); source.setSetting('workspace',repo); source.setSetting('ui_preferences',JSON.stringify({theme:'bluewhite',lastRoute:'#/project/10',editor:{fontSize:16}}));
  const service = require('../server/configuration')({ dbm:target, DATA_DIR:destination, crypto:targetCipher });
  t.after(() => { source.db.close(); target.db.close(); assert.equal(path.dirname(root),path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('gitpm-config-')); fs.rmSync(root,{recursive:true,force:true}); });
  return {root,sourceDir,source,target,targetCipher,token,service,destination,repo,sourceKey};
}
test('legacy migration reads a live WAL database, re-encrypts credentials and preserves existing data on repeated imports', t => {
  const {service,sourceDir,source,target,targetCipher,token,sourceKey} = fixture(t);
  const preview=service.inspectLegacy(sourceDir); assert.equal(preview.projects,1);assert.equal(preview.credentials,1); assert.ok(!JSON.stringify(preview).includes(token));
  const result=service.importLegacy(sourceDir); assert.equal(result.projectsAdded,1); assert.equal(result.hostsAdded,1); assert.equal(result.preferences.lastRoute,'#/project/1');
  const imported=target.listHosts()[0];assert.equal(targetCipher.decrypt(imported.token_enc),token);assert.notEqual(imported.token_enc,source.listHosts()[0].token_enc);assert.deepEqual(fs.readFileSync(path.join(sourceDir,'secret.key')),sourceKey);
  target.updateHost(imported.id,{token_enc:targetCipher.encrypt('existing-local-value')});
  const again=service.importLegacy(sourceDir); assert.equal(again.projectsAdded,0);assert.equal(again.skipped,1); assert.equal(targetCipher.decrypt(target.listHosts()[0].token_enc),'existing-local-value'); assert.equal(target.listProjects()[0].host_id,imported.id);
});
test('exports omit credentials by default, encrypted backups round trip and wrong passwords make no changes', t => {
  const {service,sourceDir,token,target} = fixture(t); service.importLegacy(sourceDir);
  const plain=service.export({}); assert.ok(!JSON.stringify(plain).includes(token));assert.ok(!JSON.stringify(plain).includes('token_enc'));assert.equal(plain.encrypted,false);
  const password=crypto.randomBytes(16).toString('hex'), backup=service.export({includeSecrets:true,password}); assert.equal(backup.encrypted,true); assert.ok(!JSON.stringify(backup).includes(token));assert.ok(!JSON.stringify(backup).includes('example.invalid'));
  assert.equal(service.inspectBackup(backup,password).credentials,1);
  const count=target.listProjects().length;assert.throws(()=>service.importBackup(backup,'incorrect'),/密码错误/);assert.equal(target.listProjects().length,count);
  assert.throws(()=>service.export({includeSecrets:true,password:'short'}),/至少 10/);
  const malformed={kind:'gitpm-config',version:1,encrypted:false,payload:{hosts:[],projects:[{name:'invalid',local_path:'relative'}]}};assert.throws(()=>service.importBackup(malformed),/项目配置无效/);assert.equal(target.listProjects().length,count);
});
test('legacy file operation records keep recoverable backups after migration without modifying source files', t => {
  const {service,sourceDir,source,target,destination} = fixture(t), key=crypto.randomUUID(); fs.mkdirSync(path.join(sourceDir,'file-trash'));fs.writeFileSync(path.join(sourceDir,'file-trash',key),'recoverable fixture');
  source.db.prepare('INSERT INTO file_operations(project_id,project_name,path,action,detail,backup_key,restored,created_at) VALUES(10,?,?,?,?,?,0,?)').run('fixture','removed.txt','delete','fixture',key,new Date().toISOString());
  assert.equal(service.importLegacy(sourceDir).recordsAdded,1);const row=target.db.prepare('SELECT * FROM file_operations').get();assert.notEqual(row.backup_key,key);assert.equal(fs.readFileSync(path.join(destination,'file-trash',row.backup_key),'utf8'),'recoverable fixture');assert.equal(fs.readFileSync(path.join(sourceDir,'file-trash',key),'utf8'),'recoverable fixture');assert.equal(service.importLegacy(sourceDir).recordsAdded,0);
});
test('preference validation keeps supported themes and bounds editor options', () => {
  const sanitize=require('../server/preferences'); assert.deepEqual(sanitize({theme:'reactbits',fontScale:125,editor:{fontSize:18,wordWrap:true,minimap:false}}),{theme:'reactbits',fontScale:125,editor:{fontSize:18,wordWrap:true,minimap:false}});assert.deepEqual(sanitize({theme:'unknown',fontScale:999,editor:{fontSize:999},secret:'ignored'}),{editor:{}});
});

test('legacy and backup migration remap project SDK overrides to destination project IDs', t=>{
  const {service,sourceDir,source,target}=fixture(t);
  source.setSetting('project_environment_10',JSON.stringify({javaHome:path.join(sourceDir,'jdk17'),mavenHome:''}));
  source.setSetting('environment_search_roots',JSON.stringify([sourceDir]));
  service.importLegacy(sourceDir);
  assert.equal(JSON.parse(target.getSetting('project_environment_1','{}')).javaHome,path.join(sourceDir,'jdk17'));
  assert.equal(target.getSetting('project_environment_10',null),null);
  const backup=service.export({});assert.equal(backup.payload.projectEnvironments[0].projectId,1);
  target.db.prepare("DELETE FROM settings WHERE key='project_environment_1'").run();
  service.importBackup(backup);assert.equal(JSON.parse(target.getSetting('project_environment_1','{}')).javaHome,path.join(sourceDir,'jdk17'));
});
test('first-run onboarding discovers existing data, allows postponement and does not repeat', t => {
  const { service, sourceDir } = fixture(t), previousDesktop = process.env.GITPM_DESKTOP, previousLegacy = process.env.GITPM_LEGACY_DATA_DIR;
  process.env.GITPM_DESKTOP = '1'; process.env.GITPM_LEGACY_DATA_DIR = sourceDir;
  t.after(() => { if (previousDesktop === undefined) delete process.env.GITPM_DESKTOP; else process.env.GITPM_DESKTOP = previousDesktop; if (previousLegacy === undefined) delete process.env.GITPM_LEGACY_DATA_DIR; else process.env.GITPM_LEGACY_DATA_DIR = previousLegacy; });
  const status = service.onboarding(); assert.equal(status.required,true); assert.equal(status.sources[0].projects,1); service.finish(); assert.equal(service.onboarding().required,false);
});
