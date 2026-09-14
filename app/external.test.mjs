/**
 * 「外部 DSH 只读检测 / 配置打包与权限收紧」的单元测试(node:test)。
 *
 *   node --test app/external.test.mjs
 *
 * 用真实临时目录而不是 mock:这些函数的价值就在文件系统语义上
 * (软链是否被下钻、拷贝是否一致),真实目录才测得出。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  copyTree, countSessions, discoverExternal, hardenHomePermissions, harnessFacts, homeCandidates, homeFacts,
  importPlan, isDsBoxContainerPath, isSymlink, measureTree, parseJsonArray, removeEntrySafely, verifyCopy,
} from './external.mjs'

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshdock-ext-'))
}

test('homeFacts: 认出 DSH home 并统计会话/大小', () => {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'a: 1\n')
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'KEY: value\n')
  fs.mkdirSync(path.join(home, 'sessions'))
  for (const name of ['s1', 's2', 's3']) fs.writeFileSync(path.join(home, 'sessions', name), 'x')
  const facts = homeFacts(fs, home)
  assert.equal(facts.isHome, true)
  assert.equal(facts.sessions, 3)
  assert.equal(facts.hasCredentials, true)
  assert.equal(facts.hasSettings, true)
  assert.ok(facts.bytes > 0)
  assert.ok(facts.signals.includes('sessions'))
})

test('homeFacts: 普通目录/空目录不算 DSH home', () => {
  const empty = tmpdir()
  assert.equal(homeFacts(fs, empty).isHome, false)
  const random = tmpdir()
  fs.writeFileSync(path.join(random, 'notes.txt'), 'hi')
  assert.equal(homeFacts(fs, random).isHome, false)
})

test('countSessions: 没有 sessions 目录时返回 0', () => {
  assert.equal(countSessions(fs, tmpdir()), 0)
})

test('measureTree: 统计文件与字节,软链不计入目标体积', () => {
  const dir = tmpdir()
  fs.writeFileSync(path.join(dir, 'a'), 'x'.repeat(10))
  fs.mkdirSync(path.join(dir, 'sub'))
  fs.writeFileSync(path.join(dir, 'sub', 'b'), 'y'.repeat(20))
  const outside = tmpdir()
  fs.writeFileSync(path.join(outside, 'big'), 'z'.repeat(1000))
  fs.symlinkSync(outside, path.join(dir, 'link'))
  const measured = measureTree(fs, dir)
  assert.equal(measured.files, 3)          // a, sub/b, link(软链自身算一个条目)
  assert.equal(measured.bytes, 30)         // 不把软链目标的 1000 字节算进来
})

test('harnessFacts: 认出 harness 检出与版本号', () => {
  const dir = tmpdir()
  fs.mkdirSync(path.join(dir, 'apps', 'cli', 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'apps', 'cli', 'src', 'bin.ts'), '// entry')
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '0.1.5-rc.2' }))
  const facts = harnessFacts(fs, dir)
  assert.equal(facts.isHarness, true)
  assert.equal(facts.version, '0.1.5-rc.2')
  assert.equal(facts.prebuilt, false)
  // 只建了 package.json 的目录不算
  const plain = tmpdir()
  fs.writeFileSync(path.join(plain, 'package.json'), JSON.stringify({ name: 'whatever' }))
  assert.equal(harnessFacts(fs, plain).isHarness, false)
})

test('copyTree + verifyCopy: 复制一致,且内部软链保持为链接', () => {
  const src = tmpdir()
  fs.mkdirSync(path.join(src, 'sessions'))
  fs.writeFileSync(path.join(src, 'settings.yaml'), 'a: 1\n')
  fs.writeFileSync(path.join(src, 'sessions', 's1'), 'x'.repeat(50))
  const outside = tmpdir()
  fs.writeFileSync(path.join(outside, 'target'), 'y')
  fs.symlinkSync(outside, path.join(src, 'linked'))

  const dst = path.join(tmpdir(), 'copy')
  copyTree(fs, src, dst)
  assert.equal(fs.existsSync(path.join(dst, 'settings.yaml')), true)
  assert.equal(isSymlink(fs, path.join(dst, 'linked')), true)   // 未被 dereference 展开
  const verdict = verifyCopy(fs, src, dst)
  assert.equal(verdict.ok, true)
})

test('removeEntrySafely: 真目录会被删除;不存在的返回 absent', () => {
  const dir = tmpdir()
  fs.writeFileSync(path.join(dir, 'f'), 'x')
  assert.equal(removeEntrySafely(fs, dir), 'removed')
  assert.equal(fs.existsSync(dir), false)
  assert.equal(removeEntrySafely(fs, path.join(tmpdir(), 'nope')), 'absent')
})

test('removeEntrySafely: 软链只删链接,目标毫发无损', () => {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'keep me\n')
  const linkParent = tmpdir()
  const link = path.join(linkParent, 'profile')
  fs.symlinkSync(home, link)
  assert.equal(isSymlink(fs, link), true)
  assert.equal(removeEntrySafely(fs, link), 'unlinked')
  assert.equal(fs.existsSync(link), false)
  assert.equal(fs.readFileSync(path.join(home, 'settings.yaml'), 'utf8'), 'keep me\n')
})

test('homeCandidates: 环境变量 DSH_HOME 优先,去重', () => {
  const list = homeCandidates({ homedir: '/home/u', env: { DSH_HOME: '/data/dsh' } })
  assert.deepEqual(list, ['/data/dsh', path.join('/home/u', '.dsh')])
  const dup = homeCandidates({ homedir: '/home/u', env: { DSH_HOME: path.join('/home/u', '.dsh') } })
  assert.equal(dup.length, 1)
})

test('parseJsonArray: 兼容单对象/数组/垃圾输入', () => {
  assert.deepEqual(parseJsonArray('{"a":1}'), [{ a: 1 }])
  assert.deepEqual(parseJsonArray('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }])
  assert.deepEqual(parseJsonArray('not json'), [])
  assert.deepEqual(parseJsonArray(''), [])
})

test('hardenHomePermissions: 凭据收紧到 0600、目录 0700(否则 DSH 拒绝启动)', () => {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'KEY: value\n', { mode: 0o644 })
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'a: 1\n', { mode: 0o644 })
  fs.mkdirSync(path.join(home, 'storages'), { mode: 0o755 })
  const tightened = hardenHomePermissions(fs, home)
  assert.ok(tightened.includes('.credentials.yaml'))
  assert.equal(fs.statSync(path.join(home, '.credentials.yaml')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(home, 'settings.yaml')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(home, 'storages')).mode & 0o777, 0o700)
  // 不存在的文件不应报错
  hardenHomePermissions(fs, tmpdir())
})

test('importPlan: 只做复制;源在跑未确认则拒绝;风险里必须点出明文凭据', () => {
  const blocked = importPlan({ inUse: true, acknowledged: false })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reasons.join(' '), /正在运行/)
  const ok = importPlan({ inUse: false, acknowledged: false })
  assert.equal(ok.ok, true)
  assert.match(ok.risks.join(' '), /只做复制/)
  assert.match(ok.risks.join(' '), /明文凭据/)
  assert.deepEqual(ok.steps, ['把源复制到临时目录', '打包成单个配置文件', '校验文件数与字节数一致', '收紧凭据权限(0600)', '写入/更新使用说明'])
  assert.equal(importPlan({ targetExists: true }).ok, false)
  assert.match(importPlan({ inUse: true, acknowledged: true }).risks.join(' '), /仍在运行/)
})

test('discoverExternal: 不把 DSHBox 自己的容器当成外部 DSH(含继承来的 DSH_HOME)', () => {
  const root = tmpdir()
  const containersDir = path.join(root, 'containers')
  const versionsDir = path.join(root, 'versions')
  const homeRoot = path.join(root, 'userhome')
  // DSHBox 自己的容器 profile(带完整 home 特征)
  const managedProfile = path.join(containersDir, 'container-1', 'profile')
  fs.mkdirSync(path.join(managedProfile, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(managedProfile, 'settings.yaml'), 'a: 1\n')
  // 真·外部 DSH(~/.dsh)
  const externalHome = path.join(homeRoot, '.dsh')
  fs.mkdirSync(path.join(externalHome, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(externalHome, 'settings.yaml'), 'a: 1\n')
  // 两个 host 进程的 --patch 文件(用于推出端口)
  const managedPatch = path.join(containersDir, 'container-1', 'web.patch.yml')
  fs.writeFileSync(managedPatch, '- id: webserver\n  config:\n    port: 41800\n')
  const externalPatch = path.join(root, 'ext.patch.yml')
  fs.writeFileSync(externalPatch, '- id: webserver\n  config:\n    port: 41999\n')

  const psOutput = [
    `  101 node apps/cli/src/bin.ts --profile web --patch ${managedPatch}`,
    `  202 node apps/cli/src/bin.ts --profile web --patch ${externalPatch}`,
    '  303 node some-unrelated-service --flag',
  ].join('\n')
  const run = (command) => (command === 'ps' ? psOutput : '/nonexistent/npm/root')

  const found = discoverExternal({
    homedir: homeRoot,
    // 服务进程常带着容器自己的 DSH_HOME —— 必须被排除
    env: { DSH_HOME: managedProfile },
    platform: 'darwin',
    run,
    managed: { containersDir, versionsDir, ports: new Set([41800]) },
  })

  assert.deepEqual(found.homes.map((h) => h.path), [externalHome])
  assert.deepEqual(found.running.map((r) => r.pid), [202])
  assert.equal(found.managedRunning, 1)
})

test('discoverExternal: 没有外部 DSH 时返回空列表(而不是把内部容器报成外部)', () => {
  const root = tmpdir()
  const containersDir = path.join(root, 'containers')
  const managedProfile = path.join(containersDir, 'container-9', 'profile')
  fs.mkdirSync(path.join(managedProfile, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(managedProfile, 'settings.yaml'), 'a: 1\n')
  const found = discoverExternal({
    homedir: path.join(root, 'userhome'),
    env: { DSH_HOME: managedProfile },
    platform: 'darwin',
    run: () => '',
    managed: { containersDir, versionsDir: path.join(root, 'versions'), ports: new Set() },
  })
  assert.deepEqual(found.homes, [])
  assert.deepEqual(found.running, [])
})

test('isDsBoxContainerPath: 认出任意 DSHBox 的容器目录(不是靠 DATA_ROOT 硬比)', () => {
  const other = tmpdir()
  const containerDir = path.join(other, 'containers', 'container-123')
  const profile = path.join(containerDir, 'profile')
  fs.mkdirSync(path.join(profile, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(containerDir, 'container.json'), '{"id":"container-123"}')
  assert.equal(isDsBoxContainerPath(fs, profile), true)
  assert.equal(isDsBoxContainerPath(fs, path.join(containerDir, 'web.patch.yml')), true)
  // 普通目录里自建的 DSH home 不应被误判
  const plain = path.join(tmpdir(), 'containers', 'my-dsh', 'profile')
  fs.mkdirSync(plain, { recursive: true })
  assert.equal(isDsBoxContainerPath(fs, plain), false)
  assert.equal(isDsBoxContainerPath(fs, '/srv/dsh'), false)
})

test('discoverExternal: 别的 DSHBox 安装的容器也不算外部(继承 DSH_HOME 场景)', () => {
  const other = tmpdir()
  const containerDir = path.join(other, 'containers', 'container-abc')
  const profile = path.join(containerDir, 'profile')
  fs.mkdirSync(path.join(profile, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(profile, 'settings.yaml'), 'a: 1\n')
  fs.writeFileSync(path.join(containerDir, 'container.json'), '{"id":"container-abc"}')
  const found = discoverExternal({
    homedir: path.join(other, 'userhome'),
    env: { DSH_HOME: profile },
    platform: 'darwin',
    run: () => '',
    managed: { containersDir: path.join(other, 'my-containers'), versionsDir: path.join(other, 'versions'), ports: new Set() },
  })
  assert.deepEqual(found.homes, [])
})
