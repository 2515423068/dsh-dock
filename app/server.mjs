#!/usr/bin/env node
// DSH Dock — 本地单用户 DSH(DeepSeek Harness) 容器化管理应用。
// 纯 Node 标准库实现,无第三方依赖。设计文档见 Obsidian:「DSH Dock 架构设计」。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import {
  aliveProbeTarget, defaultConfigDir, killTree, nodeEntry, pnpmLaunch, runtimeTarget, withRuntimePath,
} from './platform.mjs'
import {
  copyTree, discoverExternal, hardenHomePermissions, harnessFacts, homeFacts, importPlan, isSymlink,
  listDshProcesses, measureTree, removeEntrySafely, verifyCopy,
} from './external.mjs'

// ── 常量 ────────────────────────────────────────────────────────────────────

// DATA_ROOT(部署目录)解析优先级:
//   1. 环境变量 DSHBOX_DATA_ROOT
//   2. 配置文件(config.json)的 dataRoot(首次启动引导页写入)
//   3. 默认 = 项目根(app/ 的上一级),整个项目树自包含
const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
// 配置目录:Windows 用 %APPDATA%\dshdock,POSIX 用 ~/.config/dshdock(可用 DSHDOCK_CONFIG_DIR 覆盖)
const DOCK_CONFIG_DIR = process.env.DSHDOCK_CONFIG_DIR || defaultConfigDir({ homedir: os.homedir() })
const DOCK_CONFIG_PATH = path.join(DOCK_CONFIG_DIR, 'config.json')
const PUBLIC_DIR = path.join(APP_DIR, 'public')

let DATA_ROOT = null          // 部署目录,onboarding 后确定
let RUNTIME = null
let VERSIONS_DIR, CONTAINERS_DIR, PLUGINS_NM, STATE_DIR, LOGS_DIR, SETTINGS_PATH, CATALOG_PATH, PID_FILE
let onboardingNeeded = false

// 运行时(node/pnpm)解析:部署目录优先,应用自带(项目根/runtime)回退。
// 运行时属于应用,部署目录只放用户数据 —— 二者解耦,新机器部署无需拷贝运行时。
// 目录名 = <平台>-<架构>(install/setup 按同一规则落盘);回退兼容历史的 linux-x64 固定目录。
const RUNTIME_TARGET = runtimeTarget()

function runtimeDir() {
  const candidates = [
    path.join(DATA_ROOT, 'runtime', RUNTIME_TARGET),
    path.join(APP_DIR, '..', 'runtime', RUNTIME_TARGET),
    path.join(DATA_ROOT, 'runtime', 'linux-x64'),
    path.join(APP_DIR, '..', 'runtime', 'linux-x64'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(nodeEntry(candidate))) return candidate
  }
  return candidates[0]
}
const nodeBin = () => nodeEntry(runtimeDir())
// pnpm 启动方式(POSIX 用自带 shim;Windows 用自带 node 跑 pnpm.cjs,绕开 .cmd 需要 shell 的限制)
const pnpmCommand = () => pnpmLaunch(runtimeDir())

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
const HARNESS_RELEASES_API = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100'
const HARNESS_RELEASES_ATOM = `${HARNESS_REPO}/releases.atom`
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
  return {
    containerPortRange: '41800-41899',
    autoOpenUiOnStart: true,
    skipFirstOpenPrompts: true,
    proxy: '',
    githubMirror: '',
    npmRegistry: '',
    // 配置服务:自动保存开关(默认关)、配置目录(空 = DATA_ROOT/configs)
    configAutoSave: false,
    configDir: '',
    ...readJson(SETTINGS_PATH, {}),
  }
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

// GitHub API 匿名请求仅 60 次/小时/IP(共享代理出口极易耗尽,403 返回错误对象),
// 失败时回退 git ls-remote(走镜像/代理,git 协议无配额)。
async function fetchCatalogFromGithub() {
  const errors = []
  try {
    return await fetchCatalogViaApi()
  } catch (error) {
    errors.push(`GitHub API: ${error}`)
  }
  try {
    return await fetchCatalogViaLsRemote()
  } catch (error) {
    errors.push(`git ls-remote: ${error}`)
  }
  throw errors.join('; ')
}

async function fetchCatalogViaApi() {
  const stdout = await curlText(HARNESS_API)
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw '响应不是 JSON'
  }
  if (!Array.isArray(parsed)) throw parsed?.message ? String(parsed.message) : '返回异常'
  return parsed.map((entry) => ({ name: entry.name, sha: entry.commit?.sha ?? null }))
}

// 带代理的文本抓取(curl);GitHub API 与 releases.atom 共用。
async function curlText(url, { location = false, timeoutMs = 40_000 } = {}) {
  const proxy = readSettings().proxy?.trim()
  const args = ['-sS', '--max-time', '30', '-H', 'User-Agent: dsh-web']
  if (location) args.push('-L')
  if (proxy) args.push('-x', proxy)
  args.push(url)
  const { stdout } = await execFileAsync('curl', args, { timeout: timeoutMs })
  return stdout
}

// ── 版本更新说明(Release notes)────────────────────────────────────────────
// 刷新目录时一并抓取并写入本地缓存,WebUI 直接展示,无需再点外链。
// 双通道:GitHub API(/releases,带正文但受匿名限流)→ releases.atom(无限流,
// 正文为 HTML,需去标签)。两级都失败则沿用缓存里的旧说明。

const NOTES_BODY_LIMIT = 4000 // 单条说明入库上限,防单个 release 正文过大

async function fetchReleaseNotes() {
  const errors = []
  try {
    return await fetchReleaseNotesViaApi()
  } catch (error) {
    errors.push(`GitHub API: ${error}`)
  }
  try {
    return await fetchReleaseNotesViaAtom()
  } catch (error) {
    errors.push(`Atom 源: ${error}`)
  }
  throw errors.join('; ')
}

async function fetchReleaseNotesViaApi() {
  const stdout = await curlText(HARNESS_RELEASES_API)
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw '响应不是 JSON'
  }
  if (!Array.isArray(parsed)) throw parsed?.message ? String(parsed.message) : '返回异常'
  const notes = {}
  for (const release of parsed) {
    const tag = release?.tag_name
    if (typeof tag !== 'string' || tag.length === 0) continue
    const raw = typeof release.body === 'string' ? release.body : ''
    if (raw.trim().length === 0) continue
    const note = buildReleaseNote(raw, release.published_at ?? null)
    if (note !== null) notes[tag] = note
  }
  if (Object.keys(notes).length === 0) throw '未解析到任何 release 说明'
  return notes
}

async function fetchReleaseNotesViaAtom() {
  const xml = await curlText(HARNESS_RELEASES_ATOM, { location: true })
  const notes = {}
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = match[1]
    const href = block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''
    const tag = href.split('/releases/tag/')[1]
    if (tag === undefined || tag.length === 0) continue
    const raw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? ''
    if (raw.trim().length === 0) continue
    const note = buildReleaseNote(raw, block.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? null)
    if (note !== null) notes[decodeURIComponent(tag)] = note
  }
  if (Object.keys(notes).length === 0) throw '未解析到任何 release 说明'
  return notes
}

// 双语 Release 的语言锚点:实测 16/16 覆盖 —— 14 条用 id="cn-<tag>"/"en-<tag>",
// dsh-v0.1.3-alpha.2 用 id="chinese"/"english",dsh-v0.1.0-rc.7 用 id="cn"/"en"。
// 第一个带 en 锚点的标题即英文段起点;无锚点时退到已知英文章节标题。
const RELEASE_EN_HEADING = /<h[1-6][^>]*\bid\s*=\s*"(?:en|english)[^"]*"[^>]*>/i
const RELEASE_EN_KNOWN = /<h[1-6][^>]*>\s*(?:New Features|Features|Bug Fixes|Improvements|Other Changes|Breaking Changes)\s*<\/h[1-6]>/i

/** 按语言锚点把双语正文切成 `{ zh, en }`(纯结构解析,不需要 LLM)。 */
function splitBilingualRelease(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n')
  const at = RELEASE_EN_HEADING.exec(text) ?? RELEASE_EN_KNOWN.exec(text)
  if (at === null || at.index === 0) return { zh: text, en: '' }
  return { zh: text.slice(0, at.index), en: text.slice(at.index) }
}

/**
 * Build one cached note from a raw Release body.
 * @param raw - GitHub API Markdown body or Atom HTML content.
 * @param publishedAt - release timestamp when known.
 * @returns `{body, zh, en, publishedAt}` (null when nothing readable remains).
 */
function buildReleaseNote(raw, publishedAt) {
  const parts = splitBilingualRelease(raw)
  const zh = cleanReleaseBody(parts.zh)
  const en = cleanReleaseBody(parts.en)
  const body = [zh, en].filter((part) => part.length > 0).join('\n\n')
  if (body.length === 0) return null
  const note = { body: clampText(body, NOTES_BODY_LIMIT), publishedAt }
  if (zh.length > 0) note.zh = clampText(zh, NOTES_BODY_LIMIT)
  if (en.length > 0) note.en = clampText(en, NOTES_BODY_LIMIT)
  return note
}

