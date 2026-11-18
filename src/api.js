import { Message, Modal } from "./ui-kit";
import { apiUrl } from "./platform";

export async function api(method, url, body, signal) {
  const response = await fetch(apiUrl(url), {
    method,
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false)
    throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}
export const get = (url, signal) => api("GET", url, undefined, signal);
export const post = (url, body = {}) => api("POST", url, body);
export const confirm = (title, content, danger = false) =>
  new Promise((resolve) =>
    Modal.confirm({
      title,
      content,
      okText: "确定",
      cancelText: "取消",
      okButtonProps: { status: danger ? "danger" : undefined },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    }),
  );
export const report = (error) => {
  if (error.name !== "AbortError")
    Message.error(error.message || String(error));
};
export const HOSTS = {
  codeup: { label: "Codeup", url: "https://codeup.aliyun.com" },
  gitlab: { label: "GitLab", url: "https://gitlab.com" },
  github: { label: "GitHub", url: "https://github.com" },
  gitee: { label: "Gitee", url: "https://gitee.com" },
  generic: { label: "通用 Git", url: "" },
};
export function repoKey(url = "") {
  return url
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^\w+:\/\/(?:[^/@]+@)?/, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}
export function joinPath(root = "", name = "") {
  return (
    root.replace(/[\\/]+$/, "") +
    (root.includes("\\") ? "\\" : "/") +
    name.replace(/[\\/:*?"<>|]/g, "-")
  );
}
export function status(p) {
  return !p.exists
    ? "目录丢失"
    : p.dirty < 0
      ? "状态不可用"
      : p.dirty > 0
        ? `${p.dirty} 个文件待提交`
        : "工作区干净";
}
export const date = (value) =>
  value ? String(value).replace("T", " ").slice(0, 16) : "—";
