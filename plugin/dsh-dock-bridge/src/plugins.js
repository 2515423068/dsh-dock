/**
 * Profile plugin management backing the "插件管理" card (page channel): list
 * what is installed in this container's profile, install from a local
 * directory (`pnpm add file:`/`link:`), uninstall, and enable/disable by
 * patch-row surgery. Nothing here talks to the DSH Dock service — the card
 * keeps working on an independent DSH.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractPackageName, listEntries, parsePatch, readPatchText, removeEntry, setEntryDisabled, upsertEntry, writePatchText } from './patch.js'

/** Own package facts (name/version), read once from the installed manifest. */
export const SELF = (() => {
  try {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    return { name: manifest.name, version: manifest.version ?? '' }
  } catch {
    return { name: 'dsh-dock-bridge', version: '' }
  }
})()

const PNPM_TIMEOUT_MS = 300000
const PNPM_MAX_LINES = 400

/**
 * The pnpm store this profile's modules were installed from. The profile's
 * `node_modules/.modules.yaml` records it (DSH Dock installs with an explicit
 * store-dir); a bare `pnpm` run without it fails with ERR_PNPM_UNEXPECTED_STORE.
 * @returns the store dir, or `undefined` when none is recorded (pnpm default).
 */
function resolveStoreDir(profileDir) {
  try {
    const text = readFileSync(path.join(profileDir, 'node_modules', '.modules.yaml'), 'utf8')
    // pnpm writes `.modules.yaml` with JSON-style quoted keys (`"storeDir": "…"`).
    const match = text.match(/^\s*["']?storeDir["']?\s*:\s*["']?([^"'\s]+)/m)
    if (match !== null && match[1].length > 0) return match[1]
  } catch {
    // A missing or unreadable modules.yaml means no recorded store: use pnpm's default.
  }
  return undefined
}

/**
 * Run one pnpm command inside the profile directory.
 * @returns `{ code, output }` — output is the merged stdout/stderr tail.
 */
export function runPnpm(args, profileDir, { timeoutMs = PNPM_TIMEOUT_MS, signal } = {}) {
  const storeDir = resolveStoreDir(profileDir)
  const fullArgs = storeDir === undefined ? args : ['--store-dir', storeDir, ...args]
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('pnpm', fullArgs, { cwd: profileDir, env: process.env, signal })
    } catch (error) {
      resolve({ code: -1, output: [`pnpm 启动失败: ${error instanceof Error ? error.message : String(error)}`] })
      return
    }
    const output = []
    const collect = (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim().length === 0) continue
        output.push(line)
        if (output.length > PNPM_MAX_LINES) output.shift()
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, timeoutMs)
    const onAbort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: -1, output: [...output, `pnpm 启动失败(不在 PATH?): ${error.message}`, '提示:本容器由 DSH Dock 启动时自带 node/pnpm;独立 DSH 请确认 pnpm 可用。'] })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? -1, output })
    })
  })
}

/** Version of one installed package, or undefined when unreadable. */
function installedVersion(pkgDir) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

/** Dependency-spec kind: file / link / registry. */
function specKind(spec) {
  if (typeof spec !== 'string') return 'none'
  if (spec.startsWith('file:')) return 'file'
  if (spec.startsWith('link:')) return 'link'
  return 'registry'
}

/**
 * List the profile's extension plugins: package.json dependencies joined
 * with the patch rows (activation state) and node_modules presence.
 * @param profileDir - the profile directory (root config dir).
 * @returns `{ ok, recognized, plugins }`.
 */
