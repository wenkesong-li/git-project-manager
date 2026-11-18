'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { createMessageConnection, StreamMessageReader, StreamMessageWriter, CancellationTokenSource } = require('vscode-jsonrpc/node');
const { resolveEntry } = require('./files');

module.exports = function javaIntelligence(dataDir, getEnvironment = () => ({}), getProjectEnvironment = getEnvironment) {
  const runtime = require('./java-runtime')(dataDir, () => getEnvironment(null,25)), sessions = new Map();
  const javaSettings = { autobuild: { enabled: false }, import: { gradle: { enabled: false }, maven: { enabled: true }, generatesMetadataFilesAtProjectRoot: false }, configuration: { updateBuildConfiguration: 'disabled' }, project: { referencedLibraries: [] }, errors: { incompleteClasspath: { severity: 'ignore' } } };
  function stop(session) { clearTimeout(session.idle); session.connection?.dispose(); session.child?.kill(); if (sessions.get(session.root) === session) sessions.delete(session.root); }
  function touch(session) { clearTimeout(session.idle); session.idle = setTimeout(() => stop(session), 5 * 60 * 1000); session.idle.unref(); }
  async function request(connection, method, params, timeout = 25000) {
    const source = new CancellationTokenSource();
    let timer;
    try { return await Promise.race([connection.sendRequest(method, params, source.token), new Promise((_, reject) => { timer = setTimeout(() => { source.cancel(); reject(new Error('Java 分析尚未完成，请稍后重试')); }, timeout); })]); }
    finally { clearTimeout(timer); source.dispose(); }
  }
  async function sessionFor(project) {
    const root = fs.realpathSync(project.local_path);
    if (sessions.has(root)) { const session = sessions.get(root); touch(session); await session.ready; return session; }
    if (!runtime.status().installed) throw new Error('请先点击编辑器中的「启用 Java 智能分析」');
    await runtime.checkJava();
    if (sessions.size >= 2) stop(sessions.values().next().value);
    const selected = getProjectEnvironment(project), major = require('./sdks').jdkInfo(selected.javaHome)?.major;
    const settings = {...javaSettings, configuration:{...javaSettings.configuration,...(selected.javaHome && major ? {runtimes:[{name:major===8?'JavaSE-1.8':`JavaSE-${major}`,path:selected.javaHome,default:true}]} : {})}};
    const key = crypto.createHash('sha256').update(root).digest('hex').slice(0, 24);
    const working = path.join(dataDir, 'language-workspaces', key); fs.mkdirSync(working, { recursive: true });
    const configName = process.platform === 'win32' ? 'config_win' : process.platform === 'darwin' ? 'config_mac' : 'config_linux';
    const config = path.join(working, 'configuration');
    if (!fs.existsSync(config)) fs.cpSync(path.join(runtime.home, configName), config, { recursive: true });
    const launcher = fs.readdirSync(path.join(runtime.home, 'plugins')).find(n => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(n));
    const env = { ...process.env }; for (const name of ['CLIENT_PORT', 'CLIENT_HOST', 'CLIENT_CONNECTION', 'SERVER_PORT', 'SERVER_HOST', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS']) delete env[name];
    const child = spawn(runtime.java, ['-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4', '-Declipse.product=org.eclipse.jdt.ls.core.product', '-Dlog.level=ERROR', '-Xmx768m', '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED', '-jar', path.join(runtime.home, 'plugins', launcher), '-configuration', config, '-data', path.join(working, 'workspace')], { cwd: working, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    const session = { root, child, connection, documents: new Map() }; sessions.set(root, session); touch(session);
    connection.onRequest('workspace/configuration', ({ items }) => items.map(item => !item.section ? { java: settings } : item.section === 'java' ? settings : null));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('client/unregisterCapability', () => null);
    connection.onRequest('workspace/applyEdit', () => ({ applied: false, failureReason: '只读语言服务' }));
    connection.onRequest('window/showMessageRequest', () => null);
    connection.onRequest('workspace/workspaceFolders', () => [{ uri: pathToFileURL(root).href, name: project.name }]);
    connection.onNotification(() => {});
    connection.onError(() => {});
    child.on('error', () => stop(session)); child.on('exit', () => stop(session));
    connection.listen();
    session.ready = (async () => {
      try {
        await request(connection, 'initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: project.name }], capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: { definition: { linkSupport: true }, references: {}, documentHighlight: {}, hover: { contentFormat: ['markdown', 'plaintext'] } } }, initializationOptions: { settings: { java: javaSettings } } }, 60000);
        connection.sendNotification('initialized', {});
        connection.sendNotification('workspace/didChangeConfiguration', { settings: { java: javaSettings } });
      } catch (error) { stop(session); throw error; }
    })();
    await session.ready; return session;
  }
  function location(root, item) {
    try {
      const uri = item.targetUri || item.uri, range = item.targetSelectionRange || item.range;
      if (!uri?.startsWith('file:') || !range) return null;
      const relative = path.relative(root, fileURLToPath(uri)); resolveEntry(root, relative);
      return { path: relative.replace(/\\/g, '/'), range };
    } catch { return null; }
  }
  return {
    runtime,
    async query(project, body) {
      if (!['definition', 'references', 'documentHighlight', 'hover'].includes(body.action)) throw new Error('不支持的分析操作');
      if (!/\.java$/i.test(body.path || '')) throw new Error('只支持 Java 文件');
      if (!runtime.status().installed) { if (body.action === 'hover') return { result: null }; const basicRuntime=require('./java-runtime')(dataDir,()=>getEnvironment(project,17)); basicRuntime.targetRelease=require('./sdks').jdkInfo(getProjectEnvironment(project).javaHome)?.major; return require('./java-compiler')(dataDir, basicRuntime, project, body); }
      const file = resolveEntry(project.local_path, String(body.path));
      if (Buffer.byteLength(String(body.content || ''), 'utf8') > 2 * 1024 * 1024) throw new Error('文件超过 2MB');
      const session = await sessionFor(project), uri = pathToFileURL(file).href, previous = session.documents.get(uri), text = String(body.content ?? fs.readFileSync(file, 'utf8'));
      const version = (previous?.version || 0) + 1;
      if (!previous) session.connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'java', version, text } });
      else if (previous.text !== text) session.connection.sendNotification('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
      session.documents.set(uri, { text, version });
      const position = { line: Math.max(0, Number(body.line) - 1 || 0), character: Math.max(0, Number(body.column) - 1 || 0) };
      const result = await request(session.connection, `textDocument/${body.action}`, { textDocument: { uri }, position, ...(body.action === 'references' ? { context: { includeDeclaration: true } } : {}) });
      if (body.action === 'definition' || body.action === 'references') return { items: (Array.isArray(result) ? result : result ? [result] : []).map(item => location(session.root, item)).filter(Boolean) };
      return { result };
    },
    close() { for (const session of [...sessions.values()]) stop(session); },
  };
};