/** HTML 实体解码(仅 Atom 正文用到;未知/越界实体丢弃)。 */
function decodeEntities(text) {
  const codePoint = (value, radix) => {
    const parsed = Number.parseInt(value, radix)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : ''
  }
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(dec, 10))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Atom 正文是 HTML:保段落/列表换行,去标签与实体,压掉多余空行。 */
function stripMarkup(html) {
  return decodeEntities(html)
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** GitHub API 的 release 正文是 Markdown(还夹带原始 HTML):压成可读纯文本。 */
function cleanReleaseBody(markdown) {
  return stripMarkup(
    markdown
      .replace(/\r\n?/g, '\n')                 // GitHub 正文是 CRLF
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接/锚点 → 文字
      .replace(/^[ \t]*(?:中文|English)[ \t]*[|｜][ \t]*(?:中文|English)[ \t]*$/gm, '') // 语言导航行
      .replace(/^[^\n]*·[ \t]*(?:中文|English)[ \t]*$/gm, '') // "0.1.3-alpha.2 · 中文"
      .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, '') // 分隔线
      .replace(/^#{1,6}[ \t]*/gm, '')          // 标题标记
      .replace(/\*\*([^*]+)\*\*/g, '$1')       // 粗体
      .replace(/`([^`]*)`/g, '$1')             // 行内代码
      .replace(/^[ \t]*[-*+][ \t]+/gm, '· '),  // 列表项([ \t] 而非 \s,避免吃掉换行)
  )
}

function clampText(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** 把更新说明并进 tags(命中才加 notes 字段,失败时原样保留)。 */
function mergeReleaseNotes(tags, notes) {
  return tags.map((tag) => {
    const note = notes?.[tag.name]
    return note === undefined ? tag : { ...tag, notes: note }
  })
}

/** 从缓存 tags 里回收已存的更新说明,供抓取失败时沿用。 */
function notesFromTags(tags) {
  const notes = {}
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (tag?.name && tag?.notes) notes[tag.name] = tag.notes
  }
  return notes
}

async function fetchCatalogViaLsRemote() {
  const args = ['ls-remote', '--tags', '--refs', ...gitProxyArgs(), gitCloneUrl()]
  const { stdout } = await execFileAsync('git', args, { timeout: 60_000 })
  const tags = stdout
    .split('\n')
    .map((line) => {
      const [sha, ref] = line.split('\t')
      return ref?.startsWith('refs/tags/') ? { name: ref.slice('refs/tags/'.length), sha: sha ?? null } : null
    })
    .filter(Boolean)
  if (tags.length === 0) throw '未解析到任何 tag'
  return tags.reverse() // ls-remote 按 ref 名升序输出,反转使最新在前
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
  const env = withRuntimePath({ ...process.env }, runtimeDir())
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
  const launch = pnpmCommand()
  const base = [...launch.prefixArgs, '--dir', harnessDir, 'install', '--store-dir', storeDir]
  const env = pnpmEnv()
  // npm 镜像源(如 https://registry.npmmirror.com),在线安装时生效
  const registry = readSettings().npmRegistry?.trim()
  if (registry) env.npm_config_registry = registry

  task.line('尝试离线安装依赖(共享 store)...')
  const offline = await new Promise((resolve) => {
    const child = spawn(launch.command, [...base, '--offline', '--frozen-lockfile'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    pipeTaskOutput(task, child.stdout)
    pipeTaskOutput(task, child.stderr)
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
  if (offline) return

  task.line('离线安装失败,回退在线安装(经配置的代理)...')
  await new Promise((resolve, reject) => {
    const online = spawn(launch.command, [...base, '--frozen-lockfile', '--no-verify-store-integrity'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
  const launch = pnpmCommand()
  await new Promise((resolve, reject) => {
    const build = spawn(launch.command, [...launch.prefixArgs, '--dir', harnessDir, 'run', 'build'], {
      cwd: harnessDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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

// ── 配置:把容器配置保存成**单个配置文件**,以及从配置文件创建容器 ──────────
// 设计取向(用户要求):
//   - 以「配置文件」为核心:一次保存 = 一个自包含文件
//     `<名字>-<版本>-<时间>.dshcfg`(tar.gz,内含 meta.json + home/,即完整 DSH_HOME)
//   - 恢复时**只需要提供这个文件**:从列表里选,或上传本地拿到的配置文件
//   - DSHBox 不接管外部 DSH、不使用软链;是否把外部配置保存进来由用户点按钮决定
//   - 配置目录默认 DATA_ROOT/configs,**不在 uninstall-data 的删除范围内**

const CONFIG_EXT = '.dshcfg'
const CONFIG_STORE = () => {
  const configured = readSettings().configDir?.trim()
  return configured && configured.length > 0 ? configured : path.join(DATA_ROOT, 'configs')
}
const configFilePath = (file) => path.join(CONFIG_STORE(), path.basename(file))

/** tar 负责打包/解包(Linux/macOS 自带;Windows 10 1803+ 自带 tar.exe)。 */
function tar(args, options = {}) {
  try {
    return execFileSync('tar', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options })
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim().split('\n').slice(-2).join(' ')
    throw new Error(`tar 执行失败(${detail});本机可能缺少 tar(Windows 需 10 1803+)`)
  }
}

/** 配置文件名:安全化 + 时间戳,便于用户一眼认出来源与时间。 */
function configFileName(name, version) {
  const base = String(name ?? 'config').trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 48) || 'config'
  const ver = String(version ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 24)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  return `${base}${ver.length > 0 ? `-${ver}` : ''}-${stamp}${CONFIG_EXT}`
}

/** 读配置文件里的 meta.json(顺带验证它确实是 DSH Dock 配置文件)。 */
function readConfigMeta(file) {
  const meta = JSON.parse(tar(['-xzOf', file, 'meta.json']))
  if (typeof meta !== 'object' || meta === null || typeof meta.name !== 'string') throw new Error('meta.json 内容不合法')
  return meta
}

function listConfigFiles() {
  const dir = CONFIG_STORE()
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(CONFIG_EXT) || file.endsWith('.tar.gz'))
    .filter((file) => {
      try {
        return fs.statSync(path.join(dir, file)).isFile()
      } catch {
        return false
      }
    })
}

/** 列表项:元信息全部来自配置文件本身(换台机器/别人给的配置文件也能直接列出来)。 */
function configItem(file) {
  const full = configFilePath(file)
  const stat = fs.statSync(full)
  const view = {
    file,
    bytes: stat.size,
    modifiedAt: Math.floor(stat.mtimeMs / 1000),
    valid: true,
    error: null,
  }
  try {
    const meta = readConfigMeta(full)
    return {
      ...view,
      name: meta.name,
      containerId: meta.containerId ?? null,
      version: meta.version ?? null,
      profile: meta.profile ?? 'web',
      port: meta.port ?? null,
      reason: meta.reason ?? 'manual',
      note: meta.note ?? '',
      createdAt: meta.createdAt ?? null,
      files: meta.files ?? 0,
      sessions: meta.sessions ?? 0,
      hasCredentials: !!meta.hasCredentials,
      source: meta.source ?? null,
    }
  } catch (error) {
    return { ...view, valid: false, error: String(error?.message ?? error), name: file, files: 0, sessions: 0, hasCredentials: false }
  }
}

/** 把一份 DSH home 打包成单个配置文件。 */
function packConfigFrom(source, info) {
  if (!fs.existsSync(source)) throw new Error(`配置目录不存在: ${source}`)
  fs.mkdirSync(CONFIG_STORE(), { recursive: true })
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dshdock-config-'))
  try {
    const home = path.join(staging, 'home')
    copyTree(fs, source, home)
    // 复制会保留源权限;DSH 拒绝 owner 之外可读的凭据,必须收紧后再打包,否则恢复起不来
    hardenHomePermissions(fs, home)
    const facts = homeFacts(fs, home)
    const name = String(info.name ?? path.basename(source)).trim() || path.basename(source)
    writeJson(path.join(staging, 'meta.json'), {
      format: 'dsh-dock-config',
      formatVersion: 1,
      name,
      containerId: info.containerId ?? null,
      version: info.version ?? null,
      profile: info.profile ?? 'web',
      port: info.port ?? null,
      reason: info.reason ?? 'manual',
      note: info.note ?? '',
      source,
      createdAt: nowSeconds(),
      files: facts.files,
      sessions: facts.sessions,
      hasCredentials: facts.hasCredentials,
    })
    const file = configFileName(name, info.version)
    const out = configFilePath(file)
    tar(['-czf', out, '-C', staging, 'meta.json', 'home'])
    // 打包校验:能读回 meta,且归档条目数不少于源文件数
    readConfigMeta(out)
    const entries = tar(['-tzf', out]).split('\n').filter((line) => line.trim().length > 0)
    if (entries.length < facts.files + 1) {
      throw new Error(`打包校验失败(归档 ${entries.length} 条目 < 源 ${facts.files} 文件)`)
    }
    writeConfigGuide()
    log(`保存配置 ${file}(${name}:${facts.files} 文件 / ${facts.sessions} 会话 → ${out})`)
    return { file, facts }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/** 保存某个容器的配置(取它的 profile = 该实例的 DSH_HOME)。 */
function saveContainerConfig(containerId, { reason = 'manual', note = '' } = {}) {
  const meta = getContainer(containerId)
  const profileDir = path.join(containerDir(containerId), 'profile')
  if (!fs.existsSync(profileDir)) throw new Error('该容器还没有 profile(可能尚未成功创建),暂无可保存的配置')
  return packConfigFrom(profileDir, {
    name: meta.name ?? containerId,
    containerId,
    version: meta.version,
    profile: meta.profile,
    port: meta.port,
    reason,
    note,
  })
}

/** 从配置文件里解出 home/ 并铺到容器 profile(只复制,随后与配置文件各自独立)。 */
function extractConfigHome(file, profileDir) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dshdock-restore-'))
  try {
    tar(['-xzf', file, '-C', staging, 'home'])
    const home = path.join(staging, 'home')
    if (!fs.existsSync(home)) throw new Error('配置文件里缺少 home/ 目录')
    removeEntrySafely(fs, profileDir)
    copyTree(fs, home, profileDir)
    hardenHomePermissions(fs, profileDir)
    return homeFacts(fs, profileDir)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * 在配置目录里写一份**手动恢复指南**(纯文本,和 DSH Dock 本体解耦):
 * 用户即使卸载了 DSH Dock、甚至在另一台机器上,照着它就能把配置文件用起来。
 */
function writeConfigGuide() {
  const dir = CONFIG_STORE()
  fs.mkdirSync(dir, { recursive: true })
  const items = listConfigFiles().map(configItem).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const rows = items.map((item) => {
    const when = item.createdAt ? new Date(item.createdAt * 1000).toISOString().replace('T', ' ').slice(0, 19) : '-'
    return `| \`${item.file}\` | ${item.name} | ${item.version ?? '-'} | ${item.sessions} | ${(item.bytes / 1048576).toFixed(1)} MB | ${when} |`
  })
  const sample = items[0]?.file ?? '<配置文件>.dshcfg'
  const lines = [
    '# 手动恢复指南(DSH Dock 配置文件)',
    '',
    '这份文件放在配置目录里,是给「**不依赖 DSH Dock**」的场景准备的:',
    '即使你卸载了 DSH Dock、换了电脑,只要有这里的 `*.dshcfg` 文件和这份指南,就能把配置用起来。',
    '',
    `- 配置目录: \`${dir}\``,
    `- 配置文件数: ${items.length}`,
    `- 本指南生成时间: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    '',
    '---',
    '',
    '## 一、配置文件是什么',
    '',
    '每个 `*.dshcfg` 就是一个 **tar.gz 压缩包**(只是换了个扩展名),里面有两个东西:',
    '',
    '```',
    '<配置文件>.dshcfg',
    '├── meta.json    # 元信息:来自哪个容器、DSH 版本、端口、会话数、保存时间',
    '└── home/        # 该实例的完整 DSH_HOME',
    '    ├── settings.yaml        # 设置(模型、界面等)',
    '    ├── .credentials.yaml    # 明文凭据(API Key)',
    '    ├── sessions/            # 会话历史',
    '    ├── storages/            # 存储单元(工作区注册等)',
    '    ├── plugins/ skills/ attachments/',
    '    └── ...',
    '```',
    '',
    '## 二、要用它,先解压(是的,要解压)',
    '',
    '`*.dshcfg` 没有双击打开的图形界面,**必须用 `tar` 解压**(Linux / macOS / Windows 10 1803+ 都自带 `tar`)。',
    '',
    '### Linux / macOS / WSL',
    '',
    '```bash',
    '# 解到临时目录(路径随意)',
    `mkdir -p ~/dsh-restore && tar -xzf "${dir}/${sample}" -C ~/dsh-restore`,
    '',
    '# 目录结构会变成:~/dsh-restore/home/... —— 这就是一份完整的 DSH_HOME',
    'ls ~/dsh-restore/home',
    '```',
    '',
    '### Windows(PowerShell / cmd)',
    '',
    '```powershell',
    'mkdir $env:USERPROFILE\\dsh-restore -Force',
    `tar -xzf "${dir}\\${sample}" -C $env:USERPROFILE\\dsh-restore`,
    'dir $env:USERPROFILE\\dsh-restore\\home',
    '```',
    '',
    '> 如果 `tar` 报「无法识别格式」:把文件改名为 `xxx.tar.gz` 再解压(有些解压软件只认扩展名)。',
    '',
    '## 三、解压之后怎么启动',
    '',
    '### 方式 A:直接当独立 DSH 用(完全不需要 DSH Dock)',
    '',
    '```bash',
    '# 1) 准备一个 DSH(任选一种;需要 Node ≥ 22)',
    'npx @deepseek-ai/dsh web',
    '#  或源码方式:git clone https://github.com/deepseek-ai/deepseek-harness',
    '#             cd deepseek-harness && pnpm install && pnpm run build',
    '',
    '# 2) 把解出来的 home 指给它',
    'chmod 600 ~/dsh-restore/home/.credentials.yaml   # 必须:DSH 拒绝「owner 之外可读」的凭据',
    `DSH_HOME=~/dsh-restore/home npx @deepseek-ai/dsh web`,
    '```',
    '',
    'Windows PowerShell 同上,只是换环境变量写法:',
    '',
    '```powershell',
    '$env:DSH_HOME="$env:USERPROFILE\\dsh-restore\\home"; npx @deepseek-ai/dsh web',
    '```',
    '',
    '> 想让它变成「默认」配置,也可以把 `home/` 里的内容拷进 `~/.dsh`(Windows 是 `%USERPROFILE%\\.dsh`),',
    '> 然后直接 `npx @deepseek-ai/dsh web`。**建议先备份原来的 `~/.dsh`。**',
    '',
    '### 方式 B:回到 DSH Dock 里用(装了 DSH Dock 的话)',
    '',
    '把 `*.dshcfg` 放到这台机器的配置目录(`DSH Dock → 外部/配置 → 配置目录`),',
    '或在页面里「上传配置文件」,然后在列表里点「**从配置创建**」,填容器名并选一个已安装版本。',
    '',
    '## 四、现有配置文件',
    '',
    '| 文件 | 来源容器 | DSH 版本 | 会话 | 大小 | 保存时间 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(rows.length > 0 ? rows : ['| (暂无,先在 DSH Dock 里点「保存配置」) | | | | | |']),
    '',
    '## 五、注意事项',
    '',
    '- `.credentials.yaml` 是**明文 API Key**:配置文件和解压出来的目录都请当敏感数据保管,别提交到公开仓库、别随手分享。',
    '- 恢复出来的实例与配置文件、与原来的容器**各自独立**:在哪一处改动都不影响其它副本。',
    '- 配置文件是**时间点快照**:恢复得到的是保存那一刻的会话与配置。',
    '- 自动保存开关打开后,DSH Dock 会在创建容器后 / 更新版本前 / 删除容器前各保存一份。',
    '- 全部操作都在本机进行;DSH Dock 不会把你的配置上传到任何地方。',
    '',
  ]
  fs.writeFileSync(path.join(dir, '手动恢复指南.md'), lines.join('\n'))
  // 旧版本写过 README.md:清掉,避免同一个目录里两份说明
  fs.rmSync(path.join(dir, 'README.md'), { force: true })
}

