'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const sdk=require('../server/sdks');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gitpm-sdks-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('gitpm-sdks-'));fs.rmSync(root,{recursive:true,force:true});});
  function jdk(version) { const home=path.join(root,`jdk-${version}`);fs.mkdirSync(path.join(home,'bin'),{recursive:true});for(const name of ['java','javac'])fs.writeFileSync(path.join(home,'bin',name+(process.platform==='win32'?'.exe':'')),'');fs.writeFileSync(path.join(home,'release'),`JAVA_VERSION="${version}"\nIMPLEMENTOR="Fixture"`);return home; }
  function maven(version) { const home=path.join(root,`apache-maven-${version}`);fs.mkdirSync(path.join(home,'bin'),{recursive:true});fs.mkdirSync(path.join(home,'lib'));fs.writeFileSync(path.join(home,'lib',`maven-core-${version}.jar`),'');const file=path.join(home,'bin',process.platform==='win32'?'mvn.cmd':'mvn');fs.writeFileSync(file,process.platform==='win32'?`@echo off\r\necho Maven-${version}\r\necho %JAVA_HOME%\r\n`:`#!/bin/sh\necho Maven-${version}\necho "$JAVA_HOME"\n`);fs.chmodSync(file,0o755);return home; }
  return {root,jdk,maven};
}
test('SDK catalog finds multiple JDK and Maven installations and validates releases',async t=>{
  const {root,jdk,maven}=fixture(t),a=jdk('1.8.0_402'),b=jdk('21.0.6'),m=maven('3.9.9');
  const result=await sdk.discover({env:{PATH:''},home:root,roots:[root]});
  assert.ok(result.jdk.some(item=>item.path===fs.realpathSync(a) && item.major===8));assert.ok(result.jdk.some(item=>item.path===fs.realpathSync(b) && item.major===21));assert.ok(result.maven.some(item=>item.path===fs.realpathSync(m) && item.version==='3.9.9'));
  assert.equal(sdk.jdkInfo(root),null);assert.equal(sdk.major('1.8.0_402'),8);
});
test('project versions persist independently and Maven runs with the selected project JAVA_HOME',async t=>{
  const {root,jdk,maven}=fixture(t),a=jdk('17.0.9'),b=jdk('21.0.6'),ma=maven('3.8.8'),mb=maven('3.9.9'),settings=new Map();
  const dbm={getSetting:(key,fallback)=>settings.get(key)??fallback,setSetting:(key,value)=>settings.set(key,value)};
  const runner=require('../server/runner')(dbm,root);t.after(()=>runner.close());
  runner.saveEnvironment({javaHome:a,mavenHome:ma,nodePath:process.execPath});
  const first={id:1,local_path:root},second={id:2,local_path:root};fs.writeFileSync(path.join(root,'pom.xml'),'<project/>');
  runner.saveProjectEnvironment(second,{javaHome:b,mavenHome:mb});
  assert.equal(runner.effectiveEnvironment(first).javaHome,a);assert.equal(runner.effectiveEnvironment(second).javaHome,b);
  for(const [project,version,home] of [[first,'3.8.8',a],[second,'3.9.9',b]]) {
    runner.start(project,{action:'maven',goal:'compile'});const deadline=Date.now()+5000;while(runner.status(project).state==='running'){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,25));}
    const job=runner.status(project);assert.equal(job.state,'success',job.output);assert.ok(job.output.includes(`Maven-${version}`));assert.ok(job.output.includes(home));
  }
  const reopened=require('../server/runner')(dbm,root);assert.equal(reopened.effectiveEnvironment(second).javaHome,b);reopened.saveProjectEnvironment(second,{});assert.equal(reopened.effectiveEnvironment(second).javaHome,a);
  assert.throws(()=>runner.saveProjectEnvironment(first,{javaHome:root}),/环境目录无效/);
});
