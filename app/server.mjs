#!/usr/bin/env node
// DSH Dock — 本地单用户 DSH(DeepSeek Harness) 容器化管理应用。
// 纯 Node 标准库实现,无第三方依赖。设计文档见 Obsidian:「DSH Dock 架构设计」。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

// ── 常量 ────────────────────────────────────────────────────────────────────

// DATA_ROOT(部署目录)解析优先级:
//   1. 环境变量 DSHBOX_DATA_ROOT
//   2. 配置文件 ~/.config/dshdock/config.json 的 dataRoot(首次启动引导页写入)
//   3. 默认 = 项目根(app/ 的上一级),整个项目树自包含
const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const DOCK_CONFIG_DIR = process.env.DSHDOCK_CONFIG_DIR || path.join(os.homedir(), '.config', 'dshdock')
const DOCK_CONFIG_PATH = path.join(DOCK_CONFIG_DIR, 'config.json')
const PUBLIC_DIR = path.join(APP_DIR, 'public')

let DATA_ROOT = null          // 部署目录,onboarding 后确定
let RUNTIME = null
let VERSIONS_DIR, CONTAINERS_DIR, PLUGINS_NM, STATE_DIR, LOGS_DIR, SETTINGS_PATH, CATALOG_PATH, PID_FILE
let onboardingNeeded = false

// 运行时(node/pnpm)解析:部署目录优先,应用自带(项目根/runtime)回退。
// 运行时属于应用,部署目录只放用户数据 —— 二者解耦,新机器部署无需拷贝运行时。
function runtimeDir() {
  const candidates = [
    path.join(DATA_ROOT, 'runtime', 'linux-x64'),
    path.join(APP_DIR, '..', 'runtime', 'linux-x64'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'node', 'bin', 'node'))) return candidate
  }
  return candidates[0]
}
const nodeBin = () => path.join(runtimeDir(), 'node', 'bin', 'node')
const pnpmBin = () => path.join(runtimeDir(), 'pnpm', 'pnpm')

function resolveDataRoot() {
  if (process.env.DSHBOX_DATA_ROOT) return { root: process.env.DSHBOX_DATA_ROOT, source: 'env' }
  const saved = readJson(DOCK_CONFIG_PATH, null)
  if (saved?.dataRoot) return { root: saved.dataRoot, source: 'config' }
  const fallback = path.dirname(APP_DIR)
  // 默认根已有数据(老版本升级)→ 自动收编,不打扰
  const adopted = fs.existsSync(path.join(fallback, 'containers')) || fs.existsSync(path.join(fallback, 'versions'))
  if (adopted) {
    writeJson(DOCK_CONFIG_PATH, { dataRoot: fallback })
    return { root: fallback, source: 'adopted' }
  }
  return { root: null, source: 'onboarding' }
}

function initPaths(root) {
  DATA_ROOT = root
  RUNTIME = runtimeDir()
  VERSIONS_DIR = path.join(DATA_ROOT, 'versions')
  CONTAINERS_DIR = path.join(DATA_ROOT, 'containers')
  PLUGINS_NM = path.join(DATA_ROOT, 'plugins', 'node_modules')
  STATE_DIR = path.join(DATA_ROOT, 'state')
  LOGS_DIR = path.join(DATA_ROOT, 'logs')
  SETTINGS_PATH = path.join(STATE_DIR, 'settings.json')
  CATALOG_PATH = path.join(STATE_DIR, 'version-catalog.json')
  PID_FILE = path.join(STATE_DIR, 'dshdock.pid')
  ensureDirs()
}

const HARNESS_REPO = 'https://github.com/deepseek-ai/deepseek-harness'
const HARNESS_API = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=100'
const PORT = Number(process.env.DSHWEB_PORT || 7940)

const START_TIMEOUT_MS = 120_000   // 就绪探测上限(原 dshboxd 60s 不够)
const PROBE_INTERVAL_MS = 500
const STOP_GRACE_MS = 5_000

// ── 基础工具 ────────────────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isSafeName = (v) => !!v && /^[A-Za-z0-9._-]{1,64}$/.test(v)

function ensureDirs() {
  for (const dir of [VERSIONS_DIR, CONTAINERS_DIR, PLUGINS_NM, STATE_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}

function readSettings() {
  return { containerPortRange: '41800-41899', proxy: '', githubMirror: '', npmRegistry: '', ...readJson(SETTINGS_PATH, {}) }
}

function writeSettings(settings) {
  writeJson(SETTINGS_PATH, settings)
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  try {
    fs.appendFileSync(path.join(LOGS_DIR, 'dshdock.log'), line + '\n')
  } catch {}
  emitSse('log', line) // UI 底部终端窗口实时显示
}

// 明细日志(子进程逐行输出等):只落盘 + 推送 UI,不打印前台终端。
// 前台终端只保留关键信息(开始/成功/失败/生命周期事件),全量明细见
// dshdock.log 与 UI 终端窗口 —— 待办①②(2026-09-05)
function logDetail(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  try {
    fs.appendFileSync(path.join(LOGS_DIR, 'dshdock.log'), line + '\n')
  } catch {}
}

// 进程是否存活(kill(pid,0) 探测)
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ── 长任务系统(SSE 进度推送) ────────────────────────────────────────────────

const tasks = new Map() // id -> task
const sseClients = new Set()

function emitSse(event, payload) {
  const frame = `data: ${JSON.stringify({ event, payload })}\n\n`
  for (const client of [...sseClients]) {
    try {
      client.res.write(frame)
    } catch {
      sseClients.delete(client)
    }
  }
}

function createTask(kind, refId, label) {
  const task = {
    id: randomUUID(),
    kind,
    refId,
    label,
    status: 'running',
    lines: [],
    startedAt: nowSeconds(),
    finishedAt: null,
    error: null,
  }
  // line 方法挂载在任务对象上,统一工作函数的日志接口
  task.line = (message) => taskLine(task, message)
  tasks.set(task.id, task)
  emitSse('task', task)
  return task
}

function taskLine(task, message) {
  if (!Array.isArray(task.lines)) task.lines = []
  const line = `[${nowSeconds()}] ${message}`
  task.lines.push(line)
  if (task.lines.length > 500) task.lines.splice(0, task.lines.length - 500)
  emitSse('task-line', { id: task.id, line })
  logDetail(`${task.label}: ${message}`)
}

function finishTask(task, error = null) {
  task.finishedAt = nowSeconds()
  if (error) {
    task.status = 'failed'
    task.error = String(error)
  } else {
    task.status = 'succeeded'
  }
  emitSse('task', task)
}

async function runTask(kind, refId, label, work) {
  const task = createTask(kind, refId, label)
  log(`▶ ${label} ...`)
  try {
    const result = await work({
      line: (message) => taskLine(task, message),
      task,
    })
    finishTask(task, null)
    log(`✔ ${label}`)
    return { task, result }
  } catch (error) {
    finishTask(task, error)
    log(`✘ ${label} 失败: ${String(error).split('\n')[0]}`)
    throw error
  }
}

// ── 外部命令(带代理支持) ────────────────────────────────────────────────────

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 600_000, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr || stdout || error.message}`))
      else resolve({ stdout, stderr })
    })
  })
}

// git 克隆:优先 GitHub 镜像(前缀式加速),否则走代理,否则直连
function gitCloneUrl() {
  const mirror = readSettings().githubMirror?.trim().replace(/\/+$/, '')
  if (mirror) {
    return mirror.startsWith('http') ? `${mirror}/${HARNESS_REPO}` : `https://${mirror}/${HARNESS_REPO}`
  }
  return HARNESS_REPO
}

