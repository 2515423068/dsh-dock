# DSH Dock

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)做成**浏览器里管理的多版本、多隔离容器**的本地 Web 应用。

一条命令装好:后台常驻一个仅监听 `127.0.0.1` 的管理服务,负责安装 / 切换 DSH 版本、创建互相隔离的容器实例(各自独立的 `DSH_HOME`、固定端口、默认工作区)、一键启动,并把带 token 的 DSH WebUI 地址直接给你。

**零第三方运行时依赖**:后端只用 Node 标准库(单文件 `app/server.mjs`),前端是无构建的原生单页(`app/public/index.html`)。

```
浏览器 ─┬─ DSH Dock WebUI (http://127.0.0.1:7940)          ← 容器/版本/设置管理
        └─ 容器 1 的 DSH WebUI (http://127.0.0.1:41800?token=…)
           容器 2 的 DSH WebUI (http://127.0.0.1:41801?token=…)
```

---

## 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.sh | sh
```

安装脚本会:

1. 取源码(已在仓库目录内则就地安装,否则 `git clone` 到 `~/dsh-dock`);
2. 准备自带运行时 `runtime/<平台>-<架构>/`(固定 **Node v24.11.1 + pnpm 11.7.0**,sha256 / sha512 与 `runtime/linux-x64/runtime-manifest.json` 对齐)——新机器无需预装 Node;
3. 生成 `dshdock` 命令(`~/.local/bin/dshdock`);
4. 写部署目录配置(默认 = 安装目录)并后台启动服务,打印访问地址。

装完打开 **http://127.0.0.1:7940/** 即是管理界面。

### 安装参数

| 参数 | 说明 |
| --- | --- |
| `--dir <path>` | 安装目录(默认 `~/dsh-dock`;在仓库内运行时默认就地安装) |
| `--data-root <path>` | 部署目录:容器 / 版本 / 日志放这里(默认 = 安装目录) |
| `--bin-dir <path>` | `dshdock` 命令位置(默认 `~/.local/bin`) |
| `--runtime download\|system` | `download` 下载固定运行时(默认);`system` 用系统 node/pnpm 建软链 |
| `--port <n>` | 服务端口(默认 7940) |
| `--no-start` | 只安装不启动 |
| `--yes` | 非交互(agent / CI) |
| `--skip-verify` | 跳过运行时校验和(不推荐) |

可用环境变量指定下载镜像(中国大陆网络推荐):`NODE_DIST_MIRROR`、`NPM_REGISTRY_MIRROR`、`DSH_DOCK_REPO`。

```bash
# 例:自定义目录 + 非交互 + 中国镜像
curl -fsSL https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.sh \
  | NODE_DIST_MIRROR=https://npmmirror.com/mirrors/node sh -s -- --dir ~/apps/dsh-dock --yes
```

重复执行安装脚本是安全的:已就绪的运行时 / 命令 / 配置会自动跳过。

### 从源码手动安装

```bash
git clone https://github.com/2515423068/dsh-dock.git && cd dsh-dock
sh install.sh --yes            # 或用 --runtime system 复用系统 node/pnpm
```

`runtime/` 二进制不入库(约 275MB),由安装脚本按 `runtime-manifest.json` 下载并校验;仓库里只保留清单文件。

---

## 给 Agent 的安装指令

把下面整段交给 agent 即可(它会自己判断系统并按需处理失败):

> 在本机安装并启动 DSH Dock:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.sh | sh -s -- --yes
> ```
>
> 完成后验证:
>
> ```bash
> dshdock status          # 期望: 服务: 运行中 (http://127.0.0.1:7940)
> curl -sf http://127.0.0.1:7940/api/settings >/dev/null && echo OK
> ```
>
> 要求:Linux x64 / macOS / WSL2,已装 `git` 与 `curl`(Windows 原生暂不支持,见「平台支持」)。
> 若启动失败,把 `<安装目录>/logs/stdout.log` 末尾 30 行贴出来。
> 装完不要停服务:`dshdock stop` 会先停掉所有容器。

