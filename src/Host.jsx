import React, { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Input, Message, Select, Tag } from "./ui-kit";
import { IconBranch, IconCloud, IconSearch } from "./icons";
import { api, confirm, date, get, HOSTS, post, repoKey } from "./api";
import { Resource, useAction, useResource } from "./ui";
import Pagination, { usePageSize } from "./Pagination";

export default function Host({ host, ctx }) {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("remote");
  const [selection, setSelection] = useState([]),
    [expanded, setExpanded] = useState(null),
    [url, setUrl] = useState(""),
    [lookupUrl, setLookupUrl] = useState("");
  const [busy, run] = useAction();
  const [info, setInfo] = useState({});
  const resource = useResource(
    (signal) =>
      host.type === "generic"
        ? Promise.resolve({ items: [], hasMore: false })
        : get(
            `/api/hosts/${host.id}/projects?${new URLSearchParams({ search, page, pageSize })}`,
            signal,
          ),
    [
      host.id,
      host.type,
      host.baseUrl,
      host.orgId,
      host.hasToken,
      host.tokenHint,
      search,
      page,
      pageSize,
      ctx.revision,
    ],
  );
  const rows = resource.data?.items || [];
  useEffect(() => {
    if (resource.data)
      setSelection((previous) =>
        previous.filter((id) =>
          resource.data.items.some((row) => String(row.id) === id),
        ),
      );
  }, [resource.data]);
  useEffect(() => {
    if (host.type !== "codeup" || !rows.length) return;
    const controller = new AbortController();
    get(
      `/api/hosts/${host.id}/repos-info?ids=${rows.map((row) => encodeURIComponent(row.id)).join(",")}`,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setInfo(
            Object.fromEntries(
              result.items.map((item) => [String(item.id), item]),
            ),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [resource.data, host.id]);
  const local = (row) =>
    ctx.projects.find(
      (project) => repoKey(project.remote_url) === repoKey(row.url),
    );
  const selectedRows = rows.filter((row) => selection.includes(String(row.id)));
  async function openBatch(moveOnly = false) {
    run(async () => {
      const checks = await post("/api/local/batch-check", {
        items: selectedRows.map((row) => ({ url: row.url, name: row.name })),
      });
      const items = selectedRows.map((row, i) => ({
        ...checks.items[i],
        repo: row,
        hostId: host.id,
        branch: "",
        action: checks.items[i].exists
          ? moveOnly
            ? "move"
            : "skip"
          : moveOnly
            ? "skip"
            : "clone",
      }));
      ctx.setDialog({ type: "batch", hostId: host.id, moveOnly, items });
      await ctx.refresh();
    });
  }
  async function selectedSync(action) {
    const ids = selectedRows
      .map(local)
      .filter((project) => project?.exists)
      .map((project) => String(project.id));
    if (!ids.length) return Message.warning("选中的仓库没有可用的本地副本");
    await ctx.batch(action, ids);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REMOTE PLATFORM</span>
          <h1>{host.name}</h1>
          <p>
            {HOSTS[host.type]?.label}
            <span className="separator">/</span>
            {host.baseUrl}
          </p>
        </div>
        <div className="button-group">
          <Button
            disabled={busy}
            onClick={() => ctx.setDialog({ type: "host", host })}
          >
            编辑平台
          </Button>
          {host.type !== "generic" && (
            <Button
              loading={busy}
              onClick={() =>
                run(async () => {
                  const result = await post(`/api/hosts/${host.id}/test`);
                  Message.success(
                    `连接成功${result.identity ? `：${result.identity}` : ""}`,
                  );
                })
              }
            >
              测试连接
            </Button>
          )}
          <Button
            status="danger"
            disabled={busy}
            onClick={async () => {
              if (
                !(await confirm(
                  "删除平台",
                  `删除 ${host.name}？本地仓库登记保留，平台凭证将被移除。`,
                  true,
                ))
              )
                return;
              run(async () => {
                await api("DELETE", `/api/hosts/${host.id}`);
                await ctx.refresh();
                ctx.navigate();
              });
            }}
          >
            删除
          </Button>
        </div>
      </div>
      {!host.hasToken && (
        <Alert
          type="warning"
          content="未配置访问令牌。私有仓库需要在编辑平台中填写令牌。"
        />
      )}
      {host.type === "generic" ? (
        <section className="generic-section">
          <h2>通过仓库地址访问</h2>
          <p className="muted">支持 HTTPS、SSH 和自托管 Git 服务。</p>
          <div className="section-toolbar">
            <Input
              value={url}
              onChange={setUrl}
              placeholder="https://git.example.com/team/repo.git"
              aria-label="仓库地址"
            />
            <Button
              disabled={!url.trim()}
              onClick={() => setLookupUrl(url.trim())}
            >
              查询分支
            </Button>
            <Button
              type="primary"
              disabled={!url.trim()}
              onClick={() =>
                ctx.setDialog({
                  type: "clone",
                  hostId: host.id,
                  url: url.trim(),
                  name:
                    url
                      .split(/[/:]/)
                      .pop()
                      ?.replace(/\.git$/, "") || "repo",
                })
              }
            >
              克隆仓库
            </Button>
          </div>
          {lookupUrl && (
            <RemoteBranches
              hostId={host.id}
              repo={{
                url: lookupUrl,
                name:
                  lookupUrl
                    .split("/")
                    .pop()
                    ?.replace(/\.git$/, "") || "repo",
              }}
              ctx={ctx}
            />
          )}
        </section>
      ) : (
        <>
          <div className="section-toolbar">
            <Input.Search
              value={query}
              onChange={setQuery}
              placeholder="搜索远程仓库"
              aria-label="搜索远程仓库"
              style={{ width: 320 }}
              allowClear
              onSearch={(value) => {
                setSearch(value.trim());
                setPage(1);
                setSelection([]);
                setExpanded(null);
              }}
            />
            <Button loading={resource.loading} onClick={resource.reload}>
              刷新列表
            </Button>
          </div>
          {selection.length > 0 && (
            <div className="batch-toolbar">
              <span>已选 {selection.length} 项</span>
              <Button size="small" loading={busy} onClick={() => openBatch()}>
                批量克隆 / 整理
              </Button>
              <Button
                size="small"
                disabled={busy}
                onClick={() => openBatch(true)}
              >
                换目录
              </Button>
              <Button
                size="small"
                disabled={ctx.operating || busy}
                onClick={() => selectedSync("pull")}
              >
                拉取
              </Button>
              <Button
                size="small"
                disabled={ctx.operating || busy}
                onClick={() => selectedSync("push")}
              >
                推送
              </Button>
              <button className="text-button" onClick={() => setSelection([])}>
                取消选择
              </button>
            </div>
          )}
          <Resource
            resource={{
              ...resource,
              data: resource.loading ? null : resource.data,
            }}
          >
            {(data) =>
              data.items.length ? (
                <div className="remote-list">
                  <div className="remote-row table-heading">
                    <Checkbox
                      aria-label="全选远程仓库"
                      disabled={resource.loading || busy}
                      checked={rows.every((row) =>
                        selection.includes(String(row.id)),
                      )}
                      indeterminate={
                        selection.length > 0 && selection.length < rows.length
                      }
                      onChange={(checked) =>
                        setSelection(
                          checked ? rows.map((row) => String(row.id)) : [],
                        )
                      }
                    />
                    <span>项目</span>
                    <span>本地状态</span>
                    <span>操作</span>
                  </div>
                  {data.items.map((row) => {
                    const project = local(row),
                      recent = info[String(row.id)]?.branches?.[0];
                    return (
                      <React.Fragment key={row.id}>
                        <div className="remote-row">
                          <Checkbox
                            aria-label={`选择远程仓库 ${row.name}`}
                            disabled={resource.loading || busy}
                            checked={selection.includes(String(row.id))}
                            onChange={(checked) =>
                              setSelection((previous) =>
                                checked
                                  ? [...previous, String(row.id)]
                                  : previous.filter(
                                      (id) => id !== String(row.id),
                                    ),
                              )
                            }
                          />
                          <div className="remote-name">
                            <strong>{row.name}</strong>
                            <small>{row.fullName}</small>
                            {recent?.name && (
                              <span className="branch-label">
                                <IconBranch />
                                {recent.name}
                              </span>
                            )}
                          </div>
                          <div className="remote-local">
                            {project ? (
                              <>
                                <Tag
                                  size="small"
                                  color={project.exists ? "green" : "red"}
                                >
                                  {project.exists ? "本地已有" : "目录丢失"}
                                </Tag>
                                <small title={project.local_path}>
                                  {project.local_path}
                                </small>
                              </>
                            ) : (
                              <span className="muted">未克隆</span>
                            )}
                          </div>
                          <div className="button-group">
                            <Button
                              size="small"
                              onClick={() =>
                                setExpanded((previous) =>
                                  previous === String(row.id)
                                    ? null
                                    : String(row.id),
                                )
                              }
                            >
                              {expanded === String(row.id) ? "收起" : "分支"}
                            </Button>
                            {project?.exists ? (
                              <Button
                                size="small"
                                onClick={() =>
                                  ctx.navigate("project", project.id)
                                }
                              >
                                打开
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                type="primary"
                                onClick={() =>
                                  ctx.setDialog({
                                    type: "clone",
                                    hostId: host.id,
                                    url: row.url,
                                    name: row.name,
                                    branch: row.defaultBranch,
                                  })
                                }
                              >
                                克隆
                              </Button>
                            )}
                          </div>
                        </div>
                        {expanded === String(row.id) && (
                          <RemoteBranches
                            hostId={host.id}
                            repo={row}
                            ctx={ctx}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className="empty">
                  <IconCloud />
                  <h3>没有找到远程仓库</h3>
                  <p>调整关键词或检查平台配置。</p>
                </div>
              )
            }
          </Resource>
          <Pagination
            page={page}
            pageSize={pageSize}
            count={rows.length}
            total={resource.data?.total}
            hasMore={resource.data?.hasMore}
            loading={resource.loading}
            onPage={(value) => {
              setPage(value);
              setSelection([]);
              setExpanded(null);
            }}
            onPageSize={(value) => {
              setPageSize(value);
              setPage(1);
              setSelection([]);
              setExpanded(null);
            }}
          />
        </>
      )}
    </>
  );
}
export function RemoteBranches({ hostId, repo, ctx, onSelect }) {
  const resource = useResource(
    (signal) =>
      get(
        `/api/hosts/${hostId}/branches?${new URLSearchParams({ repoId: repo.id || "", fullName: repo.fullName || "", url: repo.url })}`,
        signal,
      ),
    [hostId, repo.id, repo.url],
  );
  return (
    <div className="remote-branches">
      <Resource resource={resource}>
        {(data) =>
          data.branches.length ? (
            <div className="plain-list">
              {data.branches.map((branch) => (
                <div key={branch.name}>
                  <div className="branch-details">
                    <strong>
                      <IconBranch />
                      {branch.name}
                      {branch.isDefault && <Tag size="small">默认</Tag>}
                    </strong>
                    <small>
                      {branch.message || "—"}
                      {branch.date ? ` · ${date(branch.date)}` : ""}
                    </small>
                  </div>
                  <Button
                    size="mini"
                    onClick={() =>
                      onSelect
                        ? onSelect(branch.name)
                        : ctx.setDialog({
                            type: "clone",
                            hostId,
                            url: repo.url,
                            name: repo.name,
                            branch: branch.name,
                          })
                    }
                  >
                    {onSelect ? "选择" : "克隆此分支"}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">暂无分支</div>
          )
        }
      </Resource>
    </div>
  );
}
