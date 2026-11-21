'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { resolveEntry } = require('./files');

const fields = ['nodePath', 'javaHome', 'mavenHome'];
function readEnvironment(dbm) { try { return JSON.parse(dbm.getSetting('local_environment', '{}')); } catch { return {}; } }
function executable(name, directory) {
  if (directory) return path.join(directory, name);
  const candidates = directory ? [path.join(directory, name)] : (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, name));
  return candidates.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) || name;
}
function tools(environment) {
  const windows = process.platform === 'win32';
  const node = environment.nodePath || executable(windows ? 'node.exe' : 'node');
  const javaHome = environment.javaHome || process.env.JAVA_HOME;
  const mavenHome = environment.mavenHome || process.env.MAVEN_HOME || process.env.M2_HOME;
  return { node, java: executable(windows ? 'java.exe' : 'java', javaHome && path.join(javaHome, 'bin')), javac: executable(windows ? 'javac.exe' : 'javac', javaHome && path.join(javaHome, 'bin')), mvn: executable(windows ? 'mvn.cmd' : 'mvn', mavenHome && path.join(mavenHome, 'bin')) };
}
function command(tool, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(tool)) {
    if (/[&|<>^%!"\r\n]/.test(tool) || args.some(arg => !/^[\w.:=/$-]+$/.test(arg))) throw new Error('Maven 路径或参数包含不支持的字符');
    return { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `""${tool}" ${args.join(' ')}"`], windowsVerbatimArguments: true };
  }
  return { executable: tool, args };
}
function npmCli(node) {
  const npm = executable(process.platform === 'win32' ? 'npm.cmd' : 'npm');
  for (const base of [path.dirname(node), path.dirname(npm)]) {
    for (const candidate of [path.join(base, 'node_modules/npm/bin/npm-cli.js'), path.resolve(base, '../lib/node_modules/npm/bin/npm-cli.js')]) if (fs.existsSync(candidate)) return candidate;
  }
  if (path.isAbsolute(npm) && !/\.cmd$/i.test(npm)) return fs.realpathSync(npm);
  throw new Error('未找到 npm，请检查 Node.js 安装目录');
}
module.exports = function createRunner(dbm, dataDir) {
  const jobs = new Map();
  const sdk = require('./sdks');
  let catalog = null, scanning = null;
  function projectEnvironment(project) { try { return JSON.parse(dbm.getSetting(`project_environment_${project.id}`, '{}')); } catch { return {}; } }
  function effectiveEnvironment(project) { return Object.assign({}, catalog?.preferred || {}, Object.fromEntries(Object.entries(readEnvironment(dbm)).filter(([,v])=>v)), project ? Object.fromEntries(Object.entries(projectEnvironment(project)).filter(([,v])=>v)) : {}); }
  function validate(body) {
    const result = {};
    for (const field of fields) {
      const value = String(body[field] || '').trim();
      if (value && (!path.isAbsolute(value) || /[\0\r\n]/.test(value))) throw new Error('环境路径必须为有效绝对路径');
      if (value && (field === 'javaHome' ? !sdk.jdkInfo(value) : field === 'mavenHome' ? !sdk.mavenInfo(value) : !fs.existsSync(value) || !fs.statSync(value).isFile())) throw new Error('环境目录无效，请选择完整的 JDK、Maven 目录或 Node 可执行文件');
      result[field] = value;
    }
    return result;
  }
  async function prepare(force = false) {
    if (!force && catalog && Date.now()-Date.parse(catalog.scannedAt)<60000) return catalog;
    if (scanning) return scanning;
    let roots; try { roots = JSON.parse(dbm.getSetting('environment_search_roots','[]')); } catch { roots=[]; }
    scanning = sdk.discover({ roots, configured:readEnvironment(dbm) }).then(value=>catalog=value).finally(()=>scanning=null);
    return scanning;
  }
  function append(job, chunk) { job.output = (job.output + chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).slice(-200000); }
  function stop(job) {
    job.stopped = true;
    if (!job.child?.pid) return;
    if (process.platform === 'win32') { const killer = spawn('taskkill.exe', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => job.child?.kill()); }
    else { try { process.kill(-job.child.pid, 'SIGTERM'); } catch { job.child.kill(); } }
  }
  function envFor(environment) {
    const env = { ...process.env, FORCE_COLOR: '0' };
    if (environment.javaHome) env.JAVA_HOME = environment.javaHome;
    if (!env.JAVA_HOME) {
      try { const binary = executable(process.platform === 'win32' ? 'java.exe' : 'java'); const inferred = path.dirname(path.dirname(fs.realpathSync(binary))); if (fs.existsSync(path.join(inferred, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'))) env.JAVA_HOME = inferred; } catch {}
    }
    if (environment.mavenHome) env.MAVEN_HOME = environment.mavenHome;
    const directories = [environment.nodePath && path.dirname(environment.nodePath), environment.javaHome && path.join(environment.javaHome, 'bin'), environment.mavenHome && path.join(environment.mavenHome, 'bin')].filter(Boolean);
    env.PATH = [...directories, env.PATH || ''].join(path.delimiter);
    return env;
  }
  async function launch(job, tool, args, environment) {
    if (job.stopped) return -1;
    const cmd = command(tool, args);
    append(job, `\n> ${path.basename(tool)} ${args.map(arg => arg.includes(' ') ? JSON.stringify(arg) : arg).join(' ')}\n`);
    return new Promise((resolve, reject) => {
      const env = envFor(environment);
      if (/^(?:java|javac|mvn)(?:\.exe|\.cmd|\.bat)?$/i.test(path.basename(tool))) {
        // Also applies to JVMs forked by Maven, including Spring Boot.
        env.JAVA_TOOL_OPTIONS = [
          env.JAVA_TOOL_OPTIONS,
          '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8',
        ].filter(Boolean).join(' ');
      }
      const child = spawn(cmd.executable, cmd.args, { cwd: job.cwd, env, windowsVerbatimArguments: !!cmd.windowsVerbatimArguments, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      job.child = child;
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', text => append(job, text));
      }
      child.on('error', error => reject(new Error(error.code === 'ENOENT' ? '未找到运行环境，请在右上角设置中配置并检测' : error.message)));
      child.on('close', code => { job.child = null; resolve(code ?? -1); });
    });
  }
  function vo(job) { return job ? { id: job.id, projectId: job.projectId, label: job.label, state: job.state, output: job.output, exitCode: job.exitCode, startedAt: job.startedAt } : null; }
  function metadata(project) {
    let scripts = [];
    try { const file = resolveEntry(project.local_path, 'package.json'); if (fs.statSync(file).size < 1024 * 1024) scripts = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).scripts || {}); } catch {}
    let pom='';try {const file=resolveEntry(project.local_path,'pom.xml');if(fs.statSync(file).size<1024*1024)pom=fs.readFileSync(file,'utf8').replace(/<!--[\s\S]*?-->/g,'');}catch{}
    const maven=!!pom, springBoot=/<artifactId>\s*spring-boot-maven-plugin\s*<\/artifactId>/.test(pom),execJava=/<artifactId>\s*exec-maven-plugin\s*<\/artifactId>/.test(pom);
    const runScript=['dev','start','serve'].find(value=>scripts.includes(value));
    const mavenGoals = maven ? ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', ...(springBoot ? ['spring-boot:run'] : []), ...(execJava ? ['exec:java'] : [])] : [];
    return { scripts, maven, mavenGoals, type:maven?'Maven':scripts.length?'Node.js':'普通目录', quickBuild:maven?{action:'maven',goal:'compile'}:scripts.includes('build')?{action:'npm',script:'build'}:null, quickRun:maven?(springBoot?{action:'maven',goal:'spring-boot:run'}:execJava?{action:'maven',goal:'exec:java'}:null):runScript?{action:'npm',script:runScript}:null };
  }
  return {
    prepare,
    effectiveEnvironment,
    projectEnvironment,
    saveProjectEnvironment(project, body) { const environment=validate(body); dbm.setSetting(`project_environment_${project.id}`,JSON.stringify(environment)); return {ok:true,environment,effective:effectiveEnvironment(project)}; },
    searchRoots() { try { return JSON.parse(dbm.getSetting('environment_search_roots','[]')); } catch { return []; } },
    saveSearchRoots(roots) { if(!Array.isArray(roots) || roots.length>30 || roots.some(value=>typeof value!=='string' || !path.isAbsolute(value) || !fs.existsSync(value) || !fs.statSync(value).isDirectory())) throw new Error('请填写存在的绝对目录，最多 30 个'); dbm.setSetting('environment_search_roots',JSON.stringify(roots)); catalog=null; },
    analysisEnvironment(project, minimum=17) { const environment=effectiveEnvironment(project); if (sdk.jdkInfo(environment.javaHome)?.major>=minimum) return environment; return {...environment,javaHome:catalog?.jdk.find(item=>item.major>=minimum)?.path || environment.javaHome}; },
    readEnvironment: () => readEnvironment(dbm),
    saveEnvironment(body) {
      const environment = validate(body);
      dbm.setSetting('local_environment', JSON.stringify(environment)); return { ok: true, environment };
    },
    async detect(body) {
      const environment = Object.fromEntries(fields.map(key => [key, String(body[key] || '').trim()]));
      for (const value of Object.values(environment)) if (value && (!path.isAbsolute(value) || /[\0\r\n]/.test(value))) throw new Error('环境路径必须为有效绝对路径');
      const configured = tools(environment), result = {};
      for (const [name, tool, args] of [['node', configured.node, ['--version']], ['java', configured.java, ['-version']], ['maven', configured.mvn, ['--version']]]) {
        const job = { cwd: dataDir, output: '' }; let timer;
        try { timer = setTimeout(() => stop(job), 8000); const code = await launch(job, tool, args, environment); result[name] = { ok: code === 0, version: name === 'maven' && code !== 0 && /JAVA_HOME/.test(job.output) ? '请设置有效的 JDK 安装目录，再检测 Maven' : job.output.split(/\r?\n/).filter(line => line && !line.startsWith('> ')).slice(0, 3).join('\n') || '未找到环境' }; }
        catch (error) { result[name] = { ok: false, version: error.message }; }
        finally { clearTimeout(timer); }
      }
      return { tools: result };
    },
    metadata,
    start(project, body) {
      if ([...jobs.values()].filter(job => job.state === 'running').length >= 3) throw new Error('最多同时运行 3 个项目');
      if (jobs.get(String(project.id))?.state === 'running') throw new Error('该项目已有运行中的任务，请先停止');
      const environment = effectiveEnvironment(project), configured = tools(environment), meta = metadata(project);
      const stages = [], action = body.action;
      let label;
      if (action === 'npm') {
        if (!meta.scripts.includes(body.script)) throw new Error('所选 npm 脚本不存在');
        stages.push([configured.node, [npmCli(configured.node), 'run', body.script]]); label = `npm run ${body.script}`;
      } else if (action === 'node') {
        const file = resolveEntry(project.local_path, String(body.path || ''));
        if (!/\.[cm]?js$/i.test(file)) throw new Error('Node 直接运行仅支持 .js/.mjs/.cjs 文件');
        stages.push([configured.node, [file]]); label = '运行 Node 文件';
      } else if (['java-compile', 'java-run'].includes(action)) {
        const file = resolveEntry(project.local_path, String(body.path || ''));
        if (!/\.java$/i.test(file)) throw new Error('请选择 Java 文件');
        const text = fs.readFileSync(file, 'utf8'); if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Java 文件超过 2MB');
        const packageName = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
        const output = path.join(dataDir, 'run-output', crypto.randomUUID()); fs.mkdirSync(output, { recursive: true });
        let source = path.dirname(file);
        if (packageName) for (const part of packageName.split('.')) source = path.dirname(source);
        stages.push([configured.javac, ['-encoding', 'UTF-8', '-d', output, '-sourcepath', source, file]]);
        if (action === 'java-run') stages.push([configured.java, ['-cp', output, [packageName, path.basename(file, '.java')].filter(Boolean).join('.')]]);
        label = action === 'java-run' ? '编译并运行 Java' : '编译 Java';
      } else if (action === 'maven') {
        if (!meta.maven || !meta.mavenGoals.includes(body.goal)) throw new Error('未找到 Maven 项目或编译目标无效');
        stages.push([configured.mvn, ['--batch-mode', body.goal]]); label = `Maven ${body.goal}`;
      } else throw new Error('不支持的运行配置');
      const job = { id: crypto.randomUUID(), projectId: project.id, cwd: fs.realpathSync(project.local_path), label, state: 'running', output: '', startedAt: new Date().toISOString(), exitCode: null };
      jobs.set(String(project.id), job);
      const timer = setTimeout(() => { append(job, '\n任务已超过 30 分钟，已停止。\n'); stop(job); }, 30 * 60 * 1000); timer.unref();
      (async () => {
        try { for (const [tool, args] of stages) { if (job.stopped) break; job.exitCode = await launch(job, tool, args, environment); if (job.exitCode !== 0) break; } job.state = job.stopped ? 'stopped' : job.exitCode === 0 ? 'success' : 'failed'; }
        catch (error) { append(job, `\n${error.message}\n`); job.state = 'failed'; }
        finally { clearTimeout(timer); }
      })();
      return vo(job);
    },
    status: project => vo(jobs.get(String(project.id))),
    stop(project) { const job = jobs.get(String(project.id)); if (job?.state === 'running') stop(job); return { ok: true }; },
    close() { for (const job of jobs.values()) if (job.state === 'running') stop(job); },
  };
};
