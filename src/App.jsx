import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Message,
  Modal,
  Popover,
  Select,
} from "./ui-kit";
import {
  IconApps,
  IconBranch,
  IconCloud,
  IconFolder,
  IconMenu,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSun,
} from "./icons";
import AccordionGallery from "./AccordionGallery";
import AnimatedContent from "./components/AnimatedContent";
import Project from "./Project";
import { shortcutMatches } from "./shortcut-config";
import EditorStatusBar from "./EditorStatusBar";
import Host from "./Host";
import Dialogs from "./Dialogs";
import ThemePicker from "./ThemePicker";
import Pagination, { usePageSize } from "./Pagination";
import { applyTheme, readTheme, resolveTheme } from "./themes";
import { api, confirm, get, post, report, status } from "./api";
import { LoadingState, ResultSummary, useAction } from "./ui";
import { apiUrl, searchShortcut } from "./platform";
import SidebarProjects from "./SidebarProjects";
import SidebarResize, { initialSidebarWidth } from "./SidebarResize";
import ClientDownloads from './ClientDownloads';
import FirstRunImport from './FirstRunImport';
import { applyPreferences, readPreferences, savePreferences } from './preferences';

function readRecent() {
  try {
    const ids = JSON.parse(localStorage.getItem("gpm-recent") || "[]");
    return Array.isArray(ids) ? ids.slice(0, 10) : [];
  } catch {
    return [];
  }
}
function readRoute() {
  const match = location.hash.match(/^#\/(project|host)\/([^/]+)$/);
  return match
    ? { type: match[1], id: decodeURIComponent(match[2]) }
    : { type: "home" };
}
export default function App() {
  const [hosts, setHosts] = useState([]),
    [projects, setProjects] = useState([]),
    [settings, setSettings] = useState({});
  const [route, setRoute] = useState(readRoute),
    [dialog, setDialog] = useState(null),
    [mobile, setMobile] = useState(false);
  const [theme, setThemeState] = useState(readTheme);
  const isDesktop = !!window.gitpmDesktop;
  const [desktopReady, setDesktopReady] = useState(!isDesktop);
  const preferencesHydrated = useRef(false);
  const setTheme = useCallback(value => { setThemeState(value); savePreferences({ ...readPreferences(), theme: value }).catch(report); }, []);
  const [downloads, setDownloads] = useState(false);
  const [sideQuery, setSideQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const sidebarRef = useRef(null);
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => localStorage.getItem("gitpm-navigation-collapsed") === "true");
  const [closedGroups, setClosedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("gitpm-navigation-groups")) || {}; }
    catch { return {}; }
  });
  useEffect(() => {
    localStorage.setItem("gitpm-navigation-collapsed", String(navigationCollapsed));
    localStorage.setItem("gitpm-navigation-groups", JSON.stringify(closedGroups));
  }, [navigationCollapsed, closedGroups]);
  function toggleGroup(group) {
    setClosedGroups(previous => ({ ...previous, [group]: !previous[group] }));
  }
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("name");
  const [pageSize, setPageSize] = usePageSize("local");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [query, filter, sort, pageSize]);
  const [selection, setSelection] = useState([]),
    [recent, setRecent] = useState(readRecent);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [refreshing, refreshAction] = useAction(),
    [operating, operation] = useAction();
  const [logs, setLogs] = useState([]),
    [consoleOpen, setConsoleOpen] = useState(false),
    [connected, setConnected] = useState(false);
  const consoleRef = useRef(null),
    followLog = useRef(true),
    searchRef = useRef(null);
  const navigate = useCallback((type = "home", id) => {
    const next = type === "home" ? "#/" : `#/${type}/${encodeURIComponent(id)}`;
    location.hash = next;
    setRoute(type === "home" ? { type } : { type, id: String(id) });
    setMobile(false);
    if (type === "project")
      setRecent((ids) => {
        const nextIds = [
          String(id),
          ...ids.filter((value) => String(value) !== String(id)),
        ].slice(0, 10);
        localStorage.setItem("gpm-recent", JSON.stringify(nextIds));
        return nextIds;
      });
  }, []);
  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      get("/api/hosts"),
      get("/api/local"),
      get("/api/settings"),
    ]);
    if (results[0].status === "fulfilled") setHosts(results[0].value);
    if (results[1].status === "fulfilled") {
      const items = results[1].value.items;
      setProjects(items);
      setSelection((ids) =>
        ids.filter((id) => items.some((p) => String(p.id) === id)),
      );
    }
    if (results[2].status === "fulfilled") setSettings(results[2].value);
    const failure = results.find((result) => result.status === "rejected");
    setError(failure ? failure.reason.message : "");
    setLoading(false);
    if (failure) throw failure.reason;
  }, []);
  useEffect(() => {
    refresh().catch(report);
  }, [refresh]);
  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      setMobile(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const sync = () => { setThemeState(readTheme()); setSidebarWidth(initialSidebarWidth()); };
    window.addEventListener('gitpm:preferences', sync);
    return () => window.removeEventListener('gitpm:preferences', sync);
  }, []);
  useEffect(() => {
    if (loading || preferencesHydrated.current) return;
    preferencesHydrated.current = true;
    if (settings.preferences && Object.keys(settings.preferences).length) applyPreferences(settings.preferences);
    if (isDesktop && (!location.hash || location.hash === '#/')) {
      const previous = settings.preferences?.lastRoute, match = previous?.match(/^#\/project\/(\d+)$/);
      location.hash = readPreferences().startup === 'last' && match && projects.some(project => String(project.id) === match[1]) ? previous : '#/';
    }
  }, [loading, settings, projects, isDesktop]);
  useEffect(() => {
    if (!isDesktop || !desktopReady || loading || !preferencesHydrated.current) return;
    const timer = setTimeout(() => api('PUT', '/api/preferences', { preferences: { lastRoute: route.type === 'project' ? `#/project/${route.id}` : '#/' } }).catch(() => {}), 350);
    return () => clearTimeout(timer);
  }, [route, loading, isDesktop, desktopReady]);
  useEffect(() => {
    if (!isDesktop || !desktopReady || loading || !preferencesHydrated.current) return;
    const timer = setTimeout(() => api('PUT', '/api/preferences', { preferences: { sidebarWidth } }).catch(() => {}), 400);
    return () => clearTimeout(timer);
  }, [sidebarWidth, loading, isDesktop, desktopReady]);
  useEffect(() => {
    const es = new EventSource(apiUrl("/api/events"));
    const append = (items) =>
      setLogs((previous) => [...previous, ...items].slice(-600));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("backlog", (event) => {
      try {
        append(JSON.parse(event.data));
      } catch {}
    });
    es.addEventListener("log", (event) => {
      try {
        append([JSON.parse(event.data)]);
      } catch {}
    });
    return () => es.close();
  }, []);
  useEffect(() => {
    if (consoleRef.current && followLog.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs, consoleOpen]);
  useEffect(() => {
    const listener = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      const editing =
        /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) ||
        document.activeElement?.isContentEditable;
      if (
        (event.key === "/" && !editing) ||
        shortcutMatches(event, "projectSearch", readPreferences().shortcuts)
      ) {
        if (document.querySelector("[data-ui-modal]")) return;
        event.preventDefault();
        navigate();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [navigate]);
  async function reloadAll() {
    await refreshAction(async () => {
      await refresh();
      setRevision((v) => v + 1);
    });
  }
  async function batch(action, ids = selection) {
    if (!ids.length) return;
    if (
      !(await confirm(
        action === "pull" ? "批量拉取" : "批量推送",
        `将处理 ${ids.length} 个项目的当前分支。${action === "push" ? "提交将推送到对应远程仓库。" : "仅允许快进合并。"}`,
      ))
    )
      return;
    await operation(async () => {
      setConsoleOpen(true);
      const result = await post(`/api/local/${action}-all`, { ids });
      Modal.info({
        title: `处理完成：${result.okCount}/${result.total}`,
        content: <ResultSummary result={result} />,
        style: { maxWidth: "calc(100vw - 24px)" },
      });
      await refresh();
      setRevision((v) => v + 1);
    });
  }
  async function removeSelected() {
    if (
      !(await confirm(
        "移除登记",
        `移除 ${selection.length} 个项目登记？磁盘文件会保留。`,
        true,
      ))
    )
      return;
    operation(async () => {
      const results = await Promise.allSettled(
        selection.map((id) => api("DELETE", `/api/local/${id}`)),
      );
      const failed = selection.filter(
        (_, i) => results[i].status === "rejected",
      );
      setSelection(failed);
      if (
        route.type === "project" &&
        selection.includes(route.id) &&
        !failed.includes(route.id)
      )
        navigate();
      Message[failed.length ? "warning" : "success"](
        `已移除 ${results.length - failed.length} 个${failed.length ? `，${failed.length} 个失败` : ""}`,
      );
      await refresh();
    });
  }
  const filtered = useMemo(
    () =>
      projects
        .filter((p) => {
          if (filter === "dirty" && !(p.dirty > 0)) return false;
          if (filter === "lost" && p.exists) return false;
          return [p.name, p.branch, p.local_path].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
          );
        })
        .sort(
          (a, b) =>
            (sort === "status"
              ? Number(!b.exists) - Number(!a.exists) ||
                Number(b.dirty > 0) - Number(a.dirty > 0)
              : 0) || a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
        ),
    [projects, filter, query, sort],
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / pageSize)),
  );
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const quickProjects = useMemo(() => {
    const byId = new Map(projects.map((p) => [String(p.id), p]));
    const visited = recent.map((id) => byId.get(String(id))).filter(Boolean);
    return [...visited, ...projects.filter((p) => !visited.includes(p))].slice(
      0,
      5,
    );
  }, [projects, recent]);
  function select(id, checked) {
    setSelection((ids) =>
      checked
        ? [...new Set([...ids, String(id)])]
        : ids.filter((value) => value !== String(id)),
    );
  }
  const host = route.type === 'host' ? hosts.find((h) => String(h.id) === route.id) : null;
  const sideProjects = projects.filter((project) =>
    [project.name, project.local_path, project.branch].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(sideQuery.trim().toLowerCase()),
    ),
  );
  function openMoveSelected() {
    setDialog({
      type: "batch",
      moveOnly: true,
      items: projects
        .filter((project) => selection.includes(String(project.id)))
        .map((project) => ({
          url: project.remote_url,
          name: project.name,
          localPath: project.local_path,
          projectId: project.id,
          action: project.exists ? "move" : "skip",
          exists: project.exists,
          dirty: project.dirty,
        })),
    });
  }
  const currentProject = projects.find((p) => String(p.id) === route.id);
  const ctx = {
    hosts,
    projects,
    settings,
    refresh,
    navigate,
    setDialog,
    setConsoleOpen,
    revision,
    batch,
    operating,
    theme,
    setTheme,
    reloadProjectViews: () => setRevision((value) => value + 1),
  };
  return (
    <div
      className={`app-shell ${navigationCollapsed ? "navigation-collapsed" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px`, "--navigation-width": navigationCollapsed ? "0px" : `${sidebarWidth}px` }}
    >
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside id="app-navigation" ref={sidebarRef} className={`sidebar ${mobile ? "is-open" : ""}`}>
        <button className="brand" onClick={() => navigate()}>
          <IconBranch />
          <strong>Git 项目管家</strong>
          <span>LOCAL</span>
        </button>
        <nav aria-label="项目导航">
          <button
            className={`nav-item ${route.type === "home" ? "active" : ""}`}
            onClick={() => navigate()}
          >
            <IconApps />
            工作台<span>{projects.length}</span>
          </button>
          <div className="nav-label">
            <button className="nav-group-toggle" aria-controls="remote-navigation" aria-expanded={!closedGroups.remote} onClick={() => toggleGroup("remote")}><ChevronRight size={13} />远程平台</button>
            <button
              aria-label="添加平台"
              onClick={() => setDialog({ type: "host" })}
            >
              <IconPlus />
            </button>
          </div>
          <div id="remote-navigation" hidden={!!closedGroups.remote}>
          {hosts.map((h) => (
            <button
              key={h.id}
              className={`nav-item ${route.type === "host" && route.id === String(h.id) ? "active" : ""}`}
              onClick={() => navigate("host", h.id)}
            >
              <IconCloud />
              <span className="nav-name">{h.name}</span>
              <i
                className={`status-dot ${h.hasToken ? "ok" : "warn"}`}
                title={h.hasToken ? "已配置令牌" : "未配置令牌"}
              />
            </button>
          ))}
          {!hosts.length && (
            <button
              className="nav-item muted"
              onClick={() => setDialog({ type: "host" })}
            >
              连接第一个平台
            </button>
          )}
          </div>
          <div className="nav-label">
            <button className="nav-group-toggle" aria-controls="local-navigation" aria-expanded={!closedGroups.local} onClick={() => toggleGroup("local")}><ChevronRight size={13} />本地仓库</button>
            <button
              aria-label="导入仓库"
              onClick={() => setDialog({ type: "import" })}
            >
              <IconPlus />
            </button>
          </div>
          <div id="local-navigation" hidden={!!closedGroups.local}>
          <SidebarProjects
            projects={sideProjects}
            query={sideQuery}
            onQuery={setSideQuery}
            selection={selection}
            setSelection={setSelection}
            route={route}
            navigate={navigate}
            disabled={operating}
          />
          </div>
        </nav>
        <div className="sidebar-bottom">
          {selection.length > 0 && (
            <div className="sidebar-selected">
              <div>
                <strong>已选 {selection.length} 个项目</strong>
                <button
                  className="text-button"
                  disabled={operating}
                  onClick={() => setSelection([])}
                >
                  取消
                </button>
              </div>
              <div className="sidebar-selected-actions">
                <Button
                  size="mini"
                  disabled={operating}
                  onClick={() => batch("pull")}
                >
                  批量拉取
                </Button>
                <Button
                  size="mini"
                  disabled={operating}
                  onClick={() => batch("push")}
                >
                  批量推送
                </Button>
                <Button
                  size="mini"
                  disabled={operating}
                  onClick={openMoveSelected}
                >
                  更换目录
                </Button>
                <Button
                  size="mini"
                  status="danger"
                  disabled={operating}
                  onClick={removeSelected}
                >
                  移除登记
                </Button>
              </div>
            </div>
          )}
          <div>
            <i className={`status-dot ${connected ? "ok" : "warn"}`} />
            {connected ? "本地服务已连接" : "正在重新连接"}
          </div>
        </div>
      </aside>
      {!navigationCollapsed && <SidebarResize
        sidebarRef={sidebarRef}
        width={sidebarWidth}
        onChange={setSidebarWidth}
      />}
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="desktop-navigation-toggle icon-button" aria-controls="app-navigation" aria-expanded={!navigationCollapsed} aria-label={navigationCollapsed ? "展开项目导航" : "收起项目导航"} title={navigationCollapsed ? "展开项目导航" : "收起项目导航"} onClick={() => setNavigationCollapsed(value => !value)}>
              {navigationCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <button
              className="mobile-menu icon-button"
              aria-label="展开导航"
              onClick={() => setMobile((v) => !v)}
            >
              <IconMenu />
            </button>
            <button onClick={() => navigate()}>工作台</button>
            {route.type !== "home" && (
              <>
                <span>/</span>
                <strong>{host?.name || currentProject?.name || "项目"}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {!isDesktop && <Button onClick={() => setDownloads(true)}>↓ 下载客户端</Button>}
            <Button
              icon={<IconSettings />}
              disabled={loading}
              onClick={() => setDialog({ type: "settings" })}
            >
              设置
            </Button>
            <Popover
              trigger="click"
              position="br"
              title="主题预设"
              content={
                <div className="theme-popover">
                  <ThemePicker value={theme} onChange={setTheme} />
                  <p>选择后立即应用，自动记住偏好。</p>
                </div>
              }
            >
              <button
                className="icon-button"
                aria-label="选择主题"
                title={`当前主题：${resolveTheme(theme).name}`}
              >
                {resolveTheme(theme).mode === "dark" ? (
                  <IconMoon />
                ) : (
                  <IconSun />
                )}
              </button>
            </Popover>
            <Button
              icon={<IconRefresh />}
              loading={refreshing}
              onClick={reloadAll}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<IconPlus />}
              onClick={() => setDialog({ type: "import" })}
            >
              导入仓库
            </Button>
          </div>
        </header>
        <div className="global-search">
          <IconSearch />
          <input
            ref={searchRef}
            aria-label="搜索仓库"
            placeholder="查找仓库、路径或分支…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (route.type !== "home") navigate();
            }}
          />
          <kbd>{searchShortcut()}</kbd>
          {query && (
            <button
              className="text-button"
              aria-label="清除搜索"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>
        <main key={`${route.type}/${route.id || ""}`}>
          <AnimatedContent trigger="mount" distance={10} duration={0.28}>
            {error && (
              <Alert
                type="error"
                content={error}
                action={
                  <Button size="mini" onClick={reloadAll}>
                    重试
                  </Button>
                }
              />
            )}
            {route.type === "home" ? (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">YOUR REPOSITORIES</span>
                    <h1>
                      工作台<span className="heading-dot">.</span>
                    </h1>
                    <p>
                      {projects.length} 个本地仓库
                      <span className="separator">/</span>
                      {hosts.length} 个远程平台
                    </p>
                  </div>
                  <Button onClick={() => setDialog({ type: "scan" })}>
                    检索目录 ↗
                  </Button>
                </div>
                {!query && filter === "all" && quickProjects.length > 0 && (
                  <section className="quick-section">
                    <div className="section-label">
                      <h2>快速访问</h2>
                      <span>悬停或聚焦展开 · 方向键切换</span>
                    </div>
                    <AccordionGallery
                      items={quickProjects}
                      onOpen={(id) => navigate("project", id)}
                    />
                  </section>
                )}
                <section className="repository-section">
                  <div className="list-toolbar">
                    <div
                      className="filter-tabs"
                      role="group"
                      aria-label="项目状态筛选"
                    >
                      {[
                        ["all", "全部仓库", projects.length],
                        [
                          "dirty",
                          "待提交",
                          projects.filter((p) => p.dirty > 0).length,
                        ],
                        [
                          "lost",
                          "目录丢失",
                          projects.filter((p) => !p.exists).length,
                        ],
                      ].map(([value, label, count]) => (
                        <button
                          key={value}
                          aria-pressed={filter === value}
                          className={filter === value ? "selected" : ""}
                          onClick={() => {
                            setFilter(value);
                            setSelection([]);
                          }}
                        >
                          {label}
                          <span>{count}</span>
                        </button>
                      ))}
                    </div>
                    <Select
                      aria-label="项目排序"
                      size="small"
                      style={{ width: 128 }}
                      value={sort}
                      onChange={setSort}
                      options={[
                        { value: "name", label: "名称排序" },
                        { value: "status", label: "待处理优先" },
                      ]}
                    />
                  </div>
                  {selection.length > 0 && (
                    <div className="batch-toolbar">
                      <span>已选 {selection.length} 项</span>
                      <Button
                        size="mini"
                        disabled={operating}
                        onClick={() => batch("pull")}
                      >
                        拉取
                      </Button>
                      <Button
                        size="mini"
                        disabled={operating}
                        onClick={() => batch("push")}
                      >
                        推送
                      </Button>
                      <Button
                        size="mini"
                        disabled={operating}
                        onClick={() =>
                          setDialog({
                            type: "batch",
                            moveOnly: true,
                            items: projects
                              .filter((p) => selection.includes(String(p.id)))
                              .map((p) => ({
                                url: p.remote_url,
                                name: p.name,
                                localPath: p.local_path,
                                projectId: p.id,
                                action: p.exists ? "move" : "skip",
                                exists: p.exists,
                                dirty: p.dirty,
                              })),
                          })
                        }
                      >
                        换目录
                      </Button>
                      <Button
                        status="danger"
                        size="mini"
                        disabled={operating}
                        onClick={removeSelected}
                      >
                        移除登记
                      </Button>
                      <button
                        className="text-button"
                        onClick={() => setSelection([])}
                      >
                        取消选择
                      </button>
                    </div>
                  )}
                  {loading ? (
                    <LoadingState label="正在读取仓库…" />
                  ) : filtered.length ? (
                    <div className="repo-table">
                      <div className="repo-row table-heading">
                        <Checkbox
                          aria-label="全选当前页"
                          checked={pageItems.every((p) =>
                            selection.includes(String(p.id)),
                          )}
                          indeterminate={
                            pageItems.some((p) =>
                              selection.includes(String(p.id)),
                            ) &&
                            !pageItems.every((p) =>
                              selection.includes(String(p.id)),
                            )
                          }
                          onChange={(checked) =>
                            setSelection(
                              checked
                                ? [
                                    ...new Set([
                                      ...selection,
                                      ...pageItems.map((p) => String(p.id)),
                                    ]),
                                  ]
                                : selection.filter(
                                    (id) =>
                                      !pageItems.some(
                                        (p) => String(p.id) === id,
                                      ),
                                  ),
                            )
                          }
                        />
                        <span>仓库 / 路径</span>
                        <span>当前分支</span>
                        <span>工作区状态</span>
                        <span />
                      </div>
                      {pageItems.map((p) => (
                        <div className="repo-row" key={p.id}>
                          <Checkbox
                            aria-label={`选择 ${p.name}`}
                            checked={selection.includes(String(p.id))}
                            onChange={(checked) => select(p.id, checked)}
                          />
                          <button
                            className="repo-name"
                            onClick={() => navigate("project", p.id)}
                          >
                            <strong>
                              <IconFolder />
                              {p.name}
                            </strong>
                            <small title={p.local_path}>{p.local_path}</small>
                          </button>
                          <span className="branch-label" title={p.branch || ""}>
                            <IconBranch />
                            {p.branch || "detached HEAD"}
                          </span>
                          <span
                            className={`repo-state ${!p.exists ? "danger" : p.dirty > 0 ? "warning" : p.dirty < 0 ? "muted" : ""}`}
                          >
                            <i
                              className={`status-dot ${!p.exists ? "bad" : p.dirty > 0 ? "warn" : p.dirty < 0 ? "" : "ok"}`}
                            />
                            {status(p)}
                          </span>
                          <button
                            className="icon-button"
                            aria-label={`打开 ${p.name}`}
                            onClick={() => navigate("project", p.id)}
                          >
                            ↗
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty">
                      <IconFolder />
                      <h3>
                        {projects.length
                          ? "没有匹配的仓库"
                          : "添加你的第一个仓库"}
                      </h3>
                      <p>
                        {projects.length
                          ? "调整关键词，或清除当前筛选。"
                          : "导入本地 Git 仓库，或连接平台克隆项目。"}
                      </p>
                      <Button
                        onClick={() =>
                          projects.length
                            ? (setQuery(""), setFilter("all"))
                            : setDialog({ type: "import" })
                        }
                      >
                        {projects.length ? "清除筛选" : "导入本地仓库"}
                      </Button>
                    </div>
                  )}
                </section>
                {!loading && (
                  <Pagination
                    page={currentPage}
                    pageSize={pageSize}
                    count={pageItems.length}
                    total={filtered.length}
                    onPage={setPage}
                    onPageSize={setPageSize}
                  />
                )}
                <div className="workspace-note">
                  <span>
                    {filtered.length} 个仓库<span className="separator">/</span>
                    {settings.workspace}
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      batch(
                        "pull",
                        projects
                          .filter((p) => p.exists && p.remote_url)
                          .map((p) => String(p.id)),
                      )
                    }
                    disabled={
                      operating ||
                      !projects.some((p) => p.exists && p.remote_url)
                    }
                  >
                    全部拉取 ↙
                  </button>
                </div>
              </>
            ) : route.type === "project" ? (
              <Project id={route.id} ctx={ctx} />
            ) : host ? (
              <Host key={host.id} host={host} ctx={ctx} />
            ) : loading ? (
              <LoadingState label="正在读取平台…" />
            ) : (
              <div className="empty">
                <h3>平台不存在</h3>
                <Button onClick={() => navigate()}>返回工作台</Button>
              </div>
            )}
          </AnimatedContent>
        </main>
        <footer className="console">
          <div className="console-toolbar">
            <button
              className="text-button"
              aria-expanded={consoleOpen}
              onClick={() => setConsoleOpen((v) => !v)}
            >
              <span>{consoleOpen ? "▾" : "▸"}</span> Git 日志{" "}
              <span className="log-count">{logs.length}</span>
            </button>
            <EditorStatusBar />
            <span className="console-status">
              <i className={`status-dot ${connected ? "ok" : "warn"}`} />
              {connected ? "实时连接" : "连接中"}
            </span>
            <button
              className="text-button"
              disabled={!logs.length}
              onClick={() => setLogs([])}
            >
              清空
            </button>
          </div>
          {consoleOpen && (
            <div
              className="console-body"
              ref={consoleRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                followLog.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {logs.length ? (
                logs.map((line, i) => (
                  <div className={`c-line c-${line.level}`} key={i}>
                    <time>
                      {new Date(line.t).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}
                    </time>
                    {line.text}
                  </div>
                ))
              ) : (
                <span className="muted">暂无操作日志</span>
              )}
            </div>
          )}
        </footer>
      </div>
      {downloads && !isDesktop && <ClientDownloads onClose={() => setDownloads(false)} />}
      {isDesktop && !loading && <FirstRunImport ctx={ctx} onReady={setDesktopReady} />}
      {dialog && (
        <Dialogs
          key={`${dialog.type}/${dialog.id || dialog.host?.id || ""}`}
          dialog={dialog}
          ctx={ctx}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
