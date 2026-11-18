#!/usr/bin/env bash
# Git 项目管家 · macOS / Linux 启动脚本（Windows 请使用 start.bat）
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org/"
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "[错误] 未检测到 git，请先安装：brew install git"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "首次运行：正在安装项目依赖…"
  npm install --no-audit --no-fund || exit 1
fi

echo "正在启动 Git 项目管家（Ctrl+C 停止）…"
npm start
