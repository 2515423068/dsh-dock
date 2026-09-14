#!/usr/bin/env node
/**
 * `dshdock` 跨平台命令行(POSIX 与 Windows 共用一份实现)。
 *
 *   dshdock                前台启动(Ctrl+C 停容器并退出)
 *   dshdock bg             后台启动
 *   dshdock stop           优雅关闭(先停所有容器)
 *   dshdock status         查看服务与容器状态
 *   dshdock restart        优雅重启(同样先停容器)
 *   dshdock devrestart     开发重启:SIGKILL/taskkill 服务进程,容器进程保留,新服务接管
 *   dshdock cleanup [-port N]  服务停止态清理孤儿容器进程(三重核对)
 *   dshdock uninstall-data 只删应用数据(容器/版本/日志/配置),保留源码
 *   dshdock selftest       打印平台与路径自检(排障用;Windows 上尤其有用)
 *
 * 为什么是 Node 而不是 shell/PowerShell 两份脚本:
 *   - 平台逻辑只写一遍,且能在任意平台上跑测试(app/platform.test.mjs);
 *   - 自带运行时已保证新机器有 node,不需要系统预装;
 *   - Windows 上没有 setsid/nohup/pgrep,detached+unref 与 taskkill /T 是等效能力。
 * POSIX 的 `dshdock` 入口仍是 app/run.sh(薄壳,exec 到本文件),Windows 上是 app/dshdock.cmd。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  aliveProbeTarget, cmdlinePlan, defaultConfigDir, isWindows, killTree, listeningPortsPlan, nodeEntry,
  parseNetstatPorts, parseProcNetTcp, runtimeTarget, symlinkDir,
} from './platform.mjs'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DSHWEB_PORT || 7940)
const BASE_URL = `http://127.0.0.1:${PORT}`
const SERVICE_ENTRY = path.join(APP_DIR, 'server.mjs')

// ── 路径解析(必须与服务端 server.mjs 完全一致,否则 PID/日志会错位) ─────────
const CONFIG_DIR = process.env.DSHDOCK_CONFIG_DIR || defaultConfigDir({ homedir: os.homedir() })
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function resolveDataRoot() {
  if (process.env.DSHBOX_DATA_ROOT) return process.env.DSHBOX_DATA_ROOT
  const saved = readJson(CONFIG_FILE)
  if (saved?.dataRoot) return saved.dataRoot
  return path.dirname(APP_DIR)
}

const DATA_ROOT = resolveDataRoot()
const LOGS_DIR = path.join(DATA_ROOT, 'logs')
const STDOUT_LOG = path.join(LOGS_DIR, 'stdout.log')
const PID_FILE = path.join(DATA_ROOT, 'state', 'dshdock.pid')
const CONTAINERS_DIR = path.join(DATA_ROOT, 'containers')

/** 拉起服务用的 node:优先自带运行时,否则用当前解释器(它显然是可用的 node)。 */
function nodeBin() {
  for (const candidate of [runtimeTarget(), 'linux-x64']) {
    for (const base of [DATA_ROOT, path.dirname(APP_DIR)]) {
      const entry = nodeEntry(path.join(base, 'runtime', candidate))
      if (fs.existsSync(entry)) return entry
    }
  }
  return process.execPath
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── 终端输出 ────────────────────────────────────────────────────────────────
const supportsOsc8 = () => Boolean(process.stdout.isTTY) && process.env.TERM !== 'dumb'
function printLink(url) {
  if (supportsOsc8()) process.stdout.write(`\u001b]8;;${url}\u001b\\${url}\u001b]8;;\u001b\\\n`)
  else process.stdout.write(`${url}\n`)
}
const info = (message) => process.stdout.write(`${message}\n`)

// ── 服务探活 ────────────────────────────────────────────────────────────────
async function serviceUp(timeoutMs = 1200) {
  try {
    const response = await fetch(`${BASE_URL}/api/settings`, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

async function waitService(up, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await serviceUp(900) === up) return true
    await sleep(400)
  }
  return (await serviceUp(900)) === up
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function serverPid() {
  let fromFile = Number.NaN
  try {
    fromFile = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
  } catch {
    return null // 没跑过 / 已 stop(PID 文件已被清理)
  }
  return pidAlive(fromFile) ? fromFile : null
}

async function api(method, apiPath, body) {
  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'POST' ? 60_000 : 10_000),
  })
  const text = await response.text()
  let data = null
  try { data = text.length > 0 ? JSON.parse(text) : null } catch { data = { raw: text } }
  return { status: response.status, data }
}

