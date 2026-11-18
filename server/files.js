'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function within(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function resolveEntry(root, relative, allowRoot = false) {
  const rel = String(relative || '');
  if ((!rel && !allowRoot) || rel.includes('\0') || path.isAbsolute(rel) || path.win32.isAbsolute(rel) || rel.replace(/\\/g, '/').split('/').some(part => part === '..' || part.toLowerCase() === '.git')) throw new Error('非法文件路径');
  const base = fs.realpathSync(root);
  const file = path.resolve(base, rel || '.');
  if (!within(base, file)) throw new Error('路径越界');
  const real = fs.realpathSync(file);
  if (!within(base, real)) throw new Error('链接指向仓库外，无法查看');
  const realRelative = path.relative(base, real);
  if (realRelative.split(path.sep).some(part => part.toLowerCase() === '.git')) throw new Error('不支持访问 Git 内部文件');
  return real;
}
async function listDirectory(root, relative = '', offset = 0, limit = 200) {
  const directory = resolveEntry(root, relative, true);
  if (!fs.statSync(directory).isDirectory()) throw new Error('目录不存在');
  const entries = (await fs.promises.readdir(directory, { withFileTypes: true })).filter(entry => entry.name.toLowerCase() !== '.git');
  const items = entries.map(entry => {
    const rel = relative ? `${relative.replace(/\\/g, '/')}/${entry.name}` : entry.name;
    let type = entry.isDirectory() ? 'directory' : 'file', accessible = true;
    if (entry.isSymbolicLink()) {
      try { type = fs.statSync(resolveEntry(root, rel)).isDirectory() ? 'directory' : 'file'; }
      catch { type = 'link'; accessible = false; }
    }
    return { name: entry.name, path: rel, type, link: entry.isSymbolicLink(), accessible };
  }).sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  return { items: items.slice(offset, offset + limit), total: items.length, hasMore: offset + limit < items.length };
}
function readFile(root, relative) {
  const file = resolveEntry(root, relative);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('文件不存在');
  if (stat.size > 2 * 1024 * 1024) throw new Error('文件超过 2MB，不支持在线查看');
  const buffer = fs.readFileSync(file);
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
  else if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) mime = 'image/gif';
  else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  const binary = !!mime || buffer.includes(0);
  return { path: relative, size: stat.size, revision:crypto.createHash('sha256').update(buffer).digest('hex'), binary, content: binary ? '' : buffer.toString('utf8'), ...(mime ? { image: `data:${mime};base64,${buffer.toString('base64')}` } : {}) };
}
async function searchFiles(root, query, signal) {
  const needle=String(query || '').trim().toLowerCase();
  if(!needle) return {items:[],truncated:false};
  const found=[], queue=['']; let scanned=0;
  while(queue.length && scanned<40000 && found.length<300) {
    if(signal?.aborted) break;
    const relative=queue.shift();
    let entries;
    try { entries=await fs.promises.readdir(resolveEntry(root,relative,true),{withFileTypes:true}); } catch {continue;}
    for(const entry of entries) {
      if(entry.name.toLowerCase()==='.git')continue;
      const itemPath=relative?`${relative}/${entry.name}`:entry.name;
      scanned++;
      if(entry.isSymbolicLink()) continue;
      if(entry.isDirectory())queue.push(itemPath);
      else if(entry.isFile() && itemPath.toLowerCase().includes(needle))found.push({name:entry.name,path:itemPath,type:'file',accessible:true});
      if(scanned>=40000 || found.length>=300)break;
    }
  }
  return {items:found.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true})),truncated:queue.length>0 || scanned>=40000 || found.length>=300,scanned};
}
module.exports = { resolveEntry, listDirectory, readFile, searchFiles };