export function listPlugins(profileDir) {
  const nodeModules = path.join(profileDir, 'node_modules')
  let dependencies = {}
  try {
    const manifest = JSON.parse(readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
    dependencies = manifest.dependencies ?? {}
  } catch {
    dependencies = {}
  }
  const patch = listEntries(readPatchText(profileDir))
  const names = new Set(Object.keys(dependencies))
  for (const entry of patch.entries) {
    const pkg = entry.pkg ?? entry.id
    if (typeof pkg === 'string' && pkg.length > 0) names.add(pkg)
  }
  const plugins = []
  for (const name of [...names].sort()) {
    const pkgDir = path.join(nodeModules, ...name.split('/'))
    const installed = existsSync(pkgDir) && statSync(pkgDir).isDirectory()
    const spec = dependencies[name]
    const row = patch.entries.find(entry => (entry.pkg ?? entry.id) === name)
    const self = name === SELF.name
    plugins.push({
      name,
      version: installed ? installedVersion(pkgDir) : undefined,
      spec: typeof spec === 'string' ? spec : undefined,
      kind: specKind(spec),
      installed,
      active: row !== undefined && row.disabled !== true,
      disabled: row?.disabled === true,
      self,
    })
  }
  return { ok: true, recognized: patch.recognized, plugins }
}

/**
 * Install one plugin from a local directory (absolute path; `file:`/`link:`
 * accepted), then reconcile the patch row idempotently.
 * @returns `{ ok, plugins?, error?, hint?, output? }`.
 */
export async function installPlugin(profileDir, rawSpec, signal) {
  let spec = String(rawSpec ?? '').trim()
  if (spec.length === 0) {
    return { ok: false, error: '安装路径为空', hint: '填本机插件目录的绝对路径,例如 /home/user/plugin/my-plugin。' }
  }
  if (!spec.startsWith('file:') && !spec.startsWith('link:')) {
    if (!path.isAbsolute(spec)) {
      return { ok: false, error: `必须是绝对路径: ${spec}`, hint: '填本机插件目录的绝对路径(可加 file: 前缀;开发迭代可用 link:)。' }
    }
    spec = `file:${spec}`
  }
  const sourcePath = spec.replace(/^(file|link):/, '')
  if (!path.isAbsolute(sourcePath)) {
    return { ok: false, error: `必须是绝对路径: ${sourcePath}`, hint: 'file:/link: 后面跟本机绝对路径。' }
  }
  const manifestPath = path.join(sourcePath, 'package.json')
  if (!existsSync(manifestPath)) {
    return { ok: false, error: `目录里没有 package.json: ${sourcePath}`, hint: '安装对象是插件包的源码目录(含 package.json);确认路径后重试。' }
  }
  let targetName
  let targetVersion
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    targetName = typeof manifest.name === 'string' ? manifest.name : undefined
    targetVersion = typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return { ok: false, error: `package.json 无法解析: ${manifestPath}` }
  }
  if (targetName === undefined) {
    return { ok: false, error: 'package.json 缺少 name 字段' }
  }
  if (specKind(spec) === 'file' || specKind(spec) === 'link') {
    // file:/link: semantics; no additional validation needed here.
  }
  const state = listPlugins(profileDir)
  const existing = state.plugins.find(plugin => plugin.name === targetName)
  if (existing !== undefined && existing.self) {
    return {
      ok: false,
      error: 'dsh-dock-bridge 是内置插件,请在宿主机按 README 的升级流程重建后重新安装',
      hint: '页面不给内置插件提供卸载/禁用;重新 pnpm add file: 即完成升级(升级前先重建 lib/client.js)。',
    }
  }
  if (existing !== undefined && existing.kind === 'registry') {
    return {
      ok: false,
      error: `名称冲突:${targetName} 已作为普通依赖安装(版本 ${existing.version ?? '未知'})`,
      hint: '先卸载同名插件,或换一个插件目录。',
    }
  }
  const run = await runPnpm(['--dir', profileDir, 'add', spec], profileDir, { signal })
  if (run.code !== 0) {
    return {
      ok: false,
      error: `pnpm add 失败(exit ${run.code})`,
      hint: '查看输出尾部定位原因;源码改动后记得先重建 lib/client.js 再安装。',
      output: run.output.slice(-40),
    }
  }
  // Reconcile the activation row (idempotent; keep the bridge's own row).
  const text = readPatchText(profileDir)
  const row = {
    id: targetName,
    name: `./node_modules/${targetName}/src/index.js`,
  }
  const result = upsertEntry(text ?? null, row)
  if (result.changed) writePatchText(profileDir, result.text)
  const after = listPlugins(profileDir)
  const hint = existing !== undefined
    ? `已重新安装 ${targetName}${targetVersion === undefined ? '' : ` ${targetVersion}`};若源码有改动,运行中的模块需重启容器(或刷新模块缓存)后更新。`
    : `已安装并激活 ${targetName}${targetVersion === undefined ? '' : ` ${targetVersion}`}(web profile 热挂载即生效)。`
  return { ok: true, plugins: after.plugins, hint }
}

/**
 * Uninstall one plugin: remove its activation row(s) first (web live reload
 * unmounts it), then `pnpm remove`. The bridge itself is refused both here
 * and in the page.
 */
export async function uninstallPlugin(profileDir, name, signal) {
  if (name === SELF.name) {
    return { ok: false, error: '拒绝:dsh-dock-bridge 是本页面与工具的地基(内置)', hint: '如确需卸载,请按 README 的卸载流程手动操作。' }
  }
  const text = readPatchText(profileDir)
  let working = text
  let changed = false
  const parsed = parsePatch(text)
  for (const entry of parsed.entries) {
    const pkg = entry.name === undefined ? undefined : extractPackageName(entry.name)
    if (pkg === name || entry.id === name) {
      const result = removeEntry(working, entry.id ?? name)
      if (result === null) {
        return { ok: false, error: `patch 行无法安全移除(id=${entry.id ?? '?'})`, hint: 'patch 文件包含非本工具写入的结构,请手动编辑。' }
      }
      working = result.text
      changed = true
    }
  }
  if (changed) writePatchText(profileDir, working)
  const run = await runPnpm(['--dir', profileDir, 'remove', name], profileDir, { signal })
  if (run.code !== 0) {
    return {
      ok: false,
      error: `pnpm remove 失败(exit ${run.code});插件已停用但文件仍在,可重试`,
      hint: '停用状态已生效;文件清理失败常见于目录被占用,稍后重试即可。',
      output: run.output.slice(-40),
    }
  }
  const after = listPlugins(profileDir)
  return { ok: true, plugins: after.plugins }
}

/** Toggle `disabled` on the activation row of one plugin. */
export function setPluginEnabled(profileDir, name, enabled) {
  if (name === SELF.name && enabled === false) {
    return { ok: false, error: '拒绝:禁用 dsh-dock-bridge 会拆除本页面与全部工具(内置)', hint: '如确需停用,请手动编辑 cordis.patch.yml。' }
  }
  const result = setEntryDisabled(readPatchText(profileDir), name, enabled === false)
  if (result === null) {
    return { ok: false, error: `没有找到 ${name} 的激活行`, hint: '未激活的插件无需禁用;先安装或手动添加 patch 行。' }
  }
  if (result.changed) writePatchText(profileDir, result.text)
  const after = listPlugins(profileDir)
  return { ok: true, plugins: after.plugins }
}
