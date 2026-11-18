// 页面初始化和 React 共用同一份主题定义。
export const DEFAULT_THEME = "neutral";
export const THEMES = [
  {
    id: "neutral",
    name: "黑白",
    mode: "light",
    description: "黑白灰 · 无彩色",
    colors: [
      "#ffffff",
      "#f6f6f6",
      "#ffffff",
      "#eeeeee",
      "#202020",
      "#616161",
      "#7c7c7c",
      "#dedede",
      "#252525",
      "#eeeeee",
    ],
  },
  {
    id: "bluewhite",
    name: "蓝白",
    mode: "light",
    description: "蓝色强调 · 纯白底",
    colors: [
      "#ffffff",
      "#f5f8ff",
      "#ffffff",
      "#edf3ff",
      "#182b49",
      "#596b85",
      "#75859b",
      "#dce5f2",
      "#2563eb",
      "#eaf1ff",
    ],
  },
  {
    id: "reactbits",
    name: "曜黑",
    mode: "dark",
    description: "React Bits · 黑紫",
    colors: [
      "#0d0b12",
      "#100d18",
      "#17121f",
      "#241c30",
      "#f2eef9",
      "#b0a4c1",
      "#91839f",
      "#30263e",
      "#b599f4",
      "#2c2041",
    ],
  },
  {
    id: "dark",
    name: "石墨",
    mode: "dark",
    description: "橄榄绿 · 沉静深色",
    colors: [
      "#1b1d1a",
      "#161815",
      "#22241f",
      "#2b2e26",
      "#e0e4d9",
      "#a2aa9b",
      "#828c78",
      "#32362c",
      "#b4c99b",
      "#2d3526",
    ],
  },
  {
    id: "midnight",
    name: "午夜",
    mode: "dark",
    description: "雾蓝 · 冷调深色",
    colors: [
      "#171d29",
      "#121823",
      "#1e2735",
      "#293548",
      "#e1e9f4",
      "#a1b1c8",
      "#7f94af",
      "#334156",
      "#99bde9",
      "#293c56",
    ],
  },
  {
    id: "forest",
    name: "松林",
    mode: "dark",
    description: "薄荷绿 · 自然深色",
    colors: [
      "#15221e",
      "#111c18",
      "#1c2c25",
      "#263b32",
      "#e1eee6",
      "#9fb9ac",
      "#7e9d8e",
      "#324a3f",
      "#97ccb1",
      "#294637",
    ],
  },
  {
    id: "light",
    name: "纸白",
    mode: "light",
    description: "苔绿 · 清爽浅色",
    colors: [
      "#f7f7f3",
      "#efefe9",
      "#ffffff",
      "#eaece4",
      "#262b23",
      "#646e5e",
      "#76806f",
      "#dedfd6",
      "#536b3c",
      "#e5ebdc",
    ],
  },
  {
    id: "sand",
    name: "暖砂",
    mode: "light",
    description: "陶棕 · 柔和暖色",
    colors: [
      "#faf6ef",
      "#f1e9dc",
      "#fffdf8",
      "#eee5d8",
      "#393027",
      "#776753",
      "#8c7c66",
      "#e3d7c5",
      "#916039",
      "#efe1cf",
    ],
  },
  {
    id: "lavender",
    name: "雾紫",
    mode: "light",
    description: "灰紫 · 细腻浅色",
    colors: [
      "#f7f5fa",
      "#eeebf3",
      "#ffffff",
      "#eae5f1",
      "#352e41",
      "#756881",
      "#8a7c98",
      "#ded6e7",
      "#79618f",
      "#ebe2f3",
    ],
  },
];
const keys = [
  "canvas",
  "sidebar",
  "surface",
  "hover",
  "ink",
  "muted",
  "faint",
  "line",
  "accent",
  "accent-soft",
];
const rgb = (hex) =>
  hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
function mix(a, b, weight) {
  const first = rgb(a),
    second = rgb(b);
  return first.map((value, i) =>
    Math.round(value + (second[i] - value) * weight),
  );
}
export function resolveTheme(id) {
  return (
    THEMES.find((theme) => theme.id === id) ||
    THEMES.find((theme) => theme.id === DEFAULT_THEME)
  );
}
export function readTheme() {
  try {
    return resolveTheme(localStorage.getItem("gpm-theme")).id;
  } catch {
    return DEFAULT_THEME;
  }
}
export function applyTheme(id) {
  const theme = resolveTheme(id),
    dark = theme.mode === "dark";
  const body = document.body;
  if (dark) body.setAttribute("data-mode", "dark");
  else body.setAttribute("data-mode", "light");
  body.dataset.theme = theme.id;
  body.style.colorScheme = theme.mode;
  keys.forEach((key, i) => body.style.setProperty(`--${key}`, theme.colors[i]));
  const canvas = theme.colors[0],
    accent = theme.colors[8];
  const neutral = theme.id === "neutral";
  const plainGallery = neutral || theme.id === "bluewhite";
  body.style.setProperty(
    "--success",
    neutral ? "#555555" : dark ? "#a2c29b" : "#4f7048",
  );
  body.style.setProperty(
    "--warning",
    neutral ? "#444444" : dark ? "#d5b582" : "#936518",
  );
  body.style.setProperty(
    "--danger",
    neutral ? "#242424" : dark ? "#e09b90" : "#ac493e",
  );
  body.style.setProperty("--diff-add-bg", neutral ? "#eeeeee" : "#7a9c6520");
  body.style.setProperty("--diff-del-bg", neutral ? "#e2e2e2" : "#c1675420");
  body.style.setProperty(
    "--gallery-text",
    plainGallery ? theme.colors[4] : "#f0f0e8",
  );
  body.style.setProperty(
    "--gallery-muted",
    plainGallery ? theme.colors[5] : "#b1b5a9",
  );
  body.style.setProperty(
    "--gallery-overlay",
    plainGallery
      ? "transparent"
      : "linear-gradient(0deg, rgba(0,0,0,.36), transparent 85%)",
  );
  body.style.setProperty(
    "--gallery-caption-border",
    plainGallery ? theme.colors[7] : "#ffffff20",
  );
  for (let i = 1; i <= 5; i++) {
    const tint = plainGallery
      ? accent
      : [accent, "#c2b59a", "#97adb3", "#b79d91", "#aaa1b4"][i - 1];
    body.style.setProperty(
      `--gallery-panel-${i}`,
      `rgb(${mix(plainGallery ? "#ffffff" : "#18201c", tint, plainGallery ? 0.025 + i * 0.015 : 0.12).join(", ")})`,
    );
    body.style.setProperty(
      `--gallery-tone-${i}`,
      `rgb(${mix(tint, "#ffffff", plainGallery ? 0.25 : dark ? 0.08 : 0.3).join(", ")})`,
    );
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", canvas);
  document
    .querySelector('link[rel="icon"]')
    ?.setAttribute(
      "href",
      `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="${accent}" stroke-width="2"/><circle cx="8" cy="8" r="2" fill="${accent}"/></svg>`)}`,
    );
  try {
    localStorage.setItem("gpm-theme", theme.id);
  } catch {
    /* 无存储权限时仍允许切换 */
  }
}
