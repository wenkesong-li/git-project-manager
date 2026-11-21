'use strict';
const fs = require('fs');
const path = require('path');
const { resolveEntry } = require('./files');
let compiler;
async function loadCompiler() {
  if (!compiler) { const ts=require('typescript'),directory=path.dirname(require.resolve('typescript'));const libs=Object.fromEntries(fs.readdirSync(directory).filter(name=>/^lib.*\.d\.ts$/.test(name)).map(name=>[name,fs.readFileSync(path.join(directory,name),'utf8')]));compiler=Promise.resolve({ts,libs}); }
  return compiler;
}
module.exports = async function scriptIntelligence(project, body) {
  if (!['definition', 'references', 'documentHighlight','completion','hover'].includes(body.action)) throw new Error('不支持的分析操作');
  const relative = String(body.path || ''), file = resolveEntry(project.local_path, relative);
  if (!/\.[cm]?[jt]sx?$/i.test(file)) throw new Error('仅支持 JS / TS 文件');
  const content = String(body.content ?? fs.readFileSync(file, 'utf8'));
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('文件超过 2MB');
  const { ts, libs } = await loadCompiler(), root = fs.realpathSync(project.local_path);
  const workspace = await require('./workspace-search').scriptWorkspace(root);
  const documents = new Map(workspace.items.map(item => [path.resolve(root, item.path).replace(/\\/g, '/'), item.content]));
  const filename = file.replace(/\\/g, '/'); documents.set(filename, content);
  const libRoot = '/__gitpm_lib__/';
  const directories = new Set();
  for (const name of documents.keys()) { let parent = path.posix.dirname(name); while (!directories.has(parent)) { directories.add(parent); const next = path.posix.dirname(parent); if (next === parent) break; parent = next; } }
  const getContent = name => name.startsWith(libRoot) ? libs[name.slice(libRoot.length)] : documents.get(name.replace(/\\/g, '/'));
  let config = {};
  for (const name of ['tsconfig.json', 'jsconfig.json']) { try { const target = resolveEntry(root, name); if (fs.statSync(target).size < 1024 * 1024) config = require('jsonc-parser').parse(fs.readFileSync(target, 'utf8'))?.compilerOptions || {}; break; } catch {} }
  const options = { ...ts.convertCompilerOptionsFromJson(config, root).options, allowJs: true, checkJs: false, allowNonTsExtensions: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX };
  const host = {
    getScriptFileNames: () => [...documents.keys()], getScriptVersion: () => '1',
    getScriptSnapshot: name => { const text = getContent(name); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
    getCurrentDirectory: () => root.replace(/\\/g, '/'), getCompilationSettings: () => options,
    getDefaultLibFileName: () => libRoot + 'lib.esnext.full.d.ts',
    fileExists: name => getContent(name) !== undefined, readFile: getContent,
    readDirectory: () => [], directoryExists: name => name.startsWith(libRoot) || directories.has(name.replace(/\\/g, '/')),
    getDirectories: () => [], useCaseSensitiveFileNames: () => process.platform !== 'win32', getNewLine: () => '\n',
  };
  const service = ts.createLanguageService(host);
  try {
    const source = service.getProgram()?.getSourceFile(filename); if (!source) return { items: [], truncated: workspace.truncated };
    const line = Math.min(Math.max(0, Number(body.line) - 1 || 0), source.getLineStarts().length - 1);
    const offset = source.getLineStarts()[line] + Math.max(0, Number(body.column) - 1 || 0);
    if(body.action==='completion'){const result=service.getCompletionsAtPosition(filename,offset,{includeCompletionsForModuleExports:false,includeCompletionsWithInsertText:true});return {items:(result?.entries || []).slice(0,200).map(item=>({label:item.name,apply:item.insertText || item.name,type: /function|method/.test(item.kind)?'function':/class|interface|type/.test(item.kind)?'type':item.kind==='keyword'?'keyword':'variable'})),truncated:workspace.truncated};}
    if(body.action==='hover'){const info=service.getQuickInfoAtPosition(filename,offset);return {result:info?{contents:[{value:ts.displayPartsToString(info.displayParts)+'\n'+ts.displayPartsToString(info.documentation)}]}:null};}
    const entries = body.action === 'definition' ? service.getDefinitionAtPosition(filename, offset) || [] : body.action === 'references' ? service.getReferencesAtPosition(filename, offset) || [] : (service.getDocumentHighlights(filename, offset, [filename]) || []).flatMap(item => item.highlightSpans.map(span => ({ fileName: item.fileName, textSpan: span.textSpan, kind: span.kind === 'writtenReference' ? 3 : 2 })));
    const items = entries.flatMap(entry => {
      try {
        const relative = path.relative(root, entry.fileName); resolveEntry(root, relative);
        const text = documents.get(entry.fileName), source = ts.createSourceFile(entry.fileName, text || '', ts.ScriptTarget.ESNext);
        const start = source.getLineAndCharacterOfPosition(entry.textSpan.start), end = source.getLineAndCharacterOfPosition(entry.textSpan.start + entry.textSpan.length);
        return [{ path: relative.replace(/\\/g, '/'), range: { start, end }, kind: entry.kind || 1 }];
      } catch { return []; }
    });
    return { items, truncated: workspace.truncated };
  } finally { service.dispose(); }
};