/** 某个 home 是否正被运行中的 DSH 使用(Linux 可精确探测;其它平台返回 known:false)。 */
function homeUsage(dir) {
  if (process.platform !== 'linux') return { known: false, inUse: false, pid: null }
  const target = path.resolve(dir)
  const hit = listDshProcesses().find((item) => item.home && path.resolve(item.home) === target)
  return { known: true, inUse: hit !== undefined, pid: hit?.pid ?? null }
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

// ── 新容器初始配置模板 ──────────────────────────────────────────────────────
// 从已配置好的容器捕获 profile/settings.yaml(含「测试版公告已确认」/ provider
// 定义 / 默认模型)与 .credentials.yaml 的 refs 块(API Key 值,键名 = provider
// 的 apiKeyEnv,由 DSH 凭据存储解析)。新建容器时直接写入,首次打开不再出现
// 「测试版公告」与「API Key 录入」弹窗。refs 是敏感值:模板文件一律 0600,
// API 只回显键名,绝不回显值。
const PROFILE_TEMPLATE_DIR = () => path.join(STATE_DIR, 'profile-template')
const tplSettingsPath = () => path.join(PROFILE_TEMPLATE_DIR(), 'settings.yaml')
const tplRefsPath = () => path.join(PROFILE_TEMPLATE_DIR(), 'credential-refs.yaml')
const tplMetaPath = () => path.join(PROFILE_TEMPLATE_DIR(), 'meta.json')

// 按顶层键切分 YAML:块 = 从 `key:` 行到下一个顶层键之前(缩进行与空行都归属该键)。
// 仅用于无依赖的文本级合并,不做完整 YAML 解析。
function splitYamlTopLevel(text) {
  const sections = new Map()
  let current = null
  let buf = []
  for (const line of String(text).split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_.-]*):/)
    if (m) {
      if (current) sections.set(current, buf.join('\n'))
      current = m[1]
      buf = [line]
    } else if (current) {
      buf.push(line)
    }
  }
  if (current) sections.set(current, buf.join('\n'))
  return sections
}

// 把模板里的 refs 块(flow 或块映射,如 `refs: { K: "v" }` / `refs:\n  K: v`)抽成
// 扁平 `KEY: value` 行。扁平布局是最老的凭据格式:0.1.0-* 旧版直接可读,
// 0.1.1+ 新版 loadInitial 检测到扁平布局会自动迁移成 version:1/refs 并落盘,
// 因此一种写法同时兼容新旧两端。(2026-09-11:此前注入的是新版 version/refs 结构,
// 旧版会把 version 当凭据键、要求值是字符串,导致 boot 失败。)
function flatRefEntries(refsBlock) {
  const body = String(refsBlock).replace(/^[ \t]*refs:[ \t]*/m, '')
  const entries = []
  for (const m of body.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*("[^"]*"|'[^']*'|[^,}\n]+)/g)) {
    entries.push({ key: m[1], line: `${m[1]}: ${m[2].trim()}` })
  }
  return entries
}

// ── 模型配置表(新容器初始配置) ─────────────────────────────────────────────
// 维护一张「提供方(provider)」表,每行 = DSH `llm-pi-ai.providers` 的一个 route:
// 协议 / 端点 / 密钥引用 / 模型清单。可手工增删改,也可从某个已配置容器一键导入
// (读它的 profile/settings.yaml + .credentials.yaml)。新建容器时把全表写进
// settings.yaml、默认模型写进 agent-default-model、密钥写进 .credentials.yaml 的
// refs —— 首次打开即可直接选模型,不再弹「API Key 录入」。
//
// 存储拆成两个文件,避免密钥混进可读配置:
//   state/model-configs.json  非敏感配置(provider 表 / 默认模型 / 非模型配置段)
//   state/model-keys.json     API Key 值(0600,接口只回显「已设置」,绝不回显值)
// 旧版整份捕获的 state/profile-template/ 仍可读:首次加载时自动迁移进本表。

const MODEL_CONFIG_PATH = () => path.join(STATE_DIR, 'model-configs.json')
const MODEL_KEYS_PATH = () => path.join(STATE_DIR, 'model-keys.json')
// 测试版公告确认值:与上游 ui-onboarding.welcomeNoticeVersion 对齐,写进去即免弹窗
const ONBOARDING_NOTICE_VERSION = '2026-08-13.1'
// pi-ai 的三种线协议(见 harness packages/llm/llm-pi-ai/src/catalog.ts)
const PROVIDER_API_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
// provider 键(route 名):对齐上游「小写字母开头 + 小写字母/数字/短横线分段」——
// 首字母必须是字母,因为凭据引用由 <ROUTE>_API_KEY 派生,而凭据名是 shell 标识符,
// 不能以数字开头(见 harness packages/llm/llm-pi-ai/src/auth.ts)。
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const MODEL_MODALITIES = ['text', 'image']
// 空密钥时的占位值:pi-ai 必须有 key 或 authorization 头,否则调用报 No API key for provider。
// 面板无法判断某行是不是本地服务,所以统一兜底 —— 本地服务不校验该值,云端填错会得到明确的 401。
const PLACEHOLDER_KEY = 'local'

