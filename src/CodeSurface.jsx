import React, { useRef, useState } from "react";
import { Copy, Clipboard, Braces } from "lucide-react";
import CodeEditor from "./CodeEditor";
import { languageInfo } from "./editor-language";
import { Button, Message } from "./ui-kit";
import { post } from "./api";
import { useAction, useResource } from "./ui";
import { get } from './api';

export async function copyText(text) {
  if (window.gitpmDesktop?.writeClipboard)
    return window.gitpmDesktop.writeClipboard(text);
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const previous = document.activeElement,
    element = document.createElement("textarea");
  element.value = text;
  element.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.append(element);
  element.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error("无法访问剪贴板，请使用系统复制快捷键");
  } finally {
    element.remove();
    previous?.focus();
  }
}
export default function CodeSurface({
  projectId,
  path,
  value,
  onChange,
  readOnly = false,
  onSave,
  onOperation,
  onNavigate,
  location,
  onPosition,
  resetValue,
  disabled = false,
}) {
  const editor = useRef(null),
    [hasSelection, setHasSelection] = useState(false),
    [busy, run] = useAction();
  const info = languageInfo(path);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [references, setReferences] = useState(null);
  const [javaInstalling, setJavaInstalling] = useState(false);
  const javaStatus = useResource(() => info.mode === 'java' ? get(`/api/local/${projectId}/java-status`) : Promise.resolve(null), [projectId, info.mode]);
  function findReferences() {
    if (!['java', 'javascript', 'typescript'].includes(info.mode)) { Message.info('当前支持 JS、TS 和 Java 的语义引用查询'); return; }
    run(async () => {
      const position = editor.current.getPosition();
      const data = await post(`/api/local/${projectId}/${info.mode === 'java' ? 'java' : 'script'}-intelligence`, { path, content: editor.current.getText(), action: 'references', line: position.lineNumber, column: position.column });
      setReferences(data.items);
      if (data.truncated) Message.warning('工程较大，当前引用结果仅覆盖已分析的文件范围');
    });
  }
  async function recordCopy(scope) {
    try {
      await post(`/api/local/${projectId}/file-operation`, {
        path,
        action: "copy",
        scope,
      });
      onOperation?.();
    } catch {
      Message.warning("已复制，但操作记录写入失败");
    }
  }
  async function copy(scope) {
    await run(async () => {
      const text =
        scope === "selection"
          ? editor.current.getSelection()
          : editor.current.getText();
      if (scope === "selection" && !text) return;
      await copyText(text);
      await recordCopy(scope);
      Message.success(
        scope === "selection" ? "已复制选中内容" : "已复制全部内容",
      );
    });
  }
  function format() {
    if (readOnly || disabled || !info.canFormat) return;
    run(async () => {
      const result = await post(`/api/local/${projectId}/format`, {
        path,
        content: editor.current.getText(),
      });
      onChange(result.content);
      onOperation?.();
      Message.success("已格式化，保存后写入文件");
    });
  }
  return (
    <div className="code-surface">
      <div className="code-toolbar">
        <span>
          {info.label} · {info.indent} 空格
          <small className="editor-caret"> · {caret.line}:{caret.column}</small>
        </span>
        <div className="button-group">
          {info.mode === 'java' && <Button size="mini" disabled={busy || javaStatus.loading || javaStatus.data?.installed} title={javaStatus.error || '基础导航使用本地 JDK 17+；Eclipse JDT 深度工程分析需要 JDK 25+ 和首次下载'} onClick={() => run(async () => { setJavaInstalling(true); try { await post(`/api/local/${projectId}/java-install`); javaStatus.reload(); Message.success('Java 深度分析已启用，首次跳转需要建立工程索引'); } finally { setJavaInstalling(false); } })}>{javaStatus.data?.installed ? 'JDT 深度分析已启用' : javaInstalling ? '正在下载 Java 服务…' : 'JDK 导航 · 启用深度分析'}</Button>}
          <Button size="mini" disabled={disabled} onClick={()=>editor.current?.action("find")}>查找 / 替换</Button>
          <Button size="mini" title="Ctrl+点击（macOS：⌘+点击）" onClick={() => editor.current?.action('editor.action.revealDefinition')}>转到定义</Button>
          <Button size="mini" disabled={busy} onClick={findReferences}>查找引用</Button>
          <Button
            size="mini"
            icon={<Copy size={12} />}
            disabled={busy}
            onClick={() => copy("all")}
          >
            复制全文
          </Button>
          <Button
            size="mini"
            icon={<Clipboard size={12} />}
            disabled={!hasSelection || busy}
            onClick={() => copy("selection")}
          >
            复制选中
          </Button>
          {!readOnly && (
            <Button
              size="mini"
              icon={<Braces size={12} />}
              disabled={busy || disabled || !info.canFormat}
              title="格式化编辑区，保存后才写入文件"
              onClick={format}
            >
              格式化
            </Button>
          )}
        </div>
      </div>
      {references && <div className="symbol-references" aria-label="代码引用结果"><div><strong>{references.length} 处引用</strong><Button size="mini" onClick={() => setReferences(null)}>关闭引用</Button></div>{references.map((item, index) => <button key={`${item.path}/${index}`} onClick={() => onNavigate?.({ path: item.path, line: item.range.start.line + 1, column: item.range.start.character + 1 })}>{item.path}<small>:{item.range.start.line + 1}:{item.range.start.character + 1}</small></button>)}{!references.length && <p className="muted">当前位置没有找到引用，请把光标放在方法或变量名上。</p>}</div>}
      <CodeEditor
        ref={editor}
        value={value}
        path={path}
        projectId={projectId}
        disabled={disabled}
        resetValue={resetValue}
        readOnly={readOnly}
        onChange={onChange}
        onSelection={setHasSelection}
        onSave={onSave}
        onFormat={format}
        onReferences={findReferences}
        onNavigate={onNavigate}
        location={location}
        onPosition={position => { setCaret(position); onPosition?.(position); }}
        onNativeCopy={() => {
          if (editor.current?.getSelection()) recordCopy("selection");
        }}
      />
    </div>
  );
}