function gitProxyArgs() {
  if (readSettings().githubMirror?.trim()) return [] // 镜像本身就是加速通道
  const proxy = readSettings().proxy?.trim()
  if (!proxy) return []
  return ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`]
}

async function fetchCatalogFromGithub() {
  const proxy = readSettings().proxy?.trim()
  const args = ['-sS', '--max-time', '30', '-H', 'User-Agent: dsh-web']
  if (proxy) args.push('-x', proxy)
  args.push(HARNESS_API)
  const { stdout } = await execFileAsync('curl', args, { timeout: 40_000 })
  const parsed = JSON.parse(stdout)
  if (!Array.isArray(parsed)) throw 'GitHub API 返回异常'
  return parsed.map((entry) => ({ name: entry.name, sha: entry.commit?.sha ?? null }))
}

// ── 版本管理 ────────────────────────────────────────────────────────────────

const installedVersions = () =>
  fs.readdirSync(VERSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(VERSIONS_DIR, entry.name, 'harness', 'package.json')))
    .map((entry) => entry.name)
    .sort()

const versionInUse = (tag) =>
  fs.readdirSync(CONTAINERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .some((entry) => readJson(path.join(CONTAINERS_DIR, entry.name, 'container.json'), {}).version === tag)

// pnpm v10+ 默认阻止依赖构建脚本;与 dshboxd 一致,注入全放行。
function allowAllBuilds(harnessDir) {
  const workspaceFile = path.join(harnessDir, 'pnpm-workspace.yaml')
  if (!fs.existsSync(workspaceFile)) return
  let content = fs.readFileSync(workspaceFile, 'utf8')
  if (!/dangerouslyAllowAllBuilds/.test(content)) {
    if (!content.endsWith('\n')) content += '\n'
    content += 'dangerouslyAllowAllBuilds: true\n'
    fs.writeFileSync(workspaceFile, content)
  }
}

// 子进程输出管道:统一转发到任务日志,并吞掉流错误(EPIPE 等,防止崩溃)
function pipeTaskOutput(task, stream) {
  stream.on('data', (chunk) => emitTaskOutput(task, chunk))
  stream.on('error', () => {})
}

// pnpm 子进程环境:harness 的构建脚本会递归调用 pnpm,必须让它上 PATH
function pnpmEnv(extraProxy = true) {
  const env = { ...process.env }
  env.PATH = `${path.join(runtimeDir(), 'node', 'bin')}:${runtimeDir()}/pnpm:${env.PATH ?? ''}`
  if (extraProxy) {
    const proxy = readSettings().proxy?.trim()
    if (proxy) {
      env.https_proxy = env.HTTPS_PROXY = proxy
      env.http_proxy = env.HTTP_PROXY = proxy
    }
  }
  return env
}

async function pnpmInstall(harnessDir, task) {
  const storeDir = path.join(DATA_ROOT, 'pnpm-store')
  const base = [pnpmBin(), '--dir', harnessDir, 'install', '--store-dir', storeDir]
  const env = pnpmEnv()
  // npm 镜像源(如 https://registry.npmmirror.com),在线安装时生效
  const registry = readSettings().npmRegistry?.trim()
  if (registry) env.npm_config_registry = registry

  task.line('尝试离线安装依赖(共享 store)...')
  const offline = await new Promise((resolve) => {
    const child = spawn(base[0], [...base.slice(1), '--offline', '--frozen-lockfile'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeTaskOutput(task, child.stdout)
    pipeTaskOutput(task, child.stderr)
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
  if (offline) return

  task.line('离线安装失败,回退在线安装(经配置的代理)...')
  await new Promise((resolve, reject) => {
    const online = spawn(base[0], [...base.slice(1), '--frozen-lockfile', '--no-verify-store-integrity'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeTaskOutput(task, online.stdout)
    pipeTaskOutput(task, online.stderr)
    online.on('error', reject)
    online.on('close', (code) => (code === 0 ? resolve() : reject(`pnpm install 退出码 ${code}(详见任务日志)`)))
  })
}

function emitTaskOutput(task, chunk) {
  for (const raw of String(chunk).split('\n')) {
    const line = raw.trimEnd()
    if (line) taskLine(task, line.length > 200 ? line.slice(0, 200) + '…' : line)
  }
}

async function pnpmBuild(harnessDir, task) {
  const env = pnpmEnv()
  await new Promise((resolve, reject) => {
    const build = spawn(pnpmBin(), ['--dir', harnessDir, 'run', 'build'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeTaskOutput(task, build.stdout)
    pipeTaskOutput(task, build.stderr)
    build.on('error', reject)
    build.on('close', (code) => (code === 0 ? resolve() : reject(`pnpm build 退出码 ${code}(详见任务日志)`)))
  })
}

// ── 版本级懒构建共享 ────────────────────────────────────────────────────────
// 构建产物(lib/ dist/ 与 .dsh-build 记录)只依赖版本源码,对同版本所有容器完全
// 相同(记录内容为 commit/版本号/文件数/sha256,无绝对路径,可安全拷贝)。
// 因此在版本层构建一次,创建/更新容器时随源码拷贝,免去逐容器 ~60s 的重复构建。
const CLIENT_BUILD_RECORD = path.join('.dsh-build', 'client-build-environment.json')
const versionBuildTasks = new Map() // versionDir -> 构建中的 Promise(并发去重)

function ensureVersionPrebuilt(versionDir, line, task) {
  if (fs.existsSync(path.join(versionDir, CLIENT_BUILD_RECORD))) {
    line('共享构建产物已就绪,跳过构建')
    return Promise.resolve()
  }
  const pending = versionBuildTasks.get(versionDir)
  if (pending) {
    line('该版本正由其他任务构建,等待共享产物...')
    return pending
  }
  const building = (async () => {
    line('该版本尚无共享构建产物,在版本层构建一次(同版本容器共享,仅此一次)...')
    await pnpmBuild(versionDir, task)
    line('版本层构建完成,后续同版本容器将直接拷贝产物')
  })().finally(() => versionBuildTasks.delete(versionDir))
  versionBuildTasks.set(versionDir, building)
  return building
}

// 复制目录,仅排除 node_modules。
// 注意必须保留 .git:harness 构建脚本会执行 `git rev-parse HEAD` 获取提交哈希。
async function copyHarness(source, target) {
  await fs.promises.cp(source, target, {
    recursive: true,
    // node_modules 由容器内离线安装重建;.tsbuildinfo 是 tsc 增量状态,
    // 不拷贝,避免残留状态影响容器内可能的重新构建
    filter: (src) => !/(^|\/)node_modules(\/|$)/.test(src) && !/\.tsbuildinfo$/.test(src),
  })
  sanitizeCopiedGit(target)
}

// 拷贝来的 .git 里,config.worktree 记录着源机器上的绝对 hooksPath
// (lefthook 钩子目录)。若不清理,容器内 pnpm install 的 lefthook
// 安装逻辑会按这个旧绝对路径写入,在宿主机上复活已废弃的目录。
function sanitizeCopiedGit(harnessDir) {
  const gitDir = path.join(harnessDir, '.git')
  if (!fs.existsSync(gitDir)) return
  fs.rmSync(path.join(gitDir, 'config.worktree'), { force: true })
  fs.rmSync(path.join(gitDir, 'dsh-hooks'), { recursive: true, force: true })
}

// ── 容器管理 ────────────────────────────────────────────────────────────────

// 内存中的运行中 host:id -> {pid, pgid, port, url, childPid}
const runningHosts = new Map()

const containerDir = (id) => path.join(CONTAINERS_DIR, id)
const listContainerIds = () =>
  fs.readdirSync(CONTAINERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(CONTAINERS_DIR, entry.name, 'container.json')))
    .map((entry) => entry.name)

function getContainer(id) {
  const file = path.join(containerDir(id), 'container.json')
  if (!fs.existsSync(file)) throw `容器不存在: ${id}`
  return readJson(file, {})
}

function saveContainer(id, data) {
  writeJson(path.join(containerDir(id), 'container.json'), data)
}

function hostRecordPath(id) {
  return path.join(containerDir(id), 'state', 'host.json')
}

function readHostRecord(id) {
  return readJson(hostRecordPath(id), null)
}

function writeHostRecord(id, record) {
  writeJson(hostRecordPath(id), record)
}

function containerStatus(id) {
  const running = runningHosts.get(id)
  if (running) return running.state === 'starting' ? 'starting' : 'running'
  const record = readHostRecord(id)
  if (!record) return 'stopped'
  if (record.state === 'starting' && record.pid && alive(record.pid)) return 'starting'
  return record.state === 'failed' ? 'failed' : 'stopped'
}

function profileTemplateBundles(profile) {
  if (profile === 'web') return ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  if (profile === 'headless') return ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
  throw `不支持的 profile: ${profile}`
}

function createProfileSkeleton(containerPath, profile) {
  const directory = path.join(containerPath, 'profile', 'profiles', profile)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    name: `dsh-profile-${profile}`,
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: profileTemplateBundles(profile) } },
  }, null, 2))
  fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '# 用户自定义 patch。\n[]\n')
  fs.writeFileSync(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

// ── 容器稳定端口 ────────────────────────────────────────────────────────────
// 端口在创建时从端口池分配并持久化到 container.json,此后每次启动固定使用。
// 端口池可在设置中配置(默认 41800-41899)。启动时若端口被其他进程占用则报错
// 而不换口,保证"同一容器永远同一端口"(URL 中 ?token 仍随启动轮换,系上游行为)。
function containerPortRange() {
  const m = String(readSettings().containerPortRange ?? '').match(/^(\d{2,5})\s*-\s*(\d{2,5})$/)
  if (m) {
    const start = Number(m[1])
    const end = Number(m[2])
    if (start >= 1024 && end <= 65535 && start < end && end - start <= 2000) return [start, end]
  }
  return [41800, 41899]
}

function allocateContainerPort() {
  const [start, end] = containerPortRange()
  const used = new Set(listContainerIds().map((id) => readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {}).port).filter(Boolean))
  used.add(PORT)
  for (let p = start; p <= end; p++) {
    if (!used.has(p)) return p
  }
  throw `容器端口池 ${start}-${end} 已用尽,请在设置中扩大范围或删除不用的容器`
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

// DSH host 的干净环境(剥离代理是关键,参见架构设计 3.1)
// ★ DSH_HOME 必须指向容器自己的 profile:DSH 的 home 解析优先级为
//   显式配置 → $DSH_HOME → 默认 ~/.dsh。若不设置,所有容器都会落到
//   宿主机 ~/.dsh,凭据/会话/设置互相污染、且混入用户旧 DSH 残留
//   (2026-09-05 修复的隔离缺陷,需求 F4 的 DSH_HOME 环境策略)
function dshHostEnv(profileHome) {
  const env = { ...process.env }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
    delete env[key]
  }
  env.DSH_HOME = profileHome
  env.NODE_PATH = PLUGINS_NM
  env.CHOKIDAR_USEPOLLING = 'true'
  env.PATH = `${path.join(runtimeDir(), 'node', 'bin')}:${runtimeDir()}/pnpm:${env.PATH ?? ''}`
  return env
}

function announceFromLog(logPath, sinceBytes) {
  try {
    const text = fs.readFileSync(logPath, 'utf8').slice(sinceBytes)
    const match = text.match(/dsh web: (http:\/\/\S+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function probeHttp(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 2000 }, (response) => {
      response.resume()
      resolve(response.statusCode < 500)
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

function probeTcp(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 1500 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(false))
  })
}

async function startContainer(id) {
  const container = getContainer(id)
  if (runningHosts.has(id)) throw '容器已在运行'
  // 清理上次失败遗留的 host 进程组(超时保留现场的进程)
  const stale = readHostRecord(id)
  if (stale?.pgid && groupAlive(stale.pgid)) {
    try {
      process.kill(-stale.pgid, 'SIGKILL')
      await sleep(300)
    } catch {}
  }
  const harnessDir = path.join(containerDir(id), 'harness')
  const entryFile = path.join(harnessDir, 'apps', 'cli', 'src', 'bin.ts')
  if (!fs.existsSync(entryFile)) throw '容器 harness 缺失,请先更新或重建容器'

  const dir = containerDir(id)
  for (const sub of ['profile', 'workspace', 'state', 'logs']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  const logPath = path.join(dir, 'logs', 'host.log')
  // 稳定端口:使用创建时分配并持久化的端口;旧容器(无 port 字段)在此迁移分配一次
  let port = container.port
  if (!port) {
    port = allocateContainerPort()
    container.port = port
    saveContainer(id, container)
  }
  if (!(await isPortFree(port))) {
    throw `容器端口 ${port} 被其他进程占用,无法启动;请释放端口后重试(服务已停止时可用 dshdock cleanup 清理遗留进程)`
  }
  const webPatch = path.join(dir, 'web.patch.yml')
  fs.writeFileSync(webPatch, `- id: webserver\n  config:\n    host: 127.0.0.1\n    port: ${port}\n`)

  const offset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0
  const logFd = fs.openSync(logPath, 'a')
  const child = spawn(nodeBin(), [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    '--profile', container.profile,
    '--patch', webPatch,
  ], {
    cwd: harnessDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: dshHostEnv(path.join(dir, 'profile')),
  })
  fs.closeSync(logFd)

  const record = {
    pid: child.pid,
    pgid: child.pid, // detached: true → 自成进程组
    port,
    state: 'starting',
    startedAt: nowSeconds(),
    url: null,
    exitStatus: null,
  }
  writeHostRecord(id, record)
  runningHosts.set(id, { ...record, childPid: child.pid })
  log(`容器 ${container.name}(${id}) host 已启动 pid=${child.pid} port=${port}`)

  let announcedUrl = null
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(PROBE_INTERVAL_MS)
    if (!alive(child.pid)) {
      // host 提前退出:读取日志尾部作为错误上下文
      const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(offset).trim().split('\n').slice(-8).join('\n') : ''
      runningHosts.delete(id)
      record.state = 'failed'
      record.exitStatus = 'early-exit'
      writeHostRecord(id, record)
      throw `host 进程提前退出。日志尾部:\n${tail || '(无输出)'}`
    }
    announcedUrl = announcedUrl ?? announceFromLog(logPath, offset)
    const ok = announcedUrl
      ? await probeHttp(announcedUrl)
      : await probeTcp(port)
    if (ok) {
      // 端口已就绪,但公告行(含 token)可能刚写入缓冲区:短暂等待它出现,
      // 否则浏览器打开裸 URL 会被 DSH 的 browser-trust fence 拒绝(401)
      const announceDeadline = Date.now() + 15_000
      while (!announcedUrl && Date.now() < announceDeadline && alive(child.pid)) {
        await sleep(PROBE_INTERVAL_MS)
        announcedUrl = announceFromLog(logPath, offset)
      }
      record.state = 'running'
      record.url = announcedUrl ?? `http://127.0.0.1:${port}`
      record.lastSeen = nowSeconds()
      writeHostRecord(id, record)
      runningHosts.set(id, { ...record, childPid: child.pid })
      log(`容器 ${container.name} 就绪: ${record.url}`)
      return record.url
    }
  }

  // 超时:按需求保留现场(不杀进程),标记 failed,URL 若已公告一并给出
  record.state = 'failed'
  record.url = announcedUrl
  writeHostRecord(id, record)
  throw `启动探测超时(${START_TIMEOUT_MS / 1000}s)。host 进程保留运行(现场未破坏),可在日志中查看详情。${announcedUrl ? ` 已公告 URL: ${announcedUrl}` : ''}`
}