/** 由 provider id 派生凭据引用:acme-gw → ACME_GW_API_KEY(与上游 deriveKeyRef 同构)。 */
function deriveKeyRef(id) {
  const stem = String(id).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${/^[0-9]/.test(stem) ? `P${stem}` : stem || 'PROVIDER'}_API_KEY`
}

// 上游 pi-ai 内置目录里的常见 route(只有一条 API Key 就能用,模型清单由目录提供)。
// 名单随安装的 pi-ai 版本变化,这里只做「添加提供方」的快捷入口,不校验合法性。
/** 详情表单的「快速填充」模板:填连接信息(协议 / 地址 / 凭证引用 / 提供方名称)与样例模型。 */
const PROVIDER_PRESETS = [
  {
    id: 'llama-local',
    label: '本地 llama.cpp',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:8080/v1',
    apiKeyEnv: 'LLAMA_LOCAL_API_KEY',
    providerLabel: '本地 llama.cpp',
    apiKey: 'local',
    models: [{ id: 'spark-x2.5-4b-q4-32k', name: '本地模型(模型 ID 与 llama-server 暴露的一致)', contextWindow: 131072, maxTokens: 8192 }],
  },
  {
    id: 'openrouter-free',
    label: 'OpenRouter 免费模型',
    api: 'openai-completions',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    providerLabel: 'OpenRouter',
    models: [
      { id: 'openrouter/free', name: 'Free Models Router', contextWindow: 200000, maxTokens: 4096 },
      { id: 'openai/gpt-oss-20b:free', name: 'OpenAI: gpt-oss-20b (free)', contextWindow: 131072, maxTokens: 32768 },
    ],
  },
  {
    id: 'deepseek-api',
    label: 'DeepSeek 官方 API',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    providerLabel: 'DeepSeek',
    models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 131072, maxTokens: 8192 }],
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容端点',
    api: 'openai-completions',
    baseURL: '',
    apiKeyEnv: '',
    providerLabel: '',
    models: [],
  },
]

// ── 极简 YAML 子集解析/生成 ────────────────────────────────────────────────
// 只用 Node 标准库(项目零第三方依赖)。覆盖 DSH settings.yaml / .credentials.yaml
// 实际出现的结构:块映射、块序列、流式 {} / [],单双引号标量、数字/布尔/null、注释。
// 不支持锚点/别名、`|`/`>` 块标量、多文档、标签 —— 遇到就按普通标量读,不抛异常。

/** 去掉行尾注释(# 仅在行首或前面是空白时才是注释;引号内的 # 保留)。 */
function yamlStripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return line.slice(0, i)
  }
  return line
}

/** 判断以 { / [ 开头的流式片段是否已闭合(考虑引号内的括号)。 */
function yamlFlowBalanced(text) {
  let depth = 0
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote !== null) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') depth--
  }
  return depth <= 0
}

/** 跨行收集一段流式集合(js-yaml 会把嵌套流式结构折成多行)。 */
function yamlFlowText(lines, index, prefix) {
  let text = prefix
  let i = index
  while (!yamlFlowBalanced(text) && i + 1 < lines.length) {
    i++
    text += ` ${lines[i].content}`
  }
  return { text, next: i + 1 }
}

/** 解析流式集合 {} / []:递归下降,plain 标量读到 , } ] 为止。 */
function yamlParseFlow(text) {
  let i = 0
  const skip = () => { while (i < text.length && /\s/.test(text[i])) i++ }
  const parseQuoted = (quote) => {
    let out = ''
    i++
    while (i < text.length) {
      const ch = text[i]
      if (quote === '"' && ch === '\\') {
        const next = text[i + 1]
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
        i += 2
        continue
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") { out += "'"; i += 2; continue }
        i++
        break
      }
      out += ch
      i++
    }
    return out
  }
  const parsePlain = () => {
    const start = i
    while (i < text.length && !',}]'.includes(text[i])) i++
    return yamlParseScalar(text.slice(start, i).trim())
  }
  const parseValue = () => {
    skip()
    const ch = text[i]
    if (ch === '{') return parseMap()
    if (ch === '[') return parseSeq()
    if (ch === '"' || ch === "'") return parseQuoted(ch)
    return parsePlain()
  }
  const parseMap = () => {
    const obj = {}
    i++
    for (;;) {
      skip()
      if (i >= text.length) break
      if (text[i] === '}') { i++; break }
      let key
      if (text[i] === '"' || text[i] === "'") key = parseQuoted(text[i])
      else {
        const start = i
        while (i < text.length && text[i] !== ':' && text[i] !== '}') i++
        key = text.slice(start, i).trim()
      }
      skip()
      if (text[i] === ':') i++
      obj[key] = parseValue()
      skip()
      if (text[i] === ',') { i++; continue }
      if (text[i] === '}') { i++; break }
    }
    return obj
  }
  const parseSeq = () => {
    const arr = []
    i++
    for (;;) {
      skip()
      if (i >= text.length) break
      if (text[i] === ']') { i++; break }
      arr.push(parseValue())
      skip()
      if (text[i] === ',') { i++; continue }
      if (text[i] === ']') { i++; break }
    }
    return arr
  }
  skip()
  return parseValue()
}

/** 标量:引号 / null / 布尔 / 数字 / 普通字符串。 */
function yamlParseScalar(text) {
  const t = String(text).trim()
  if (t === '') return null
  if (t.startsWith('{') || t.startsWith('[')) return yamlParseFlow(t)
  if (t.startsWith('"')) {
    try { return JSON.parse(t) } catch { return t.replace(/^"|"$/g, '') }
  }
  if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  if (t === 'null' || t === '~') return null
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'
  if (/^-?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t)
  return t
}

/** 拆 `key:` 与 `key: value`;找不到键分隔符返回 null。 */
function yamlSplitKey(content) {
  let quote = null
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (quote !== null) {
      if (ch === '\\' && quote === '"') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === ':' && (i + 1 === content.length || content[i + 1] === ' ')) {
      const rawKey = content.slice(0, i).trim()
      const key = (rawKey.startsWith('"') || rawKey.startsWith("'")) ? String(yamlParseScalar(rawKey)) : rawKey
      return { key, rest: content.slice(i + 1).trim() }
    }
  }
  return null
}

function yamlParseMap(lines, start, indent) {
  const map = {}
  let i = start
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i]
    if (line.content === '-' || line.content.startsWith('- ')) break
    const split = yamlSplitKey(line.content)
    if (split === null) break
    if (split.rest !== '') {
      if (split.rest.startsWith('{') || split.rest.startsWith('[')) {
        const { text, next } = yamlFlowText(lines, i, split.rest)
        map[split.key] = yamlParseFlow(text)
        i = next
      } else {
        map[split.key] = yamlParseScalar(split.rest)
        i++
      }
      continue
    }
    const nextLine = lines[i + 1]
    if (nextLine !== undefined && nextLine.indent > indent) {
      const [child, next] = yamlParseBlock(lines, i + 1, nextLine.indent)
      map[split.key] = child
      i = next
    } else if (nextLine !== undefined && nextLine.indent === indent && (nextLine.content === '-' || nextLine.content.startsWith('- '))) {
      const [child, next] = yamlParseBlock(lines, i + 1, indent)
      map[split.key] = child
      i = next
    } else {
      map[split.key] = null
      i++
    }
  }
  return [map, i]
}

function yamlParseSeq(lines, start, indent) {
  const arr = []
  let i = start
  while (i < lines.length && lines[i].indent === indent && (lines[i].content === '-' || lines[i].content.startsWith('- '))) {
    const rest = lines[i].content === '-' ? '' : lines[i].content.slice(2).trim()
    if (rest === '') {
      const nextLine = lines[i + 1]
      if (nextLine !== undefined && nextLine.indent > indent) {
        const [child, next] = yamlParseBlock(lines, i + 1, nextLine.indent)
        arr.push(child); i = next
      } else {
        arr.push(null); i++
      }
      continue
    }
    const split = yamlSplitKey(rest)
    if (split !== null) {
      // `- key: value` 紧凑映射:把本行改写成更深一级的映射行后按映射解析
      const patched = lines.slice()
      patched[i] = { indent: indent + 2, content: rest }
      const [child, next] = yamlParseMap(patched, i, indent + 2)
      arr.push(child); i = next
      continue
    }
    if (rest.startsWith('{') || rest.startsWith('[')) {
      const { text, next } = yamlFlowText(lines, i, rest)
      arr.push(yamlParseFlow(text)); i = next
      continue
    }
    arr.push(yamlParseScalar(rest)); i++
  }
  return [arr, i]
}

function yamlParseBlock(lines, start, indent) {
  const line = lines[start]
  if (line.content === '-' || line.content.startsWith('- ')) return yamlParseSeq(lines, start, indent)
  if (line.content.startsWith('{') || line.content.startsWith('[')) {
    const { text, next } = yamlFlowText(lines, start, line.content)
    return [yamlParseFlow(text), next]
  }
  return yamlParseMap(lines, start, indent)
}

/** 解析 YAML 文本为 JS 值(见本节开头的支持范围)。 */
function parseYamlSubset(text) {
  const lines = []
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const stripped = yamlStripComment(raw)
    if (stripped.trim() === '') continue
    const content = stripped.trim()
    if (content === '---' || content === '...') continue
    lines.push({ indent: stripped.length - stripped.trimStart().length, content })
  }
  if (lines.length === 0) return {}
  const [value] = yamlParseBlock(lines, 0, lines[0].indent)
  return value
}

/** 标量输出:能裸写就裸写,否则 JSON 引号(YAML 双引号串兼容 JSON 转义)。 */
function yamlScalarText(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = String(value)
  if (/^[A-Za-z0-9_][A-Za-z0-9_+./-]*$/.test(text) && !/^(true|false|null|yes|no|on|off|~)$/i.test(text)) return text
  return JSON.stringify(text)
}

function yamlKeyText(key) {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) ? key : JSON.stringify(key)
}

/** 生成块式 YAML(标量数组写成流式 `[a, b]`,对象数组写成 `- key:` 紧凑块)。 */
function toYamlBlock(value, indent = 0) {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value.map((item) => {
      if (item !== null && typeof item === 'object') {
        const bodyLines = toYamlBlock(item, indent + 2).split('\n')
        const rest = bodyLines.length > 1 ? `\n${bodyLines.slice(1).join('\n')}` : ''
        return `${pad}- ${bodyLines[0].slice(indent + 2)}${rest}`
      }
      return `${pad}- ${yamlScalarText(item)}`
    }).join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return `${pad}{}`
    return entries.map(([key, item]) => {
      if (Array.isArray(item)) {
        if (item.length === 0) return `${pad}${yamlKeyText(key)}: []`
        if (item.every((x) => x === null || typeof x !== 'object')) {
          return `${pad}${yamlKeyText(key)}: [${item.map(yamlScalarText).join(', ')}]`
        }
        return `${pad}${yamlKeyText(key)}:\n${toYamlBlock(item, indent + 2)}`
      }
      if (item !== null && typeof item === 'object') {
        if (Object.keys(item).length === 0) return `${pad}${yamlKeyText(key)}: {}`
        return `${pad}${yamlKeyText(key)}:\n${toYamlBlock(item, indent + 2)}`
      }
      return `${pad}${yamlKeyText(key)}: ${yamlScalarText(item)}`
    }).join('\n')
  }
  return `${pad}${yamlScalarText(value)}`
}

// ── 模型配置表的读写与视图 ──────────────────────────────────────────────────
// 表的一行 = 一个**模型**,连它所属提供方的连接信息(协议 / 地址 / 凭证引用)一起存在行上。
// 不单独维护「提供方」实体:新建容器注入时按 (api, baseURL, apiKeyEnv) 自动归纳 ——
// 连接信息相同的模型合并成一个 `llm-pi-ai.providers.<route>`,模型进它的 models[]。


/** 字符串映射(请求头之类的键值对):只留字符串值。 */
function normalizeStringMap(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && key.trim() !== '') out[key.trim()] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** compat 开关映射:只留布尔/字符串值。 */
function normalizeCompat(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean' || typeof value === 'string') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 一行模型配置的规范化(未知字段丢弃;input 属高级字段,导入时原样保留)。 */
function normalizeModelEntry(raw) {
  const entry = {
    uid: typeof raw?.uid === 'string' && raw.uid !== '' ? raw.uid : randomUUID().slice(0, 8),
    id: typeof raw?.id === 'string' ? raw.id.trim() : '',
    name: typeof raw?.name === 'string' ? raw.name.trim() : '',
    api: typeof raw?.api === 'string' ? raw.api.trim() : '',
    baseURL: typeof raw?.baseURL === 'string' ? raw.baseURL.trim() : '',
    apiKeyEnv: typeof raw?.apiKeyEnv === 'string' ? raw.apiKeyEnv.trim() : '',
    label: typeof raw?.label === 'string' ? raw.label.trim() : '',
    routeHint: typeof raw?.routeHint === 'string' ? raw.routeHint.trim() : '',
  }
  const headers = normalizeStringMap(raw?.headers)
  if (headers) entry.headers = headers
  const compat = normalizeCompat(raw?.compat)
  if (compat) entry.compat = compat
  for (const key of ['contextWindow', 'maxTokens']) {
    const n = Number(raw?.[key])
    if (Number.isInteger(n) && n > 0) entry[key] = n
  }
  if (Array.isArray(raw?.input)) {
    const input = raw.input.filter((modality) => MODEL_MODALITIES.includes(modality))
    if (input.length > 0) entry.input = [...new Set(input)]
  }
  return entry
}

/**
 * 读某个容器里 pi-ai 内置目录的模型清单(`@earendil-works/pi-ai/dist/providers/data/<route>.json`)。
 * 目录按协议分组:`{ "openai-completions": { modelId: {...} }, ... }`。
 * @returns `{ api, models }`(api 为 null 表示该 route 的模型跨多个协议,无法用一条 settings route 表达),找不到返回 null。
 */
function resolveCatalogModels(containerDir, route) {
  const bases = [
    path.join(containerDir, 'profile', 'profiles', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'),
    path.join(containerDir, 'harness', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'),
  ]
  for (const base of bases) {
    const file = path.join(base, `${route}.json`)
    if (!fs.existsSync(file)) continue
    const raw = readJson(file, null)
    if (raw === null || typeof raw !== 'object') continue
    const groups = Array.isArray(raw) ? { '': raw } : raw
    const apis = Object.keys(groups).filter((key) => key !== '')
    const models = []
    for (const [api, group] of Object.entries(groups)) {
      const rows = Array.isArray(group) ? group : Object.values(group ?? {})
      for (const item of rows) {
        if (item === null || typeof item !== 'object' || typeof item.id !== 'string') continue
        const model = { id: item.id, api, baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '' }
        if (typeof item.name === 'string' && item.name !== '') model.name = item.name
        const context = Number(item.contextWindow)
        if (Number.isInteger(context) && context > 0) model.contextWindow = context
        const maxTokens = Number(item.maxTokens)
        if (Number.isInteger(maxTokens) && maxTokens > 0) model.maxTokens = maxTokens
        if (Array.isArray(item.input)) {
          const input = item.input.filter((m) => m === 'text' || m === 'image')
          if (input.length > 0) model.input = [...new Set(input)]
        }
        models.push(model)
      }
    }
    if (models.length === 0) continue
    const modelsByApi = {}
    for (const model of models) {
      if (modelsByApi[model.api] === undefined) modelsByApi[model.api] = []
      modelsByApi[model.api].push(model)
    }
    return { apis, models, modelsByApi }
  }
  return null
}

/** 把 provider 结构摊平成模型行(旧 v1 表迁移 / 从容器导入共用)。 */
function providersToModelEntries(providers) {
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return { entries: [], passthrough: [] }
  const entries = []
  const passthrough = []
  for (const [route, profile] of Object.entries(providers)) {
    const provider = profile ?? {}
    const models = Array.isArray(provider.models) ? provider.models : []
    if (models.length === 0) {
      // 目录内置 route(只声明端点/凭证,模型清单由 DSH 目录提供):原样保留,注入时照抄
      passthrough.push({ route, profile: provider })
      continue
    }
    for (const model of models) {
      entries.push(normalizeModelEntry({
        id: model?.id,
        name: model?.name,
        contextWindow: model?.contextWindow,
        maxTokens: model?.maxTokens,
        input: model?.input,
        api: provider.api,
        baseURL: provider.baseURL,
        apiKeyEnv: provider.apiKeyEnv,
        headers: provider.headers,
        compat: provider.compat,
        label: provider.displayName ?? route,
        routeHint: route,
      }))
    }
  }
  return { entries: entries.filter((entry) => entry.id), passthrough }
}

function normalizeModelConfig(raw) {
  let models = []
  if (Array.isArray(raw?.models)) models = raw.models.map(normalizeModelEntry).filter((entry) => entry.id)
  else if (Array.isArray(raw?.providers)) models = providersToModelEntries(Object.fromEntries(raw.providers.map((p) => [p.id, p]))).entries
  const cfg = {
    version: 2,
    models,
    defaultUid: typeof raw?.defaultUid === 'string' ? raw.defaultUid : '',
    passthrough: {},
    basics: { rawSections: {} },
    importedFrom: raw?.importedFrom && typeof raw.importedFrom === 'object' ? raw.importedFrom : null,
  }
  const rawSections = raw?.basics?.rawSections
  if (rawSections !== null && typeof rawSections === 'object' && !Array.isArray(rawSections)) {
    for (const [key, text] of Object.entries(rawSections)) {
      if (typeof text === 'string' && text.trim() !== '') cfg.basics.rawSections[key] = text
    }
  }
  if (raw !== null && raw.passthrough !== null && typeof raw.passthrough === 'object' && !Array.isArray(raw.passthrough)) {
    for (const [route, profile] of Object.entries(raw.passthrough)) {
      if (profile !== null && typeof profile === 'object' && !Array.isArray(profile)) cfg.passthrough[route] = profile
    }
  }
  if (!cfg.models.some((entry) => entry.uid === cfg.defaultUid)) cfg.defaultUid = cfg.models[0]?.uid ?? ''
  return cfg
}

function saveModelConfig(cfg) {
  fs.mkdirSync(path.dirname(MODEL_CONFIG_PATH()), { recursive: true })
  fs.writeFileSync(MODEL_CONFIG_PATH(), `${JSON.stringify(cfg, null, 2)}\n`)
}

function loadModelKeys() {
  const keys = readJson(MODEL_KEYS_PATH(), {})
  return (keys !== null && typeof keys === 'object' && !Array.isArray(keys)) ? keys : {}
}

function saveModelKeys(keys) {
  fs.mkdirSync(path.dirname(MODEL_KEYS_PATH()), { recursive: true })
  fs.writeFileSync(MODEL_KEYS_PATH(), `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(MODEL_KEYS_PATH(), 0o600)
}

/** 顶层配置段中不归模型表管的键(逐段原文保留,导入时不丢用户其他设置)。 */
const MODEL_MANAGED_SECTIONS = ['llm-pi-ai', 'agent-default-model']

function splitSectionsOutsideManaged(text) {
  const sections = {}
  for (const [key, block] of splitYamlTopLevel(text)) {
    if (MODEL_MANAGED_SECTIONS.includes(key)) continue
    sections[key] = block.trimEnd()
  }
  return sections
}

function defaultFromParsedSettings(parsed) {
  const def = parsed?.['agent-default-model']
  if (def === null || typeof def !== 'object') return null
  const provider = typeof def.provider === 'string' ? def.provider.trim() : ''
  const model = typeof def.model === 'string' ? def.model.trim() : ''
  return provider && model ? { provider, model } : null
}

