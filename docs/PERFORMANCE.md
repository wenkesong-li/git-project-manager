# 性能与磁盘占用 / Performance and disk footprint

[简体中文首页](../README.md) · [English overview](../README.en.md)

## Windows 实测

2026 年 11 月 21 日，在 Windows x64（系统构建 19044）、Intel Core i7-14700KF、64 GiB 内存的同一台电脑上，分别测试本地打包的 1.1.6 和 1.1.7。两版使用同一 Electron 运行时缓存。

启动时间从创建桌面进程开始，到内置本地服务启动、Electron 页面加载完成并写出就绪标记为止。每版运行六次，丢弃一次预热，每次使用新的空白应用数据目录。后台自动更新检查可能启动，但就绪测量不等待联网结果。

2.0.0 发布前在同一台主机、同一运行时条件下补测。

| 指标 | 1.1.6 | 1.1.7 | 2.0.0 |
| --- | ---: | ---: | ---: |
| 启动到页面加载完成，5 次样本（ms） | 503 / 468 / 505 / 495 / 493 | 474 / 473 / 498 / 469 / 485 | 508 / 509 / 531 / 496 / 485 |
| 启动中位数 | 495 ms | 474 ms | 508 ms |
| Windows x64 安装包 | 128.35 MiB（134,586,620 字节） | 128.35 MiB（134,589,602 字节） | 128.36 MiB（134,591,900 字节） |
| 解包应用目录 | 455.27 MiB（477,388,011 字节） | 455.29 MiB（477,406,761 字节） | 455.30 MiB（477,415,242 字节） |
| 首次退出后的应用数据目录中位数 | 9.78 MiB | 10.83 MiB | 10.84 MiB |
| 其中 SQLite 主文件 | 4 KiB | 4 KiB | 4 KiB |

2.0.0 的启动中位数比 1.1.7 高 34 ms，安装包增加约 2.2 KiB。启动样本区间有重叠，且每版只有五次样本。首次应用数据目录包含 Chromium 缓存、SQLite 辅助文件和其他运行时数据，其大小随运行环境波动。

应用目录按文件逻辑字节求和。安装包经过压缩，因此应预留解包空间，并为实际项目、Git 历史、可选 Java 语言服务、依赖缓存、回收站和用户备份单独规划空间。库文件与仓库由使用者存放在本机。可在应用的「设置 → 数据与备份 → 本机数据」找到实际数据目录。

## 对比范围

OpenIDEA 的公开基准使用约 770 个文件的 Python 仓库，报告窗口显示、CPU 稳定后就绪、进程内存及其他指标，测试对照为 IntelliJ IDEA。[OpenIDEA 基准与方法](https://github.com/l0ng-ai/openidea#benchmark)

本报告的 GitPM 测试是空工作区加载，未测完整项目分析、进程内存或 CPU 稳定时间。跨产品结论需要在同一台电脑、同一仓库、同一缓存和语言服务条件下，统一记录窗口显示和项目就绪两个时间点。macOS 暂无本次测量数据。

## Reproducing the measurements

Build the Windows x64 package, close other copies of the same desktop build, and run the benchmark script from the repository root:

```powershell
node scripts/benchmark-desktop.js "dist/win-unpacked/Git Project Manager.exe" dist/GitProjectManager-2.0.0-win-x64.exe
```

The script starts the packaged app six times in smoke mode and discards the first sample. Each run uses a fresh, temporary profile. Readiness means the local page has loaded. The script reports elapsed time and logical disk bytes for the installer, unpacked app, profile, and SQLite main file.

On the tested Windows host, median startup was **495 ms** for 1.1.6, **474 ms** for 1.1.7, and **508 ms** for 2.0.0. The locally built 2.0.0 installer measured **128.36 MiB**, the unpacked app **455.30 MiB**, and the fresh profile **10.84 MiB** after exit. These measurements exclude Git worktrees, language servers, and project dependencies. OpenIDEA's benchmark uses a different workload.
