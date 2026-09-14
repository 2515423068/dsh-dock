/**
 * 平台差异集中层。
 *
 * DSH Dock 的其余代码(server.mjs / cli.mjs / setup.mjs)只从这里取平台事实,
 * 于是所有 Windows 分支都是**纯函数 + 显式 platform 参数**,可以在 Linux/macOS 上
 * 用 node:test 覆盖(PowerShell 脚本无法在本机执行,平台逻辑必须靠这一层兜住)。
 *
 * 约定:
 *   - 运行时目录布局:POSIX `<rt>/node/bin/node` + `<rt>/pnpm/pnpm`;
 *     Windows `<rt>/node/node.exe` + `<rt>/pnpm/node_modules/pnpm/bin/pnpm.cjs`
 *   - Windows 不支持负 pid / 进程组(https://github.com/nodejs/node/issues/3617),
 *     终止一律走 `taskkill /PID <pid> /T [/F]`(杀整棵树)
 *   - Windows 上 `{ ...process.env }` 可能同时存在 `Path` 与 `PATH` 两个键,
 *     必须大小写不敏感地替换,否则子进程环境块里会出现重复变量
 */
import path from 'node:path'

/** 是否 Windows。 */
export const isWindows = (platform = process.platform) => platform === 'win32'

/** 运行时目录名:`<平台>-<架构>`(install/setup 与服务端按同一规则落盘与查找)。 */
export function runtimeTarget(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win' : platform
  const cpu = arch === 'arm64' ? 'arm64' : 'x64'
  return `${os}-${cpu}`
}

/** 自带 Node 可执行文件路径。 */
export function nodeEntry(runtimeDir, platform = process.platform) {
  return isWindows(platform)
    ? path.join(runtimeDir, 'node', 'node.exe')
    : path.join(runtimeDir, 'node', 'bin', 'node')
}

/** Node 发行包解压后的顶层目录名(如 `node-v24.11.1-win-x64`)。 */
export function nodeDistDirName(version, platform = process.platform, arch = process.arch) {
  const plat = platform === 'win32' ? 'win' : platform
  const cpu = arch === 'arm64' ? 'arm64' : 'x64'
  return `node-${version}-${plat}-${cpu}`
}

/** 环境变量读取(Windows 下大小写不敏感)。 */
export function envValue(env, name, platform = process.platform) {
  if (env === undefined || env === null) return undefined
  if (!isWindows(platform)) return env[name]
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}

/** 大小写不敏感地写 PATH,保证只留一个键。 */
export function setEnvPath(env, value, platform = process.platform) {
  if (!isWindows(platform)) {
    env.PATH = value
    return env
  }
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key]
  }
  env.PATH = value
  return env
}

/** PATH 分隔符。 */
export const pathSeparator = (platform = process.platform) => (isWindows(platform) ? ';' : ':')

/** 运行时需要挂到 PATH 的两个目录(node 与 pnpm)。 */
export function runtimePathEntries(runtimeDir, platform = process.platform) {
  return isWindows(platform)
    ? [path.join(runtimeDir, 'node'), path.join(runtimeDir, 'pnpm')]
    : [path.join(runtimeDir, 'node', 'bin'), path.join(runtimeDir, 'pnpm')]
}

/**
 * 返回一份新 env:自带运行时的 node/pnpm 目录置于 PATH 最前。
 * @param env - 基础环境(通常是 process.env 的副本)。
 * @param runtimeDir - 运行时根目录。
 */
export function withRuntimePath(env, runtimeDir, platform = process.platform) {
  const next = { ...env }
  const current = envValue(next, 'PATH', platform) ?? ''
  const head = runtimePathEntries(runtimeDir, platform).join(pathSeparator(platform))
  return setEnvPath(next, current.length > 0 ? `${head}${pathSeparator(platform)}${current}` : head, platform)
}

/**
 * pnpm 的启动方式。
 * POSIX 直接用自带 shim;Windows 不能用 `.cmd`(Node ≥20 起 execFile/spawn 直接跑 .cmd 会 EINVAL),
 * 所以用自带 node 跑 pnpm.cjs —— 无 shell、无引号问题。
 */
