import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RotateCw,
  X,
  Search,
  History,
  Trash2,
  Copy,
} from "lucide-react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Button, Input, Spin, Message } from "./ui-kit";
import { api, get, post, confirm } from "./api";
import { Resource, useAction, useResource } from "./ui";
import CodeSurface, { copyText } from "./CodeSurface";
import { readPreferences } from "./preferences";
import { shortcutMatches } from "./shortcut-config";
import TreeIcon from "./TreeIcon";
import SidebarResize from "./SidebarResize";
import FileOperations from "./FileOperations";

function PathMenu({path, onCopyPath, onReveal}) {
  return <>
    <ContextMenu.Item className="file-context-item" onSelect={() => onReveal(path)}><FolderOpen />在文件管理器中查看</ContextMenu.Item>
    {[[ "absolute", "复制绝对路径" ], [ "relative", "复制相对路径" ], [ "name", "复制名称" ]].map(([kind, label]) => (
      <ContextMenu.Item key={kind} className="file-context-item" onSelect={() => onCopyPath(path, kind)}><Copy />{label}</ContextMenu.Item>
    ))}
  </>;
}

function FileEntry({
  item,
  selected,
  onSelect,
  onDelete,
  onCopyPath,
  onReveal,
  deleteBusy,
  searchResult = false,
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          className={`file-tree-item ${selected === item.path ? "selected" : ""}`}
          aria-current={selected === item.path ? "page" : undefined}
          title={item.accessible ? item.path : `${item.path}：链接无法访问`}
          disabled={!item.accessible}
          onClick={() => onSelect(searchResult ? { path: item.path, line: item.line || 1, column: item.column || 1 } : item.path)}
        >
          <TreeIcon name={item.name} link={item.link} />
          <span>
            {item.name}
            {searchResult && (
              <small className="search-result-path">{item.path}</small>
            )}
          </span>
          {searchResult && item.line && <small className="search-line-number">:{item.line}</small>}
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="file-context-menu">
          <ContextMenu.Label className="file-context-label">
            {item.name}
          </ContextMenu.Label>
          <ContextMenu.Item
            className="file-context-item"
            onSelect={() => onSelect(item.path)}
          >
            <FileText />
            打开文件
          </ContextMenu.Item>
          <PathMenu path={item.path} onCopyPath={onCopyPath} onReveal={onReveal} />
          <ContextMenu.Separator className="file-context-separator" />
          <ContextMenu.Item
            className="file-context-item danger"
            disabled={deleteBusy || item.link}
            onSelect={() => onDelete(item.path)}
          >
            <Trash2 />
            删除文件…
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Directory({
  id,
  path = "",
  name,
  selected,
  onSelect,
  version,
  root = false,
  treeDepth = 0,
  treeEpoch = 0,
  onDelete,
  onCopyPath,
  onReveal,
  deleteBusy,
}) {
  const [expanded, setExpanded] = useState(
    root || (path.split("/").length <= treeDepth) || !!selected?.startsWith(path + "/"),
  );
  const [extra, setExtra] = useState([]),
    [more, setMore] = useState(false);
  const [busy, run] = useAction();
  const currentVersion = useRef(version);
  currentVersion.current = version;
  useEffect(() => {
    if (path && selected?.startsWith(path + "/")) setExpanded(true);
  }, [path, selected]);
  useEffect(()=>{if(treeEpoch) setExpanded(root || path.split("/").length<=treeDepth);},[treeEpoch]);
  const resource = useResource(
    (signal) =>
      expanded
        ? get(`/api/local/${id}/files?${new URLSearchParams({ path })}`, signal)
        : Promise.resolve(null),
    [id, path, expanded, version],
  );
  useEffect(() => {
    setExtra([]);
    setMore(resource.data?.hasMore || false);
  }, [resource.data]);
  const items = [...(resource.data?.items || []), ...extra];
  return (
    <li className="file-tree-directory">
      {!root && (
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <button className="file-tree-item folder-item" title={path} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
              {expanded ? <ChevronDown /> : <ChevronRight />}
              <TreeIcon name={name} directory open={expanded} />
              <span>{name}</span>
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="file-context-menu">
              <ContextMenu.Item className="file-context-item" onSelect={() => setExpanded(value => !value)}>
                <Folder />{expanded ? "折叠目录" : "展开目录"}
              </ContextMenu.Item>
              <PathMenu path={path} onCopyPath={onCopyPath} onReveal={onReveal} />
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      )}
      {expanded && (
        <ul>
          {resource.loading && !resource.data ? (
            <li className="tree-message">
              <Spin /> 正在读取…
            </li>
          ) : resource.error ? (
            <li className="tree-message danger">
              {resource.error}
              <Button size="mini" onClick={resource.reload}>
                重试
              </Button>
            </li>
          ) : (
            <>
              {items.map((item) =>
                item.type === "directory" ? (
                  <Directory
                    key={item.path}
                    {...{
                      id,
                      version,
                      treeDepth,
                      treeEpoch,
                      selected,
                      onSelect,
                      onDelete,
                      onCopyPath,
                      onReveal,
                      deleteBusy,
                    }}
                    path={item.path}
                    name={item.name}
                  />
                ) : (
                  <li key={item.path}>
                    <FileEntry
                      {...{
                        item,
                        selected,
                        onSelect,
                        onDelete,
                        onCopyPath,
                        onReveal,
                        deleteBusy,
                      }}
                    />
                  </li>
                ),
              )}
              {!items.length && <li className="tree-message">空目录</li>}
              {more && (
                <li>
                  <Button
                    size="mini"
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        const expected = version;
                        const next = await get(
                          `/api/local/${id}/files?${new URLSearchParams({ path, offset: String(items.length) })}`,
                        );
                        if (currentVersion.current !== expected) return;
                        setExtra((previous) => [...previous, ...next.items]);
                        setMore(next.hasMore);
                      })
                    }
                  >
                    加载更多（已显示 {items.length}/{resource.data.total}）
                  </Button>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </li>
  );
}
const draftCache=new Map();
function Preview({ id, path, version, onEdit, location, onNavigate, onPosition, drafts, setDrafts, onFilesChanged }) {
  const [saving,saveAction]=useAction();
  const resource = useResource(
    (signal) =>
      get(`/api/local/${id}/file?path=${encodeURIComponent(path)}`, signal),
    [id, path, version],
  );
  useEffect(()=>{const data=resource.data;if(!data || data.binary)return;setDrafts(previous=>{const draft=previous[path];if(!draft || draft.content!==draft.saved || draft.revision===data.revision)return previous;return {...previous,[path]:{content:data.content,saved:data.content,revision:data.revision}};});},[resource.data]);
  async function save(data){const draft=drafts[path];if(!draft || draft.content===draft.saved || saving)return;await saveAction(async()=>{const content=draft.content,result=await api('PUT',`/api/local/${id}/file`,{path,content,revision:draft.revision});setDrafts(previous=>({...previous,[path]:{...previous[path],saved:content,revision:result.revision}}));await onFilesChanged?.();Message.success('文件已保存');});}
  const lineCount = (resource.data?.content.match(/\n/g)?.length || 0) + 1;
  return (
    <Resource resource={resource}>
      {(data) => (
        <>
          <div className="file-preview-info">
            <span>
              {(data.size / 1024).toFixed(1)} KB
              {!data.binary && ` · ${lineCount} 行`}
            </span>
            {!data.binary && (
              <Button size="mini" disabled={saving || !drafts[path] || drafts[path].content===drafts[path].saved} onClick={()=>save(resource.data)}>{saving?'保存中…':'保存文件'}</Button>
            )}
          </div>
          <div className="file-preview-pane" key={path}>
            {data.image ? (
              <div className="image-preview">
                <img src={data.image} alt={path} />
              </div>
            ) : data.binary ? (
              <div className="empty">
                <FileText />
                <h3>二进制文件</h3>
                <p>该文件不支持文本预览。</p>
              </div>
            ) : (
              <CodeSurface
                projectId={id}
                path={path}
                value={drafts[path]?.content ?? data.content}
                onChange={content=>setDrafts(previous=>({...previous,[path]:{...(previous[path] || {saved:data.content,revision:data.revision}),content}}))}
                onSave={()=>save(data)}
                disabled={saving}
                location={location}
                onNavigate={onNavigate}
                onPosition={onPosition}
              />
            )}
          </div>
        </>
      )}
    </Resource>
  );
}
export default function FileBrowser({ id, projectPath, version, onEdit, onFilesChanged }) {
  const browserRef = useRef(null), treeRef = useRef(null);
  const [treeWidth, setTreeWidth] = useState(() => Math.max(180, Math.min(520, Number(localStorage.getItem("gitpm-file-tree-width")) || 232)));
  const [treeHidden, setTreeHidden] = useState(false);
  useEffect(() => {
    function toggleTree(event) {
      if (event.defaultPrevented || event.repeat || !shortcutMatches(event, "toggleTree", readPreferences().shortcuts) || !browserRef.current?.getClientRects().length || document.querySelector("[data-ui-modal]")) return;
      event.preventDefault();
      setTreeHidden(value => !value);
    }
    window.addEventListener("keydown", toggleTree);
    return () => window.removeEventListener("keydown", toggleTree);
  }, []);
  function navigateTree(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const button = event.target.closest("button.file-tree-item");
    if (!button) return;
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      const rows = Array.from(event.currentTarget.querySelectorAll("button.file-tree-item:not(:disabled)"));
      const index = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : rows.indexOf(button) + (event.key === "ArrowUp" ? -1 : 1);
      rows[index]?.focus();
    } else if (event.key === "ArrowRight" && button.getAttribute("aria-expanded") === "false") {
      button.click();
    } else if (event.key === "ArrowLeft" && button.getAttribute("aria-expanded") === "true") {
      button.click();
    } else if (event.key === "ArrowLeft") {
      button.closest("li")?.parentElement.closest(".file-tree-directory")?.querySelector(":scope > .folder-item")?.focus();
    } else {
      return;
    }
    event.preventDefault();
  }
  const [tabMenu,setTabMenu]=useState(null);
  useEffect(()=>{const closeMenu=event=>{if(!event.target.closest?.(".editor-tab-menu"))setTabMenu(null);};window.addEventListener("pointerdown",closeMenu);return()=>window.removeEventListener("pointerdown",closeMenu);},[]);
  const [treeDepth,setTreeDepth]=useState(0), [treeEpoch,setTreeEpoch]=useState(0);
  const [drafts,setDrafts]=useState(()=>draftCache.get(id) || {});
  useEffect(()=>{const dirty=Object.fromEntries(Object.entries(drafts).filter(([,draft])=>draft.content!==draft.saved));draftCache.set(id,dirty);const guard=event=>{if(Object.keys(dirty).length){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[drafts,id]);
  const [opened, setOpened] = useState(()=>Object.keys(draftCache.get(id) || {})),
    [navigation, setNavigation] = useState({ paths: [], positions: [], cursor: -1 });
  const position = useRef(null);
  const [mode, setMode] = useState('name-or-path'), [regex, setRegex] = useState(false), [matchCase, setMatchCase] = useState(false), [skipGenerated, setSkipGenerated] = useState(true);
  const [refresh, setRefresh] = useState(0),
    [input, setInput] = useState("");
  const [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [records, setRecords] = useState(false);
  const [deleteBusy, deleteAction] = useAction();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const active = navigation.paths[navigation.cursor] || null;
  const resourceVersion = `${version}/${refresh}`;
  const search = useResource(
    (signal) =>
      debounced
        ? get(
            `/api/local/${id}/file-search?${new URLSearchParams({ q: debounced, mode, regex: String(regex), case: String(matchCase), skipGenerated: String(skipGenerated) })}`,
            signal,
          )
        : Promise.resolve({ items: [], truncated: false }),
    [id, debounced, resourceVersion, mode, regex, matchCase, skipGenerated],
  );
  async function revealPath(path) {
    try { await post(`/api/local/${id}/open`, { path }); }
    catch (error) { Message.error(error.message); }
  }
  async function copyPath(path, kind = "relative") {
    try {
      const separator = /^[a-z]:|^\\\\/i.test(projectPath) ? "\\" : "/";
      const absolute = [String(projectPath || "").replace(/[\\/]+$/, ""), path].join(separator).replace(/[\\/]/g, separator);
      await copyText(kind === "absolute" ? absolute : kind === "name" ? path.split("/").pop() : path);
      await post(`/api/local/${id}/file-operation`, {
        path,
        action: "copy",
        scope: kind === "relative" ? "path" : kind,
      });
      Message.success({ relative: "已复制相对路径", absolute: "已复制绝对路径", name: "已复制名称" }[kind]);
    } catch (error) {
      Message.error(error.message);
    }
  }
  async function remove(path) {
    if (
      !(await confirm(
        "删除文件",
        `将 ${path} 移至应用回收站？可在「文件操作记录」中恢复。`,
        true,
      ))
    )
      return;
    deleteAction(async () => {
      await post(`/api/local/${id}/delete-file`, { path });
      if (opened.includes(path)) close(path);
      setRefresh((value) => value + 1);
      await onFilesChanged?.();
      Message.success("文件已移至应用回收站");
    });
  }
  function open(target) {
    const location = typeof target === 'string' ? { path: target, line: 1, column: 1 } : target;
    const path = location.path;
    if (!path) return;
    setOpened((previous) =>
      previous.includes(path) ? previous : [...previous, path],
    );
    setNavigation((previous) => {
      if (previous.paths[previous.cursor] === path && !location.line) return previous;
      const paths = [...previous.paths.slice(0, previous.cursor + 1), path];
      const positions = [...previous.positions.slice(0, previous.cursor + 1)];
      if (previous.cursor >= 0 && position.current?.path === previous.paths[previous.cursor]) positions[previous.cursor] = position.current;
      positions.push(location);
      return { paths, positions, cursor: paths.length - 1 };
    });
    setInput(path);
  }
  function travel(delta) {
    const cursor = Math.max(
      0,
      Math.min(navigation.paths.length - 1, navigation.cursor + delta),
    );
    setInput(navigation.paths[cursor] || "");
    const positions = [...navigation.positions];
    if (position.current?.path === active) positions[navigation.cursor] = position.current;
    setNavigation({ ...navigation, positions, cursor });
  }
  async function closeTabs(paths){if(paths.some(path=>drafts[path] && drafts[path].content!==drafts[path].saved) && !(await confirm('关闭未保存文件','选中的标签页包含未保存修改，关闭将丢弃这些修改，是否继续？')))return;const remaining=opened.filter(path=>!paths.includes(path));setOpened(remaining);setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([path])=>!paths.includes(path))));setNavigation(previous=>{const next=previous.paths.filter(path=>!paths.includes(path));return {paths:next,positions:next.map(()=>null),cursor:Math.max(-1,next.lastIndexOf(active)>=0?next.lastIndexOf(active):next.length-1)};});setTabMenu(null);}
  async function close(path) {
    if(drafts[path] && drafts[path].content!==drafts[path].saved && !(await confirm("关闭未保存文件","关闭后将丢弃当前文件未保存的修改，是否继续？")))return;
    setDrafts(previous=>{const next={...previous};delete next[path];return next;});
    const remaining = opened.filter((item) => item !== path);
    setOpened(remaining);
    const current = navigation.paths[navigation.cursor];
    const history = navigation.paths.filter((item) => item !== path);
    const paths = history.length
      ? history
      : remaining.length
        ? [remaining[remaining.length - 1]]
        : [];
    const cursor =
      current !== path
        ? paths.lastIndexOf(current)
        : Math.min(navigation.cursor, paths.length - 1);
    setInput(paths[cursor] || "");
    setNavigation({ paths, positions: paths.map((item) => navigation.positions[navigation.paths.lastIndexOf(item)] || { path: item, line: 1, column: 1 }), cursor });
  }
  return (
    <section
      ref={browserRef}
      className={`repository-browser ${treeHidden ? "tree-hidden" : ""}`}
      style={{ "--file-tree-width": `${treeWidth}px` }}
      aria-label="仓库文件浏览器"
      onKeyDown={(event) => {
        if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
        if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          travel(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="repository-file-tree" ref={treeRef} hidden={treeHidden}>
        <div className="file-tree-header">
          <strong>文件</strong>
          <button className="icon-button" aria-label="收起文件树" title="收起文件树" onClick={() => setTreeHidden(true)}><ChevronLeft /></button>
          <button className="icon-button" aria-label="展开下一层目录" title="展开下一层目录" onClick={()=>{setTreeDepth(value=>Math.min(value+1,12));setTreeEpoch(value=>value+1);}}><ChevronDown size={16} /></button>
          <button className="icon-button" aria-label="折叠全部目录" title="折叠全部目录" onClick={()=>{setTreeDepth(0);setTreeEpoch(value=>value+1);}}><ChevronUp size={16} /></button>
          <div className="button-group">
            <button
              className="icon-button"
              aria-label="文件操作记录"
              title="文件操作记录与回收站"
              onClick={() => setRecords(true)}
            >
              <History />
            </button>
            <button
              className="icon-button"
              title="刷新文件列表与预览"
              aria-label="刷新文件浏览器"
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RotateCw />
            </button>
          </div>
        </div>
        <div className="file-search-input">
          <div className="file-search-options">
            <button type="button" className="file-search-content-toggle" aria-pressed={mode === 'content'}
              title="切换文件内容搜索" onClick={() => setMode(value => value === 'content' ? 'name-or-path' : 'content')}>内容</button>
            <button type="button" aria-label="区分大小写" aria-pressed={matchCase} title="区分大小写" onClick={() => setMatchCase(!matchCase)}>Aa</button>
            <button type="button" aria-label="正则搜索" aria-pressed={regex} title="使用正则表达式" onClick={() => setRegex(!regex)}>.*</button>
          </div>
          <Input
            aria-label="搜索仓库文件"
            prefix={<Search size={13} />}
            placeholder={mode === 'content' ? '搜索文件内容' : '搜索文件名或路径'}
            value={query}
            onChange={setQuery}
            allowClear
          />
          <label className="file-search-excludes"><input type="checkbox" checked={skipGenerated} onChange={event => setSkipGenerated(event.target.checked)} />跳过依赖与构建目录</label>
          {regex && <small className="muted">支持正则；不支持环视和回溯引用</small>}
        </div>
        <nav
          aria-label="仓库目录与文件"
          onKeyDown={navigateTree}
          className="file-tree"

        >
          {query.trim() ? (
            <Resource
              resource={{
                ...search,
                data:
                  search.loading || query.trim() !== debounced
                    ? null
                    : search.data,
                loading: search.loading || query.trim() !== debounced,
              }}
            >
              {(data) => (
                <>
                  <p className="tree-message">{data.items.length} 个结果{mode === 'content' ? ' · 点击定位行号' : ''}</p>
                  <ul>
                    {data.items.map((item) => (
                      <li key={item.path}>
                        <FileEntry
                          item={item}
                          selected={active}
                          onSelect={open}
                          onDelete={remove}
                          onCopyPath={copyPath}
                          onReveal={revealPath}
                          deleteBusy={deleteBusy}
                          searchResult
                        />
                        {item.preview !== undefined && <button className="search-content-preview" title={item.preview} onClick={() => open({ path: item.path, line: item.line, column: item.column })}><code>{item.preview.slice(0, item.column - 1)}<mark>{item.preview.slice(item.column - 1, item.endColumn - 1)}</mark>{item.preview.slice(item.endColumn - 1)}</code></button>}
                      </li>
                    ))}
                  </ul>
                  {!data.items.length && (
                    <div className="tree-message">没有匹配的文件</div>
                  )}
                  {data.truncated && (
                    <p className="tree-message">
                      已达到 300 条结果或搜索时间上限，请缩小搜索范围。
                    </p>
                  )}
                </>
              )}
            </Resource>
          ) : (
            <ul>
              <Directory
                key={treeEpoch}
                treeDepth={treeDepth}
                treeEpoch={treeEpoch}
                id={id}
                selected={active}
                onSelect={open}
                version={resourceVersion}
                root
                onDelete={remove}
                onCopyPath={copyPath}
                          onReveal={revealPath}
                deleteBusy={deleteBusy}
              />
            </ul>
          )}
        </nav>
        <p className="file-tree-note">包含未修改和被 Git 忽略的文件</p>
      </div>
      {treeHidden ? (
        <button className="file-tree-reopen" title="展开文件树" aria-label="展开文件树" onClick={() => setTreeHidden(false)}><Folder size={15} /> 文件</button>
      ) : <SidebarResize sidebarRef={treeRef} containerRef={browserRef} width={treeWidth}
        onChange={setTreeWidth} label="调整文件树宽度" storageKey="gitpm-file-tree-width" />}
      <div className="repository-file-viewer">
        <div className="file-navigation">
          <button
            className="icon-button"
            aria-label="上一个查看的文件"
            disabled={navigation.cursor <= 0}
            onClick={() => travel(-1)}
          >
            <ArrowLeft />
          </button>
          <button
            className="icon-button"
            aria-label="下一个查看的文件"
            disabled={navigation.cursor >= navigation.paths.length - 1}
            onClick={() => travel(1)}
          >
            <ArrowRight />
          </button>
          <Input
            aria-label="打开文件路径"
            placeholder="输入文件路径，按回车打开"
            value={input}
            onChange={setInput}
            onPressEnter={() => open(input.trim())}
          />
        </div>
        {opened.length > 0 && (
          <div className="file-open-tabs" aria-label="已打开文件" role="tablist">
            {opened.map((path) => (
              <div
                key={path}
                className={`file-open-tab ${active === path ? "active" : ""}`}
                onAuxClick={event=>{if(event.button===1){event.preventDefault();close(path);}}}
                onContextMenu={event=>{event.preventDefault();setTabMenu({path,x:event.clientX,y:event.clientY});}}
              >
                <button
                  title={path}
                  role="tab" aria-selected={active===path}
                  aria-current={active === path ? "page" : undefined}
                  onClick={() => open(path)}
                >
                  <TreeIcon name={path.split("/").pop()} /> {path.split("/").pop()}{drafts[path] && drafts[path].content!==drafts[path].saved ? " ●" : ""}
                </button>
                <button
                  aria-label={`关闭文件 ${path}`}
                  onClick={() => close(path)}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
        )}
        {tabMenu && <div className="editor-context-menu editor-tab-menu" role="menu" aria-label="标签页操作" style={{position:"fixed",left:tabMenu.x,top:tabMenu.y}}><button role="menuitem" onClick={()=>{setTabMenu(null);close(tabMenu.path);}}>关闭当前标签</button><button role="menuitem" onClick={()=>closeTabs(opened.filter(path=>path!==tabMenu.path))}>关闭其他标签</button><button role="menuitem" onClick={()=>closeTabs(opened)}>关闭全部标签</button></div>}
        {active ? (
          <Preview
            key={active}
            id={id}
            drafts={drafts}
            setDrafts={setDrafts}
            onFilesChanged={onFilesChanged}
            path={active}
            version={resourceVersion}
            onEdit={onEdit}
            location={navigation.positions[navigation.cursor]}
            onNavigate={open}
            onPosition={value => { position.current = value; }}
          />
        ) : (
          <div className="empty file-viewer-empty">
            <FileText />
            <h3>选择文件查看内容</h3>
            <p>展开左侧目录，点击文件即可预览。支持标签页和前进、后退。</p>
          </div>
        )}
      </div>
      {records && (
        <FileOperations
          id={id}
          version={resourceVersion}
          onClose={() => setRecords(false)}
          onRestore={async (path) => {
            setRefresh((value) => value + 1);
            await onFilesChanged?.();
          }}
        />
      )}
    </section>
  );
}
