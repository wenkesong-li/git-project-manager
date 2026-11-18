// 桌面壳可通过隔离的 preload 注入服务地址；网页默认使用同源本地服务。
export function searchShortcut() {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? "⌘ K"
    : "Ctrl K";
}
export function apiUrl(path) {
  const base = window.gitpmDesktop?.serverUrl;
  if (!base) return path;
  const url = new URL(base);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("桌面服务必须使用本机回环地址");
  return new URL(path, url).href;
}
