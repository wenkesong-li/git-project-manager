import React, { useEffect, useState, useRef } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Message,
  Modal,
  Select,
  Tabs,
  Tag,
} from "./ui-kit";
import {
  IconBranch,
  IconDownload,
  IconFolder,
  IconPlus,
  IconRefresh,
  IconUpload,
} from "./icons";
import { api, confirm, date, get, post, report, status } from "./api";
import { Diff, Field, FormModal, Resource, useAction, useResource } from "./ui";
import FileBrowser from "./FileBrowser";
import CodeSurface from "./CodeSurface";
import RunPanel from './RunPanel';
import ProjectRunDock from './ProjectRunDock';

export default function Project({ id, ctx }) {
  const [version, setVersion] = useState(0),
    [tab, setTab] = useState("files");
  const resource = useResource(
    (signal) => get(`/api/local/${id}`, signal),
    [id, ctx.revision, version],
  );
  const [busy, run] = useAction();
  const [dialog, setDialog] = useState(null);
  async function changed() {
    setVersion((v) => v + 1);
    await ctx.refresh();
  }
  async function act(action, body = {}) {
    if (
      action === "push" &&
      !(await confirm(
        "推送当前分支",
        `将 ${resource.data?.branch} 推送到远程仓库？`,
      ))
    )
      return;
    await run(async () => {
      ctx.setConsoleOpen(true);
      await post(`/api/local/${id}/${action}`, body);
      Message.success("操作完成");
      await changed();
    });
  }
  async function checkout(branch, stash = false) {
    await run(async () => {
      const result = await post(`/api/local/${id}/checkout`, { branch, stash });
      if (result.needConfirm) {
        if (
          !(await confirm(
            "工作区有未提交修改",
            "先贮藏修改，切换分支后自动恢复？恢复时可能出现冲突，请留意日志。",
          ))
        )
          return;
        ctx.setConsoleOpen(true);
        await post(`/api/local/${id}/checkout`, { branch, stash: true });
      }
      Message.success(`已切换到 ${branch}`);
      setDialog(null);
      await changed();
    });
  }
  return (
    <Resource resource={resource}>
      {(p) => (
        <>
          <div className="page-heading project-heading">
            <div>
              <span className="eyebrow">LOCAL REPOSITORY</span>
              <h1>{p.name}</h1>
              <p className="path-text">{p.local_path}</p>
            </div>
            <div className="button-group">
              <Button
                icon={<IconFolder />}
                disabled={!p.exists || busy}
                onClick={() => act("open")}
              >
                目录
              </Button>
              <Button
                disabled={!p.exists || busy}
                onClick={() => act("terminal")}
              >
                终端
              </Button>
              <Button
                type="primary"
                icon={<IconDownload />}
                loading={busy}
                disabled={!p.exists || !p.remote_url}
                onClick={() => act("pull")}
              >
                拉取
              </Button>
              <Button
                icon={<IconUpload />}
                disabled={busy || !p.exists || !p.remote_url || !p.branch}
                onClick={() => act("push")}
              >
                推送
              </Button>
            </div>
          </div>
          <div className="project-meta">
            <span>
              <IconBranch />
              {p.branch || "detached HEAD"}
            </span>
            <span className={p.dirty > 0 ? "warning" : "muted"}>
              {status(p)}
            </span>
            <span className="muted">上次同步 {date(p.last_sync_at)}</span>
            <Button
              size="mini"
              disabled={busy || !p.remote_url || !p.exists}
              onClick={() => act("fetch")}
            >
              获取远程
            </Button>
          </div>
          {!p.exists && (
            <Alert
              type="warning"
              content="本地目录不存在。检查仓库存放路径，或移除登记后重新导入。"
            />
          )}
          {p.exists && <ProjectRunDock id={id} version={version} onRefresh={()=>setVersion(value=>value+1)} onConfigure={()=>setTab('run')} />}
          <Tabs
            activeTab={tab}
            onChange={setTab}
            type="line"
            lazyload
            destroyOnHide
          >
            <Tabs.TabPane key="files" title="文件浏览" keepAlive>
              {p.exists ? (
                <FileBrowser
                  id={id}
                  version={`${version}/${ctx.revision}`}
                  onFilesChanged={changed}
                  onEdit={(path) => setDialog({ type: "file", path })}
                />
              ) : (
                <div className="empty">本地目录不存在，无法浏览文件。</div>
              )}
            </Tabs.TabPane>
            <Tabs.TabPane key="changes" title="文件修改">
              <Changes
                id={id}
                version={`${version}/${ctx.revision}`}
                disabled={!p.exists}
                changed={changed}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key="run" title="编译运行"><RunPanel id={id} /></Tabs.TabPane>
            <Tabs.TabPane key="branches" title="分支管理">
              <Branches
                id={id}
                version={`${version}/${ctx.revision}`}
                current={p.branch}
                busy={busy}
                checkout={checkout}
                onNew={() => setDialog({ type: "new" })}
                onRemote={() => setDialog({ type: "switch" })}
                changed={changed}
                disabled={!p.exists}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key="history" title="提交历史">
              <History id={id} version={`${version}/${ctx.revision}`} />
            </Tabs.TabPane>
            <Tabs.TabPane key="stash" title="贮藏">
              <Stashes id={id} changed={changed} />
            </Tabs.TabPane>
            <Tabs.TabPane key="info" title="仓库信息">
              <div className="info-list">
                <div>
                  <span>远程地址</span>
                  <code>{p.remote_url || "纯本地仓库"}</code>
                </div>
                <div>
                  <span>所属平台</span>
                  {ctx.hosts.find((h) => h.id === p.host_id)?.name || "未关联"}
                </div>
                <div>
                  <span>本地目录</span>
                  <code>{p.local_path}</code>
                </div>
              </div>
              <Button
                status="danger"
                onClick={async () => {
                  if (
                    !(await confirm(
                      "移除项目登记",
                      `移除 ${p.name}？仅解除登记，磁盘文件会保留。`,
                      true,
                    ))
                  )
                    return;
                  run(async () => {
                    await api("DELETE", `/api/local/${id}`);
                    await ctx.refresh();
                    ctx.navigate();
                  });
                }}
              >
                移除登记
              </Button>
            </Tabs.TabPane>
          </Tabs>
          {dialog?.type === "file" && (
            <FileEditor
              id={id}
              path={dialog.path}
              onClose={() => setDialog(null)}
              onSaved={async () => {
                await changed();
              }}
            />
          )}
          {dialog?.type === "new" && (
            <NewBranch
              onClose={() => setDialog(null)}
              onCreate={(name) =>
                run(async () => {
                  await post(`/api/local/${id}/create-branch`, { name });
                  setDialog(null);
                  await changed();
                  Message.success("分支已创建");
                })
              }
            />
          )}
          {dialog?.type === "switch" && (
            <RemoteSwitch
              id={id}
              onClose={() => setDialog(null)}
              onSwitch={checkout}
              busy={busy}
            />
          )}
        </>
      )}
    </Resource>
  );
}
function Changes({ id, version, changed, disabled }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/changes`, signal),
    [id, version],
  );
  const [selected, setSelected] = useState([]),
    [query, setQuery] = useState(""),
    [dialog, setDialog] = useState(null);
  const [busy, run] = useAction();
  const items = resource.data?.items || [];
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((path) => items.some((item) => item.path === path)),
    );
  }, [resource.data]);
  async function stage(paths, unstage = false) {
    run(async () => {
      await post(`/api/local/${id}/stage`, { paths, unstage });
      resource.reload();
      await changed();
    });
  }
  async function discard(paths) {
    if (
      !(await confirm(
        "还原文件",
        `将还原 ${paths.length} 个文件。未提交修改将丢失，未跟踪文件将被删除。此操作无法撤销。`,
        true,
      ))
    )
      return;
    run(async () => {
      await post(`/api/local/${id}/discard`, { paths });
      setSelected([]);
      resource.reload();
      await changed();
      Message.success("已还原");
    });
  }
  const visible = items.filter((item) =>
    item.path.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="section-toolbar">
        <Input
          prefix={<IconFolder />}
          aria-label="筛选修改文件"
          placeholder="筛选文件路径"
          style={{ width: 260 }}
          value={query}
          onChange={setQuery}
          allowClear
        />
        <div className="button-group">
          {selected.length > 0 && (
            <>
              <span className="muted">已选 {selected.length}</span>
              <Button
                size="small"
                disabled={busy}
                onClick={() => stage(selected)}
              >
                暂存
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() => stage(selected, true)}
              >
                取消暂存
              </Button>
              <Button
                size="small"
                status="danger"
                disabled={busy}
                onClick={() => discard(selected)}
              >
                还原
              </Button>
            </>
          )}
          <Button
            size="small"
            icon={<IconRefresh />}
            loading={resource.loading}
            onClick={resource.reload}
          >
            刷新
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={
              disabled ||
              busy ||
              !items.length ||
              (!selected.length && !items.some((item) => item.staged))
            }
            onClick={() => setDialog({ type: "commit", paths: [...selected] })}
          >
            提交{selected.length ? ` ${selected.length} 个文件` : "暂存区"}
          </Button>
        </div>
      </div>
      <Resource resource={resource}>
        {() =>
          visible.length ? (
            <div className="file-list">
              <div className="file-row table-heading">
                <Checkbox
                  aria-label="全选当前文件"
                  checked={visible.every((f) => selected.includes(f.path))}
                  indeterminate={
                    visible.some((f) => selected.includes(f.path)) &&
                    !visible.every((f) => selected.includes(f.path))
                  }
                  onChange={(checked) =>
                    setSelected((previous) =>
                      checked
                        ? [
                            ...new Set([
                              ...previous,
                              ...visible.map((f) => f.path),
                            ]),
                          ]
                        : previous.filter(
                            (path) => !visible.some((f) => f.path === path),
                          ),
                    )
                  }
                />
                <span>状态</span>
                <span>文件路径</span>
                <span />
              </div>
              {visible.map((f) => (
                <div className="file-row" key={f.path}>
                  <Checkbox
                    aria-label={`选择文件 ${f.path}`}
                    checked={selected.includes(f.path)}
                    onChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [...previous, f.path]
                          : previous.filter((path) => path !== f.path),
                      )
                    }
                  />
                  <Tag
                    size="small"
                    color={
                      f.state === "added"
                        ? "green"
                        : f.state === "deleted" || f.state === "conflict"
                          ? "red"
                          : "orange"
                    }
                  >
                    {
                      {
                        added: "新增",
                        modified: "修改",
                        deleted: "删除",
                        conflict: "冲突",
                      }[f.state]
                    }
                    {f.staged ? " · 已暂存" : ""}
                  </Tag>
                  <button
                    className="file-path"
                    onClick={() => setDialog({ type: "diff", path: f.path })}
                  >
                    {f.path}
                  </button>
                  <div className="button-group">
                    <Button
                      size="mini"
                      disabled={busy}
                      onClick={() => stage([f.path], f.staged)}
                    >
                      {f.staged ? "取消暂存" : "暂存"}
                    </Button>
                    {f.state !== "deleted" && (
                      <Button
                        size="mini"
                        disabled={busy}
                        onClick={() =>
                          setDialog({ type: "file", path: f.path })
                        }
                      >
                        预览 / 编辑
                      </Button>
                    )}
                    <Button
                      size="mini"
                      status="danger"
                      disabled={busy}
                      onClick={() => discard([f.path])}
                    >
                      还原
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <IconBranch />
              <h3>{query ? "没有匹配的文件" : "工作区干净"}</h3>
              <p>{query ? "试试其他文件路径。" : "没有未提交的修改。"}</p>
            </div>
          )
        }
      </Resource>
      {!!items.length && (
        <p className="section-note">
          勾选文件后只提交所选文件；不勾选时提交暂存区。
        </p>
      )}
      {dialog?.type === "diff" && (
        <FileDiff id={id} path={dialog.path} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "file" && (
        <FileEditor
          id={id}
          path={dialog.path}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            resource.reload();
            await changed();
          }}
        />
      )}
      {dialog?.type === "commit" && (
        <Commit
          id={id}
          paths={dialog.paths}
          onClose={() => setDialog(null)}
          onCommitted={async () => {
            setDialog(null);
            setSelected([]);
            resource.reload();
            await changed();
          }}
        />
      )}
    </>
  );
}
function FileDiff({ id, path, sha, onClose }) {
  const resource = useResource(
    (signal) =>
      get(
        `/api/local/${id}/${sha ? "commit-diff" : "diff"}?${new URLSearchParams({ path, ...(sha ? { sha } : {}) })}`,
        signal,
      ),
    [id, path, sha],
  );
  return (
    <Diff
      resource={resource}
      title={`${sha ? sha.slice(0, 8) : "工作区与 HEAD"} · ${path}`}
      onClose={onClose}
    />
  );
}
function FileEditor(props) {
  const [navigation, setNavigation] = useState({ items: [{ path: props.path, line: 1, column: 1 }], cursor: 0 });
  const position = useRef(null);
  const current = navigation.items[navigation.cursor];
  function navigate(target) {
    setNavigation(previous => {
      const items = previous.items.slice(0, previous.cursor + 1);
      if (position.current?.path === items[previous.cursor].path) items[previous.cursor] = position.current;
      return { items: [...items, target], cursor: items.length };
    });
  }
  function travel(delta) {
    setNavigation(previous => {
      const items = [...previous.items];
      if (position.current?.path === items[previous.cursor].path) items[previous.cursor] = position.current;
      return { items, cursor: previous.cursor + delta };
    });
  }
  return <FileEditorContent {...props} key={current.path} path={current.path} location={current} onNavigate={navigate} onPosition={value => { position.current = value; }} onTravel={travel} canBack={navigation.cursor > 0} canForward={navigation.cursor < navigation.items.length - 1} />;
}
function FileEditorContent({ id, path, onClose, onSaved, onNavigate, location, onPosition, onTravel, canBack, canForward }) {
  const formRef = useRef(null);
  const resource = useResource(
    (signal) =>
      get(`/api/local/${id}/file?path=${encodeURIComponent(path)}`, signal),
    [id, path],
  );
  const [editing, setEditing] = useState(true),
    [content, setContent] = useState("");
  const [snapshot, setSnapshot] = useState(null), [saving, setSaving] = useState(false);
  useEffect(() => {
    if (resource.data) { setContent(resource.data.content); setSnapshot(resource.data); }
  }, [resource.data]);
  const dirty = editing && content !== snapshot?.content;
  async function navigate(action) {
    if (dirty && !(await confirm('放弃当前编辑', '跳转会放弃当前文件尚未保存的内容，是否继续？', true))) return;
    action();
  }
  async function close() {
    if (
      !dirty ||
      (await confirm("放弃编辑", "关闭后将丢弃尚未保存的编辑内容。", true))
    )
      onClose();
  }
  return (
    <FormModal
      title={`${editing ? "编辑" : "预览"} · ${path}`}
      onClose={close}
      width={940}
      formRef={formRef}
      canSubmit={dirty && !resource.data?.binary}
      okText="保存文件"
      onSubmit={async () => {
        setSaving(true);
        try {
        const result = await api("PUT", `/api/local/${id}/file`, {
          path,
          content,
          revision: snapshot.revision,
        });
        setSnapshot(previous => ({ ...previous, content, revision: result.revision }));
        Message.success("已保存");
        await onSaved();
        } finally { setSaving(false); }
      }}
    >
      <div className="editor-navigation"><Button size="mini" disabled={!canBack} onClick={() => navigate(() => onTravel(-1))}>← 返回</Button><Button size="mini" disabled={!canForward} onClick={() => navigate(() => onTravel(1))}>前进 →</Button><span className="muted">Ctrl / ⌘ + 点击跳转 · F12 定义 · Shift+F12 引用</span></div>
      <Resource resource={resource}>
        {(data) =>
          data.binary ? (
            <div className="empty">二进制文件，无法预览和编辑</div>
          ) : (
            <>
              {!editing && (
                <div className="section-toolbar">
                  <span className="muted">文本预览</span>
                  <Button size="small" onClick={() => setEditing(true)}>
                    编辑文件
                  </Button>
                </div>
              )}
              <div className="file-edit-surface">
                <CodeSurface
                  projectId={id}
                  path={path}
                  value={editing ? content : data.content}
                  onChange={setContent}
                  readOnly={!editing}
                  disabled={saving}
                  resetValue={snapshot?.content}
                  onSave={() => formRef.current?.requestSubmit()}
                  location={location}
                  onNavigate={target => navigate(() => onNavigate(target))}
                  onPosition={onPosition}
                />
              </div>
            </>
          )
        }
      </Resource>
    </FormModal>
  );
}
function Commit({ id, paths, onClose, onCommitted }) {
  const [message, setMessage] = useState("");
  return (
    <FormModal
      title="提交修改"
      onClose={onClose}
      canSubmit={!!message.trim()}
      okText="提交"
      onSubmit={async () => {
        await post(`/api/local/${id}/commit`, {
          paths,
          message: message.trim(),
        });
        Message.success("提交成功");
        await onCommitted();
      }}
    >
      <Field label="提交说明">
        <Input.TextArea
          autoFocus
          value={message}
          onChange={setMessage}
          placeholder="简要描述本次修改"
          autoSize={{ minRows: 3, maxRows: 8 }}
          maxLength={200}
          showWordLimit
        />
      </Field>
      <p className="muted">
        {paths.length
          ? `将自动暂存并提交所选的 ${paths.length} 个文件。`
          : "将提交当前暂存区的全部文件。"}
      </p>
      {paths.length > 0 && (
        <pre className="commit-paths">{paths.join("\n")}</pre>
      )}
    </FormModal>
  );
}
function NewBranch({ onClose, onCreate }) {
  const [name, setName] = useState("");
  return (
    <FormModal
      title="新建分支"
      onClose={onClose}
      canSubmit={!!name.trim()}
      okText="创建并切换"
      onSubmit={() => onCreate(name.trim())}
    >
      <Field label="分支名称" hint="基于当前 HEAD 创建并自动切换。">
        <Input
          autoFocus
          value={name}
          onChange={setName}
          placeholder="feature/my-feature"
        />
      </Field>
    </FormModal>
  );
}
function RemoteSwitch({ id, onClose, onSwitch, busy }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/remote-branches`, signal),
    [id],
  );
  const [branch, setBranch] = useState("");
  return (
    <FormModal
      title="切换远程分支"
      onClose={onClose}
      okText="切换"
      canSubmit={!!branch && !busy}
      onSubmit={() => onSwitch(branch)}
    >
      <Resource resource={resource}>
        {(data) => (
          <Field
            label="远程分支"
            hint="本地不存在时会基于远程最新提交创建分支。"
          >
            <Select
              showSearch
              value={branch || undefined}
              onChange={setBranch}
              placeholder="选择分支"
              options={data.branches}
            />
          </Field>
        )}
      </Resource>
    </FormModal>
  );
}
function Branches({
  id,
  version,
  current,
  checkout,
  busy,
  onNew,
  onRemote,
  changed,
  disabled,
}) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/branches`, signal),
    [id, version],
  );
  const [deleting, run] = useAction();
  async function remove(name, force = false) {
    if (
      !(await confirm(
        force ? "强制删除分支" : "删除分支",
        force
          ? `${name} 包含未合并的提交。强制删除可能导致提交丢失。`
          : `删除本地分支 ${name}？`,
        true,
      ))
    )
      return;
    run(async () => {
      try {
        await post(`/api/local/${id}/delete-branch`, { name, force });
        resource.reload();
        await changed();
      } catch (error) {
        if (!force && /not fully merged|not merged/.test(error.message)) {
          if (
            await confirm(
              "分支尚未合并",
              "删除失败，因为存在未合并提交。仍然强制删除？",
              true,
            )
          ) {
            await post(`/api/local/${id}/delete-branch`, { name, force: true });
            resource.reload();
            await changed();
          }
        } else throw error;
      }
    });
  }
  return (
    <>
      <div className="section-toolbar">
        <h2>本地分支</h2>
        <div className="button-group">
          <Button disabled={disabled || busy || deleting} onClick={onRemote}>
            切换远程分支
          </Button>
          <Button
            icon={<IconPlus />}
            disabled={disabled || busy || deleting}
            onClick={onNew}
          >
            新建分支
          </Button>
        </div>
      </div>
      <Resource resource={resource}>
        {(data) =>
          data.branches.length ? (
            <div className="plain-list">
              {data.branches.map((name) => (
                <div key={name}>
                  <span className="branch-label">
                    <IconBranch />
                    {name}
                    {name === current && <Tag size="small">当前</Tag>}
                  </span>
                  {name !== current && (
                    <div className="button-group">
                      <Button
                        size="small"
                        disabled={busy || deleting}
                        onClick={() => checkout(name)}
                      >
                        切换
                      </Button>
                      <Button
                        size="small"
                        status="danger"
                        disabled={busy || deleting}
                        onClick={() => remove(name)}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">暂无本地分支</div>
          )
        }
      </Resource>
    </>
  );
}
function History({ id, version }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/log?limit=100`, signal),
    [id, version],
  );
  const [expanded, setExpanded] = useState(null);
  return (
    <>
      <div className="section-toolbar">
        <h2>
          最近提交 <small className="muted">最多 100 条</small>
        </h2>
        <Button
          size="small"
          loading={resource.loading}
          onClick={resource.reload}
        >
          刷新
        </Button>
      </div>
      <Resource resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="history-list">
              {data.items.map((commit) => (
                <React.Fragment key={commit.hash}>
                  <button
                    className={`history-row ${expanded === commit.hash ? "expanded" : ""}`}
                    onClick={() =>
                      setExpanded((previous) =>
                        previous === commit.hash ? null : commit.hash,
                      )
                    }
                    aria-expanded={expanded === commit.hash}
                  >
                    <code>{commit.short}</code>
                    <strong>{commit.subject}</strong>
                    <span>{commit.author}</span>
                    <time>{commit.date}</time>
                    <span>{expanded === commit.hash ? "−" : "+"}</span>
                  </button>
                  {expanded === commit.hash && (
                    <CommitFiles id={id} sha={commit.hash} />
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="empty">暂无提交记录</div>
          )
        }
      </Resource>
    </>
  );
}
function CommitFiles({ id, sha }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/commit-info?sha=${sha}`, signal),
    [id, sha],
  );
  const [path, setPath] = useState(null);
  return (
    <div className="commit-files">
      <Resource resource={resource}>
        {(data) => (
          <div className="plain-list">
            {data.files.map((file) => (
              <button
                key={file.path}
                className="commit-file"
                onClick={() => setPath(file.path)}
              >
                <span
                  className={
                    file.state === "added"
                      ? "success"
                      : file.state === "deleted"
                        ? "danger"
                        : "warning"
                  }
                >
                  {{ added: "A", deleted: "D", modified: "M" }[file.state]}
                </span>
                <code>{file.path}</code>
                <span>查看差异 ↗</span>
              </button>
            ))}
          </div>
        )}
      </Resource>
      {path && (
        <FileDiff id={id} sha={sha} path={path} onClose={() => setPath(null)} />
      )}
    </div>
  );
}
function Stashes({ id, changed }) {
  const resource = useResource(
    (signal) => get(`/api/local/${id}/stashes`, signal),
    [id],
  );
  const [message, setMessage] = useState(""),
    [busy, run] = useAction();
  async function act(action, index) {
    const titles = {
      push: "创建贮藏",
      apply: "应用贮藏",
      pop: "弹出贮藏",
      drop: "删除贮藏",
    };
    if (
      action !== "push" &&
      !(await confirm(
        titles[action],
        action === "drop"
          ? "将永久删除该贮藏记录，无法撤销。"
          : action === "pop"
            ? "恢复修改并删除贮藏记录；如有冲突会保留记录。"
            : "恢复修改，保留贮藏记录。",
        action === "drop",
      ))
    )
      return;
    run(async () => {
      await post(`/api/local/${id}/stash`, { action, index, message });
      setMessage("");
      resource.reload();
      await changed();
      Message.success(`${titles[action]}完成`);
    });
  }
  return (
    <>
      <div className="section-toolbar">
        <Input
          value={message}
          onChange={setMessage}
          placeholder="贮藏说明（可选）"
          aria-label="贮藏说明"
          style={{ width: 300 }}
        />
        <Button type="primary" loading={busy} onClick={() => act("push")}>
          贮藏当前修改
        </Button>
      </div>
      <p className="section-note">包含未跟踪文件。贮藏后可在这里恢复。</p>
      <Resource resource={resource}>
        {(data) =>
          data.items.length ? (
            <div className="plain-list">
              {data.items.map((item) => (
                <div key={item.index}>
                  <code>{item.label}</code>
                  <div className="button-group">
                    {["apply", "pop", "drop"].map((action) => (
                      <Button
                        key={action}
                        size="small"
                        status={action === "drop" ? "danger" : undefined}
                        disabled={busy}
                        onClick={() => act(action, item.index)}
                      >
                        {{ apply: "应用", pop: "弹出", drop: "删除" }[action]}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">暂无贮藏</div>
          )
        }
      </Resource>
    </>
  );
}
