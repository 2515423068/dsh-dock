/**
 * The `dshdock` skill shipped with the bridge (design §3.4): when to use
 * which tool, the canonical workflows, the troubleshooting path, and the
 * self-protection rules. Registered through `ctx.skills.register()` so it is
 * loaded on demand instead of occupying the standing system prompt.
 */

const CONTENT = `
# dshdock — 用 DSH Dock 工具管理容器与版本

dshdock_* 工具操作宿主机上的 DSH Dock 服务(默认 http://127.0.0.1:7940),
管理 DSH 容器与 DSH 版本。工具输出统一为 JSON:ok=false 时读 error 与 hint,
hint 就是下一步该做什么。

## 何时用哪个工具

- 看现状:dshdock_containers(容器列表,含 self 标记)、dshdock_versions(版本目录)、dshdock_tasks(后台任务)。
- 起一个测试容器:dshdock_version_install(版本未装时)→ dshdock_container_create(wait=true)→ dshdock_container_lifecycle{action:'start', wait:true} → 返回值里的 url 直接交付。
- 排障"另一端口的容器起不来":dshdock_containers 看状态 → dshdock_container_log{container, tail:120} 定位 → 修复后 stop → start(wait)。
- 交付网址:dshdock_container_url(容器须在运行)。

## 典型工作流(装版本 → 建容器 → 启动 → 拿网址 → 交付)

1. dshdock_versions 确认目标版本已安装;未装则 dshdock_version_install{tag}(最慢操作,wait 默认 true,上限 11 分钟)。
2. dshdock_container_create{name, version}(wait=true;版本已预构建约 8s,首次构建约 70s)。
3. dshdock_container_lifecycle{container, action:'start', wait:true}(2-5s)。
4. 成功返回的 lines 里有就绪 URL;或 dshdock_container_url 取带 token 的完整网址。
5. 用完不再需要的容器:dshdock_container_lifecycle{action:'stop'} → dshdock_container_delete{confirm:true}。

## 排障顺序

1. 工具返回 ok=false:先读 hint —— 两类"不可用"有明确指引:
   - "DSH Dock 服务未运行" → 让用户在宿主机运行 dshdock bg。
   - "此 DSH 为独立实例" → 本会话不经 DSH Dock 运行,容器工具整体不可用,请装 DSH Dock 并在"DSH Dock"设置分区填服务地址。
2. 容器状态 failed/starting 不定:dshdock_container_log 看该容器 host.log 尾部。
3. 任务卡住:dshdock_tasks{refId} 看最近输出(任务记录含 lines)。

## 自保护规则(硬约束)

- dshdock_containers 里 self:true 的容器 = 当前会话脚下所在容器。
- 对 self 容器的 stop/update/delete 默认被插件拒绝(会杀死本会话);除非用户明确要求并理解后果,才传 force:true。
- 删除容器必须 confirm=true(不可恢复:整个容器目录被移除);受开发保护(devProtect)的容器服务端还有确认门禁。
- 建议:承载主会话的容器请用户在 WebUI 上开启 devProtect;agent 不主动代开。

## 边界

- 低频配置(网络代理/镜像、改端口、开发保护开关、服务地址)不进工具集 —— 在 DSH web 设置的"DSH Dock"分区里由用户手动操作。
- 插件装卸:设置分区"插件管理"卡,或容器内 dsh plugin CLI。
`.trim()

/**
 * Build the runtime skill definition.
 * @returns the object accepted by `ctx.skills.register()`.
 */
export function skillDefinition() {
  return {
    name: 'dshdock',
    description: '操作 DSH Dock 容器与版本:dshdock_* 工具的选用、典型工作流(装版本→建容器→启动→交付)、日志排障路径与 self 自保护规则。',
    source: 'custom',
    content: CONTENT,
  }
}