export function pnpmLaunch(runtimeDir, platform = process.platform) {
  if (isWindows(platform)) {
    return {
      command: nodeEntry(runtimeDir, platform),
      prefixArgs: [path.join(runtimeDir, 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')],
    }
  }
  return { command: path.join(runtimeDir, 'pnpm', 'pnpm'), prefixArgs: [] }
}

/** Windows 上 pnpm.cmd shim 的内容(给 harness 构建脚本里裸 `pnpm` 调用用)。 */
export function pnpmCmdShim() {
  return [
    '@echo off',
    'setlocal',
    'set "PNPM_DIR=%~dp0"',
    '"%PNPM_DIR%..\\node\\node.exe" "%PNPM_DIR%node_modules\\pnpm\\bin\\pnpm.cjs" %*',
    '',
  ].join('\r\n')
}

/**
 * 终止整棵进程树。
 * POSIX → 杀进程组(负 pid);Windows → taskkill /T(先不带 /F 给宽限,再 /F)。
 */
export function killTreePlan(pid, { force = false, platform = process.platform } = {}) {
  const id = Math.abs(Number(pid))
  if (isWindows(platform)) {
    return { kind: 'taskkill', command: 'taskkill', args: force ? ['/PID', String(id), '/T', '/F'] : ['/PID', String(id), '/T'] }
  }
  return { kind: 'signal', target: -id, signal: force ? 'SIGKILL' : 'SIGTERM' }
}

/** 存活探测的目标(直接喂给 process.kill):POSIX 用负进程组,Windows 只有 pid。 */
export function aliveProbeTarget(record, platform = process.platform) {
  if (record === undefined || record === null) return undefined
  if (isWindows(platform)) return record.pid === undefined ? undefined : Math.abs(Number(record.pid))
  const group = record.pgid ?? record.pid
  return group === undefined ? undefined : -Math.abs(Number(group))
}

/**
 * 执行一次终止计划。`run` 可注入,便于测试不必真的杀进程。
 * @returns 实际执行的计划(便于日志)。
 */
export async function killTree(pid, { force = false, platform = process.platform, run } = {}) {
  const plan = killTreePlan(pid, { force, platform })
  const exec = run ?? defaultRun
  if (plan.kind === 'signal') {
    try {
      process.kill(plan.target, plan.signal)
    } catch {
      // 进程/进程组已不存在:与 kill(2) 的 ESRCH 等价,调用方按“已停止”处理
    }
    return plan
  }
  try {
    await exec(plan.command, plan.args)
  } catch {
    // taskkill 对已退出进程返回非 0:同样按“已停止”处理
  }
  return plan
}

function defaultRun(command, args) {
  return new Promise((resolve, reject) => {
    import('node:child_process').then(({ execFile }) => {
      execFile(command, args, { windowsHide: true, timeout: 30_000 }, (error) => (error ? reject(error) : resolve()))
    }, reject)
  })
}

/** 读取某个进程的命令行:POSIX 读 /proc,Windows 用 PowerShell CIM。 */
export function cmdlinePlan(pid, platform = process.platform) {
  const id = Math.abs(Number(pid))
  if (isWindows(platform)) {
    return {
      kind: 'command',
      command: 'powershell',
      args: ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${id}").CommandLine`],
    }
  }
  return { kind: 'file', path: `/proc/${id}/cmdline` }
}

/** 枚举监听端口的命令:Linux 读 /proc/net/tcp(调用方自行解析),Windows 用 netstat -ano。 */
export function listeningPortsPlan(platform = process.platform) {
  if (isWindows(platform)) return { kind: 'command', command: 'netstat', args: ['-ano', '-p', 'TCP'] }
  return { kind: 'proc' }
}

/** 从 Linux `/proc/net/tcp{,6}` 文本里取出 LISTEN(状态 0A)端口。 */
export function parseProcNetTcp(text) {
  const ports = new Set()
  for (const line of String(text).split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length > 3 && parts[3] === '0A') ports.add(Number.parseInt(parts[1].split(':')[1], 16))
  }
  return ports
}

/** 从 `netstat -ano` 文本里取出 LISTENING 端口(Windows)。 */
export function parseNetstatPorts(text) {
  const ports = new Set()
  for (const line of String(text).split('\n')) {
    const parts = line.trim().split(/\s+/)
    // 形如:TCP  127.0.0.1:41800  0.0.0.0:0  LISTENING  12345
    if (parts[0] !== 'TCP' || parts[3] !== 'LISTENING') continue
    const local = parts[1] ?? ''
    const port = Number.parseInt(local.slice(local.lastIndexOf(':') + 1), 10)
    if (Number.isInteger(port)) ports.add(port)
  }
  return ports
}

/** 默认配置目录:Windows 用 %APPDATA%\dshdock,POSIX 用 ~/.config/dshdock。 */
export function defaultConfigDir({ platform = process.platform, homedir, env = process.env } = {}) {
  if (isWindows(platform)) {
    const appData = envValue(env, 'APPDATA', platform) ?? path.join(homedir, 'AppData', 'Roaming')
    return path.join(appData, 'dshdock')
  }
  return path.join(homedir, '.config', 'dshdock')
}

/** 创建目录软链:Windows 用 junction(无需管理员/开发者模式,且不会跟随删除目标)。 */
export function symlinkDir(target, linkPath, fsImpl, platform = process.platform) {
  const type = isWindows(platform) ? 'junction' : 'dir'
  fsImpl.symlinkSync(target, linkPath, type)
}

/** 路径是否位于另一路径之内(用于删除前校验,避免把软链目标当容器目录删掉)。 */
export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
