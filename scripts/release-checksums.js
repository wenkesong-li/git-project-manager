'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.argv[2] || 'release-assets');
const files=fs.readdirSync(root).filter(name=>/\.(exe|dmg|zip|blockmap|yml)$/.test(name)).sort();
for(const suffix of ['-win-x64.exe','-mac-x64.dmg','-mac-arm64.dmg','-mac-x64.zip','-mac-arm64.zip'])if(!files.some(name=>name.endsWith(suffix)))throw Error(`缺少发行包：${suffix}`);
for(const name of ['latest.yml','latest-mac.yml'])if(!files.includes(name))throw Error(`缺少更新清单：${name}`);
fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),files.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')}  ${name}`).join('\n')+'\n');
console.log(`已验证双端安装包并生成 ${files.length} 项 SHA-256 校验值`);