之后 agent 可以继续做:安装一个 DSH 版本 → 建容器 → 启动 → 把返回的带 token URL 交付给用户。

---

## 功能

**容器**

- 一个容器 = 一个独立 DSH 实例:独立 `DSH_HOME`(profile / 凭据 / 会话 / 存储)、独立固定端口(创建时从端口池分配并持久化,重启不变)、容器内默认工作区。
- 创建 / 启动 / 停止 / 更新版本 / 删除,长任务进度通过 SSE 实时推送到界面与底部终端。
- **开发保护**:开启后服务关闭/重启时保留该容器进程(下次启动自动接管),删除需二次确认。
- **自动启动**:开启后 DSH Dock 服务每次启动都会自动拉起该容器(宿主机重启后无需手动点启动);进程仍存活的容器走自动接管,不会重复启动。
- 新容器自动注入**初始配置**(模型配置表:提供方 + 密钥 + 默认模型),首次打开不再有「测试版公告 / API Key 录入」弹窗。
- 更新版本只替换 harness,`profile` / workspace / 凭据等用户数据原样保留。

**版本**

- 版本目录自动刷新(GitHub API → `git ls-remote` 双通道 + Release 更新说明,中英自动切分)。
- 安装 = `git clone` + 依赖预热 + **版本级懒构建**(同版本只构建一次,之后创建容器约 8 秒),带进度日志。

**设置**(WebUI 设置页)

- HTTP 代理 / GitHub 镜像 / npm 镜像(中国大陆网络)。
- 容器端口池范围;启动容器后是否自动打开浏览器;新容器是否跳过首开弹窗。
- **模型配置表**:一行一个模型(协议 / 端点 / 凭据引用 / 提供方),支持从已有容器一键导入,建容器时自动归纳成提供方并写进 `settings.yaml` + 凭据。

**插件 `dsh-dock-bridge`**(`plugin/dsh-dock-bridge/`)

把上面这套能力装进**任意 DSH 容器**:

- 9 个 `dshdock_*` 模型工具 + 一个按需加载的 `dshdock` 技能,让容器内的 agent 自己建容器 / 装版本 / 起服务并交付 URL;
- DSH web 设置里的顶级分区「**DSH Dock**」(容器 / 版本 / 插件管理 / 设置四卡,zh/en 双语);
- 自带分层自保护:对「当前会话所在容器」的停止 / 更新 / 删除默认拒绝,`force` 才放行;受开发保护的容器删除由服务端再拦一道。

安装到某个容器(在该容器所在机器执行;`<容器>` 为容器目录):

```bash
# 1) 装包(拷贝语义,含依赖)
DSH_HOME=<容器>/profile node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add \
  file:<安装目录>/plugin/dsh-dock-bridge

# 2) 把激活行写进 <容器>/profile/profiles/web/cordis.patch.yml(web profile 是 live 热挂载,写完即生效):
#    - insert:
#        - id: dshdock-bridge
#          name: ./node_modules/dsh-dock-bridge/src/index.js
#          inject: [tools]
#          config:
#            baseUrl: http://127.0.0.1:7940
```

细节见 [`plugin/dsh-dock-bridge/README.md`](plugin/dsh-dock-bridge/README.md)。

---

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Linux x64 | ✅ 已验证 | 开发与日常使用环境;`install.sh` 一键装 |
| Linux arm64 | ✅ 预期可用 | `install.sh` 按平台下载对应 Node(未在 arm64 机器实测) |
| macOS(x64 / arm64) | ⚠️ 预期可用 | `install.sh` 会取 darwin 版 Node;容器隔离依赖的 `DSH_HOME` 机制与应用本体不依赖 Linux 特性;未实机验证 |
| WSL2 | ✅ 建议的 Windows 方案 | 在 WSL2 发行版里执行 `install.sh`,与 Linux 等价 |
| 原生 Windows | ❌ 暂不支持 | 见下 |