// ── 启动 / 停止 ─────────────────────────────────────────────────────────────
async function startServer() {
  if (await serviceUp()) return true
  fs.mkdirSync(LOGS_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true })
  const logFd = fs.openSync(STDOUT_LOG, 'a')
  // detached:POSIX 自成会话(setsid 等效),Windows 独立进程 —— 服务不随调用方终端退出
  const child = spawn(nodeBin(), [SERVICE_ENTRY], {
    cwd: APP_DIR,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, DSHDOCK_DEV: '1' },
    windowsHide: true,
  })
  child.unref()
  fs.closeSync(logFd)
  const ok = await waitService(true, 20_000)
  if (!ok) {
    info('✗ DSH Dock 服务启动失败,最近的错误输出:')
    for (const line of tailFile(STDOUT_LOG, 10)) info(`    ${line}`)
    info(`  完整日志: ${STDOUT_LOG}`)
    return false
  }
  return true
}

function tailFile(file, lines) {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines)
  } catch {
    return []
  }
}

async function cmdStart() {
  if (!await startServer()) process.exit(1)
  info('DSH Dock 已就绪,访问地址(点击打开):')
  printLink(`${BASE_URL}/`)
}

async function cmdForeground() {
  if (await serviceUp()) {
    info('✗ 服务已在后台运行,先执行 dshdock stop 再用前台模式')
    process.exit(1)
  }
  info('DSH Dock 前台模式 (Ctrl+C 停止所有容器并退出),访问地址(点击打开):')
  printLink(`${BASE_URL}/`)
  const child = spawn(nodeBin(), [SERVICE_ENTRY], { cwd: APP_DIR, stdio: 'inherit', env: process.env, windowsHide: false })
  const code = await new Promise((resolve) => {
    child.on('exit', (value, signal) => resolve(value ?? (signal === null ? 0 : 1)))
    child.on('error', (error) => { info(`✗ 启动失败: ${error.message}`); resolve(1) })
  })
  process.exit(code)
}

async function cmdStop() {
  const pid = serverPid()
  if (pid === null && !await serviceUp()) {
    info('DSH Dock 未在运行')
    const orphans = listOrphanRecords().length
    if (orphans > 0) info(`发现 ${orphans} 条运行中容器记录(可能为孤儿进程),可执行 dshdock cleanup 清理`)
    return
  }
  // 优雅关闭:服务端会先停容器(POST /api/shutdown)
  try {
    await api('POST', '/api/shutdown')
  } catch {}
  if (pid !== null) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && pidAlive(pid)) await sleep(300)
    if (pidAlive(pid)) await killTree(pid, { force: true })
  } else {
    await waitService(false, 10_000)
  }
  try { fs.rmSync(PID_FILE, { force: true }) } catch {}
  info('DSH Dock 已停止')
}

async function cmdDevrestart() {
  const pid = serverPid()
  if (pid !== null) {
    // 硬杀服务进程:不触发 gracefulShutdown,容器进程原样保留,由新服务接管
    await killTree(pid, { force: true })
    if (!await waitService(false, 8_000)) {
      info(`✗ 无法确认服务进程(pid=${pid})已停止,放弃本次重启;请手动检查端口 ${PORT} 占用`)
      process.exit(1)
    }
  } else if (await serviceUp()) {
    info(`✗ 找不到服务进程记录,但端口 ${PORT} 仍有服务在响应,放弃本次重启;请手动排查`)
    process.exit(1)
  }
  if (!await startServer()) process.exit(1)
  info(`DSH Dock 已重启(容器进程保留): ${BASE_URL}/`)
  await printContainers()
}

async function cmdRestart() {
  await cmdStop()
  await cmdStart()
}

// ── 状态 ────────────────────────────────────────────────────────────────────
async function cmdStatus() {
  if (await serviceUp()) {
    info(`服务: 运行中 (${BASE_URL})`)
    await printContainers()
  } else {
    info('服务: 未运行')
  }
}

