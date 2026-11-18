'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const files = require('./files');

module.exports = function createFileOperations(db, trashRoot) {
  db.exec(`CREATE TABLE IF NOT EXISTS file_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, project_name TEXT NOT NULL,
    path TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', backup_key TEXT,
    restored INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS file_operations_project ON file_operations(project_id,id);`);
  const busy = new Set();
  function record(project, relative, action, detail = '', backup = null) {
    return Number(db.prepare('INSERT INTO file_operations(project_id,project_name,path,action,detail,backup_key,created_at) VALUES(?,?,?,?,?,?,?)').run(project.id,project.name,relative,action,detail,backup,new Date().toISOString()).lastInsertRowid);
  }
  async function locked(project, relative, fn) {
    const key = `${project.id}:${relative}`;
    if (busy.has(key)) throw new Error('该文件正在操作，请稍后重试');
    busy.add(key); try { return await fn(); } finally { busy.delete(key); }
  }
  return {
    record,
    list(project, before = 0) {
      const rows = db.prepare('SELECT id,path,action,detail,restored,created_at,backup_key FROM file_operations WHERE project_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 101').all(project.id,before,before);
      return { items: rows.slice(0,100).map(({backup_key,...row})=>({...row,canRestore:row.action==='delete' && !row.restored && !!backup_key && fs.existsSync(path.join(trashRoot,backup_key))})), hasMore:rows.length>100 };
    },
    async save(project, relative, content, revision) {
      return locked(project,relative,async()=>{
        const target=files.resolveEntry(project.local_path,relative);
        if (!fs.statSync(target).isFile()) throw new Error('只能保存普通文件');
        const next=Buffer.from(String(content),'utf8');
        if(next.length>2*1024*1024) throw new Error('文件超过 2MB，不支持在线编辑');
        const previous=fs.readFileSync(target);
        if(revision && crypto.createHash('sha256').update(previous).digest('hex')!==revision) throw new Error('磁盘文件已被其他程序修改，请重新打开后再编辑，避免覆盖');
        fs.writeFileSync(target,next);
        try { record(project,relative,'save',`${previous.length} → ${next.length} 字节`); }
        catch(error) { fs.writeFileSync(target,previous); throw error; }
        return {ok:true,revision:crypto.createHash('sha256').update(next).digest('hex')};
      });
    },
    async remove(project, relative) {
      return locked(project,relative,async()=>{
        const target=files.resolveEntry(project.local_path,relative);
        const lexical=path.resolve(fs.realpathSync(project.local_path),relative);
        if(fs.lstatSync(lexical).isSymbolicLink() || !fs.statSync(target).isFile()) throw new Error('仅支持删除普通文件，不支持目录或链接');
        fs.mkdirSync(trashRoot,{recursive:true,mode:0o700});
        const key=crypto.randomUUID(), backup=path.join(trashRoot,key);
        await fs.promises.copyFile(target,backup,fs.constants.COPYFILE_EXCL);
        try {
          await fs.promises.unlink(target);
          const id=record(project,relative,'delete','已移至应用回收站',key);
          return {ok:true,operationId:id};
        } catch(error) {
          if(!fs.existsSync(target)) await fs.promises.copyFile(backup,target,fs.constants.COPYFILE_EXCL);
          throw error;
        }
      });
    },
    async restore(project, id) {
      const row=db.prepare('SELECT * FROM file_operations WHERE id=? AND project_id=?').get(id,project.id);
      if(!row || row.action!=='delete' || row.restored || !/^[a-f0-9-]{36}$/.test(row.backup_key || '')) throw new Error('记录不存在或文件已恢复');
      return locked(project,row.path,async()=>{
        const parent=files.resolveEntry(project.local_path,path.dirname(row.path)==='.'?'':path.dirname(row.path),true);
        const target=path.join(parent,path.basename(row.path));
        if(fs.existsSync(target)) throw new Error('已有同名文件，不会覆盖，请先处理现有文件');
        const backup=path.join(trashRoot,row.backup_key);
        if(!fs.existsSync(backup)) throw new Error('回收站备份不存在');
        await fs.promises.copyFile(backup,target,fs.constants.COPYFILE_EXCL);
        try { db.transaction(()=>{db.prepare('UPDATE file_operations SET restored=1 WHERE id=?').run(row.id);record(project,row.path,'restore','从应用回收站恢复');})(); }
        catch(error) { await fs.promises.unlink(target);throw error; }
        return {ok:true,path:row.path};
      });
    },
  };
};