**原生 Windows 尚未支持的阻塞点**(已在代码中逐条确认,均为 DSHBox 自身代码,DSH 本体支持 Windows):

1. **管理命令是 POSIX 脚本** —— `app/run.sh` 用了 `setsid` / `nohup` / `pgrep` / `kill -0` / `kill -9` / `readlink -f` / `python3`,Windows 无对应物;需要一套 `install.ps1` + `dshdock.ps1`/`.cmd` 启动器。
2. **进程组语义** —— `app/server.mjs` 的 `stopContainer()` / `groupAlive()` 用 `process.kill(-pgid, …)` 杀整个进程组,而 Node 在 Windows 上不支持负 pid / 进程组([nodejs/node#3617](https://github.com/nodejs/node/issues/3617));需要改为 `taskkill /PID <pid> /T /F`,并重做「保留现场 / 优雅停止」的等待逻辑。这是最硬的一块:不改它,容器起得来但停不掉。
3. **运行时路径与 PATH** —— `nodeBin()` / `pnpmBin()` 返回 `…/node/bin/node`、`…/pnpm/pnpm`,Windows 需要 `node.exe` 与 `pnpm.cmd`(或 `node pnpm.cjs`);`pnpmEnv()` / `dshHostEnv()` 用 `:` 拼 `PATH`,Windows 需 `;` 与对应可执行名。
4. **`dshdock cleanup`** 读 `/proc/net/tcp` 与 `/proc/<pid>/cmdline`,仅 Linux 可用。
5. 次要项:`fs.chmod(0o600)` 在 Windows 上不生效(凭据文件不会报错但没有权限保护);配置目录用 `~/.config/dshdock` 而非 `%APPDATA%`。

`runtime` 目录解析已按平台处理(`win-x64` / `darwin-arm64` …),`install.sh` 也已按平台落盘,所以上表第 3 条的**路径**部分已就位,剩下的是**可执行文件名与进程管理**。

> 想在 Windows 上先用起来:装 WSL2 + Ubuntu,然后在 WSL 里跑一键安装。DSH Dock 与容器都跑在 WSL 内,浏览器在 Windows 侧访问 `http://127.0.0.1:7940/` 正常(WSL2 自带 localhost 转发)。

---

## `dshdock` 命令

| 命令 | 作用 |
| --- | --- |
| `dshdock` | 前台启动(Ctrl+C = 停所有容器并退出,日志实时可见) |
| `dshdock bg` | 后台启动(默认方式;不随终端退出而死亡) |
| `dshdock status` | 查看服务与各容器状态 |
| `dshdock stop` | 优雅关闭:先停所有运行中的容器再退出服务 |
| `dshdock restart` | 优雅重启(同样先停容器) |
| `dshdock devrestart` | **改完代码用这个**:SIGKILL 服务进程、容器进程保留、新服务自动接管(不假成功) |
| `dshdock cleanup [-port N]` | 服务停止态清理孤儿容器进程(三重核对,受开发保护的容器跳过) |
| `dshdock uninstall-data` | 只删除应用生成的数据(容器/版本/日志/配置),保留源码 |

---

## 目录与数据

仓库(可整体搬迁,自包含):

```
app/
  server.mjs            # 后端全部逻辑(零依赖单文件)
  public/index.html     # 管理界面(无构建原生单页)
  run.sh                # dshdock 命令的实现
install.sh              # 一键安装
plugin/dsh-dock-bridge/ # DSH 插件源码 + 已构建的客户端 bundle
runtime/                # 自带 node + pnpm(不入库,安装脚本按清单下载)
```

部署目录(= `DATA_ROOT`,默认 = 安装目录)只放用户数据:

```
containers/<id>/        # 容器:container.json、harness/、profile/、workspace/、logs/
versions/<tag>/harness/ # 已安装的 DSH 版本
pnpm-store/             # 共享 pnpm store(硬链接省空间)
state/                  # settings.json、模型配置、版本目录缓存
logs/                   # dshdock.log(全量)、stdout.log
```

**`DATA_ROOT` 解析优先级**:环境变量 `DSHBOX_DATA_ROOT` → 配置文件 `~/.config/dshdock/config.json` 的 `dataRoot` → 安装目录。数据与应用解耦,换机器只搬部署目录即可。

**运行时解析**:`DATA_ROOT/runtime/<平台>-<架构>` 优先 → 应用目录的 `runtime/` 回退。

---

## API 一览

服务只监听 `127.0.0.1`,接口与 WebUI 同源:

```
GET  /api/settings                      POST /api/settings               # 网络/端口池/启动行为
GET  /api/versions/catalog[?refresh=1]  POST /api/versions/install       # 版本目录 / 安装 {tag}
DELETE /api/versions/:tag
GET  /api/containers                    POST /api/containers             # 列表 / 创建 {name,version,profile}
POST /api/containers/:id/start|stop|update|protect|autostart|port
DELETE /api/containers/:id
GET  /api/containers/:id/url|hostlog
GET  /api/model-configs                 PUT/DELETE /api/model-configs/models/:uid
POST /api/model-configs/default|import
GET  /api/tasks                         GET /events                      # 任务列表 / SSE 进度
POST /api/shutdown                                                       # 优雅关闭(先停容器)
```

长任务(安装 / 创建 / 启动 / 更新)立即返回,进度走 SSE;`keepalive` 5 秒、任务快照随连接下发,刷新页面不丢进度。

---

## 开发

```bash
node --check app/server.mjs        # 语法检查
dshdock devrestart                 # 改完代码重启服务(容器进程保留,不假成功)
```

改动 `plugin/dsh-dock-bridge/src/client/**` 后必须重建客户端 bundle:

```bash
cd plugin/dsh-dock-bridge && pnpm install && pnpm run build   # 产物 lib/client.js 入库
```

端到端自测(临时数据根,不影响现有部署):

```bash
ROOT=$(mktemp -d)
DSHBOX_DATA_ROOT=$ROOT DSHWEB_PORT=7999 node app/server.mjs &   # 起一个临时实例
curl -s localhost:7999/api/containers
```

---

## 排障

| 现象 | 处理 |
| --- | --- |
| 服务起不来 | 看 `<部署目录>/logs/stdout.log`;端口被占则 `--port` 换一个 |
| 界面提示「服务未运行」 | `dshdock status`;必要时 `dshdock bg` |
| 容器端口被占用 | 容器端口是固定的(设计如此):先释放该端口,或在界面改成别的端口(仅停止态) |
| 容器 host 起不来 | 看 `containers/<id>/logs/host.log`;常见原因:harness 缺失(更新或重建容器) |
| 服务被误杀,容器还在跑 | `dshdock bg` 会自动接管(URL 与 token 不变);顽固孤儿用 `dshdock cleanup` |
| 版本目录刷新失败 | 设置页配代理 / GitHub 镜像;服务端会自动回退到 `git ls-remote` |

**重要**:容器 host 是 detached 进程组,服务退出不影响它们,下次启动自动接管。带补丁重启服务**必须**用 `dshdock devrestart`(直接 `SIGTERM` 会触发优雅关闭、把所有容器停掉)。

---

## 许可

本仓库尚未附许可文件(未选择许可证 = 默认保留所有权利);插件包 `plugin/dsh-dock-bridge` 为 MIT。DSH 本体 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 为 MIT,由本应用按需克隆并在独立容器中运行,不含其代码副本。

> 如果你打算让别人自由使用,建议加一个 `LICENSE`(MIT 与本项目上游一致)。需要的话我可以补。
