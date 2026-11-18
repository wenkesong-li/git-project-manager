import * as monaco from 'monaco-editor';
import { get, post } from './api';
import { languageInfo } from './editor-language';

self.MonacoEnvironment = {
  getWorker(_, label) {
    const type = ['typescript', 'javascript'].includes(label) ? 'ts' : ['json', 'css', 'html'].includes(label) ? label : 'editor';
    return new Worker(new URL(`./worker-${type}.js`, import.meta.url), { type: 'module' });
  },
};
const compilerOptions = { allowJs: true, checkJs: false, allowNonTsExtensions: true, allowSyntheticDefaultImports: true, esModuleInterop: true, module: monaco.typescript.ModuleKind.ESNext, moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs, target: monaco.typescript.ScriptTarget.ESNext, jsx: monaco.typescript.JsxEmit.ReactJSX };
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  defaults.setModeConfiguration({ ...defaults.modeConfiguration, definitions: false, references: false, documentHighlights: false });
}
export function modelUri(id, path) { return monaco.Uri.from({ scheme: 'file', path: `/gitpm/${id}/${path.replace(/\\/g, '/')}` }); }
export function modelLocation(uri) {
  const match = uri.scheme === 'file' && uri.path.match(/^\/gitpm\/([^/]+)\/(.+)$/);
  return match ? { id: match[1], path: match[2] } : null;
}
export function modelLanguage(path) {
  const info = languageInfo(path);
  return info.mode === 'text' ? 'plaintext' : info.ext === 'scss' || info.ext === 'less' ? info.ext : info.mode;
}
const workspaces = new Map();
export function retainWorkspace(id) {
  const key = String(id);
  let state = workspaces.get(key);
  if (!state) { state = { count: 0 }; workspaces.set(key, state); }
  clearTimeout(state.timer); state.count++;
  if (!state.loading) state.loading = get(`/api/local/${id}/script-workspace`).then(data => {
    if (workspaces.get(key) !== state) return data;
    for (const item of data.items) {
      const uri = modelUri(id, item.path);
      if (!monaco.editor.getModel(uri)) monaco.editor.createModel(item.content, modelLanguage(item.path), uri);
    }
    state.truncated = data.truncated;
    return data;
  }).catch(error => { state.error = error.message; return { items: [], error: error.message }; });
  return { ready: state.loading, release() { state.count--; if (!state.count) state.timer = setTimeout(() => { if (state.count) return; for (const model of monaco.editor.getModels()) if (modelLocation(model.uri)?.id === key) model.dispose(); workspaces.delete(key); }, 1000); } };
}
function hex(value) { const canvas = document.createElement('canvas').getContext('2d'); canvas.fillStyle = value; return canvas.fillStyle; }
export function syncEditorTheme() {
  const style = getComputedStyle(document.body), color = (name, fallback) => hex(style.getPropertyValue(name).trim() || fallback);
  const surface = color('--surface', '#ffffff'), dark = parseInt(surface.slice(1, 3), 16) < 128;
  monaco.editor.defineTheme('gitpm', {
    base: dark ? 'vs-dark' : 'vs', inherit: document.body.dataset.theme !== 'neutral',
    rules: [
      { token: 'keyword', foreground: color('--code-keyword', '#555555').slice(1), fontStyle: 'bold' },
      { token: 'string', foreground: color('--code-string', '#555555').slice(1) },
      { token: 'number', foreground: color('--code-number', '#555555').slice(1) },
      { token: 'comment', foreground: color('--code-comment', '#888888').slice(1), fontStyle: 'italic' },
      { token: 'type', foreground: color('--code-type', '#555555').slice(1) },
      { token: 'identifier', foreground: color('--ink', '#252525').slice(1) },
      { token: 'delimiter', foreground: color('--ink', '#252525').slice(1) },
    ],
    colors: {
      'editor.background': surface, 'editor.foreground': color('--ink', '#252525'),
      'editorLineNumber.foreground': color('--faint', '#888888'), 'editorLineNumber.activeForeground': color('--ink', '#252525'),
      'editorGutter.background': color('--sidebar', surface), 'editor.lineHighlightBackground': color('--hover', '#f4f4f4'),
      'editor.selectionBackground': color('--accent-soft', '#e5e5e5'), 'editor.inactiveSelectionBackground': color('--accent-soft', '#e5e5e5'),
      'editor.wordHighlightBackground': color('--hover', '#f4f4f4'), 'editor.wordHighlightStrongBackground': color('--accent-soft', '#e5e5e5'),
      'editor.findMatchBackground': color('--accent-soft', '#e5e5e5'), 'editor.findMatchHighlightBackground': color('--hover', '#f4f4f4'),
      'editorLink.activeForeground': color('--accent', '#252525'), 'editorCursor.foreground': color('--ink', '#252525'),
      'editorWidget.background': surface, 'editorWidget.border': color('--line', '#dddddd'),
      'editorHoverWidget.background': surface, 'editorHoverWidget.border': color('--line', '#dddddd'),
      'editorSuggestWidget.background': surface, 'editorSuggestWidget.selectedBackground': color('--hover', '#f4f4f4'),
      'peekViewEditor.background': surface, 'peekViewResult.background': color('--sidebar', surface), 'peekViewTitle.background': color('--sidebar', surface),
      'focusBorder': color('--accent', '#252525'), 'editorError.foreground': color('--danger', '#555555'),
      'editorWarning.foreground': color('--faint', '#888888'), 'editorInfo.foreground': color('--accent', '#252525'),
    },
  });
  monaco.editor.setTheme('gitpm');
}
new MutationObserver(syncEditorTheme).observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'style'] });

