import React, { useState } from "react";
import SettingsCenter from './SettingsCenter';
import { apiUrl } from "./platform";
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Message,
  Modal,
  Select,
} from "./ui-kit";
import { api, get, HOSTS, joinPath, post, repoKey } from "./api";
import {
  Field,
  FolderInput,
  FormModal,
  ResultSummary,
  useAction,
  useResource,
} from "./ui";

export default function Dialogs({ dialog, ctx, onClose }) {
  const props = { dialog, ctx, onClose };
  return (
    {
      host: <HostEditor {...props} />,
      import: <Import {...props} />,
      settings: <SettingsCenter {...props} />,
      scan: <Scan {...props} />,
      clone: <Clone {...props} />,
      batch: <Batch {...props} />,
    }[dialog.type] || null
  );
}
function HostEditor({ dialog, ctx, onClose }) {
  const existing = dialog.host;
  const [form, setForm] = useState(
    existing
      ? { ...existing, token: "" }
      : {
          name: "",
          type: "codeup",
          baseUrl: HOSTS.codeup.url,
          username: "",
          orgId: "",
          token: "",
        },
  );
  const [clearToken, setClearToken] = useState(false);
  const update = (key, value) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  return (
    <FormModal
      title={existing ? "编辑平台" : "连接远程平台"}
      onClose={onClose}
      canSubmit={
        !!form.name.trim() &&
        (form.type === "generic" || /^https?:\/\//.test(form.baseUrl))
      }
      onSubmit={async () => {
        const saved = await api(
          existing ? "PUT" : "POST",
          existing ? `/api/hosts/${existing.id}` : "/api/hosts",
          {
            name: form.name.trim(),
            type: form.type,
            baseUrl: form.baseUrl.trim(),
            username: form.username.trim(),
            orgId: form.orgId.trim(),
            token: clearToken ? null : form.token.trim(),
          },
        );
        await ctx.refresh();
        onClose();
        ctx.navigate("host", saved.id);
        Message.success("平台已保存");
      }}
    >
      <Field label="平台名称">
        <Input
          autoFocus
          value={form.name}
          onChange={(value) => update("name", value)}
          placeholder="公司 Codeup"
        />
      </Field>
      <Field label="平台类型">
        <Select
          value={form.type}
          onChange={(value) => {
            setForm((previous) => ({
              ...previous,
              type: value,
              baseUrl: HOSTS[value].url,
            }));
          }}
          options={Object.entries(HOSTS).map(([value, item]) => ({
            value,
            label: item.label,
          }))}
        />
      </Field>
      <Field label="服务器地址">
        <Input
          value={form.baseUrl}
          onChange={(value) => update("baseUrl", value)}
          placeholder="https://git.example.com"
        />
      </Field>
      {form.type === "codeup" && (
        <Field
          label="组织 ID（可选）"
          hint="留空自动识别，有多个组织时可指定。"
        >
          <Input
            value={form.orgId}
            onChange={(value) => update("orgId", value)}
          />
        </Field>
      )}
      <Field label="HTTPS 克隆用户名（可选）">
        <Input
          value={form.username}
          onChange={(value) => update("username", value)}
          placeholder="留空使用默认用户名"
        />
      </Field>
      <Field
        label="访问令牌"
        hint="令牌加密后保存在本机。Codeup：个人设置 → 个人访问令牌。"
      >
        <Input.Password
          value={form.token}
          onChange={(value) => update("token", value)}
          disabled={clearToken}
          autoComplete="new-password"
          placeholder={
            existing?.hasToken
              ? `已保存 ${existing.tokenHint}，留空保持不变`
              : "粘贴个人访问令牌"
          }
        />
      </Field>
      {existing?.hasToken && (
        <Checkbox checked={clearToken} onChange={setClearToken}>
          清除已保存的令牌
        </Checkbox>
      )}
    </FormModal>
  );
}
function Import({ ctx, onClose }) {
  const [path, setPath] = useState("");
  return (
    <FormModal
      title="导入本地仓库"
      onClose={onClose}
      okText="导入仓库"
      canSubmit={!!path.trim()}
      onSubmit={async () => {
        const result = await post("/api/local/import", {
          localPath: path.trim(),
        });
        await ctx.refresh();
        onClose();
        ctx.navigate("project", result.project.id);
        Message.success(
          result.alreadyRegistered ? "已打开现有仓库" : "导入成功",
        );
      }}
    >
      <Field
        label="仓库路径"
        hint="选择包含 .git 的目录，也可选择仓库中的子目录。"
      >
        <FolderInput
          autoFocus
          value={path}
          onChange={setPath}
          placeholder="E:\\repos\\my-project"
        />
      </Field>
    </FormModal>
  );
}
function Scan({ ctx, onClose }) {
  const [roots, setRoots] = useState(ctx.settings.scanRoots || []),
    [path, setPath] = useState("");
  const allRoots = [...new Set([...roots, path.trim()].filter(Boolean))];
  return (
    <FormModal
      title="检索本地目录"
      onClose={onClose}
      okText="开始检索"
      canSubmit={allRoots.length > 0}
      onSubmit={async () => {
        ctx.setConsoleOpen(true);
        const result = await post("/api/local/scan", { roots: allRoots });
        await ctx.refresh();
        onClose();
        Message.success(
          `检索完成，新登记 ${result.registeredCount || 0} 个仓库`,
        );
      }}
    >
      <p className="section-note">
        递归查找 Git 仓库并登记，最多 5 层、500 个仓库。已登记仓库自动跳过。
      </p>
      <div className="scan-roots">
        {roots.map((root) => (
          <div key={root}>
            <code>{root}</code>
            <button
              className="text-button"
              onClick={() =>
                setRoots((previous) =>
                  previous.filter((value) => value !== root),
                )
              }
              aria-label={`移除检索目录 ${root}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <Field label="添加检索目录">
        <FolderInput
          value={path}
          onChange={setPath}
          placeholder="输入或选择目录"
        />
      </Field>
      <Button
        disabled={!path.trim()}
        onClick={() => {
          setRoots(allRoots);
          setPath("");
        }}
      >
        添加到列表
      </Button>
    </FormModal>
  );
}
function BranchSelect({ hostId, repo, value, onChange }) {
  const [enabled, setEnabled] = useState(false);
  const resource = useResource(
    (signal) =>
      enabled && hostId
        ? get(
            `/api/hosts/${hostId}/branches?${new URLSearchParams({ repoId: repo.id || "", fullName: repo.fullName || "", url: repo.url })}`,
            signal,
          )
        : Promise.resolve({ branches: [] }),
    [enabled, hostId, repo.id, repo.url],
  );
  return (
    <>
      <Select
        value={value || undefined}
        onChange={(value) => onChange(value || "")}
        allowClear
        allowCreate
        showSearch
        placeholder="默认分支 / 输入分支名"
        loading={enabled && resource.loading}
        onVisibleChange={(visible) => {
          if (visible) setEnabled(true);
        }}
        options={(resource.data?.branches || []).map((branch) => ({
          value: branch.name,
          label: `${branch.isDefault ? "● " : ""}${branch.name}${branch.date ? ` · ${branch.date.slice(0, 10)}` : ""}`,
        }))}
      />
      {resource.error && (
        <small className="warning">
          分支加载失败，可直接输入分支名。
          <button className="text-button" onClick={resource.reload}>
            重试
          </button>
        </small>
      )}
    </>
  );
}
function Clone({ dialog, ctx, onClose }) {
  const [url, setUrl] = useState(dialog.url || ""),
    [branch, setBranch] = useState(dialog.branch || "");
  const [path, setPath] = useState(
      joinPath(ctx.settings.workspace, dialog.name || "repo"),
    ),
    [shallow, setShallow] = useState(false);
  const existing = ctx.projects.find(
    (project) => repoKey(project.remote_url) === repoKey(url),
  );
  return (
    <FormModal
      title="克隆仓库"
      onClose={onClose}
      okText="开始克隆"
      canSubmit={!!url.trim() && !!path.trim()}
      onSubmit={async () => {
        ctx.setConsoleOpen(true);
        const result = await post("/api/local/clone", {
          hostId: dialog.hostId,
          remoteUrl: url.trim(),
          branch: branch.trim(),
          localPath: path.trim(),
          shallow,
          name: dialog.name,
        });
        await ctx.refresh();
        onClose();
        ctx.navigate("project", result.project.id);
        Message.success("克隆完成");
      }}
    >
      <Field label="仓库地址">
        <Input value={url} onChange={setUrl} />
      </Field>
      {existing && (
        <Alert
          type="warning"
          content={`本地已有副本：${existing.local_path}。继续将克隆为独立副本。`}
        />
      )}
      <Field label="分支（可选）">
        <BranchSelect
          hostId={dialog.hostId}
          repo={{ url }}
          value={branch}
          onChange={setBranch}
        />
      </Field>
      <Field label="目标目录">
        <FolderInput value={path} onChange={setPath} />
      </Field>
      <Checkbox checked={shallow} onChange={setShallow}>
        浅克隆，只获取最近一次提交
      </Checkbox>
    </FormModal>
  );
}
function Batch({ dialog, ctx, onClose }) {
  const [items, setItems] = useState(dialog.items || []),
    [targetDir, setTargetDir] = useState(ctx.settings.workspace || ""),
    [shallow, setShallow] = useState(false);
  const update = (index, patch) =>
    setItems((previous) =>
      previous.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <FormModal
      title={dialog.moveOnly ? "批量换目录" : "批量克隆 / 整理"}
      onClose={onClose}
      width={900}
      okText={`执行 ${items.filter((item) => item.action !== "skip").length} 项`}
      canSubmit={
        !!targetDir.trim() && items.some((item) => item.action !== "skip")
      }
      onSubmit={async () => {
        ctx.setConsoleOpen(true);
        const result = await post("/api/local/batch-clone", {
          hostId: dialog.hostId,
          targetDir: targetDir.trim(),
          shallow,
          plan: items.map(
            ({ url, name, action, projectId, localPath, branch }) => ({
              url,
              name,
              action,
              projectId,
              localPath,
              branch,
            }),
          ),
        });
        await ctx.refresh();
        ctx.reloadProjectViews();
        onClose();
        Modal.info({
          title: `完成 ${result.okCount}/${result.total} 项`,
          content: <ResultSummary result={result} />,
          style: { maxWidth: "calc(100vw - 24px)" },
        });
      }}
    >
      <Field label="目标父目录">
        <FolderInput value={targetDir} onChange={setTargetDir} />
      </Field>
      <p className="section-note">
        每个项目会放入目标目录下的同名子目录。迁移保留历史和未提交修改，已有同名目录时跳过并报告错误。
      </p>
      <div className="batch-plan">
        {items.map((item, i) => (
          <div className="plan-row" key={`${item.url}/${item.name}/${i}`}>
            <div>
              <strong>{item.name}</strong>
              <small title={item.localPath}>
                {item.localPath || "尚未克隆"}
              </small>
              {item.dirty > 0 && (
                <small className="warning">{item.dirty} 个未提交文件</small>
              )}
            </div>
            <Select
              aria-label={`${item.name} 执行方式`}
              value={item.action}
              onChange={(value) => update(i, { action: value })}
              options={[
                ...(item.exists
                  ? [{ value: "move", label: "迁移目录" }]
                  : !dialog.moveOnly
                    ? [{ value: "clone", label: "克隆仓库" }]
                    : []),
                { value: "skip", label: "跳过" },
              ]}
            />
            {item.action === "clone" ? (
              <BranchSelect
                hostId={dialog.hostId}
                repo={item.repo || { url: item.url }}
                value={item.branch}
                onChange={(value) => update(i, { branch: value })}
              />
            ) : (
              <span className="muted">
                {item.action === "move" ? "整体迁移，保留修改" : "保持现状"}
              </span>
            )}
          </div>
        ))}
      </div>
      {!dialog.moveOnly && (
        <Checkbox checked={shallow} onChange={setShallow}>
          新克隆项目使用浅克隆
        </Checkbox>
      )}
    </FormModal>
  );
}