/** 从 .credentials.yaml 解析结果里抽「环境变量名 → 值」(新版 refs 映射与旧版扁平布局都吃)。 */
function credentialRefValues(parsed) {
  const refs = parsed?.refs
  if (refs !== null && typeof refs === 'object' && !Array.isArray(refs)) {
    const out = {}
    for (const [key, value] of Object.entries(refs)) if (typeof value === 'string') out[key] = value
    return out
  }
  const out = {}
  for (const [key, value] of Object.entries(parsed ?? {})) {
    if (/^[A-Z][A-Z0-9_]*$/.test(key) && typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * 读取模型配置表。首次调用时若只有旧版整份模板(state/profile-template/),
 * 就地迁移成新表(旧文件保留,便于回退)。
 */
function loadModelConfig() {
  const raw = readJson(MODEL_CONFIG_PATH(), null)
  if (raw !== null && typeof raw === 'object') return normalizeModelConfig(raw)
  const migrated = migrateLegacyProfileTemplate()
  if (migrated) return migrated
  return normalizeModelConfig(null)
}

function migrateLegacyProfileTemplate() {
  if (!fs.existsSync(tplSettingsPath())) return null
  let parsed
  try {
    parsed = parseYamlSubset(fs.readFileSync(tplSettingsPath(), 'utf8'))
  } catch (error) {
    log(`旧模板迁移失败(将退回旧模板注入): ${error}`)
    return null
  }
  const settingsText = fs.readFileSync(tplSettingsPath(), 'utf8')
  const { entries, passthrough } = providersToModelEntries(parsed?.['llm-pi-ai']?.providers)
  const cfg = normalizeModelConfig({
    models: entries,
    passthrough: Object.fromEntries(passthrough.map((item) => [item.route, item.profile])),
    basics: { rawSections: splitSectionsOutsideManaged(settingsText) },
    importedFrom: { ...readJson(tplMetaPath(), {}), migratedFromLegacy: true },
  })
  saveModelConfig(cfg)
  let keyCount = 0
  if (fs.existsSync(tplRefsPath())) {
    let refs = {}
    try { refs = credentialRefValues(parseYamlSubset(fs.readFileSync(tplRefsPath(), 'utf8'))) } catch { refs = {} }
    const keys = loadModelKeys()
    for (const entry of cfg.models) {
      const value = entry.apiKeyEnv ? refs[entry.apiKeyEnv] : undefined
      if (typeof value === 'string' && value !== '') { keys[entry.apiKeyEnv] = value; keyCount++ }
    }
    if (keyCount > 0) saveModelKeys(keys)
  }
  ensurePlaceholderKeys(cfg, loadModelKeys())
  saveModelKeys(loadModelKeys())
  const sourceDefault = defaultFromParsedSettings(parsed)
  if (sourceDefault !== null) {
    const row = cfg.models.find((entry) => entry.id === sourceDefault.model)
    if (row) { cfg.defaultUid = row.uid; saveModelConfig(cfg) }
  }
  log(`已把旧初始配置模板迁移为模型配置表:${cfg.models.length} 个模型 / ${keyCount} 枚 API Key(旧文件保留)`)
  return cfg
}

/** 有没有 Authorization 头(有头就不需要密钥)。 */
function hasAuthHeaderProfile(profile) {
  const headers = profile?.headers
  return headers !== null && typeof headers === 'object'
    && (typeof headers.Authorization === 'string' || typeof headers.authorization === 'string')
}

/**
 * 兜底:没有 Authorization 头的行必须有一个凭据引用 —— 引用留空就按「提供方名称 / 端点主机」派生,
 * 这样同一提供方的模型才会归到同一组。**占位值不落库** —— 值是否补占位由注入开关
 * (skipFirstOpenPrompts)在生成 .credentials.yaml 时决定,保证 model-keys.json 里只有用户真填的 key。
 */
function ensurePlaceholderKeys(cfg, keys) {
  let changed = false
  for (const entry of cfg.models) {
    if (hasAuthHeaderProfile(entry)) continue
    if (entry.apiKeyEnv === '') {
      entry.apiKeyEnv = deriveKeyRef(entry.label || hostLabelOf(entry.baseURL) || entry.id)
      changed = true
    }
  }
  for (const [route, profile] of Object.entries(cfg.passthrough)) {
    if (hasAuthHeaderProfile(profile)) continue
    if (typeof profile.apiKeyEnv !== 'string' || profile.apiKeyEnv === '') {
      profile.apiKeyEnv = deriveKeyRef(route)
      changed = true
    }
  }
  return changed
}

function modelConfigHasContent(cfg) {
  return cfg.models.length > 0 || Object.keys(cfg.passthrough).length > 0 || Object.keys(cfg.basics.rawSections).length > 0
}

/** route 名:小写字母开头,非字母数字折成短横线(上游凭据名与 route 都吃这个规则)。 */
function slugifyRoute(text) {
  const slug = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug === '') return 'provider'
  return /^[a-z]/.test(slug) ? slug : `p-${slug}`
}

/** 没写提供方名称时,用端点主机名当分组名。 */
function hostLabelOf(baseURL) {
  try {
    const host = new URL(baseURL).hostname.replace(/^www\./, '')
    return host.split('.')[0] || host
  } catch {
    return ''
  }
}

/**
 * 按连接信息 (api, baseURL, apiKeyEnv) 把模型行归纳成提供方分组 —— 这就是
 * 「多个模型属于同一提供商时自动归纳」的实现。同组只写一个 providers 条目。
 * @returns `[{ route, displayName, api, baseURL, apiKeyEnv, models }]`
 */
function groupModelEntries(models) {
  const groups = new Map()
  const usedRoutes = new Set()
  for (const entry of models) {
    const key = [entry.api, entry.baseURL, entry.apiKeyEnv, JSON.stringify(entry.headers ?? {})].join('|')
    let group = groups.get(key)
    if (group === undefined) {
      const displayName = entry.label || hostLabelOf(entry.baseURL) || entry.id
      // 中文显示名 slug 后可能只剩空壳:退回导入时的原始 route 名,保证 route 稳定可读
      const slugged = slugifyRoute(displayName)
      let route = slugged === 'provider' && entry.routeHint ? slugifyRoute(entry.routeHint) : slugged
      let suffix = 2
      while (usedRoutes.has(route)) route = `${slugifyRoute(displayName)}-${suffix++}`
      usedRoutes.add(route)
      group = { route, displayName, api: entry.api, baseURL: entry.baseURL, apiKeyEnv: entry.apiKeyEnv, headers: entry.headers, compat: entry.compat, models: [] }
      groups.set(key, group)
    }
    const model = { id: entry.id }
    if (entry.name) model.name = entry.name
    if (entry.contextWindow) model.contextWindow = entry.contextWindow
    if (entry.maxTokens) model.maxTokens = entry.maxTokens
    if (entry.input) model.input = entry.input
    group.models.push(model)
  }
  return [...groups.values()]
}

function defaultModelEntry(cfg) {
  return cfg.models.find((entry) => entry.uid === cfg.defaultUid) ?? null
}

/** 给前端的视图:密钥只回显「是否已设置」,值绝不出库。 */
function modelConfigView() {
  const cfg = loadModelConfig()
  const keys = loadModelKeys()
  const groups = groupModelEntries(cfg.models)
  const groupOf = (entry) => groups.find((group) => group.models.some((model) => model.id === entry.id && group.baseURL === entry.baseURL && group.api === entry.api))
  const def = defaultModelEntry(cfg)
  const defGroup = def === null ? undefined : groupOf(def)
  return {
    models: cfg.models.map((entry) => ({
      ...entry,
      hasAuthHeader: typeof entry.headers?.Authorization === 'string' || typeof entry.headers?.authorization === 'string',
      apiKeySet: entry.apiKeyEnv !== '' && typeof keys[entry.apiKeyEnv] === 'string' && keys[entry.apiKeyEnv] !== '',
      route: groupOf(entry)?.route ?? '',
      providerLabel: groupOf(entry)?.displayName ?? '',
    })),
    defaultUid: cfg.defaultUid,
    defaultModel: def === null ? null : { provider: defGroup?.route ?? '', model: def.id, uid: def.uid },
    providers: groups.map((group) => ({
      route: group.route,
      displayName: group.displayName,
      api: group.api,
      baseURL: group.baseURL,
      apiKeyEnv: group.apiKeyEnv,
      modelCount: group.models.length,
      apiKeySet: group.apiKeyEnv !== '' && typeof keys[group.apiKeyEnv] === 'string' && keys[group.apiKeyEnv] !== '',
    })),
    passthrough: Object.entries(cfg.passthrough).map(([route, profile]) => ({
      route,
      displayName: typeof profile.displayName === 'string' && profile.displayName !== '' ? profile.displayName : route,
      apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : '',
      apiKeySet: typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv !== ''
        && typeof keys[profile.apiKeyEnv] === 'string' && keys[profile.apiKeyEnv] !== '',
    })),
    importedFrom: cfg.importedFrom,
    rawSectionKeys: Object.keys(cfg.basics.rawSections),
    presets: PROVIDER_PRESETS,
    protocols: PROVIDER_API_PROTOCOLS,
  }
}

/** 校验一行模型配置;返回错误文案或 null。 */
function validateModelEntry(entry) {
  if (entry.id === '') return '模型 ID 不能为空(要跟提供方暴露的模型名完全一致)'
  if (entry.api !== '' && !PROVIDER_API_PROTOCOLS.includes(entry.api)) return `API 协议只支持 ${PROVIDER_API_PROTOCOLS.join(' / ')}`
  if (entry.baseURL === '') {
    // 目录内置 route 可以只填模型 ID(端点与协议由 DSH 目录提供);填了地址才要求协议
    if (entry.api !== '') return null
  } else if (!/^https?:\/\/\S+$/.test(entry.baseURL)) {
    return 'API 地址必须是 http(s):// 开头的有效地址'
  } else if (!PROVIDER_API_PROTOCOLS.includes(entry.api)) {
    return `填了 API 地址就要选协议(${PROVIDER_API_PROTOCOLS.join(' / ')})`
  }
  if (entry.apiKeyEnv !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv)) return '凭据引用(环境变量名)只能包含字母/数字/下划线,且不以数字开头'
  for (const key of ['contextWindow', 'maxTokens']) {
    if (entry[key] !== undefined && (!Number.isInteger(entry[key]) || entry[key] <= 0)) return '上下文窗口与最大输出必须是正整数'
  }
  return null
}

/** 把模型配置表归纳成新建容器的 settings.yaml。 */
function buildInitialSettingsYaml(cfg, { confirmNotice = true } = {}) {
  // 开关开:导入/迁移没带 ui-onboarding 时补一段上游确认值(首开不弹测试版公告);
  // 开关关:**不做任何额外处理** —— 不添加,也不删掉已有的(没人会故意去开弹窗)
  const parts = Object.entries(cfg.basics.rawSections).map(([, text]) => text.trimEnd())
  if (confirmNotice && !Object.hasOwn(cfg.basics.rawSections, 'ui-onboarding')) {
    parts.unshift(`ui-onboarding:\n  welcomeNoticeVersion: ${yamlScalarText(ONBOARDING_NOTICE_VERSION)}`)
  }
  const groups = groupModelEntries(cfg.models)
  const providers = {}
  for (const group of groups) {
    const entry = {}
    if (group.displayName && group.displayName !== group.route) entry.displayName = group.displayName
    if (group.api) entry.api = group.api
    if (group.baseURL) entry.baseURL = group.baseURL
    if (group.apiKeyEnv) entry.apiKeyEnv = group.apiKeyEnv
    if (group.headers) entry.headers = group.headers
    if (group.compat) entry.compat = group.compat
    entry.models = group.models
    providers[group.route] = entry
  }
  // 目录内置 route(无模型清单)原样照抄;同名 route 以模型归纳结果为准
  for (const [route, profile] of Object.entries(cfg.passthrough)) {
    if (providers[route] === undefined) providers[route] = profile
  }
  if (Object.keys(providers).length > 0) {
    parts.push(`llm-pi-ai:\n  providers:\n${toYamlBlock(providers, 4)}`)
  }
  const def = defaultModelEntry(cfg)
  const defGroup = def === null ? undefined : groups.find((group) => group.models.some((model) => model.id === def.id))
  if (def !== null && defGroup !== undefined) {
    parts.push(`agent-default-model:\n  provider: ${yamlScalarText(defGroup.route)}\n  model: ${yamlScalarText(def.id)}`)
  }
  return parts.length > 0 ? `${parts.join('\n')}\n` : ''
}

/** 把密钥渲染成 .credentials.yaml 的扁平 refs(见 flatRefEntries 的新旧兼容说明)。 */
function buildCredentialEntryLines(cfg, keys, { fillPlaceholder = true } = {}) {
  const lines = []
  const seen = new Set()
  const refs = groupModelEntries(cfg.models).map((group) => group.apiKeyEnv)
  for (const profile of Object.values(cfg.passthrough)) {
    if (typeof profile.apiKeyEnv === 'string') refs.push(profile.apiKeyEnv)
  }
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref === '' || seen.has(ref)) continue
    const value = keys[ref]
    if (typeof value === 'string' && value !== '') {
      seen.add(ref)
      lines.push(`${ref}: ${yamlScalarText(value)}`)
    } else if (fillPlaceholder) {
      // 开关打开且用户没配 key:补占位值,让 pi-ai 有 key 可用(本地不校验;云端会是明确的 401)
      seen.add(ref)
      lines.push(`${ref}: ${yamlScalarText(PLACEHOLDER_KEY)}`)
    }
  }
  return lines
}

/**
 * 从某个容器一键导入:把它的 llm-pi-ai.providers 摊平成模型行,按
 * (模型 ID + API 地址 + 协议) 合并 —— 同一条更新、新的追加;密钥按 refs 取值入库。
 * @returns 摘要 `{ added, updated, passthrough, refKeys, source, defaultSet, defaultModel }`,或 `{ error }`。
 */