// 进程组是否存活(kill(-pgid,0) 探测整个组)
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

async function stopContainer(id) {
  const running = runningHosts.get(id)
  const record = readHostRecord(id) ?? {}
  const pgid = running?.pgid ?? record.pgid
  if (pgid && groupAlive(pgid)) {
    try {
      process.kill(-pgid, 'SIGTERM')
    } catch {}
    const deadline = Date.now() + STOP_GRACE_MS
    while (Date.now() < deadline && groupAlive(pgid)) {
      await sleep(100)
    }
    if (groupAlive(pgid)) {
      try {
        process.kill(-pgid, 'SIGKILL')
      } catch {}
      await sleep(200)
    }
  }
  runningHosts.delete(id)
  record.state = 'stopped'
  record.stoppedAt = nowSeconds()
  record.exitStatus = null
  writeHostRecord(id, record)
  log(`容器 ${id} 已停止`)
}

// ── API 处理器 ──────────────────────────────────────────────────────────────

// 系统目录选择对话框:跨平台,全部使用各 OS 内置机制,无需安装第三方依赖。
//   Windows: PowerShell FolderBrowserDialog(系统自带)
//   macOS:   osascript choose folder(系统自带)
//   Linux:   zenity → kdialog → yad 链式回退(Linux 无保证预装的 GUI 工具,需装其一)
// 用户取消返回 {path:null};工具缺失自动尝试下一个。
function pickDirectoryNative() {
  return new Promise((resolve) => {
    const title = '选择 DSH Dock 部署目录'
    if (process.platform === 'win32') {
      const script = [
        `Add-Type -AssemblyName System.Windows.Forms | Out-Null`,
        `$d = New-Object System.Windows.Forms.FolderBrowserDialog`,
        `$d.Description = '${title}'`,
        `if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`,
      ].join('; ')
      return execFile('powershell', ['-NoProfile', '-STA', '-Command', script], (error, stdout) => {
        if (error) return resolve({ path: null, error: `PowerShell 目录对话框失败: ${String(error.message).split('\n')[0]}` })
        const picked = String(stdout).trim()
        resolve(picked ? { path: picked } : { path: null })
      })
    }
    if (process.platform === 'darwin') {
      return execFile('osascript', ['-e', `POSIX path of (choose folder with prompt "${title}")`], (error, stdout) => {
        if (error) {
          if (error.code === 1) return resolve({ path: null }) // 用户取消
          return resolve({ path: null, error: String(error.message).split('\n')[0] })
        }
        const picked = String(stdout).trim()
        resolve(picked ? { path: picked } : { path: null })
      })
    }
    // Linux: zenity → kdialog → yad
    const candidates = [
      ['zenity', ['--file-selection', '--directory', `--filename=${os.homedir()}/`, '--title', title]],
      ['kdialog', ['--getexistingdirectory', `${os.homedir()}/`, '--title', title]],
      ['yad', ['--file', '--directory', `--filename=${os.homedir()}/`, '--title', title, '--geometry', '900x600']],
    ]
    const attempt = (index) => {
      if (index >= candidates.length) {
        return resolve({
          path: null,
          error: '未找到目录选择工具。请安装任一:sudo pacman -S zenity(或 kdialog/yad),或直接在输入框手动填写路径',
        })
      }
      const [bin, args] = candidates[index]
      execFile(bin, args, (error, stdout) => {
        if (error) {
          if (error.code === 'ENOENT') return attempt(index + 1)
          if (error.code === 1 || error.code === 2) return resolve({ path: null }) // 用户取消
          return resolve({ path: null, error: `${bin} 失败: ${error.message}` })
        }
        const picked = String(stdout).trim()
        resolve(picked ? { path: picked } : { path: null })
      })
    }
    attempt(0)
  })
}

