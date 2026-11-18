# 运行与发布文档

## 一、环境要求

- 源码运行 / 构建推荐 Node.js 24 LTS 和 npm。Node.js 24 使用内置 SQLite，旧版本可能需要编译可选的 `better-sqlite3` 原生依赖。
- 安装 Git 并确保终端能执行 `git --version`。
- 编译 Java 项目需要完整 JDK，运行 Maven 项目需要 Maven；Node.js 项目需要对应 Node.js 和 npm。
- Java 基础语义分析需要 JDK 17+；可选 JDT 深度分析服务需要 JDK 25+。项目自身仍可选 JDK 8 等旧版本编译运行。

## 二、运行网页端

在项目根目录执行：

```sh
npm ci
npm start
```

`npm start` 会先构建前端，再启动服务。浏览器访问 `http://127.0.0.1:7456`，关闭终端或按 `Ctrl+C` 停止。

Windows PowerShell 自定义端口：

```powershell
$env:PORT = '8000'
npm start
```

macOS / Linux 自定义端口：

```sh
PORT=8000 npm start
```

可用环境变量：

| 变量 | 用途 |
| --- | --- |
| `PORT` | 本地 HTTP 端口，默认 7456 |
| `NO_OPEN=1` | 启动网页服务时不自动打开浏览器 |
| `GITPM_DATA_DIR` | 自定义本机应用数据目录 |
| `GITPM_WORKSPACE` | 默认仓库工作区 |
| `GITPM_LEGACY_DATA_DIR` | 首次启动时额外查找的历史配置目录 |
| `GITPM_RELEASE_REPOSITORY` | 构建时嵌入的 GitHub 发行仓库，格式 `owner/repo` |

不要把含真实凭据的环境配置文件提交到仓库。

## 三、项目、环境与快捷运行

1. 点击“导入仓库”，选择本机 Git 仓库；或添加平台后克隆项目。
2. 右上角“设置 → 本地环境”会扫描 PATH、常见安装目录和版本管理器目录；自定义安装位置可添加额外搜索目录后重新扫描。
3. 在项目“编译运行 → 项目 SDK 与版本设置”选择项目专属 JDK、Maven、Node.js，保存后应用到下一次任务。留空跟随全局默认，不改变其他项目环境。
4. 根目录含 `pom.xml` 时识别为 Maven 项目，“编译”执行 `mvn --batch-mode compile`；Node.js 项目提供 `build` 脚本时执行 `npm run build`。
5. Maven 配置 `spring-boot-maven-plugin` 或 `exec-maven-plugin` 后可快捷运行；Node.js 依次选择 `dev`、`start`、`serve` 脚本。其他任务在“运行配置”中选择。
6. 底部启动日志实时滚动，手动向上滚动后暂停自动跟随。可停止任务、复制或收起日志。服务启动失败时查看退出码及日志中的具体错误。
7. 编译结束会刷新文件树，展示 `target` 等生成目录。文件树“＋”展开下一层，“−”折叠目录；大目录按需加载，超过单次条数时使用“加载更多”。

运行使用磁盘上已保存的文件，请先保存编辑内容。应用不会自动安装项目依赖；按项目要求执行可信的依赖安装步骤。运行任务有并发限制和 30 分钟超时，长期服务超时后会停止。

## 四、历史数据与备份

首次启动桌面端可导入旧版网页端的历史配置，默认查找用户主目录下的 `.gitpm`，也可手动选择数据目录。源目录应包含 `data.db` 和原始 `secret.key`。导入按项目路径和平台标识合并，保留已有配置。

之后可在“设置 → 数据与备份”重新导入或导出配置。默认备份不含令牌；勾选包含登录凭据后，需设置至少 10 位备份密码。备份密码不会保存，遗失后无法恢复。

配置备份包含平台、项目登记、环境路径、偏好和主题，不包含实际仓库文件或回收站内容。跨设备导入后，原本的文件路径和 SDK 路径可能不存在，需重新选择；Windows 与 macOS 路径也需要分别调整。

## 五、本地打包

```sh
npm ci
npm run desktop:win
```

macOS 在 Mac 上执行：

```sh
npm run desktop:build -- --mac --arm64 --publish never
# Intel Mac 使用 --x64
```

安装包在 `dist/`。正式构建前设置 `GITPM_RELEASE_REPOSITORY`，软件更新才能定位 GitHub Releases。不要将 `dist/`、`.desktop-build/` 或任何本机数据加入源码提交。

## 六、GitHub 自动发布

工作流 `.github/workflows/release.yml` 在推送 `v*.*.*` 标签时构建 Windows x64、macOS Intel x64、macOS Apple Silicon arm64。各平台构建全部成功后才统一上传 GitHub Release；包含安装包、自动更新清单、分块信息和 SHA-256 校验文件。

更新 `package.json` / `package-lock.json` 的版本，并完成提交后：

```sh
npm run check:secrets
npm test
npm run build
git tag v1.0.4
git push github main
git push github v1.0.4
```

标签版本必须与 `package.json` 一致；示例仅表示下一次版本，不要重复发布已存在的标签或覆盖旧安装包。也可通过 Actions 手动运行构建验证，手动运行本身不会创建版本发布。

仓库需要启用 Actions，工作流的发布任务使用内置 `GITHUB_TOKEN` 写入 Releases，不需要把个人令牌写入代码。

签名可选，在仓库 Actions Secrets 中配置构建证书和相应凭据：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。不配置时只能生成未签名包；Apple 公证要求另行有效配置，不能把“已打包”等同于“已公证”。

发布后在 Releases 下载对应架构安装包，并在“设置 → 软件更新”检查新版本。当前电脑只能直接验证本机平台；其他平台需查看对应 CI 构建结果，并在目标系统实际安装验收。

## 七、常见问题

- **端口占用**：关闭旧实例，或用 `PORT` 选择其他端口。
- **版本未检测到**：配置额外搜索目录，或直接填入完整 SDK 路径后检测。JDK 目录需包含 `bin/java` 和 `bin/javac`。
- **Maven 无法启动**：检查所选 JDK、Maven 以及项目指定的 Java 版本是否匹配；构建依赖下载还受 Maven 镜像和网络影响。
- **没有快捷运行按钮可用**：检查 `package.json` 脚本或 Maven 插件；普通 Java 文件可在运行配置中直接编译运行。
- **格式化 / 语义分析失败**：先检查语法、文件语言和本地 JDK。Java 深度分析首次启用需要联网下载并校验服务。
- **更新不可用**：确认客户端构建嵌入了正确的发行仓库，且该仓库存在有效 Release 和更新清单。私有仓库下载可能需要额外授权，默认公开分发流程不内置个人凭据。
- **Git 认证失败**：检查本机 Git 凭据管理器、平台权限、令牌有效期和仓库地址。不要将令牌粘贴到 Issue 或日志截图中。