function importModelConfigFromContainer(containerId) {
  const cdir = path.join(CONTAINERS_DIR, String(containerId ?? ''))
  const settingsSrc = path.join(cdir, 'profile', 'settings.yaml')
  if (!containerId || !fs.existsSync(settingsSrc)) {
    return { error: '来源容器还没有 profile/settings.yaml(先启动并完成一次模型配置,或换一个已配置的容器)' }
  }
  const settingsText = fs.readFileSync(settingsSrc, 'utf8')
  let parsed
  try {
    parsed = parseYamlSubset(settingsText)
  } catch (error) {
    return { error: `解析来源容器 settings.yaml 失败: ${error}` }
  }
  const { entries, passthrough } = providersToModelEntries(parsed?.['llm-pi-ai']?.providers)
  if (entries.length === 0 && passthrough.length === 0) {
    return { error: '来源容器没有配置任何提供方' }
  }
  // 目录提供方(无模型清单)尽量摊平成模型行:只有**单协议**目录(或提供方自己声明了协议)才能
  // 用一条 settings route 表达;多协议 route(如 openrouter 同时有 anthropic-messages 与
  // openai-completions)在 settings.yaml 里无法表达,只能原样 passthrough。
  const keptPassthrough = []
  const expandedRoutes = []
  for (const item of passthrough) {
    const catalog = resolveCatalogModels(cdir, item.route)
    const declared = (item.profile.api ?? '').trim()
    let chosen = null
    if (catalog !== null) {
      if (declared !== '' && catalog.modelsByApi[declared] !== undefined) chosen = { api: declared, models: catalog.modelsByApi[declared] }
      else if (catalog.apis.length === 1) chosen = { api: catalog.apis[0], models: catalog.modelsByApi[catalog.apis[0]] }
    }
    if (chosen === null) { keptPassthrough.push(item); continue }
    for (const model of chosen.models) {
      entries.push(normalizeModelEntry({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        api: chosen.api,
        baseURL: (item.profile.baseURL ?? '') !== '' ? item.profile.baseURL : model.baseUrl,
        apiKeyEnv: item.profile.apiKeyEnv,
        headers: item.profile.headers,
        compat: item.profile.compat,
        label: item.profile.displayName ?? item.route,
        routeHint: item.route,
      }))
    }
    expandedRoutes.push(`${item.route}(${chosen.models.length})`)
  }
  const cfg = loadModelConfig()
  const keys = loadModelKeys()
  const added = []
  const updated = []
  for (const entry of entries) {
    const index = cfg.models.findIndex((row) => row.id === entry.id && row.baseURL === entry.baseURL && row.api === entry.api)
    if (index === -1) {
      cfg.models.push(entry)
      added.push(entry.id)
    } else {
      entry.uid = cfg.models[index].uid
      cfg.models[index] = entry
      updated.push(entry.id)
    }
  }
  for (const [key, text] of Object.entries(splitSectionsOutsideManaged(settingsText))) {
    cfg.basics.rawSections[key] = text
  }
  const credSrc = path.join(cdir, 'profile', '.credentials.yaml')
  let refs = {}
  if (fs.existsSync(credSrc)) {
    try { refs = credentialRefValues(parseYamlSubset(fs.readFileSync(credSrc, 'utf8'))) } catch { refs = {} }
  }
  const refKeys = []
  const wantedRefs = [...entries.map((entry) => entry.apiKeyEnv), ...passthrough.map((item) => item.profile.apiKeyEnv)]
  for (const ref of wantedRefs) {
    if (typeof ref !== 'string' || ref === '') continue
    const value = refs[ref]
    if (typeof value === 'string' && value !== '') {
      keys[ref] = value
      if (!refKeys.includes(ref)) refKeys.push(ref)
    }
  }
  const sourceDefault = defaultFromParsedSettings(parsed)
  let defaultSet = false
  if (sourceDefault !== null) {
    const matched = entries.find((entry) => entry.id === sourceDefault.model)
    const row = matched === undefined ? undefined : cfg.models.find((entry) => entry.id === matched.id && entry.baseURL === matched.baseURL)
    if (row !== undefined) { cfg.defaultUid = row.uid; defaultSet = true }
  }
  for (const item of keptPassthrough) cfg.passthrough[item.route] = item.profile
  ensurePlaceholderKeys(cfg, keys)
  const meta = readJson(path.join(cdir, 'container.json'), {})
  const source = meta.name ?? String(containerId)
  cfg.importedFrom = { containerId: String(containerId), containerName: source, at: nowSeconds() }
  saveModelKeys(keys)
  saveModelConfig(cfg)
  const def = defaultModelEntry(cfg)
  return {
    added,
    updated,
    passthrough: keptPassthrough.map((item) => item.route),
    expandedRoutes,
    refKeys,
    source,
    defaultSet,
    modelCount: cfg.models.length,
    defaultModel: def === null ? null : { model: def.id },
  }
}

// 旧版「整份模板」信息的兼容视图:新表有内容时由模型配置表合成,
// 让仍在运行的旧插件客户端拿到形状一致的 { exists, capturedAt, source, sections, refKeys }。
function profileTemplateInfo() {
  const cfg = loadModelConfig()
  const keys = loadModelKeys()
  const groups = groupModelEntries(cfg.models)
  const sections = Object.keys(cfg.basics.rawSections)
  if (cfg.models.length > 0 || Object.keys(cfg.passthrough).length > 0) sections.push('llm-pi-ai')
  if (defaultModelEntry(cfg) !== null) sections.push('agent-default-model')
  const refKeys = groups.filter((group) => group.apiKeyEnv !== '').map((group) => group.apiKeyEnv)
  return {
    exists: modelConfigHasContent(cfg),
    capturedAt: cfg.importedFrom?.at ?? cfg.importedFrom?.capturedAt ?? null,
    source: cfg.importedFrom?.containerName ?? cfg.importedFrom?.source ?? null,
    sections,
    refKeys,
    modelCount: cfg.models.length,
    providerCount: groups.length,
    keyCount: refKeys.filter((ref) => typeof keys[ref] === 'string' && keys[ref] !== '').length,
  }
}

// 注入到新建容器:由模型配置表生成 settings.yaml(受管段 = llm-pi-ai.providers +
// agent-default-model,其余顶层段按原文保留)与 .credentials.yaml 的 refs(密钥值)。
// 创建期 profile 里这两个文件都还不存在,直接写入即可;若已存在则只替换受管部分。
function applyProfileTemplate(containerPath, line) {
  const cfg = loadModelConfig()
  if (!modelConfigHasContent(cfg)) {
    if (fs.existsSync(tplSettingsPath())) return applyLegacyProfileTemplate(containerPath, line)
    return
  }
  const profileDir = path.join(containerPath, 'profile')
  const skipPrompts = readSettings().skipFirstOpenPrompts !== false
  const settingsText = buildInitialSettingsYaml(cfg, { confirmNotice: skipPrompts })
  if (settingsText !== '') {
    fs.writeFileSync(path.join(profileDir, 'settings.yaml'), settingsText, { mode: 0o600 })
  }
  const keys = loadModelKeys()
  const entryLines = buildCredentialEntryLines(cfg, keys, { fillPlaceholder: skipPrompts })
  if (entryLines.length > 0) {
    const credPath = path.join(profileDir, '.credentials.yaml')
    if (!fs.existsSync(credPath)) {
      // 扁平布局新旧通吃(见 flatRefEntries 注释)
      fs.writeFileSync(credPath, `${entryLines.join('\n')}\n`, { mode: 0o600 })
    } else {
      const sections = splitYamlTopLevel(fs.readFileSync(credPath, 'utf8'))
      sections.delete('refs')
      const composed = [...sections.values()].join('\n').replace(/\n+$/, '')
      fs.writeFileSync(credPath, `${composed ? `${composed}\n` : ''}refs: { ${entryLines.join(', ')} }\n`, { mode: 0o600 })
    }
  }
  const groups = groupModelEntries(cfg.models)
  const def = defaultModelEntry(cfg)
  const defGroup = def === null ? undefined : groups.find((group) => group.models.some((model) => model.id === def.id))
  line(`已注入模型配置:${cfg.models.length} 个模型,自动归纳为 ${groups.length} 个提供方${def !== null ? `;默认模型 ${defGroup?.route ?? ''} / ${def.id}` : ''}${entryLines.length > 0 ? `;API Key(${entryLines.map((entry) => entry.split(':')[0]).join(' / ')})` : ''}`)
}