async function handleApi(request, response, url) {
  const route = `${request.method} ${url.pathname}`
  const send = (status, body) => {
    const data = JSON.stringify(body)
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(data)
  }

  // 部署目录引导(onboarding)
  if (route === 'GET /api/onboarding') {
    return send(200, { needed: onboardingNeeded, suggestion: path.join(os.homedir(), 'DSHDock-data') })
  }
  // 拉起系统目录选择对话框(zenity/kdialog/yad 链式回退),阻塞直至用户选择或取消
  if (route === 'POST /api/pick-directory') {
    const result = await pickDirectoryNative()
    return send(200, result)
  }
  if (route === 'POST /api/onboarding') {
    const { dataRoot } = await readJsonBody(request)
    const trimmed = String(dataRoot ?? '').trim()
    if (!trimmed || !path.isAbsolute(trimmed)) return send(400, { error: '必须是绝对路径' })
    let resolved
    try {
      fs.mkdirSync(trimmed, { recursive: true })
      resolved = fs.realpathSync(trimmed)
    } catch (error) {
      return send(400, { error: `目录不可用: ${error}` })
    }
    writeJson(DOCK_CONFIG_PATH, { dataRoot: resolved })
    onboardingNeeded = false
    initPaths(resolved)
    log(`部署目录已设定: ${resolved}`)
    return send(200, { ok: true, dataRoot: resolved })
  }
  if (onboardingNeeded && route !== 'GET /api/settings') {
    return send(409, { needsOnboarding: true, error: '尚未选择部署目录' })
  }

  // 设置
  if (route === 'GET /api/settings') {
    return send(200, readSettings())
  }
  if (route === 'POST /api/settings') {
    const body = await readJsonBody(request)
    writeSettings({
      proxy: String(body.proxy ?? '').trim(),
      githubMirror: String(body.githubMirror ?? '').trim(),
      npmRegistry: String(body.npmRegistry ?? '').trim(),
      containerPortRange: String(body.containerPortRange ?? '').trim(),
    })
    return send(200, readSettings())
  }

  // 版本目录
  if (route === 'GET /api/versions/catalog') {
    const cache = readJson(CATALOG_PATH, null)
    const installed = installedVersions()
    if (cache && url.searchParams.get('refresh') !== '1') {
      return send(200, { fetchedAt: cache.fetchedAt, tags: cache.tags, installed })
    }
    try {
      const tags = await fetchCatalogFromGithub()
      writeJson(CATALOG_PATH, { fetchedAt: nowSeconds(), tags })
      return send(200, { fetchedAt: nowSeconds(), tags, installed })
    } catch (error) {
      if (cache) return send(200, { fetchedAt: cache.fetchedAt, tags: cache.tags, installed, warning: `刷新失败,使用缓存: ${error}` })
      return send(500, { error: `获取版本目录失败: ${error}` })
    }
  }

  // 安装版本(部分安装可重装 = 修复)
  if (route === 'POST /api/versions/install') {
    const { tag } = await readJsonBody(request)
    if (!isSafeName(tag)) return send(400, { error: '非法版本号' })
    const target = path.join(VERSIONS_DIR, tag, 'harness')
    if (fs.existsSync(target) && fs.existsSync(path.join(target, 'node_modules'))) {
      return send(400, { error: '该版本已安装;如需修复请先删除再安装' })
    }
    if (fs.existsSync(target)) {
      log(`版本 ${tag} 上次安装未完成,清理后重装`)
      fs.rmSync(path.join(VERSIONS_DIR, tag), { recursive: true, force: true })
    }
    runTask('version-install', tag, `安装 ${tag}`, async ({ line, task }) => {
      line(`克隆 ${HARNESS_REPO}(tag: ${tag}) → ${target}`)
      await execFileAsync('git', [...gitProxyArgs(), 'clone', '--depth', '1', '--branch', tag, HARNESS_REPO, target])
      line('克隆完成,安装依赖(预热共享 store)...')
      await pnpmInstall(target, { line: (m) => line(m) })
      // 防御:清掉任何随上游而来的构建记录,保证共享产物只由本机版本层构建产生
      fs.rmSync(path.join(target, '.dsh-build'), { recursive: true, force: true })
      line('版本安装完成')
    }).catch(() => {
      fs.rmSync(path.join(VERSIONS_DIR, tag), { recursive: true, force: true })
    })
    return send(200, { ok: true })
  }

  // 删除版本
  if (request.method === 'DELETE' && url.pathname.startsWith('/api/versions/')) {
    const tag = decodeURIComponent(url.pathname.split('/')[3])
    if (!isSafeName(tag)) return send(400, { error: '非法版本号' })
    if (versionInUse(tag)) return send(400, { error: '该版本仍被容器使用,先删除相关容器' })
    if (!fs.existsSync(path.join(VERSIONS_DIR, tag))) return send(404, { error: '版本未安装' })
    fs.rmSync(path.join(VERSIONS_DIR, tag), { recursive: true, force: true })
    return send(200, { ok: true })
  }

  // 容器列表
  if (route === 'GET /api/containers') {
    const containers = listContainerIds().map((id) => {
      const meta = readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {})
      const record = readHostRecord(id) ?? {}
      const status = containerStatus(id)
      return {
        id,
        name: meta.name ?? id,
        version: meta.version,
        profile: meta.profile,
        port: meta.port ?? null,
        devProtect: !!meta.devProtect,
        createdAt: meta.createdAt,
        status,
        url: status === 'running' ? runningHosts.get(id)?.url ?? record.url : null,
        logPath: path.join(containerDir(id), 'logs', 'host.log'),
      }
    })
    return send(200, containers)
  }

  // 创建容器
  if (route === 'POST /api/containers') {
    const { name, version, profile = 'web' } = await readJsonBody(request)
    if (!isSafeName(name)) return send(400, { error: '容器名只能包含字母、数字、点、下划线、连字符(≤64字符)' })
    if (!profileTemplateBundlesSafe(profile)) return send(400, { error: 'profile 仅支持 web / headless' })
    const versionDir = path.join(VERSIONS_DIR, version, 'harness')
    if (!fs.existsSync(path.join(versionDir, 'package.json'))) return send(400, { error: `版本未安装: ${version}` })
    if (listContainerIds().some((id) => readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {}).name === name)) {
      return send(400, { error: '同名容器已存在' })
    }
    const id = `container-${Date.now()}-${randomUUID().slice(0, 8)}`
    const containerPath = containerDir(id)
    fs.mkdirSync(containerPath, { recursive: true })
    // 创建时即分配稳定端口并持久化(端口池耗尽则整体失败,不留半成品)
    let port
    try {
      port = allocateContainerPort()
    } catch (error) {
      fs.rmSync(containerPath, { recursive: true, force: true })
      return send(400, { error: String(error) })
    }
    saveContainer(id, { id, name, version, profile, port, createdAt: nowSeconds() })

    runTask('container-create', id, `创建容器 ${name}`, async ({ line, task }) => {
      await ensureVersionPrebuilt(versionDir, line, task)
      line('复制版本源码(含共享构建产物,排除 node_modules)...')
      await copyHarness(versionDir, path.join(containerPath, 'harness'))
      allowAllBuilds(path.join(containerPath, 'harness'))
      line('生成 profile 骨架...')
      createProfileSkeleton(containerPath, profile)
      fs.mkdirSync(path.join(containerPath, 'workspace'), { recursive: true })
      line('安装容器依赖...')
      await pnpmInstall(path.join(containerPath, 'harness'), task)
      // 保险丝:共享产物意外缺失(如版本层构建曾失败)时,回退容器内构建
      if (!fs.existsSync(path.join(containerPath, 'harness', CLIENT_BUILD_RECORD))) {
        line('共享构建产物缺失,回退容器内构建...')
        await pnpmBuild(path.join(containerPath, 'harness'), task)
      }
      line('容器创建完成')
    }).catch(async (error) => {
      // 创建失败:清理半成品
      try {
        if (runningHosts.has(id)) await stopContainer(id)
        fs.rmSync(containerPath, { recursive: true, force: true })
      } catch {}
      log(`容器 ${name} 创建失败: ${error}`)
    })
    return send(200, { ok: true, id })
  }

  const containerMatch = url.pathname.match(/^\/api\/containers\/([^/]+)(\/.*)?$/)
  if (containerMatch) {
    const id = containerMatch[1]
    const action = containerMatch[2] ?? ''
    if (!fs.existsSync(path.join(containerDir(id), 'container.json'))) {
      return send(404, { error: '容器不存在' })
    }

    if (route === `POST /api/containers/${id}/start`) {
      const busy = busyTaskFor(id)
      if (busy) return send(400, { error: busy.kind === 'container-create' ? '容器正在创建中,请等待创建完成后再启动' : '容器正在更新中,请等待更新完成后再启动' })
      const container = getContainer(id)
      runTask('container-start', id, `启动 ${container.name}`, async ({ line }) => {
        line('启动 DSH host...')
        const url = await startContainer(id)
        line(`就绪: ${url}`)
      }).catch(() => {})
      return send(200, { ok: true })
    }

    if (route === `POST /api/containers/${id}/protect`) {
      const { enabled } = await readJsonBody(request)
      const container = getContainer(id)
      container.devProtect = !!enabled
      saveContainer(id, container)
      log(`容器 ${container.name} 开发保护: ${container.devProtect ? '开启' : '关闭'}`)
      return send(200, { ok: true, devProtect: container.devProtect })
    }

    // 修改容器固定端口:仅停止状态可改(运行中改端口会与监听中的 host 脱节),
    // 校验范围/服务端口冲突/其他容器占用/当前实际被占用,下次启动生效
    if (route === `POST /api/containers/${id}/port`) {
      const { port } = await readJsonBody(request)
      const p = Number(port)
      if (!Number.isInteger(p) || p < 1024 || p > 65535) return send(400, { error: '端口必须是 1024-65535 的整数' })
      if (p === PORT) return send(400, { error: `端口 ${p} 是 DSH Dock 服务自身端口,不可使用` })
      const container = getContainer(id)
      if (['running', 'starting'].includes(containerStatus(id))) return send(400, { error: '容器运行中,请先停止再修改端口' })
      if (busyTaskFor(id)) return send(400, { error: '容器有进行中的任务(创建/更新/启动),请稍后再试' })
      const clash = listContainerIds().some((other) => other !== id && readJson(path.join(CONTAINERS_DIR, other, 'container.json'), {}).port === p)
      if (clash) return send(400, { error: `端口 ${p} 已分配给其他容器` })
      if (!(await isPortFree(p))) return send(400, { error: `端口 ${p} 当前被其他进程占用,请换一个` })
      const oldPort = container.port
      container.port = p
      saveContainer(id, container)
      log(`容器 ${container.name} 端口: ${oldPort ?? '(未分配)'} → ${p}(下次启动生效)`)
      return send(200, { ok: true, port: p })
    }

    if (route === `POST /api/containers/${id}/stop`) {
      try {
        await stopContainer(id)
        return send(200, { ok: true })
      } catch (error) {
        return send(500, { error: String(error) })
      }
    }

    if (route === `DELETE /api/containers/${id}`) {
      const busy = busyTaskFor(id)
      if (busy) return send(400, { error: '容器正在创建/更新中,请等待当前任务完成' })
      const delContainer = getContainer(id)
      if (delContainer.devProtect) {
        const body = await readJsonBody(request).catch(() => ({}))
        if (!body.confirmDevProtect) {
          return send(400, { error: '该容器受开发保护,删除前需在弹窗中确认', needConfirm: true })
        }
      }
      try {
        await stopContainer(id)
      } catch {}
      fs.rmSync(containerDir(id), { recursive: true, force: true })
      return send(200, { ok: true })
    }

    if (route === `POST /api/containers/${id}/update`) {
      const busy = busyTaskFor(id)
      if (busy) return send(400, { error: '容器正在创建/更新中,请等待当前任务完成' })
      const { version } = await readJsonBody(request)
      const newVersionDir = path.join(VERSIONS_DIR, version, 'harness')
      if (!fs.existsSync(path.join(newVersionDir, 'package.json'))) return send(400, { error: `版本未安装: ${version}` })
      const containerPath = containerDir(id)
      const container = getContainer(id)
      if (container.version === version) return send(400, { error: '容器已是该版本' })
      runTask('container-update', id, `更新 ${container.name} → ${version}`, async ({ line, task }) => {
        if (runningHosts.has(id)) {
          line('停止运行中的容器...')
          await stopContainer(id)
        }
        const harnessDir = path.join(containerPath, 'harness')
        const backupDir = path.join(containerPath, 'state', `harness.old-${nowSeconds()}`)
        line('备份当前 harness...')
        fs.renameSync(harnessDir, backupDir)
        try {
          await ensureVersionPrebuilt(newVersionDir, line, task)
          line('复制新版本源码(含共享构建产物)...')
          await copyHarness(newVersionDir, harnessDir)
          allowAllBuilds(harnessDir)
          line('安装依赖...')
          await pnpmInstall(harnessDir, task)
          // 保险丝:共享产物意外缺失时,回退容器内构建
          if (!fs.existsSync(path.join(harnessDir, CLIENT_BUILD_RECORD))) {
            line('共享构建产物缺失,回退容器内构建...')
            await pnpmBuild(harnessDir, task)
          }
          container.version = version
          saveContainer(id, container)
          line('更新完成,用户数据(profile/workspace)未受影响')
        } catch (error) {
          line('更新失败,回滚...')
          fs.rmSync(harnessDir, { recursive: true, force: true })
          fs.renameSync(backupDir, harnessDir)
          throw error
        }
        fs.rmSync(backupDir, { recursive: true, force: true })
      }).catch(() => {})
      return send(200, { ok: true })
    }

    if (route === `GET /api/containers/${id}/url`) {
      const running = runningHosts.get(id)
      if (!running) return send(400, { error: '容器未在运行' })
      return send(200, { url: running.url })
    }

    if (route === `GET /api/containers/${id}/hostlog`) {
      const logPath = path.join(containerDir(id), 'logs', 'host.log')
      if (!fs.existsSync(logPath)) return send(200, { text: '(尚无日志)' })
      const text = fs.readFileSync(logPath, 'utf8')
      const lines = text.split('\n')
      return send(200, { text: lines.slice(-400).join('\n') })
    }

    // 优雅关闭:先停所有运行中的容器,再退出进程(run.sh stop 调用)
    if (route === 'POST /api/shutdown') {
      const running = [...runningHosts.keys()]
      for (const id of running) {
        try {
          await stopContainer(id)
        } catch (error) {
          log(`关闭容器 ${id} 失败: ${error}`)
        }
      }
      send(200, { ok: true, stoppedContainers: running.length })
      log('收到关闭请求,进程即将退出')
      setTimeout(() => {
        try {
          fs.rmSync(PID_FILE, { force: true })
        } catch {}
        process.exit(0)
      }, 300)
      return
    }
  }

  // 任务列表
  if (route === 'GET /api/tasks') {
    return send(200, [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50))
  }

  return send(404, { error: `未知接口: ${route}` })
}

