import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { monaco, modelUri, modelLocation, modelLanguage, retainWorkspace, syncEditorTheme } from './monaco';
import { languageInfo } from './editor-language';
import { Message } from './ui-kit';
import { readPreferences } from './preferences';

export default forwardRef(function CodeEditor({ value, path, projectId, readOnly = false, disabled = false, resetValue, onChange, onSelection, onSave, onFormat, onNativeCopy, onNavigate, location, onPosition, onReferences }, ref) {
  const host = useRef(null), editor = useRef(null), callbacks = useRef({});
  callbacks.current = { onChange, onSelection, onSave, onFormat, onNativeCopy, onNavigate, onPosition, resetValue, onReferences };
  useImperativeHandle(ref, () => ({ getText: () => editor.current?.getValue() || '', getPosition: () => editor.current?.getPosition(), getSelection: () => editor.current?.getSelections().map(selection => editor.current.getModel().getValueInRange(selection)).join('\n') || '', focus: () => editor.current?.focus(), action: async id => { editor.current?.focus(); try { await editor.current?.getAction(id)?.run(); } catch (error) { Message.error(error.message); } } }), []);
  useEffect(() => {
    syncEditorTheme();
    const workspace = retainWorkspace(projectId), uri = modelUri(projectId, path), info = languageInfo(path);
    const model = monaco.editor.getModel(uri) || monaco.editor.createModel(value, modelLanguage(path), uri);
    if (model.getValue() !== value) model.setValue(value);
    model.updateOptions({ tabSize: info.indent, insertSpaces: true, bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false } });
    const initialValue = value;
    const editorPreferences = readPreferences().editor;
    const instance = monaco.editor.create(host.current, {
      model, theme: 'gitpm', readOnly, domReadOnly: readOnly, editContext: false, automaticLayout: true, ariaLabel: `文件内容 ${path}`,
      fontSize: editorPreferences.fontSize, lineHeight: Math.round(editorPreferences.fontSize * 1.75), fontFamily: '"Cascadia Code", Consolas, monospace', minimap: { enabled: editorPreferences.minimap },
      padding: { top: 10, bottom: 20 }, scrollBeyondLastLine: false, smoothScrolling: true,
      renderLineHighlight: 'gutter', wordWrap: editorPreferences.wordWrap ? 'on' : 'off', folding: true, showFoldingControls: 'mouseover',
      links: true, multiCursorModifier: 'alt', definitionLinkOpensInPeek: false, occurrencesHighlight: 'singleFile',
      selectionHighlight: true, unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: true, nonBasicASCII: false },
      stickyScroll: { enabled: true },
    });
    editor.current = instance;
    const syncPreferences = () => { const prefs = readPreferences().editor; instance.updateOptions({ fontSize: prefs.fontSize, lineHeight: Math.round(prefs.fontSize * 1.75), wordWrap: prefs.wordWrap ? 'on' : 'off', minimap: { enabled: prefs.minimap } }); };
    window.addEventListener('gitpm:preferences', syncPreferences);
    const disposables = [
      instance.onDidChangeModelContent(() => callbacks.current.onChange?.(model.getValue())),
      instance.onDidChangeCursorSelection(event => { callbacks.current.onSelection?.(!event.selection.isEmpty()); callbacks.current.onPosition?.({ path, line: event.selection.positionLineNumber, column: event.selection.positionColumn }); }),
      monaco.editor.registerEditorOpener({ async openCodeEditor(source, resource, selection) {
        const target = modelLocation(resource);
        if (source !== instance || target?.id !== String(projectId)) return false;
        const targetLocation = { path: target.path, line: selection?.startLineNumber || selection?.lineNumber || 1, column: selection?.startColumn || selection?.column || 1 };
        if (resource.toString() === uri.toString()) { instance.setPosition({ lineNumber: targetLocation.line, column: targetLocation.column }); instance.revealLineInCenter(targetLocation.line); return true; }
        await callbacks.current.onNavigate?.(targetLocation); return true;
      } }),
      monaco.editor.registerLinkOpener({ async open(resource) {
        if (resource.scheme !== 'gitpm' || resource.authority !== String(projectId) || !instance.hasTextFocus()) return false;
        await callbacks.current.onNavigate?.({ path: resource.path.slice(1), line: 1, column: 1 }); return true;
      } }),
    ];
    instance.addAction({ id: 'gitpm-save', label: '保存文件', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => callbacks.current.onSave?.() });
    instance.addAction({ id: 'gitpm-format', label: '格式化文件', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyL], contextMenuGroupId: '1_modification', run: () => callbacks.current.onFormat?.() });
    instance.addAction({ id: 'gitpm-find-references', label: '查找引用', keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: 'navigation', contextMenuOrder: 1.4, run: () => callbacks.current.onReferences?.() });
    const nativeCopy = () => callbacks.current.onNativeCopy?.(); host.current.addEventListener('copy', nativeCopy);
    workspace.ready.then(data => { if (!host.current) return; if (data.truncated) Message.warning('工程较大：脚本索引已达到 500 个文件或 8MB 上限'); else if (data.error) Message.warning('跨文件索引加载失败，可刷新重试'); });
    return () => {
      host.current?.removeEventListener('copy', nativeCopy);
      for (const disposable of disposables) disposable.dispose();
      instance.dispose(); editor.current = null;
      window.removeEventListener('gitpm:preferences', syncPreferences);
      const baseline = callbacks.current.resetValue ?? initialValue;
      if (!readOnly && !model.isDisposed() && model.getValue() !== baseline) model.setValue(baseline);
      workspace.release();
    };
  }, [projectId, path, readOnly]);
  useEffect(() => { const model = editor.current?.getModel(); if (model && model.getValue() !== value) editor.current.executeEdits('controlled-update', [{ range: model.getFullModelRange(), text: value }]); }, [value]);
  useEffect(() => { editor.current?.updateOptions({ readOnly: readOnly || disabled, domReadOnly: readOnly || disabled }); }, [disabled, readOnly]);
  useEffect(() => { if (editor.current && location) { const position = { lineNumber: location.line || 1, column: location.column || 1 }; editor.current.setPosition(position); editor.current.revealPositionInCenter(position); editor.current.focus(); } }, [location]);
  return <div ref={host} className={`code-editor-host monaco-host ${readOnly ? 'readonly' : ''}`} />;
});