async function printContainers() {
  const { data } = await api('GET', '/api/containers')
  if (!Array.isArray(data)) return
  if (data.length === 0) info('容器: (无)')
  for (const container of data) {
    const parts = [`容器 ${container.name}: ${container.status}`]
    if (container.url) parts.push(container.url)
    if (container.autoStart) parts.push('[自启]')
    if (container.devProtect) parts.push('[保护]')
    info(parts.join('  '))
  }
}

/** 自检:平台事实与所有关键路径(Windows 秒级排障)。 */
async function cmdSelftest() {
  const target = runtimeTarget()
  const wrapper = isWindows() ? path.join(APP_DIR, 'dshdock.cmd') : path.join(APP_DIR, 'run.sh')
  const rows = [
    ['平台', `${process.platform}-${process.arch}(运行时目录 ${target})`],
    ['Node', `${process.version}(${process.execPath})`],
    ['服务 node', nodeBin()],
    ['服务入口', SERVICE_ENTRY],
    ['命令入口', wrapper],
    ['部署目录', DATA_ROOT],
    ['配置文件', CONFIG_FILE],
    ['PID 文件', PID_FILE],
    ['日志', STDOUT_LOG],
    ['端口', String(PORT)],
  ]
  for (const [label, value] of rows) info(`${label.padEnd(10, ' ')} ${value}`)
  const runtimeBase = path.join(path.dirname(APP_DIR), 'runtime', target)
  const runtimeNode = nodeEntry(runtimeBase)
  info(`自带运行时   ${fs.existsSync(runtimeNode) ? `就绪(${runtimeNode})` : `缺失(${runtimeNode})`}`)
  info(`服务状态     ${await serviceUp() ? '运行中' : '未运行'}`)
}

// ── 孤儿清理 ────────────────────────────────────────────────────────────────
function listOrphanRecords() {
  if (!fs.existsSync(CONTAINERS_DIR)) return []
  const found = []
  for (const entry of fs.readdirSync(CONTAINERS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(CONTAINERS_DIR, entry.name)
    const record = readJson(path.join(dir, 'state', 'host.json'))
    const meta = readJson(path.join(dir, 'container.json')) ?? {}
    if (!record || !['running', 'starting'].includes(record.state)) continue
    if (record.pid === undefined) continue
    found.push({ dir, record, meta, name: meta.name ?? entry.name })
  }
  return found
}

/** 读某进程的命令行(判断它是不是 DSH host,防 pid 复用误杀)。 */
function processCmdline(pid) {
  const plan = cmdlinePlan(pid)
  try {
    if (plan.kind === 'file') return fs.readFileSync(plan.path, 'utf8').replaceAll('\0', ' ')
    return execFileSync(plan.command, plan.args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
  } catch {
    return null
  }
}

/** 当前监听中的端口集合。 */
function listeningPorts() {
  const plan = listeningPortsPlan()
  try {
    if (plan.kind === 'proc') {
      const ports = new Set()
      for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
        if (fs.existsSync(file)) for (const port of parseProcNetTcp(fs.readFileSync(file, 'utf8'))) ports.add(port)
      }
      return ports
    }
    return parseNetstatPorts(execFileSync(plan.command, plan.args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 }))
  } catch {
    return null // 端口信息拿不到时不作为否决条件
  }
}

