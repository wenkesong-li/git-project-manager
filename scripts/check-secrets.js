'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['cloud-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bLTAI[A-Za-z0-9]{16,}\b/],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ['private-network-address', /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['embedded-url-password', /https?:\/\/[^\s/'"<>:{}]+:[^\s/'"<>@{}]+@/],
];
const forbidden = /(?:^|\/)(?:\.env(?:\..*)?|secret\.key|desktop-preferences\.json|[^/]+\.(?:db(?:-(?:wal|shm|journal))?|p12|pfx|pem|key|gitpm-backup\.json))$/i;
function inspect(files, root) {
  const findings=[];
  for (const name of new Set(files)) {
    const file=path.resolve(root,name),relative=path.relative(root,file).replace(/\\/g,'/');
    if(relative.startsWith('../') || path.isAbsolute(relative) || !fs.existsSync(file))continue;
    if(forbidden.test(relative)) { findings.push({file:relative,rule:'private-data-file'});continue; }
    const stat=fs.lstatSync(file);if(!stat.isFile() || stat.size>5*1024*1024)continue;
    const bytes=fs.readFileSync(file);if(bytes.includes(0))continue;
    bytes.toString('utf8').split(/\r?\n/).forEach((line,index)=>{for(const [rule,regex] of rules)if(regex.test(line))findings.push({file:relative,line:index+1,rule});});
  }
  return findings;
}
if(require.main===module) {
  const root=path.resolve(__dirname,'..'),result=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw new Error('无法读取待发布源码清单');
  const files=result.stdout.split('\0').filter(Boolean),findings=inspect(files,root);
  if(findings.length){for(const item of findings)console.error(`${item.file}${item.line?':'+item.line:''} [${item.rule}]`);console.error('敏感信息检查未通过；仅报告位置，不输出匹配内容。');process.exitCode=1;}
  else console.log(`敏感信息检查通过：${new Set(files).size} 个源码路径。此检查不能替代人工审查。`);
}
module.exports=inspect;
