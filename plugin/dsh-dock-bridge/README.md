# dsh-dock-bridge

DSH Dock 桥接插件:把 DSH Dock(https://127.0.0.1:7940)的容器/版本管理能力装进任意 DSH 容器。

- **Host 半**(`src/`,零构建纯 ESM):9 个 `dshdock_*` 模型工具 + `dshdock` 技能 + `/dshdock-plugins` 页面通道。唯一运行时依赖:`@deepseek-ai/dsh-tools` 的 `defineTool`。
- **浏览器半**(`src/client/`,构建产物 `lib/client.js` 已入库):DSH web 设置里的顶级分区 **"DSH Dock"**(五卡:容器 / 版本 / 插件管理 / 设置 / 外部与配置),zh/en 双语。
  - 「外部与配置」卡:只读检测机器上已有的 DSH(配置目录 / CLI 安装 / harness 检出 / 运行中实例;**DSHBox 自己的容器不算外部**),并提供**只复制**的配置服务:一次「保存配置」= 一个自包含文件 `<名字>-<版本>-<时间>.dshcfg`(tar.gz:meta.json + home/),「从配置创建」只需选中该文件。DSHBox **不接管**外部实例、**不使用软链**;把外部配置保存进来必须先在弹窗里勾选确认风险。(上传/下载配置文件在 WebUI 侧,插件通道只走 JSON。)

设计要点:Host 半零依赖纯 ESM;单一激活路径(只走 profile 的 patch 行,包内不声明 `dsh.bundle`);页面通道自己挂 `webServer` 前缀路由并复用 connection 的浏览器信任围栏;分层自保护(devProtect + self 识别)。

## 安装(web profile,容器内或宿主机执行)

先装包、后写激活行(顺序不能反——模块在激活时才 import):

```bash
# 1) 装包进目标容器 profile(pnpm add 拷贝语义,含依赖 @deepseek-ai/dsh-tools)
#    在容器的 harness 目录下执行;file: 指向 DSH Dock 安装目录里的插件源码
DSH_HOME=<容器>/profile node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add \
  file:<DSH Dock 安装目录>/plugin/dsh-dock-bridge
# 无 dsh.bundle 的 "plain dependency" 警告 = 预期(激活只走 patch 行,见下)

# 2) 把 cordis.patch.yml 里的 insert 块写进目标 profile 的 cordis.patch.yml
#    ($DSH_HOME/profiles/web/cordis.patch.yml),tmp+rename 原子写入:
#   - insert:
#       - id: dshdock-bridge
#         name: ./node_modules/dsh-dock-bridge/src/index.js
#         inject: [tools]
#         config:
#           baseUrl: http://127.0.0.1:7940
```

web profile 的 patch 是 `patchReload: live`:写入激活行即**热挂载,无需重启**;重启后该行仍在,持久生效。headless profile 为 startup 档,重启后生效(无网页,分区自然不出现,工具不受影响)。

## 升级

1. 改 `src/client/**` 后**必须重建**:`pnpm install && pnpm run build`(产物 `lib/client.js` 入库;R6:忘记重建 = 页面行为与源码漂移)。
2. 重新执行安装第 1 步(`file:` 是拷贝语义,会刷新副本)。
3. 运行中的模块需要重启容器(或清模块缓存)后更新;Host 半工具在容器重启后生效。

## 卸载

先删激活行(web 下即时卸载),再删包:

```bash
# 1) 从 cordis.patch.yml 删掉 dshdock-bridge 的 insert 块(热卸载)
# 2) 删包
pnpm --dir <容器>/profile/profiles/web remove dsh-dock-bridge
```

在"DSH Dock"分区的**插件管理卡**里也可以对本容器内的插件做安装/启停/卸载;桥接自身标"内置",页面与 Host 半都拒绝对它的禁用/卸载(防自毁,R5)。

## 配置

patch 行 `config.baseUrl`:DSH Dock 服务地址,默认 `http://127.0.0.1:7940`,可用环境变量 `DSHDOCK_URL` 覆盖(v1.1 服务端注入预留)。非法值在激活期直接报错(fail-loud)。设置分区"设置卡"里也可以改(写回本容器的激活行)。

## 机制要点(为什么这样做)

- **单一激活路径**:包**不声明** `dsh.bundle`,避免与 patch 行双挂载(R2);行 `name` 必须用相对路径 `./node_modules/dsh-dock-bridge/src/index.js`——tsx 源码启动下裸包名从 harness 安装树解析,profile 的 node_modules 不可达;相对路径经 `ctx.baseUrl`(= profile 目录)解析,两种启动模式都可靠。
- **页面通信**:Host `ctx.connection.rpc.handle('/dshdock-plugins', …)`,浏览器 `ctx.connection.rpc.call(...)`;信任/登录围栏由 connection 层统一处理,无需 typert 代码生成。
- **错误契约**:服务未启动 → "DSH Dock 服务未运行(\<baseUrl\>),请运行 `dshdock bg`";独立 DSH → "此 DSH 为独立实例…" + 安装引导;HTTP 3s 连接超时,`exec.signal` 贯穿等待轮询。

## 红线

- 不动 harness 源码;不改 DSH Dock server.mjs;不对承载会话的容器停止/重启/更新/删除。
- patch 文件写入一律 tmp+rename 原子替换,且只改本工具认识的结构(R1)。
