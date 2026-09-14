#!/usr/bin/env node
/**
 * 安装收尾(跨平台,由 install.sh / install.ps1 在备好 Node 之后调用)。
 *
 * 两个引导脚本只负责“把 Node 弄到 runtime/<平台>-<架构>/node”(POSIX 用 tar,
 * Windows 用 Expand-Archive);其余逻辑都在这里,只写一遍、且能在任意平台上测试:
 *   - 自带 pnpm:按 runtime-manifest.json 下载 + sha512 校验 + 解压 + 生成启动器
 *     (POSIX shim / Windows .cmd)
 *   - 部署目录配置 dataRoot(默认 = 安装目录,免去首次引导)
 *   - `dshdock` 命令(POSIX 软链到 app/run.sh;Windows 写 dshdock.cmd)
 *   - 启动服务并打印地址
 *
 * 用法:
 *   node app/setup.mjs [--data-root P] [--bin-dir P] [--port N] [--no-start]
 *                      [--runtime download|system] [--skip-verify]
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defaultConfigDir, envValue, isWindows, nodeEntry, pathSeparator, pnpmCmdShim, runtimePathEntries, runtimeTarget } from './platform.mjs'

const APP_DIR = path.dirname(fileURLToPath(import.meta.url))
const INSTALL_DIR = path.dirname(APP_DIR)

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}
const DATA_ROOT = path.resolve(option('--data-root', INSTALL_DIR))
const BIN_DIR = path.resolve(option('--bin-dir', isWindows() ? path.join(INSTALL_DIR, 'bin') : path.join(os.homedir(), '.local', 'bin')))
const PORT = Number(option('--port', process.env.DSHWEB_PORT || 7940))
const RUNTIME_MODE = option('--runtime', 'download')
const DO_START = !flag('--no-start')
const SKIP_VERIFY = flag('--skip-verify')

const TARGET = runtimeTarget()
const RUNTIME_DIR = path.join(INSTALL_DIR, 'runtime', TARGET)
const MANIFEST = path.join(INSTALL_DIR, 'runtime', 'linux-x64', 'runtime-manifest.json')

const info = (message) => process.stdout.write(`${message}\n`)
const warn = (message) => process.stderr.write(`⚠️  ${message}\n`)
function die(message) {
  process.stderr.write(`✗ ${message}\n`)
  process.exit(1)
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch {
    return {}
  }
}

// ── Node(引导脚本应当已就位) ───────────────────────────────────────────────
const NODE_BIN = nodeEntry(RUNTIME_DIR)

function ensureNode() {
  if (fs.existsSync(NODE_BIN)) return
  if (RUNTIME_MODE === 'system') {
    fs.mkdirSync(path.dirname(NODE_BIN), { recursive: true })
    try {
      fs.symlinkSync(process.execPath, NODE_BIN)
    } catch {
      fs.copyFileSync(process.execPath, NODE_BIN)
    }
    info(`▸ 复用当前 Node: ${process.execPath}`)
    return
  }
  die(`自带运行时缺少 Node: ${NODE_BIN}\n  请让引导脚本下载(install.sh / install.ps1),或用 --runtime system`)
}

// ── pnpm ────────────────────────────────────────────────────────────────────
const PNPM_CJS = path.join(RUNTIME_DIR, 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

function verifySha512(file, expectedBase64) {
  if (SKIP_VERIFY || !expectedBase64) return
  const actual = createHash('sha512').update(fs.readFileSync(file)).digest('base64')
  if (actual !== expectedBase64) die(`pnpm 校验失败(期望 sha512-${expectedBase64},实际 sha512-${actual})`)
  info('  ✓ pnpm sha512 校验通过')
}

function fetchTo(url, out) {
  const script = [
    "const { writeFileSync } = require('node:fs')",
    `fetch(${JSON.stringify(url)}, { redirect: 'follow' })`,
    "  .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer() })",
    `  .then((b) => { writeFileSync(${JSON.stringify(out)}, Buffer.from(b)); process.exit(0) })`,
    "  .catch((e) => { process.stderr.write(String(e.message)); process.exit(1) })",
  ].join('\n')
  execFileSync(process.execPath, ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 900_000 })
}

function writePnpmLaunchers() {
  const pnpmDir = path.join(RUNTIME_DIR, 'pnpm')
  fs.mkdirSync(path.join(pnpmDir, 'bin'), { recursive: true })
  const shim = [
    '#!/bin/sh',
    'exec "$(dirname "$0")/../node/bin/node" "$(dirname "$0")/node_modules/pnpm/bin/pnpm.cjs" "$@"',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(pnpmDir, 'pnpm'), shim, { mode: 0o755 })
  fs.writeFileSync(path.join(pnpmDir, 'bin', 'pnpm'), shim, { mode: 0o755 })
  // Windows:harness 构建脚本里裸 `pnpm` 需要 .cmd 才能被 shell 解析
  fs.writeFileSync(path.join(pnpmDir, 'pnpm.cmd'), pnpmCmdShim())
  fs.writeFileSync(path.join(pnpmDir, 'bin', 'pnpm.cmd'), pnpmCmdShim())
  try {
    fs.chmodSync(path.join(pnpmDir, 'pnpm'), 0o755)
  } catch {}
}

function ensurePnpm() {
  const manifest = readManifest()
  const version = manifest.pnpmVersion || '11.7.0'
  if (fs.existsSync(PNPM_CJS)) {
    info(`▸ 自带 pnpm 已就绪(${version})`)
    writePnpmLaunchers()
    return
  }
  const registries = [process.env.NPM_REGISTRY_MIRROR, 'https://registry.npmmirror.com', 'https://registry.npmjs.org'].filter(Boolean)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dshdock-pnpm-'))
  const tgz = path.join(tmp, `pnpm-${version}.tgz`)
  let downloaded = false
  for (const registry of registries) {
    try {
      info(`▸ 下载 pnpm ${version}(${registry})`)
      fetchTo(`${registry}/pnpm/-/pnpm-${version}.tgz`, tgz)
      downloaded = true
      break
    } catch (error) {
      warn(`镜像不可用(${registry}):${error.message}`)
    }
  }
  if (!downloaded) die('pnpm 下载失败;可用 NPM_REGISTRY_MIRROR 指定镜像')
  verifySha512(tgz, manifest.pnpmVersion === version ? manifest.pnpmIntegrity?.replace(/^sha512-/, '') : undefined)

  fs.mkdirSync(path.join(RUNTIME_DIR, 'pnpm', 'node_modules'), { recursive: true })
  // Windows 10+ 自带 tar.exe,与 POSIX 同一调用
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit', windowsHide: true })
  const extracted = path.join(tmp, 'package')
  if (!fs.existsSync(extracted)) die('pnpm 解压结果异常(缺少 package/ 目录)')
  fs.rmSync(path.join(RUNTIME_DIR, 'pnpm', 'node_modules', 'pnpm'), { recursive: true, force: true })
  fs.renameSync(extracted, path.join(RUNTIME_DIR, 'pnpm', 'node_modules', 'pnpm'))
  fs.rmSync(tmp, { recursive: true, force: true })
  writePnpmLaunchers()
  info(`  ✓ pnpm ${version}`)
}

// ── 部署目录配置 ────────────────────────────────────────────────────────────
function ensureConfig() {
  const configDir = process.env.DSHDOCK_CONFIG_DIR || defaultConfigDir({ homedir: os.homedir() })
  const configFile = path.join(configDir, 'config.json')
  if (fs.existsSync(configFile)) {
    info(`▸ 已有部署目录配置,保持不变: ${configFile}`)
    return
  }
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(configFile, `${JSON.stringify({ dataRoot: DATA_ROOT }, null, 2)}\n`)
  info(`▸ 部署目录: ${DATA_ROOT}(配置写入 ${configFile})`)
}

// ── dshdock 命令 ────────────────────────────────────────────────────────────
function ensureCommand() {
  fs.mkdirSync(BIN_DIR, { recursive: true })
  if (isWindows()) {
    const cmd = [
      '@echo off',
      'setlocal',
      `set "APP=${APP_DIR}"`,
      'set "NODE="',
      `if not defined NODE if exist "${NODE_BIN}" set "NODE=${NODE_BIN}"`,
      'if not defined NODE set "NODE=node"',
      '"%NODE%" "%APP%\\cli.mjs" %*',
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n')
    fs.writeFileSync(path.join(BIN_DIR, 'dshdock.cmd'), cmd)
    info(`▸ 命令已就绪: ${path.join(BIN_DIR, 'dshdock.cmd')}`)
    const pathValue = envValue(process.env, 'PATH') ?? ''
    if (!pathValue.split(pathSeparator()).includes(BIN_DIR)) {
      warn(`${BIN_DIR} 不在 PATH 里;把该目录加入用户 PATH 后可直接用 dshdock,否则用全路径`)
    }
    // 安装目录里的入口总是可用,给一条稳妥路径
    const local = path.join(INSTALL_DIR, 'app', 'dshdock.cmd')
    if (!fs.existsSync(local)) fs.copyFileSync(path.join(BIN_DIR, 'dshdock.cmd'), local)
    info(`▸ 备用入口: ${local}`)
    return
  }
  const runSh = path.join(APP_DIR, 'run.sh')
  try {
    fs.chmodSync(runSh, 0o755)
  } catch {}
  const link = path.join(BIN_DIR, 'dshdock')
  fs.rmSync(link, { force: true })
  fs.symlinkSync(runSh, link)
  info(`▸ 命令已就绪: ${link} → ${runSh}`)
  const pathValue = envValue(process.env, 'PATH') ?? ''
  if (!pathValue.split(pathSeparator()).includes(BIN_DIR)) {
    warn(`${BIN_DIR} 不在 PATH 里;把它加进 shell 配置(或直接用全路径 ${link})`)
  }
}

// ── 启动 ────────────────────────────────────────────────────────────────────
async function startService() {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'cli.mjs'), 'bg'], {
    cwd: APP_DIR,
    stdio: 'inherit',
    env: { ...process.env, DSHWEB_PORT: String(PORT) },
    windowsHide: true,
  })
  const code = await new Promise((resolve) => child.on('exit', resolve))
  if (code !== 0) die(`服务启动失败,日志见 ${path.join(DATA_ROOT, 'logs', 'stdout.log')}`)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
info(`▸ 安装目录: ${INSTALL_DIR}(运行时目录 ${TARGET})`)
ensureNode()
if (RUNTIME_MODE !== 'system') ensurePnpm()
else info('▸ --runtime system:跳过自带 pnpm(将使用系统 pnpm)')
ensureConfig()
ensureCommand()
if (DO_START) {
  info(`▸ 启动 DSH Dock 服务(端口 ${PORT})`)
  await startService()
} else {
  info('▸ 已跳过启动;稍后执行: dshdock bg')
}
info('')
info('完成。')
info(`  服务地址: http://127.0.0.1:${PORT}/(首次打开即容器管理界面)`)
info('  常用命令: dshdock status | dshdock stop | dshdock devrestart | dshdock selftest')
info(`  部署数据: ${DATA_ROOT}(containers/ versions/ logs/)`)
info('  下一步:  在 WebUI 安装一个 DSH 版本 → 新建容器 → 启动 → 打开该容器的 DSH UI')
