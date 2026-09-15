# DSH Dock

在浏览器里管理多个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)实例的本地应用。

一条命令装好一个只监听 `127.0.0.1` 的后台服务:安装 / 切换 DSH 版本、创建互相隔离的容器实例、一键启动,并把带 token 的 DSH 界面地址直接给你。后端只用 Node 标准库,前端是无构建的原生单页。

```
浏览器 ─┬─ DSH Dock 管理界面    http://127.0.0.1:7940
        ├─ 容器 A 的 DSH 界面   http://127.0.0.1:41800/?token=…
        └─ 容器 B 的 DSH 界面   http://127.0.0.1:41801/?token=…
```

## 特性

- **多版本并存** —— 安装任意 DSH 版本(git tag)。每个版本只构建一次,之后新建容器约 8 秒。
- **真正隔离** —— 一个容器就是一个独立 DSH 实例:独立 `DSH_HOME`(凭据 / 会话 / 设置 / 存储)、固定端口、容器内默认工作区。
- **日常操作都在界面上** —— 装版本、建容器、启停、改端口、更新版本,长任务进度实时推送。
- **开发保护** —— 打开后服务重启不杀该容器(下次自动接管),删除需二次确认。
- **自动启动** —— 打开后 DSH Dock 启动时自动拉起该容器。
- **配置备份** —— 把一个容器的完整配置打包成**单个 `.dshcfg` 文件**;恢复只需要这个文件,没有 DSH Dock 也能按随附指南恢复。
- **外部 DSH 检测** —— 只读列出机器上已有的 DSH(官方 `~/.dsh`、npx / 全局安装、源码检出、运行中的实例),不接管、不修改。
- **DSH 插件** —— `dsh-dock-bridge` 把同一套管理能力装进任意 DSH 容器:9 个工具 + 一个「DSH Dock」设置分区。

## 安装

**Linux / macOS / WSL2**

```bash
curl -fsSL https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.sh | sh
```

**Windows 10 1803+(PowerShell)**

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.ps1))) -Yes
```

脚本会:取源码(默认 `~/dsh-dock`)→ 下载自带 Node v24 + pnpm 并校验 → 生成 `dshdock` 命令 → 写数据目录配置 → 后台启动服务。重复执行是安全的。

环境要求:Linux x64 / macOS / WSL2 / Windows 10 1803+;`git`(安装 DSH 版本时需要)。**不需要预装 Node。**

**参数**(两个脚本同名,Windows 用 PowerShell 风格)

| 参数 | 说明 |
| --- | --- |
| `--dir <path>` | 安装目录,默认 `~/dsh-dock` |
| `--data-root <path>` | 数据目录(容器 / 版本 / 配置),默认 = 安装目录 |
| `--port <n>` | 服务端口,默认 `7940` |
| `--no-start` | 只安装,不启动 |
| `--yes` | 非交互(CI / 脚本) |
| `--runtime system` | 用系统的 node / pnpm,不下载自带运行时 |

国内网络可用镜像:`NODE_DIST_MIRROR=https://npmmirror.com/mirrors/node`、`NPM_REGISTRY_MIRROR=https://registry.npmmirror.com`(作为环境变量传给安装脚本)。

**从源码运行**

```bash
git clone https://github.com/2515423068/dsh-dock.git && cd dsh-dock && sh install.sh
```

## 快速开始

1. 打开 <http://127.0.0.1:7940/>
2. **版本管理** → 安装一个 DSH 版本(例如 `dsh-v0.1.5-rc.2`)
3. **容器管理** → 新建容器(名称 + 版本)
4. 点「启动」,就绪后点「打开 DSH UI」

容器地址带 token,可直接收藏;端口固定,重启不变。

## 命令行

| 命令 | 说明 |
| --- | --- |
| `dshdock` | 前台启动(Ctrl+C 停容器并退出) |
| `dshdock bg` | 后台启动 |
| `dshdock status` | 服务与容器状态 |
| `dshdock stop` | 优雅关闭(先停所有容器) |
| `dshdock restart` | 优雅重启 |
| `dshdock devrestart` | 改完代码后的重启:换掉服务进程、保留容器、自动接管 |
| `dshdock cleanup [-port N]` | 服务停止态清理孤儿容器进程 |
| `dshdock selftest` | 打印平台与全部关键路径(排障第一步) |
| `dshdock uninstall-data --yes` | 只删除数据(容器 / 版本 / 日志 / 配置),保留源码 |

## 数据目录

默认就是安装目录,可用 `--data-root` 或环境变量 `DSHBOX_DATA_ROOT` 指定:

```
containers/<id>/       一个容器:container.json、harness/、profile/、workspace/、logs/
versions/<tag>/        已安装的 DSH 版本
configs/               配置备份 *.dshcfg + 手动恢复指南.md
pnpm-store/            共享 pnpm store
state/                 设置、模型配置、版本目录缓存
logs/                  dshdock.log(全量)、stdout.log
```

## HTTP API

服务只监听回环地址,接口与界面同源:

```
GET/POST /api/settings                  设置(网络 / 端口池 / 自动启动 / 配置备份)
GET      /api/versions/catalog          版本目录
POST     /api/versions/install          安装版本 {tag}
GET/POST /api/containers                容器列表 / 新建 {name,version,profile}
POST     /api/containers/:id/start|stop|update|protect|autostart|port
DELETE   /api/containers/:id            删除容器
GET      /api/containers/:id/url|hostlog  带 token 的地址 / 日志尾部
GET/DELETE /api/configs                 配置备份列表 / 删除
POST     /api/configs                   保存配置 {containerId?|sourcePath}
POST     /api/configs/restore           从配置创建 {file?|path?,name,version}
GET      /api/external                  外部 DSH 只读检测
GET      /api/tasks · /events           任务列表 / SSE 进度
```

## 平台支持

| 平台 | 状态 |
| --- | --- |
| Linux x64 | 已验证 |
| Windows 10 1803+ | 已实现(`install.ps1`),待实机验证 |
| WSL2 / macOS / Linux arm64 | 可用,未在真机逐一验证 |

Windows 上管理命令是 `dshdock.cmd`,运行时可执行文件为 `node.exe`,容器进程树用 `taskkill /T` 结束;配置目录在 `%APPDATA%\dshdock`。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 服务起不来 | `dshdock selftest`,再看 `<数据目录>/logs/stdout.log`;端口被占则 `--port` 换一个 |
| 界面提示「服务未运行」 | `dshdock status`,必要时 `dshdock bg` |
| 容器端口被占用 | 端口是固定的:先释放该端口,或在界面上改成别的(仅停止态) |
| 容器起不来 | 看 `containers/<id>/logs/host.log`;常见原因是 harness 缺失,更新或重建容器 |
| 服务被杀但容器还在跑 | `dshdock bg` 会自动接管;顽固孤儿用 `dshdock cleanup` |
| Windows 找不到 `tar` | 需要 Windows 10 1803+(自带 `tar.exe`) |
| Windows 路径过长报错 | 换短安装路径(如 `C:\dsh-dock`)或启用系统长路径支持 |

> 改完代码重启服务请用 `dshdock devrestart`:它只换服务进程,容器原样保留。

## 开发

```bash
node --check app/server.mjs
node --test app/platform.test.mjs app/external.test.mjs
dshdock devrestart
```

改插件前端后需要重新构建客户端 bundle:

```bash
cd plugin/dsh-dock-bridge && pnpm install && pnpm run build   # 产物 lib/client.js 入库
```

## 许可

[MIT](LICENSE)。DSH 本体 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 同为 MIT,由本应用按需克隆并在独立容器中运行,仓库内不含其代码副本。