// 旧版整份模板注入(仅当模型配置表为空、且旧模板文件仍在时作为兜底)
function applyLegacyProfileTemplate(containerPath, line) {
  const info = { sections: [], refKeys: [] }
  const profileDir = path.join(containerPath, 'profile')
  fs.copyFileSync(tplSettingsPath(), path.join(profileDir, 'settings.yaml'))
  fs.chmodSync(path.join(profileDir, 'settings.yaml'), 0o600)
  info.sections = [...splitYamlTopLevel(fs.readFileSync(tplSettingsPath(), 'utf8')).keys()]
  if (fs.existsSync(tplRefsPath())) {
    const refsBlock = fs.readFileSync(tplRefsPath(), 'utf8').trimEnd()
    const credPath = path.join(profileDir, '.credentials.yaml')
    const entries = flatRefEntries(refsBlock)
    if (entries.length > 0 && !fs.existsSync(credPath)) {
      fs.writeFileSync(credPath, `${entries.map((entry) => entry.line).join('\n')}\n`, { mode: 0o600 })
    } else {
      const base = fs.existsSync(credPath) ? fs.readFileSync(credPath, 'utf8') : 'version: 1\nrecords: {}\n'
      const sections = splitYamlTopLevel(base)
      sections.delete('refs')
      const composed = [...sections.values()].join('\n').replace(/\n+$/, '')
      fs.writeFileSync(credPath, (composed ? `${composed}\n` : '') + `${refsBlock}\n`, { mode: 0o600 })
    }
    for (const entry of entries) info.refKeys.push(entry.key)
  }
  line(`已注入初始配置(旧模板): ${info.sections.join(' / ')}${info.refKeys.length ? `;API Key(${info.refKeys.join(' / ')})` : ''}`)
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

// ── 新容器默认工作区 ────────────────────────────────────────────────────────
// 目录放在容器内(随容器一起删除),并在 DSH 的 workspace 存储单元(schema version 2,
// 形态照抄运行中实例)里预注册为唯一工作区 —— 首次打开 WebUI 即落在该工作区,
// 无需手动选择,方便 agent 建完容器直接开工测试。
function createDefaultWorkspace(containerPath, containerName) {
  const workspaceDir = path.join(containerPath, 'workspace')
  fs.mkdirSync(workspaceDir, { recursive: true })
  fs.writeFileSync(
    path.join(workspaceDir, 'README.md'),
    `# ${containerName} 默认工作区\n\n本目录是容器「${containerName}」的 DSH 默认工作区,随容器一起删除(整目录在容器内)。\n创建它的目的:agent/用户建完容器即可在此直接开工测试,无需再手动选择工作区。\n`,
  )
  const storagesDir = path.join(containerPath, 'profile', 'storages')
  fs.mkdirSync(storagesDir, { recursive: true })
  fs.chmodSync(storagesDir, 0o700)
  const now = new Date().toISOString()
  const id = randomUUID()
  const storage = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [] },
    tables: {
      workspaces: {
        [id]: {
          path: workspaceDir,
          title: containerName,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }
  fs.writeFileSync(path.join(storagesDir, 'workspace.json'), JSON.stringify(storage, null, 2), { mode: 0o600 })
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
  const env = withRuntimePath({ ...process.env }, runtimeDir())
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']) {
    delete env[key]
  }
  env.DSH_HOME = profileHome
  env.NODE_PATH = PLUGINS_NM
  env.CHOKIDAR_USEPOLLING = 'true'
  return env
}

// ★ sinceBytes 是字节偏移(来自 statSync().size):必须先用 Buffer 按字节切片
// 再解码。若写成 readFileSync(path,'utf8').slice(sinceBytes),就是拿字节偏移当
// 字符下标——日志一旦含非 ASCII(→ ← µ 或中文),字符数 < 字节数,切片起点会
// 向后多吃若干字符,恰好切掉新公告行的 "dsh web: " 前缀 → 匹配失败,启动探测
// 退化成 15s「等公告行」超时(2026-09-11 实测:DshPlugin_Dev 启动 4s → 20s)
function announceFromLog(logPath, sinceBytes) {
  try {
    const text = fs.readFileSync(logPath).subarray(sinceBytes).toString('utf8')
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
  // 清理上次失败遗留的 host 进程(超时保留现场的进程):POSIX 按进程组,Windows 按进程树
  const stale = readHostRecord(id)
  if (stale && recordAlive(stale)) {
    await killTree(Math.abs(Number(stale.pid ?? stale.pgid)), { force: true })
    await sleep(300)
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
  // 启动后就绪时是否自动打开浏览器由设置决定:上游 web-startup 插件解析主命令行的
  // --no-open(设置开=默认弹带 token 标签;dshdock 不代开,避免与上游弹窗重复)
  const child = spawn(nodeBin(), [
    '--import', 'tsx/esm',
    'apps/cli/src/bin.ts',
    '--profile', container.profile,
    '--patch', webPatch,
    ...(readSettings().autoOpenUiOnStart === false ? ['--no-open'] : []),
  ], {
    cwd: harnessDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: dshHostEnv(path.join(dir, 'profile')),
    windowsHide: true,
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
      // 同样按字节切片:B 偏移当字符下标会因非 ASCII 日志错位
      const tail = fs.existsSync(logPath) ? fs.readFileSync(logPath).subarray(offset).toString('utf8').trim().split('\n').slice(-8).join('\n') : ''
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

// 该容器的 host 进程是否还活着:
// POSIX 探测整个进程组(kill(-pgid,0),组内主进程死了子进程可能还在);
// Windows 没有进程组语义,只能按 pid 探测(终止时用 taskkill /T 处理整棵树)。
function recordAlive(record) {
  const target = aliveProbeTarget(record)
  if (target === undefined) return false
  try {
    process.kill(target, 0)
    return true
  } catch {
    return false
  }
}

async function stopContainer(id) {
  const running = runningHosts.get(id)
  const record = readHostRecord(id) ?? {}
  const live = running ?? record
  const pid = Math.abs(Number(live.pid ?? record.pid ?? 0))
  if (pid > 0 && recordAlive(live)) {
    await killTree(pid, { force: false })
    const deadline = Date.now() + STOP_GRACE_MS
    while (Date.now() < deadline && recordAlive(live)) {
      await sleep(100)
    }
    if (recordAlive(live)) {
      await killTree(pid, { force: true })
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

// ── 容器创建(新建 与 从配置库创建 共用同一条流水线) ────────────────────────
/**
 * 建容器记录并启动创建任务。
 * @param input.name - 容器名
 * @param input.version - 已安装版本 tag
 * @param input.profile - web / headless
 * @param input.config - 可选:`{ id, mode }`,把 profile 换成配置库条目的拷贝/软链
 * @returns 容器 id
 * @throws 校验失败(由调用方转成 400)
 */
function beginContainerCreate({ name, version, profile = 'web', config = null }) {
  if (!isSafeName(name)) throw new Error('容器名只能包含字母、数字、点、下划线、连字符(≤64字符)')
  if (!profileTemplateBundlesSafe(profile)) throw new Error('profile 仅支持 web / headless')
  const versionDir = path.join(VERSIONS_DIR, version, 'harness')
  if (!fs.existsSync(path.join(versionDir, 'package.json'))) throw new Error(`版本未安装: ${version}`)
  if (listContainerIds().some((id) => readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {}).name === name)) {
    throw new Error('同名容器已存在')
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
    throw error
  }
  saveContainer(id, {
    id, name, version, profile, port, createdAt: nowSeconds(),
    ...(config === null ? {} : { configFile: config.name, configSavedAt: nowSeconds() }),
  })

  runTask('container-create', id, `创建容器 ${name}`, async ({ line, task }) => {
    await ensureVersionPrebuilt(versionDir, line, task)
    line('复制版本源码(含共享构建产物,排除 node_modules)...')
    await copyHarness(versionDir, path.join(containerPath, 'harness'))
    allowAllBuilds(path.join(containerPath, 'harness'))
    if (config !== null) {
      // 从配置创建:profile 来自配置文件里的 home/(复制语义 —— 此后与配置文件、与源容器各自独立)
      if (!fs.existsSync(config.file)) throw `配置文件不存在: ${config.file}`
      line(`从配置文件恢复 DSH 配置(${config.file})...`)
      const facts = extractConfigHome(config.file, path.join(containerPath, 'profile'))
      line(`已恢复 ${facts.files} 个文件 / ${facts.sessions} 个会话,跳过初始配置注入与默认工作区`)
    } else {
      line('生成 profile 骨架...')
      createProfileSkeleton(containerPath, profile)
      // 新容器初始配置:模型配置表有内容就注入(settings.yaml + 凭据 refs),首次打开无弹窗
      if (modelConfigHasContent(loadModelConfig()) || fs.existsSync(tplSettingsPath())) {
        line('注入新容器初始配置(模型配置表)...')
        applyProfileTemplate(containerPath, line)
      }
      line('创建默认工作区(随容器删除,首次打开免选工作区)...')
      createDefaultWorkspace(containerPath, name)
    }
    line('安装容器依赖...')
    await pnpmInstall(path.join(containerPath, 'harness'), task)
    // 保险丝:共享产物意外缺失(如版本层构建曾失败)时,回退容器内构建
    if (!fs.existsSync(path.join(containerPath, 'harness', CLIENT_BUILD_RECORD))) {
      line('共享构建产物缺失,回退容器内构建...')
      await pnpmBuild(path.join(containerPath, 'harness'), task)
    }
    line('容器创建完成')
    // 自动保存开关开启时,顺手保存一份初始配置(失败不影响创建结果)
    if (readSettings().configAutoSave) {
      try {
        const entry = saveContainerConfig(id, { reason: 'created' })
        line(`已自动保存配置: ${entry.file}`)
      } catch (error) {
        line(`自动保存配置失败(不影响创建): ${String(error?.message ?? error)}`)
      }
    }
  }).catch(async (error) => {
    // 创建失败:清理半成品(removeEntrySafely 保证不会下钻软链目标)
    try {
      if (runningHosts.has(id)) await stopContainer(id)
      if (isSymlink(fs, path.join(containerPath, 'profile'))) removeEntrySafely(fs, path.join(containerPath, 'profile'))
      fs.rmSync(containerPath, { recursive: true, force: true })
    } catch {}
    log(`容器 ${name} 创建失败: ${error}`)
  })
  return id
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
      // 未传字段时保留现值(避免仅改其他设置的调用把开关悄悄关掉)
      autoOpenUiOnStart: body.autoOpenUiOnStart === undefined ? readSettings().autoOpenUiOnStart : !!body.autoOpenUiOnStart,
      skipFirstOpenPrompts: body.skipFirstOpenPrompts === undefined ? readSettings().skipFirstOpenPrompts : !!body.skipFirstOpenPrompts,
      configAutoSave: body.configAutoSave === undefined ? readSettings().configAutoSave : !!body.configAutoSave,
      configDir: body.configDir === undefined ? readSettings().configDir : String(body.configDir).trim(),
    })
    return send(200, readSettings())
  }

  // ── 模型配置表:一行 = 一个模型,注入时按连接信息自动归纳成提供方 ──
  if (route === 'GET /api/model-configs') {
    return send(200, modelConfigView())
  }
  if (route === 'DELETE /api/model-configs') {
    saveModelKeys({})
    saveModelConfig(normalizeModelConfig(null))
    log('已清空模型配置表')
    return send(200, modelConfigView())
  }
  if (route === 'POST /api/model-configs/import') {
    const { containerId } = await readJsonBody(request)
    const result = importModelConfigFromContainer(containerId)
    if (result.error) return send(400, { error: result.error })
    log(`从容器 ${result.source} 导入模型配置:新增 ${result.added.length} / 更新 ${result.updated.length} 个模型${result.refKeys.length > 0 ? `,API Key ${result.refKeys.length} 枚` : ''}`)
    return send(200, { ...modelConfigView(), import: result })
  }
  if (route === 'POST /api/model-configs/default') {
    const { uid } = await readJsonBody(request)
    const cfg = loadModelConfig()
    if (!cfg.models.some((entry) => entry.uid === uid)) return send(400, { error: '默认模型必须来自表里已有的模型' })
    cfg.defaultUid = String(uid)
    saveModelConfig(cfg)
    log(`模型配置表:默认模型 → ${defaultModelEntry(cfg)?.id ?? ''}`)
    return send(200, modelConfigView())
  }
  const passRowMatch = url.pathname.match(/^\/api\/model-configs\/passthrough\/([^/]+)$/)
  if (passRowMatch && request.method === 'DELETE') {
    const route = decodeURIComponent(passRowMatch[1])
    const cfg = loadModelConfig()
    if (cfg.passthrough[route] === undefined) return send(404, { error: `目录提供方不存在: ${route}` })
    delete cfg.passthrough[route]
    saveModelConfig(cfg)
    log(`模型配置表:删除目录提供方 ${route}`)
    return send(200, modelConfigView())
  }
  const modelRowMatch = url.pathname.match(/^\/api\/model-configs\/models\/([^/]+)$/)
  if (modelRowMatch && request.method === 'PUT') {
    const targetUid = decodeURIComponent(modelRowMatch[1])
    const body = await readJsonBody(request)
    const cfg = loadModelConfig()
    const index = targetUid === 'new' ? -1 : cfg.models.findIndex((entry) => entry.uid === targetUid)
    if (targetUid !== 'new' && index === -1) return send(404, { error: `模型配置不存在: ${targetUid}` })
    // 以旧行为底、界面提交的字段覆盖其上:界面没暴露的 input / routeHint 等高级字段原样保留
    const previous = index === -1 ? {} : cfg.models[index]
    const entry = normalizeModelEntry({ ...previous, ...(body.model ?? {}), uid: index === -1 ? undefined : previous.uid })
    const invalid = validateModelEntry(entry)
    if (invalid) return send(400, { error: invalid })
    if (index === -1) cfg.models.push(entry)
    else cfg.models[index] = entry
    const keys = loadModelKeys()
    // 先补引用(ensurePlaceholderKeys 会按名称派生 apiKeyEnv),再存用户填的密钥 ——
    // 顺序反了会把用户刚填的 key 静默丢掉(实测踩到过)
    ensurePlaceholderKeys(cfg, keys)
    if (typeof body.apiKey === 'string' && entry.apiKeyEnv !== '') {
      if (body.apiKey === '') delete keys[entry.apiKeyEnv]
      else keys[entry.apiKeyEnv] = body.apiKey
    }
    if (!cfg.models.some((row) => row.uid === cfg.defaultUid)) cfg.defaultUid = entry.uid
    saveModelKeys(keys)
    saveModelConfig(cfg)
    log(`模型配置表:保存模型 ${entry.id}(${entry.baseURL})`)
    return send(200, modelConfigView())
  }
  if (modelRowMatch && request.method === 'DELETE') {
    const targetUid = decodeURIComponent(modelRowMatch[1])
    const cfg = loadModelConfig()
    const index = cfg.models.findIndex((entry) => entry.uid === targetUid)
    if (index === -1) return send(404, { error: `模型配置不存在: ${targetUid}` })
    const [removed] = cfg.models.splice(index, 1)
    if (cfg.defaultUid === removed.uid) cfg.defaultUid = cfg.models[0]?.uid ?? ''
    saveModelConfig(cfg)
    log(`模型配置表:删除模型 ${removed.id}`)
    return send(200, modelConfigView())
  }

  // ── 旧接口兼容(仍在运行的旧插件客户端):读写都代理到模型配置表 ──
  if (route === 'GET /api/profile-template') {
    return send(200, profileTemplateInfo())
  }
  if (route === 'POST /api/profile-template') {
    const { containerId } = await readJsonBody(request)
    const result = importModelConfigFromContainer(containerId)
    if (result.error) return send(400, { error: result.error })
    log(`旧接口导入初始配置: 来源 ${result.source} → 模型配置表(新增 ${result.added.length} / 更新 ${result.updated.length})`)
    return send(200, profileTemplateInfo())
  }
  if (route === 'DELETE /api/profile-template') {
    saveModelKeys({})
    saveModelConfig(normalizeModelConfig(null))
    fs.rmSync(PROFILE_TEMPLATE_DIR(), { recursive: true, force: true })
    log('已清空模型配置表(含旧模板文件)')
    return send(200, { ok: true })
  }

  // 版本目录
  if (route === 'GET /api/versions/catalog') {
    const cache = readJson(CATALOG_PATH, null)
    const installed = installedVersions()
    if (cache && url.searchParams.get('refresh') !== '1') {
      return send(200, { fetchedAt: cache.fetchedAt, tags: cache.tags, installed, repo: HARNESS_REPO })
    }
    try {
      const tags = await fetchCatalogFromGithub()
      const notes = await fetchReleaseNotes().catch((error) => {
        logDetail(`版本更新说明拉取失败(沿用缓存): ${error}`)
        return notesFromTags(cache?.tags)
      })
      const merged = mergeReleaseNotes(tags, notes)
      writeJson(CATALOG_PATH, { fetchedAt: nowSeconds(), tags: merged })
      return send(200, { fetchedAt: nowSeconds(), tags: merged, installed, repo: HARNESS_REPO })
    } catch (error) {
      if (cache) return send(200, { fetchedAt: cache.fetchedAt, tags: cache.tags, installed, warning: `刷新失败,使用缓存: ${error}`, repo: HARNESS_REPO })
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
    // 收编来的版本可能是软链(harness → 外部检出):只删链接,源目录不动
    const marker = readJson(path.join(VERSIONS_DIR, tag, 'version.json'), null)
    const linkedHarness = isSymlink(fs, path.join(VERSIONS_DIR, tag, 'harness'))
    if (linkedHarness) removeEntrySafely(fs, path.join(VERSIONS_DIR, tag, 'harness'))
    fs.rmSync(path.join(VERSIONS_DIR, tag), { recursive: true, force: true })
    if (linkedHarness) log(`版本 ${tag} 已移除(软链,源目录未受影响${marker?.source ? `: ${marker.source}` : ''})`)
    return send(200, { ok: true, sourceUntouched: linkedHarness })
  }

  // ── 外部 DSH:只读检测 / 告知 ──────────────────────────────────────────────
  // 用户可能在 DSH Dock 之外已有 DSH(官方 ~/.dsh、npx/全局安装、源码检出、正在跑的实例)。
  // DSHBox **不接管**它们、也不建立任何链接:这里只负责把事实读出来告诉用户;
  // 要不要把某份配置保存成配置文件,由用户自己点按钮决定(POST /api/configs + sourcePath)。
  if (route === 'GET /api/external') {
    // ★ 必须把「自己的容器/版本目录与端口」交给检测层过滤,否则服务进程继承的
    //   DSH_HOME(就是本容器 profile)会被当成外部 DSH —— 这正是之前的检测 bug。
    const discovered = discoverExternal({
      homedir: os.homedir(),
      managed: {
        containersDir: CONTAINERS_DIR,
        versionsDir: VERSIONS_DIR,
        ports: new Set(listContainerIds().map((id) => {
          const meta = readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {})
          return meta.port
        }).filter((port) => port !== undefined && port !== null)),
      },
    })
    return send(200, {
      ...discovered,
      officialHome: path.join(os.homedir(), '.dsh'),
      configDir: CONFIG_STORE(),
      configAutoSave: readSettings().configAutoSave === true,
      containers: listContainerIds().map((id) => {
        const meta = readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {})
        return {
          id,
          name: meta.name ?? id,
          status: containerStatus(id),
          /** 该容器是否由某个配置文件创建而来 */
          configFile: meta.configFile ?? null,
        }
      }),
    })
  }

  // 校验一个路径:是 DSH 配置目录还是 harness 检出,以及事实与风险
  if (route === 'POST /api/external/check') {
    const { path: target } = await readJsonBody(request)
    const resolved = String(target ?? '').trim()
    if (!resolved || !path.isAbsolute(resolved)) return send(400, { error: '需要绝对路径(例如 /home/you/.dsh)' })
    if (!fs.existsSync(resolved)) return send(404, { error: `路径不存在: ${resolved}` })
    const home = homeFacts(fs, resolved)
    const harness = harnessFacts(fs, resolved)
    const usage = homeUsage(resolved)
    return send(200, {
      path: resolved,
      isHome: home.isHome,
      home,
      isHarness: harness.isHarness,
      harness,
      usage,
      /** 适合当成“版本”还是“配置”:两者都给,由界面决定 */
      suggestion: home.isHome ? 'config' : (harness.isHarness ? 'version' : null),
    })
  }

  // 把外部 harness 检出登记为 DSHBox 版本(link 默认:源保持唯一真相,删版本只删链接)
  // ── 配置:保存为单个配置文件 / 从配置创建 / 上传 / 下载 / 删除 ──────────────
  // 一个配置文件 = 一个自包含文件(meta.json + home/);恢复只需要提供它。
  if (route === 'GET /api/configs') {
    const dir = CONFIG_STORE()
    const items = listConfigFiles()
      .map((file) => configItem(file))
      .sort((a, b) => (b.createdAt ?? b.modifiedAt ?? 0) - (a.createdAt ?? a.modifiedAt ?? 0))
    return send(200, {
      dir,
      autoSave: readSettings().configAutoSave === true,
      items,
    })
  }

  // 保存配置:容器(默认全部)或用户指定的外部 home → 打包成一个配置文件
  if (route === 'POST /api/configs') {
    const body = await readJsonBody(request).catch(() => ({}))
    const sourcePathRaw = String(body.sourcePath ?? '').trim()
    if (sourcePathRaw.length > 0) {
      const sourcePath = path.resolve(sourcePathRaw)
      if (!fs.existsSync(sourcePath)) return send(400, { error: `源路径不存在: ${sourcePath}` })
      if (sourcePath === CONFIG_STORE() || sourcePath.startsWith(`${CONFIG_STORE()}${path.sep}`)) {
        return send(400, { error: '源不能是配置目录自身' })
      }
      const facts = homeFacts(fs, sourcePath)
      if (!facts.isHome) {
        return send(400, { error: '这不是一个 DSH 配置目录(需要 settings.yaml / sessions / storages 等)' })
      }
      const usage = homeUsage(sourcePath)
      const plan = importPlan({ inUse: usage.inUse, acknowledged: !!body.acknowledge })
      if (!plan.ok) return send(400, { error: plan.reasons.join(';'), risks: plan.risks, steps: plan.steps })
      try {
        const entry = packConfigFrom(sourcePath, {
          name: String(body.name ?? '').trim() || path.basename(sourcePath),
          reason: 'import',
          note: `来自 ${sourcePath}`,
        })
        return send(200, { ok: true, file: entry.file, item: configItem(entry.file), risks: plan.risks })
      } catch (error) {
        return send(500, { error: String(error?.message ?? error) })
      }
    }
    const targets = body.containerId === undefined || body.containerId === ''
      ? listContainerIds()
      : [String(body.containerId)]
    if (targets.length === 0) return send(400, { error: '还没有容器可保存' })
    for (const id of targets) {
      if (!fs.existsSync(path.join(CONTAINERS_DIR, id, 'container.json'))) return send(404, { error: `容器不存在: ${id}` })
    }
    const created = []
    for (const id of targets) {
      try {
        created.push(saveContainerConfig(id, { reason: 'manual', note: String(body.note ?? '') }).file)
      } catch (error) {
        return send(500, { error: `保存 ${id} 失败: ${String(error?.message ?? error)}` })
      }
    }
    return send(200, { ok: true, created, items: listConfigFiles().map(configItem) })
  }

  // 上传配置文件(raw body;浏览器选择本地文件,或从别的机器拷过来)
  if (route === 'POST /api/configs/upload') {
    const raw = String(url.searchParams.get('filename') ?? '').trim()
    const safe = raw.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 96)
    const base = safe.length > 0 ? safe : `config-${Date.now()}`
    const target = configFilePath(base.endsWith(CONFIG_EXT) ? base : `${base}${CONFIG_EXT}`)
    fs.mkdirSync(CONFIG_STORE(), { recursive: true })
    // 边收边写盘:配置里可能带上百 MB 的会话/附件,不能整包堆在内存里
    const out = fs.createWriteStream(target)
    let total = 0
    let tooBig = false
    for await (const chunk of request) {
      total += chunk.length
      if (total > 2 * 1024 * 1024 * 1024) {
        tooBig = true
        break
      }
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
    }
    await new Promise((resolve) => out.end(resolve))
    if (tooBig) {
      fs.rmSync(target, { force: true })
      return send(413, { error: '配置文件过大(>2GB)' })
    }
    if (total === 0) {
      fs.rmSync(target, { force: true })
      return send(400, { error: '上传内容为空' })
    }
    try {
      const meta = readConfigMeta(target)
      writeConfigGuide()
      log(`配置文件已上传: ${path.basename(target)}(${meta.name})`)
      return send(200, { ok: true, file: path.basename(target), item: configItem(path.basename(target)) })
    } catch (error) {
      fs.rmSync(target, { force: true })
      return send(400, { error: `不是有效的 DSH Dock 配置文件: ${String(error?.message ?? error)}` })
    }
  }

  // 从配置创建:file = 配置目录里的文件名;path = 磁盘上任意位置(二选一)
  if (route === 'POST /api/configs/restore') {
    const body = await readJsonBody(request)
    const byPath = String(body.path ?? '').trim()
    const byFile = String(body.file ?? '').trim()
    const full = byPath.length > 0 ? path.resolve(byPath) : (byFile.length > 0 ? configFilePath(byFile) : '')
    if (!full || !fs.existsSync(full)) return send(404, { error: `配置文件不存在: ${byPath || byFile}` })
    let meta
    try {
      meta = readConfigMeta(full)
    } catch (error) {
      return send(400, { error: `不是有效的 DSH Dock 配置文件: ${String(error?.message ?? error)}` })
    }
    try {
      const id = beginContainerCreate({
        name: body.name,
        version: body.version ?? meta.version,
        profile: body.profile ?? meta.profile ?? 'web',
        config: { file: full, name: meta.name ?? path.basename(full) },
      })
      return send(200, { ok: true, id })
    } catch (error) {
      return send(400, { error: String(error?.message ?? error) })
    }
  }

  const configDownloadMatch = url.pathname.match(/^\/api\/configs\/([^/]+)\/download$/)
  if (configDownloadMatch && request.method === 'GET') {
    const file = path.basename(decodeURIComponent(configDownloadMatch[1]))
    const full = configFilePath(file)
    if (!fs.existsSync(full)) return send(404, { error: `配置文件不存在: ${file}` })
    response.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Length': fs.statSync(full).size,
    })
    fs.createReadStream(full).pipe(response)
    return
  }

  const configFileMatch = url.pathname.match(/^\/api\/configs\/([^/]+)$/)
  if (configFileMatch && request.method === 'DELETE') {
    const file = path.basename(decodeURIComponent(configFileMatch[1]))
    const full = configFilePath(file)
    if (!fs.existsSync(full)) return send(404, { error: `配置文件不存在: ${file}` })
    fs.rmSync(full, { force: true })
    writeConfigGuide()
    log(`配置文件已删除: ${file}`)
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
        autoStart: !!meta.autoStart,
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
    const { name, version, profile = 'web', configFile } = await readJsonBody(request)
    let config = null
    if (configFile !== undefined && configFile !== null && String(configFile).length > 0) {
      const file = configFilePath(String(configFile))
      if (!fs.existsSync(file)) return send(404, { error: `配置文件不存在: ${configFile}` })
      try {
        config = { file, name: readConfigMeta(file).name }
      } catch (error) {
        return send(400, { error: `不是有效的 DSH Dock 配置文件: ${String(error?.message ?? error)}` })
      }
    }
    try {
      return send(200, { ok: true, id: beginContainerCreate({ name, version, profile, config }) })
    } catch (error) {
      return send(400, { error: String(error?.message ?? error) })
    }
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

    // 自动启动开关:开启后 DSH Dock 服务启动时自动拉起该容器(持久化在 container.json)
    if (route === `POST /api/containers/${id}/autostart`) {
      const { enabled } = await readJsonBody(request)
      const container = getContainer(id)
      container.autoStart = !!enabled
      saveContainer(id, container)
      log(`容器 ${container.name} 自动启动: ${container.autoStart ? '开启' : '关闭'}`)
      return send(200, { ok: true, autoStart: container.autoStart })
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
      // 自动保存开启时,删除前存一份配置(删掉容器也不至于丢掉会话与凭据)
      if (readSettings().configAutoSave) {
        try {
          const entry = saveContainerConfig(id, { reason: 'pre-delete', note: '删除容器前' })
          log(`删除前已自动保存 ${delContainer.name} 的配置: ${entry.file}`)
        } catch (error) {
          log(`删除前自动保存失败(继续删除): ${String(error?.message ?? error)}`)
        }
      }
      // 保险:容器 profile 若是链接(历史遗留),先摘链接再删目录,绝不下钻到目标
      const profileDir = path.join(containerDir(id), 'profile')
      if (isSymlink(fs, profileDir)) removeEntrySafely(fs, profileDir)
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
        // 自动保存开启时,换 harness 之前先存一份(配置与旧版本一起可回退)
        if (readSettings().configAutoSave) {
          try {
            const entry = saveContainerConfig(id, { reason: 'pre-update', note: `更新到 ${version} 之前` })
            line(`更新前已自动保存配置: ${entry.file}`)
          } catch (error) {
            line(`自动保存配置失败(继续更新): ${String(error?.message ?? error)}`)
          }
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
  // 前端是本地静态单页,改完必须刷新即见:禁止浏览器缓存(否则用户会看到旧布局/旧逻辑)
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store, must-revalidate',
  })
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

// 启动时自动拉起开了「自动启动」开关的容器:与 devProtect 的接管互补 ——
// 接管管的是进程仍存活的,这里补上真正已经停掉的(如宿主机重启后)。
// 逐个启动:并发拉起多个 host 会争抢构建/探测资源;整段异步执行,不阻塞服务对外可用。
function autoStartContainers() {
  const meta = (id) => readJson(path.join(CONTAINERS_DIR, id, 'container.json'), {})
  const targets = listContainerIds().filter((id) => !runningHosts.has(id) && meta(id).autoStart === true)
  if (targets.length === 0) return
  log(`自动启动 ${targets.length} 个容器: ${targets.map((id) => meta(id).name ?? id).join(', ')}`)
  void (async () => {
    for (const id of targets) {
      if (runningHosts.has(id)) continue
      const name = meta(id).name ?? id
      try {
        await runTask('container-start', id, `自动启动 ${name}`, async ({ line }) => {
          line('服务启动:该容器开启了「自动启动」')
          const url = await startContainer(id)
          line(`就绪: ${url}`)
        })
      } catch (error) {
        log(`自动启动容器 ${name} 失败: ${String(error).split('\n')[0]}`)
      }
    }
  })()
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

// 每次服务启动后台拉取一次版本目录(尽力而为:失败保留旧缓存,不阻塞启动)
function refreshCatalogOnBoot() {
  fetchCatalogFromGithub()
    .then(async (tags) => {
      const cache = readJson(CATALOG_PATH, null)
      const notes = await fetchReleaseNotes().catch((error) => {
        logDetail(`启动时版本更新说明拉取失败(沿用缓存): ${error}`)
        return notesFromTags(cache?.tags)
      })
      const merged = mergeReleaseNotes(tags, notes)
      writeJson(CATALOG_PATH, { fetchedAt: nowSeconds(), tags: merged })
      const withNotes = merged.filter((tag) => tag.notes).length
      log(`版本目录已自动刷新(${tags.length} 个 tag,更新说明 ${withNotes} 条)`)
    })
    .catch((error) => log(`启动时版本目录自动刷新失败,沿用缓存: ${error}`))
}

server.listen(PORT, '127.0.0.1', () => {
  const resolved = resolveDataRoot()
  if (resolved.root) {
    initPaths(resolved.root)
    reconcileRunningHosts()
    autoStartContainers()
    refreshCatalogOnBoot()
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
