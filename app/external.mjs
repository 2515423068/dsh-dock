/**
 * 外部 DSH 的**只读检测**,以及容器配置的**备份与恢复**。
 *
 * 定位(用户明确要求):
 *   - 用户可能在装 DSH Dock 之前(或在 DSH Dock 之外)已经有 DSH:官方路径的 `~/.dsh`、
 *     npx/全局安装的 dsh、一份 harness 源码检出、甚至正在跑的实例。
 *   - DSHBox **不接管**这些外部实例,也**不使用软链**(软链会让两边产生隐式依赖,
 *     破坏容器隔离)。这里只负责「检测 + 告知」,以及把配置**复制**进来做备份。
 *   - 是否把某个外部配置复制进 DSHBox,由用户自己决定。
 *
 * 备份的取向:备份是给用户留后路的 —— 即使 DSHBox 被卸载,备份目录与其中的恢复
 * 操作指南仍要能独立使用。因此备份一律是**独立副本**(copy),不做任何链接。
 *
 * 纯逻辑(事实探测、校验、策略裁决、拷贝校验、权限收紧)都做成可注入 fsImpl 的函数,
 * 便于在任意平台上单测(见 external.test.mjs)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { isWindows } from './platform.mjs'

/** 判定“这是一个 DSH home”的信号文件/目录。 */
export const HOME_SIGNALS = ['settings.yaml', '.credentials.yaml', 'sessions', 'storages', 'profiles', 'plugins', 'skills', 'attachments']

/** 判定“这是一份 harness 检出”的结构信号。 */
export const HARNESS_ENTRY = ['apps', 'cli', 'src', 'bin.ts']

// ── 事实探测 ────────────────────────────────────────────────────────────────

/** 递归统计文件数与总字节(跳过软链目标;软链本身按 0 字节计)。 */
export function measureTree(fsImpl, dir, { maxEntries = 200_000 } = {}) {
  let files = 0
  let bytes = 0
  let lastModified = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fsImpl.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) {
        files += 1
        continue
      }
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      try {
        const stat = fsImpl.statSync(full)
        files += 1
        bytes += stat.size
        if (stat.mtimeMs > lastModified) lastModified = stat.mtimeMs
      } catch {}
      if (files > maxEntries) return { files, bytes, lastModified, truncated: true }
    }
  }
  return { files, bytes, lastModified, truncated: false }
}

/** 统计会话数(DSH 把每个会话落成 sessions/ 下的文件或目录)。 */
export function countSessions(fsImpl, dir) {
  const sessionsDir = path.join(dir, 'sessions')
  try {
    return fsImpl.readdirSync(sessionsDir).length
  } catch {
    return 0
  }
}

/** 一个目录是不是 DSH home,以及它里面有什么。 */
export function homeFacts(fsImpl, dir) {
  const signals = []
  for (const name of HOME_SIGNALS) {
    if (fsImpl.existsSync(path.join(dir, name))) signals.push(name)
  }
  const strong = signals.includes('settings.yaml') || signals.includes('.credentials.yaml') || signals.includes('sessions')
  const measured = signals.length > 0 ? measureTree(fsImpl, dir) : { files: 0, bytes: 0, lastModified: 0 }
  return {
    isHome: signals.length >= 2 || (strong && signals.length >= 1),
    signals,
    sessions: countSessions(fsImpl, dir),
    hasCredentials: signals.includes('.credentials.yaml'),
    hasSettings: signals.includes('settings.yaml'),
    ...measured,
  }
}

/** 一个目录是不是 harness 检出(用于“版本收编”)。 */
export function harnessFacts(fsImpl, dir) {
  const entry = path.join(dir, ...HARNESS_ENTRY)
  const pkgPath = path.join(dir, 'package.json')
  let version = ''
  let name = ''
  try {
    const pkg = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf8'))
    name = pkg.name ?? ''
    version = pkg.version ?? ''
  } catch {}
  const workspace = fsImpl.existsSync(path.join(dir, 'pnpm-workspace.yaml'))
  const hasEntry = fsImpl.existsSync(entry)
  const prebuilt = fsImpl.existsSync(path.join(dir, '.dsh-build', 'client-build-environment.json'))
  return {
    isHarness: hasEntry && workspace && (name === '@deepseek-ai/dsh-root' || name.length === 0),
    name,
    version,
    hasEntry,
    workspace,
    prebuilt,
  }
}

// ── 拷贝 / 安全删除 ────────────────────────────────────────────────────────

/** 复制整棵树;保留内部软链(不 dereference),避免把别人的链接展开成大拷贝。 */
export function copyTree(fsImpl, src, dst) {
  fsImpl.cpSync(src, dst, { recursive: true, dereference: false, force: true, errorOnExist: false })
}