async function cmdCleanup(argv) {
  if (await serviceUp()) {
    info('✗ DSH Dock 服务运行中,容器由服务管理;请用 UI 停止容器或执行 dshdock stop')
    process.exit(1)
  }
  let portFilter = null
  if (argv[0] === '-port' || argv[0] === '--port') {
    portFilter = Number(argv[1])
    if (!Number.isInteger(portFilter)) {
      info('用法: dshdock cleanup -port <端口号>')
      process.exit(1)
    }
  }
  const records = listOrphanRecords().filter((item) =>
    (portFilter === null || item.record.port === portFilter) && pidAlive(item.record.pid))
  if (records.length === 0) {
    info(portFilter === null ? '没有需要清理的孤儿容器进程' : `没有找到使用端口 ${portFilter} 的存活 DSH 容器`)
    process.exit(portFilter === null ? 0 : 1)
  }
  const ports = listeningPorts()
  const victims = []
  for (const item of records) {
    const cmdline = processCmdline(item.record.pid)
    if (cmdline === null || !(cmdline.includes('bin.ts') && cmdline.includes('--profile'))) {
      info(`跳过 ${item.name}: pid ${item.record.pid} 不是 DSH host 进程(防 pid 复用误杀)`)
      continue
    }
    if (ports !== null && item.record.port !== undefined && !ports.has(item.record.port)) {
      info(`跳过 ${item.name}: 端口 ${item.record.port} 未在监听(疑似残留记录)`)
      continue
    }
    if (item.meta.devProtect) {
      info(`跳过 ${item.name}: 受开发保护(如确认要清理,先在 UI 关闭保护)`)
      continue
    }
    victims.push(item)
  }
  for (const item of victims) info(`停止 ${item.name} (pid=${item.record.pid}, port=${item.record.port}) ...`)
  for (const item of victims) await killTree(item.record.pid, { force: false })
  await sleep(5000)
  for (const item of victims) {
    if (pidAlive(item.record.pid)) {
      info(`  ${item.name} 5s 未退出,强制终止`)
      await killTree(item.record.pid, { force: true })
    }
    const next = { ...item.record, state: 'stopped', exitStatus: { signal: 'terminated' } }
    try {
      fs.writeFileSync(path.join(item.dir, 'state', 'host.json'), `${JSON.stringify(next, null, 2)}\n`)
    } catch {}
  }
  info(`清理完成: ${victims.length} 个`)
}

// ── 卸载数据 ────────────────────────────────────────────────────────────────
function cmdUninstallData(argv) {
  // 配置目录不在删除范围内:卸载后用户仍应留有各容器的配置文件与使用说明
  let configDir = path.join(DATA_ROOT, 'configs')
  try {
    const configured = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'state', 'settings.json'), 'utf8')).configDir
    if (typeof configured === 'string' && configured.trim().length > 0) configDir = configured.trim()
  } catch {}
  info('将删除以下应用生成内容:')
  info(`  部署目录: ${['containers', 'versions', 'pnpm-store', 'state', 'logs', 'plugins'].join(' / ')}`)
  info(`  配置目录: ${CONFIG_DIR}`)
  info(`保留: app/ runtime/ 及部署目录中其他所有文件`)
  info(`保留: 配置目录 ${configDir}(含各容器 *.dshcfg 配置文件与 README 使用说明)`)
  if (!argv.includes('--yes')) {
    info('确认请加 --yes(例如 dshdock uninstall-data --yes)')
    process.exit(1)
  }
  const pid = serverPid()
  if (pid !== null) {
    try { execFileSync(nodeBin(), [fileURLToPath(import.meta.url), 'stop'], { stdio: 'ignore' }) } catch {}
  }
  for (const name of ['containers', 'versions', 'pnpm-store', 'state', 'logs', 'plugins']) {
    fs.rmSync(path.join(DATA_ROOT, name), { recursive: true, force: true })
  }
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true })
  info('卸载完成。部署目录剩余内容:')
  try {
    for (const name of fs.readdirSync(DATA_ROOT)) info(`  ${name}`)
  } catch {}
}

// ── 入口 ────────────────────────────────────────────────────────────────────
const [command = '', ...rest] = process.argv.slice(2)
switch (command) {
  case 'bg':
  case 'start':
    await cmdStart()
    break
  case 'fg':
    await cmdForeground()
    break
  case 'stop':
    await cmdStop()
    break
  case 'status':
    await cmdStatus()
    break
  case 'restart':
    await cmdRestart()
    break
  case 'devrestart':
    await cmdDevrestart()
    break
  case 'cleanup':
    await cmdCleanup(rest)
    break
  case 'uninstall-data':
    cmdUninstallData(rest)
    break
  case 'selftest':
    await cmdSelftest()
    break
  case '-h':
  case '--help':
  case 'help':
    info('用法: dshdock [bg|stop|status|restart|devrestart|cleanup [-port N]|uninstall-data --yes|selftest|fg]')
    info('  不带参数 = 前台启动(Ctrl+C 停止所有容器并退出)')
    break
  default:
    await cmdForeground()
    break
}