function range(value) { return { startLineNumber: value.start.line + 1, startColumn: value.start.character + 1, endLineNumber: value.end.line + 1, endColumn: value.end.character + 1 }; }
async function javaQuery(model, position, action, token) {
  const location = modelLocation(model.uri);
  if (!location || token?.isCancellationRequested) return null;
  const data = await post(`/api/local/${location.id}/java-intelligence`, { path: location.path, content: model.getValue(), line: position.lineNumber, column: position.column, action });
  return token?.isCancellationRequested ? null : data;
}
const javaLocations = data => data?.items?.map(item => ({ uri: modelUri(data.id, item.path), range: range(item.range) })) || [];
monaco.languages.registerDefinitionProvider('java', { async provideDefinition(model, position, token) { const data = await javaQuery(model, position, 'definition', token); return javaLocations({ ...data, id: modelLocation(model.uri).id }); } });
monaco.languages.registerReferenceProvider('java', { async provideReferences(model, position, context, token) { const data = await javaQuery(model, position, 'references', token); return javaLocations({ ...data, id: modelLocation(model.uri).id }); } });
monaco.languages.registerDocumentHighlightProvider('java', { async provideDocumentHighlights(model, position, token) { try { const data = await javaQuery(model, position, 'documentHighlight', token); return data?.result?.map(item => ({ range: range(item.range), kind: item.kind })); } catch { return []; } } });
monaco.languages.registerHoverProvider('java', { async provideHover(model, position, token) { try { const data = await javaQuery(model, position, 'hover', token), hover = data?.result; if (!hover) return null; return { range: hover.range ? range(hover.range) : undefined, contents: (Array.isArray(hover.contents) ? hover.contents : [hover.contents]).map(value => ({ value: typeof value === 'string' ? value : value.language ? `\`\`\`${value.language}\n${value.value}\n\`\`\`` : value.value, isTrusted: false, supportHtml: false })) }; } catch { return null; } } });

function importsIn(model) {
  const result = [], lines = model.getLinesContent();
  for (let line = 0; line < lines.length && result.length < 200; line++) {
    const regex = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|@import\s*)['"]([^'"\r\n]+)['"]/g;
    let match;
    while ((match = regex.exec(lines[line]))) {
      const start = match.index + match[0].indexOf(match[1]);
      result.push({ specifier: match[1], range: new monaco.Range(line + 1, start + 1, line + 1, start + match[1].length + 1) });
    }
  }
  return result;
}
monaco.languages.registerLinkProvider(['javascript', 'typescript', 'css', 'scss', 'less'], { async provideLinks(model, token) {
  const location = modelLocation(model.uri), imports = importsIn(model);
  if (!location || !imports.length) return { links: [] };
  try {
    const data = await post(`/api/local/${location.id}/resolve-imports`, { path: location.path, specifiers: imports.map(item => item.specifier) });
    if (token.isCancellationRequested) return { links: [] };
    return { links: imports.flatMap(item => { const target = data.items.find(value => value.specifier === item.specifier); return target ? [{ range: item.range, url: monaco.Uri.from({ scheme: 'gitpm', authority: String(location.id), path: '/' + target.path }), tooltip: '打开引用文件（Ctrl / ⌘ + 点击）' }] : []; }) };
  } catch { return { links: [] }; }
} });
export { monaco };
async function scriptQuery(model, position, action, token) {
  const location = modelLocation(model.uri);
  if (!location || token?.isCancellationRequested) return { items: [] };
  const data = await post(`/api/local/${location.id}/script-intelligence`, { path: location.path, content: model.getValue(), line: position.lineNumber, column: position.column, action });
  return { ...data, id: location.id };
}
monaco.languages.registerDefinitionProvider(['javascript', 'typescript'], { async provideDefinition(model, position, token) { return javaLocations(await scriptQuery(model, position, 'definition', token)); } });
monaco.languages.registerReferenceProvider(['javascript', 'typescript'], { async provideReferences(model, position, context, token) { return javaLocations(await scriptQuery(model, position, 'references', token)); } });
monaco.languages.registerDocumentHighlightProvider(['javascript', 'typescript'], { async provideDocumentHighlights(model, position, token) { try { const data = await scriptQuery(model, position, 'documentHighlight', token); return data.items.map(item => ({ range: range(item.range), kind: item.kind })); } catch { return []; } } });