/**
 * 复制完成后收紧权限:DSH 启动时会拒绝「owner 之外可读」的凭据文件
 * (`credentials-local: .credentials.yaml is readable beyond its owner (mode 644)`)。
 * 复制会保留源文件权限,所以备份/导入之后必须显式收紧,否则恢复出来的实例起不来。
 */
export function hardenHomePermissions(fsImpl, dir) {
  const tightened = []
  for (const name of ['.credentials.yaml', 'settings.yaml']) {
    const target = path.join(dir, name)
    try {
      if (fsImpl.existsSync(target)) {
        fsImpl.chmodSync(target, 0o600)
        tightened.push(name)
      }
    } catch {}
  }
  for (const name of ['storages', 'sessions', 'plugins', 'skills']) {
    const target = path.join(dir, name)
    try {
      if (fsImpl.existsSync(target)) {
        fsImpl.chmodSync(target, 0o700)
        tightened.push(name)
      }
    } catch {}
  }
  return tightened
}

/** 该路径是否是软链(删除前必须判断)。 */
export function isSymlink(fsImpl, target) {
  try {
    return fsImpl.lstatSync(target).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 安全删除:软链只删链接本身,目录才递归删除。
 * 这是「删掉 DSHBox 也不影响外部 DSH」的实现要点之一(另一处是 rmSync 本身不下钻软链)。
 */
export function removeEntrySafely(fsImpl, target) {
  if (!fsImpl.existsSync(target) && !isSymlink(fsImpl, target)) return 'absent'
  if (isSymlink(fsImpl, target)) {
    fsImpl.unlinkSync(target)
    return 'unlinked'
  }
  fsImpl.rmSync(target, { recursive: true, force: true })
  return 'removed'
}

/** 校验复制结果:文件数与字节数一致才算成功(在删源之前必须通过)。 */
export function verifyCopy(fsImpl, src, dst) {
  const a = measureTree(fsImpl, src)
  const b = measureTree(fsImpl, dst)
  return { ok: a.files === b.files && a.bytes === b.bytes, source: a, target: b }
}

// ── 策略裁决(风险告知与放行条件集中在这里,便于单测与统一文案)────────────
/**
 * 是否允许把某个 home 复制进来(备份/导入)。**只支持复制** ——
 * 软链会让 DSHBox 与外部 DSH 产生隐式依赖,破坏容器隔离,因此不提供。
 * @param options.inUse - 源是否正被运行中的 DSH 使用
 * @param options.acknowledged - 用户是否已勾选「我确认它已停止 / 了解风险」
 * @param options.targetExists - 目标位置是否已存在同名条目
 */
export function importPlan({ inUse = false, acknowledged = false, targetExists = false } = {}) {
  const reasons = []
  const risks = []
  if (targetExists) reasons.push('目标位置已存在同名条目')
  if (inUse && !acknowledged) reasons.push('源 DSH 正在运行:请先停止它(这样复制到的才是完整一致的会话数据)')

  risks.push('只做复制:源目录不会被修改,复制完成后两边各自独立、互不影响')
  risks.push('复制只在本机进行,不会上传任何内容')
  risks.push('⚠️ 配置里含明文凭据(.credentials.yaml):备份目录请视为敏感数据,不要提交到公开仓库或分享')
  if (!acknowledged) risks.push('请确认该 DSH 当前处于停止状态(运行中复制可能得到写到一半的会话文件)')
  else if (inUse) risks.push('⚠️ 检测到源 DSH 仍在运行(你已确认继续):复制到的可能只是某一刻的快照')

  return {
    ok: reasons.length === 0,
    reasons,
    risks,
    steps: ['把源复制到备份目录', '校验文件数与字节数一致', '收紧凭据权限(0600)', '写入/更新恢复操作指南'],
  }
}

// ── 进程探测(谁在用这个 home / 有哪些外部实例在跑)──────────────────────────

/** 列出正在运行的 DSH host 进程(pid + 命令行 + 由 --patch 推出的端口)。 */
export function listDshProcesses({ platform = process.platform, run = defaultRun, procDir = '/proc' } = {}) {
  const found = []
  try {
    if (isWindows(platform)) {
      const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bin.ts*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
      const text = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
      for (const row of parseJsonArray(text)) {
        if (typeof row?.CommandLine !== 'string') continue
        found.push(processFacts(row.ProcessId, row.CommandLine))
      }
      return found
    }
    if (platform === 'linux') {
      for (const name of fs.readdirSync(procDir)) {
        if (!/^\d+$/.test(name)) continue
        let cmdline = ''
        try {
          cmdline = fs.readFileSync(path.join(procDir, name, 'cmdline'), 'utf8').replaceAll('\0', ' ').trim()
        } catch {
          continue
        }
        if (cmdline.includes('bin.ts') && cmdline.includes('--profile')) found.push(processFacts(Number(name), cmdline, procDir))
      }
      return found
    }
    const text = run('ps', ['-eo', 'pid=,command='])
    for (const line of String(text).split('\n')) {
      const match = line.trim().match(/^(\d+)\s+(.*)$/)
      if (match && match[2].includes('bin.ts') && match[2].includes('--profile')) found.push(processFacts(Number(match[1]), match[2]))
    }
  } catch {
    // 进程探测是尽力而为:拿不到就不报“在用”,由用户确认
  }
  return found
}

function processFacts(pid, cmdline, procDir) {
  const portMatch = cmdline.match(/--patch\s+(\S+)/)
  let port = null
  if (portMatch) {
    try {
      const patch = fs.readFileSync(portMatch[1], 'utf8')
      const value = patch.match(/port:\s*(\d+)/)
      if (value) port = Number(value[1])
    } catch {}
  }
  return { pid: Number(pid), cmdline: cmdline.trim(), port, home: processHome(pid, procDir) }
}

/** 该进程的 DSH_HOME(Linux 读 /proc/<pid>/environ;其它平台拿不到 → null)。 */
function processHome(pid, procDir = '/proc') {
  if (process.platform !== 'linux' || procDir !== '/proc') return null
  try {
    const env = fs.readFileSync(path.join(procDir, String(pid), 'environ'), 'utf8')
    const match = env.match(/(?:^|\0)DSH_HOME=([^\0]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** 解析 PowerShell ConvertTo-Json 输出(单个对象或数组)。 */
export function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function defaultRun(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
}

// ── 发现 ────────────────────────────────────────────────────────────────────
/** 候选 DSH home:环境变量 DSH_HOME 与官方路径 ~/.dsh。 */
export function homeCandidates({ homedir, env = process.env }) {
  return [...new Set([env.DSH_HOME, path.join(homedir, '.dsh')].filter(Boolean))]
}

/** 扫描 npx / npm 全局里的 dsh 包(用户可能用 npx 或全局装过)。 */
export function findInstalledDsh({ fsImpl, homedir, run = defaultRun } = {}) {
  const found = []
  const npxRoot = path.join(homedir, '.npm', '_npx')
  try {
    for (const entry of fsImpl.readdirSync(npxRoot)) {
      const pkg = path.join(npxRoot, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
      if (!fsImpl.existsSync(pkg)) continue
      const info = readPackage(fsImpl, pkg)
      if (info) found.push({ kind: 'npx', path: path.dirname(pkg), ...info })
    }
  } catch {}
  try {
    const globalRoot = run('npm', ['root', '-g']).trim()
    const pkg = path.join(globalRoot, '@deepseek-ai', 'dsh', 'package.json')
    if (fsImpl.existsSync(pkg)) {
      const info = readPackage(fsImpl, pkg)
      if (info) found.push({ kind: 'global', path: path.dirname(pkg), ...info })
    }
  } catch {}
  return found
}

function readPackage(fsImpl, pkgPath) {
  try {
    const pkg = JSON.parse(fsImpl.readFileSync(pkgPath, 'utf8'))
    return { name: pkg.name ?? '', version: pkg.version ?? '' }
  } catch {
    return null
  }
}

/** 汇总一次发现结果。 */
export function discoverExternal({ fsImpl = fs, homedir, env = process.env, platform = process.platform, run } = {}) {
  const homes = []
  for (const dir of homeCandidates({ homedir, env })) {
    if (!fsImpl.existsSync(dir)) continue
    const facts = homeFacts(fsImpl, dir)
    if (facts.isHome) homes.push({ path: dir, ...facts })
  }
  const checkouts = []
  for (const dir of [path.join(homedir, 'deepseek-harness'), path.join(homedir, 'dsh-src')]) {
    if (!fsImpl.existsSync(dir)) continue
    const facts = harnessFacts(fsImpl, dir)
    if (facts.isHarness) checkouts.push({ path: dir, ...facts })
  }
  const running = listDshProcesses({ platform, run })
  // 把“正在运行”的判定挂到对应 home 上(POSIX 能读到 DSH_HOME;其它平台标记 unknown)
  const used = new Map(running.filter((item) => item.home).map((item) => [path.resolve(item.home), item]))
  const markUsed = (dir) => {
    const hit = used.get(path.resolve(dir))
    return hit ? { inUse: true, pid: hit.pid } : { inUse: false, pid: null }
  }
  return {
    homes: homes.map((home) => ({ ...home, ...markUsed(home.path) })),
    checkouts: checkouts.map((item) => ({ ...item, ...markUsed(item.path) })),
    installed: findInstalledDsh({ fsImpl, homedir, run }),
    running,
    /** Windows/macOS 读不到进程环境变量:界面上必须让用户自己确认源已停止 */
    canDetectUsage: platform === 'linux',
  }
}