function profileTemplateBundlesSafe(profile) {
  return profile === 'web' || profile === 'headless'
}

// 该容器是否有尚未完成的后台任务(创建/更新)。
// 创建中途启动会让 host 因 client bundles 未构建而失败;中途删除会删掉
// 正在写入的目录(2026-09-05 实测事故:创建未结束时点启动 → host 崩溃)
function busyTaskFor(id) {
  return [...tasks.values()].find((t) =>
    t.refId === id && t.status === 'running' && (t.kind === 'container-create' || t.kind === 'container-update')
  ) ?? null
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

// ── 静态文件 ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function serveStatic(response, pathname) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname))
  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403)
    response.end()
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('前端文件缺失')
    return
  }
  response.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(response)
}

// ── 服务器 ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`)
  try {
    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      const client = { res: response }
      sseClients.add(client)
      // 新客户端立即拿到任务快照:页面刷新/重连后进行中任务的状态不丢(待办④)
      const snapshot = [...tasks.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 50)
        .map((t) => ({ ...t, lines: (t.lines ?? []).slice(-60) }))
      response.write(`data: ${JSON.stringify({ event: 'snapshot', payload: snapshot })}\n\n`)
      const keepAlive = setInterval(() => {
        try {
          response.write(': keepalive\n\n')
        } catch {}
      }, 15000)
      request.on('close', () => {
        clearInterval(keepAlive)
        sseClients.delete(client)
      })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(request, response, url)
    }
    serveStatic(response, url.pathname)
  } catch (error) {
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    }
    response.end(JSON.stringify({ error: String(error) }))
  }
})

