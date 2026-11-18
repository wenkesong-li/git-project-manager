'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const windows = process.platform === 'win32';
const names = { java: windows ? 'java.exe' : 'java', javac: windows ? 'javac.exe' : 'javac', node: windows ? 'node.exe' : 'node', maven: windows ? 'mvn.cmd' : 'mvn' };
function file(value) { try { return fs.statSync(value).isFile(); } catch { return false; } }
function directory(value) { try { return fs.statSync(value).isDirectory(); } catch { return false; } }
function real(value) { try { return fs.realpathSync(value); } catch { return value; } }
function text(value) { try { return fs.statSync(value).size <= 128 * 1024 ? fs.readFileSync(value,'utf8') : ''; } catch { return ''; } }
function major(version) { const values = String(version || '').replace(/^v/,'').split(/[._+-]/).map(Number); return values[0] === 1 ? values[1] || 0 : values[0] || 0; }
function jdkInfo(home) {
  if (!home || !file(path.join(home,'bin',names.java)) || !file(path.join(home,'bin',names.javac))) return null;
  const release = text(path.join(home,'release')), version = release.match(/^JAVA_VERSION="([^"]+)"/m)?.[1] || path.basename(home).match(/(?:jdk[-_]?|java[-_]?)([\d._+-]+)/i)?.[1] || '';
  return { kind:'jdk', path:real(home), version:version || '未知版本', major:major(version), vendor:release.match(/^IMPLEMENTOR="([^"]+)"/m)?.[1] || '' };
}
function mavenInfo(home) {
  if (!home || !file(path.join(home,'bin',names.maven))) return null;
  let version = '';
  try { version = fs.readdirSync(path.join(home,'lib')).find(name=>/^maven-core-[\d.]+\.jar$/.test(name))?.replace(/^maven-core-|\.jar$/g,'') || ''; } catch {}
  version ||= path.basename(home).match(/(?:apache-)?maven[-_]?([\d.]+)/i)?.[1] || '';
  return { kind:'maven', path:real(home), version:version || '未知版本', major:major(version) };
}
function probe(executable, args, timeout=3500) {
  return new Promise(resolve => {
    let output = '', child;
    try { child = spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); } catch { resolve(''); return; }
    const timer = setTimeout(()=>child.kill(),timeout);
    const read = chunk => { if(output.length<32768) output += chunk.toString(); };
    child.stdout.on('data',read); child.stderr.on('data',read); child.on('error',()=>{clearTimeout(timer);resolve('');}); child.on('close',()=>{clearTimeout(timer);resolve(output);});
  });
}
function onPath(name, env=process.env) { return (env.PATH || '').split(path.delimiter).map(dir=>path.join(dir.replace(/^"|"$/g,''),name)).find(file); }
function children(root) { try { return fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory() || item.isSymbolicLink()).map(item=>path.join(root,item.name)).slice(0,100); } catch { return []; } }
async function discover(options={}) {
  const env = options.env || process.env, home = options.home || os.homedir();
  const roots = new Set(options.roots || []), homes = new Set(), nodes = new Set();
  const configured = options.configured || {};
  for (const value of [configured.javaHome,configured.mavenHome,env.JAVA_HOME,env.JDK_HOME,env.MAVEN_HOME,env.M2_HOME]) if(value) { homes.add(value); roots.add(path.dirname(value)); }
  if (configured.nodePath) nodes.add(configured.nodePath);
  for (const name of [names.java,names.javac,names.node,names.maven]) {
    for (const dir of (env.PATH || '').split(path.delimiter)) {
      const binary = path.join(dir.replace(/^"|"$/g,''),name);
      if(!file(binary))continue;
      if(name===names.node) nodes.add(binary);
      const parent=path.dirname(path.dirname(real(binary))); homes.add(parent); if(path.dirname(parent)!==path.parse(parent).root)roots.add(path.dirname(parent));
    }
  }
  const currentJava = onPath(names.java,env);
  let javaHome = '';
  if(currentJava) { const output = await probe(currentJava,['-XshowSettings:properties','-version']); javaHome=output.match(/^\s*java.home\s*=\s*(.+)$/m)?.[1]?.trim() || ''; if(javaHome){homes.add(javaHome);roots.add(path.dirname(javaHome));} }
  for(const root of [path.join(home,'.jdks'),path.join(home,'.sdkman/candidates/java'),path.join(home,'.sdkman/candidates/maven'),path.join(home,'.sdkman/candidates/nodejs'),path.join(home,'.asdf/installs/java'),path.join(home,'.asdf/installs/maven'),path.join(home,'.asdf/installs/nodejs'),path.join(home,'.local/share/mise/installs/java'),path.join(home,'.local/share/mise/installs/maven'),path.join(home,'.local/share/mise/installs/node'),path.join(home,'.nvm/versions/node'),path.join(home,'.volta/tools/image/node'),env.NVM_HOME,env.NVM_DIR,env.VOLTA_HOME && path.join(env.VOLTA_HOME,'tools/image/node')].filter(Boolean)) roots.add(root);
  if(windows) {
    for(const base of [env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean)) for(const name of ['Java','Eclipse Adoptium','Microsoft','Amazon Corretto','BellSoft','Zulu','nodejs']) roots.add(path.join(base,name));
    if(env.APPDATA) roots.add(path.join(env.APPDATA,'nvm'));
    const registry = await Promise.all(['HKLM\\SOFTWARE\\JavaSoft\\JDK','HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit'].map(key=>probe('reg.exe',['query',key,'/s'],1500)));
    for(const output of registry) for(const match of output.matchAll(/JavaHome\s+REG_SZ\s+(.+)/g)) homes.add(match[1].trim());
  } else {
    for(const root of ['/Library/Java/JavaVirtualMachines','/usr/lib/jvm','/opt/java','/opt/homebrew/Cellar/maven','/usr/local/Cellar/maven','/opt/homebrew/Cellar/openjdk','/usr/local/Cellar/openjdk']) roots.add(root);
    if(process.platform==='darwin') { const output=await probe('/usr/libexec/java_home',['-V'],2000);for(const line of output.split('\n')) { const match=line.match(/(\/[^\r\n]+\/Contents\/Home)\s*$/);if(match)homes.add(match[1].trim()); } }
  }
  const visited=new Set();
  function inspect(candidate, depth) {
    const resolved=real(candidate); if(visited.size>=1500 || visited.has(resolved) || candidate===path.parse(candidate).root || !directory(candidate))return;visited.add(resolved);
    homes.add(candidate);
    for(const suffix of ['Contents/Home','libexec','libexec/openjdk.jdk/Contents/Home']) if(directory(path.join(candidate,suffix)))homes.add(path.join(candidate,suffix));
    for(const suffix of ['', 'bin']) { const binary=path.join(candidate,suffix,names.node);if(file(binary))nodes.add(binary); }
    if(depth>0) for(const child of children(candidate)) inspect(child,depth-1);
  }
  for(const root of [...roots].filter(value=>value && path.isAbsolute(value)).slice(0,80))inspect(root,2);
  const jdk=new Map(), maven=new Map();
  for(const candidate of homes) { const java=jdkInfo(candidate), mvn=mavenInfo(candidate); if(java)jdk.set(java.path,java); if(mvn)maven.set(mvn.path,mvn); }
  const node=[]; const list=[...new Set([...nodes].filter(file).map(real))].slice(0,30);
  for(let i=0;i<list.length;i+=4) await Promise.all(list.slice(i,i+4).map(async binary=>{const version=(await probe(binary,['--version'],2000)).match(/v?(\d+\.\d+\.\d+)/)?.[1];if(version)node.push({kind:'node',path:binary,version,major:major(version)});}));
  const sort=items=>items.sort((a,b)=>b.major-a.major || b.version.localeCompare(a.version,undefined,{numeric:true}) || a.path.localeCompare(b.path));
  const javaList=sort([...jdk.values()]),mavenList=sort([...maven.values()]),nodeList=sort(node);
  const currentMaven=onPath(names.maven,env),currentNode=onPath(names.node,env);
  return {jdk:javaList,maven:mavenList,node:nodeList,preferred:{javaHome:javaList.find(item=>item.path===real(javaHome))?.path || javaList[0]?.path || '',mavenHome:currentMaven?real(path.dirname(path.dirname(currentMaven))):mavenList[0]?.path || '',nodePath:currentNode?real(currentNode):nodeList[0]?.path || ''},scannedAt:new Date().toISOString()};
}
module.exports = {discover,jdkInfo,mavenInfo,major};
