'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),{execFileSync}=require('child_process');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitpm-publication-'));t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('gitpm-publication-'));fs.rmSync(root,{recursive:true,force:true});});return root;}
test('publication scan blocks private files and common credentials without returning their values',t=>{
  const root=fixture(t),token='gh'+'p_'+'A'.repeat(36);
  fs.writeFileSync(path.join(root,'sample.js'),`const secret='${token}';`);fs.writeFileSync(path.join(root,'secret.key'),'fixture');
  const findings=require('../scripts/check-secrets')(['sample.js','secret.key'],root);
  assert.equal(findings.length,2);assert.equal(findings[0].rule,'github-token');assert.ok(!JSON.stringify(findings).includes(token));
  fs.writeFileSync(path.join(root,'sample.js'),'https://example.invalid/placeholder');assert.deepEqual(require('../scripts/check-secrets')(['sample.js'],root),[]);
});
test('release checksums require both desktop platforms and both macOS architectures',t=>{
  const root=fixture(t),script=path.resolve(__dirname,'../scripts/release-checksums.js');
  fs.writeFileSync(path.join(root,'app-win-x64.exe'),'fixture');assert.throws(()=>execFileSync(process.execPath,[script,root],{stdio:'pipe',windowsHide:true}));
  for(const file of ['app-mac-x64.dmg','app-mac-arm64.dmg','app-mac-x64.zip','app-mac-arm64.zip','latest.yml','latest-mac.yml'])fs.writeFileSync(path.join(root,file),'fixture');
  execFileSync(process.execPath,[script,root],{windowsHide:true});const checks=fs.readFileSync(path.join(root,'SHA256SUMS.txt'),'utf8').trim().split('\n');assert.equal(checks.length,7);assert.ok(checks.every(line=>/^[a-f0-9]{64}  /.test(line)));
});