// 启动时接管已在运行的 host(应用重启不丢容器状态)
function reconcileRunningHosts() {
  for (const id of listContainerIds()) {
    const record = readHostRecord(id)
    if (record && ['running', 'starting'].includes(record.state) && record.pid && alive(record.pid)) {
      runningHosts.set(id, { pid: record.pid, pgid: record.pgid, port: record.port, url: record.url, childPid: record.pid })
      log(`接管运行中的容器 ${id}(port=${record.port})`)
    }
  }
}

// supervisor 不能因未捕获异常退出:记录并继续
process.on('uncaughtException', (error) => log(`未捕获异常(已忽略): ${error?.stack ?? error}`))
process.on('unhandledRejection', (error) => log(`未处理的 Promise 拒绝(已忽略): ${error?.stack ?? error}`))

// 前台模式(Ctrl+C / kill)的优雅退出:先停容器,不遗留孤儿 host
let shuttingDown = false
async function gracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log(`收到 ${signal},停止容器后退出...`)
  for (const id of [...runningHosts.keys()]) {
    // 开发保护的容器在优雅关闭时豁免:进程保留,下次服务启动自动接管
    const meta = readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {})
    if (meta.devProtect) {
      log(`容器 ${meta.name ?? id} 受开发保护,进程保留(下次服务启动自动接管)`)
      continue
    }
    try {
      await stopContainer(id)
    } catch (error) {
      log(`关闭容器 ${id} 失败: ${error}`)
    }
  }
  try {
    fs.rmSync(PID_FILE, { force: true })
  } catch {}
  process.exit(0)
}
// 开发模式(DSHDOCK_DEV=1,由 dshdock bg/devrestart 设置):收到终止信号时直接退出。
// 容器进程组是 detached 的,原样保留,由下一次服务启动自动接管 ——
// 避免一个误发的 Ctrl+C/kill 就停光所有容器(含用户正在使用的 DSH 会话)。
// 显式的 dshdock stop(POST /api/shutdown)在任何模式下都会先停容器再退出。
if (process.env.DSHDOCK_DEV === '1') {
  const devExit = (signal) => {
    log(`开发模式收到 ${signal}:服务退出,容器进程保留(下次启动自动接管)`)
    process.exit(0)
  }
  process.on('SIGINT', () => devExit('SIGINT'))
  process.on('SIGTERM', () => devExit('SIGTERM'))
} else {
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
}

server.listen(PORT, '127.0.0.1', () => {
  const resolved = resolveDataRoot()
  if (resolved.root) {
    initPaths(resolved.root)
    reconcileRunningHosts()
    fs.writeFileSync(PID_FILE, String(process.pid))
    if (DATA_ROOT === path.join(os.homedir(), 'DSHBox')) {
      log('⚠️ DATA_ROOT 指向已废弃的 ~/DSHBox — 检查 DSHBOX_DATA_ROOT 环境变量或源码位置!')
    }
    log(`DSH Dock 就绪: http://127.0.0.1:${PORT}/ (DATA_ROOT=${DATA_ROOT}, 来源=${resolved.source})`)
  } else {
    onboardingNeeded = true
    log('首次启动:等待选择部署目录(onboarding)')
  }
})
