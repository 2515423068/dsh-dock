/**
 * 平台差异层的单元测试(node:test,零依赖)。
 *
 * 本机是 Linux,Windows 分支无法真机执行 —— 所以这一层刻意做成纯函数/可注入,
 * 由这些用例覆盖 Windows 的路径、PATH、taskkill、netstat 解析等分支。
 *
 *   node --test app/platform.test.mjs
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  aliveProbeTarget, cmdlinePlan, defaultConfigDir, envValue, isInside, isWindows, killTree, killTreePlan,
  listeningPortsPlan, nodeDistDirName, nodeEntry, parseNetstatPorts, parseProcNetTcp, pathSeparator,
  pnpmCmdShim, pnpmLaunch, runtimePathEntries, runtimeTarget, setEnvPath, symlinkDir, withRuntimePath,
} from './platform.mjs'

const RT = '/opt/dsh-dock/runtime'

test('runtimeTarget: 平台-架构目录名', () => {
  assert.equal(runtimeTarget('linux', 'x64'), 'linux-x64')
  assert.equal(runtimeTarget('linux', 'arm64'), 'linux-arm64')
  assert.equal(runtimeTarget('darwin', 'arm64'), 'darwin-arm64')
  assert.equal(runtimeTarget('win32', 'x64'), 'win-x64')
  assert.equal(runtimeTarget('win32', 'arm64'), 'win-arm64')
})

test('isWindows / pathSeparator', () => {
  assert.equal(isWindows('win32'), true)
  assert.equal(isWindows('linux'), false)
  assert.equal(pathSeparator('win32'), ';')
  assert.equal(pathSeparator('linux'), ':')
})

test('nodeEntry: 两端可执行文件布局', () => {
  assert.equal(nodeEntry(RT, 'linux'), path.join(RT, 'node', 'bin', 'node'))
  assert.equal(nodeEntry(RT, 'win32'), path.join(RT, 'node', 'node.exe'))
})

test('nodeDistDirName: 解压后的顶层目录名', () => {
  assert.equal(nodeDistDirName('v24.11.1', 'linux', 'x64'), 'node-v24.11.1-linux-x64')
  assert.equal(nodeDistDirName('v24.11.1', 'win32', 'x64'), 'node-v24.11.1-win-x64')
})

test('envValue: Windows 下大小写不敏感', () => {
  const env = { Path: 'C:\\Windows' }
  assert.equal(envValue(env, 'PATH', 'win32'), 'C:\\Windows')
  assert.equal(envValue(env, 'PATH', 'linux'), undefined)
})

test('setEnvPath: Windows 下 Path/PATH 只留一个键', () => {
  const env = { Path: 'C:\\old', TEMP: 'x' }
  setEnvPath(env, 'C:\\new', 'win32')
  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === 'path')
  assert.deepEqual(pathKeys, ['PATH'])
  assert.equal(env.PATH, 'C:\\new')
  assert.equal(env.TEMP, 'x')
})

test('runtimePathEntries: 自带 node 与 pnpm 目录', () => {
  assert.deepEqual(runtimePathEntries(RT, 'linux'), [path.join(RT, 'node', 'bin'), path.join(RT, 'pnpm')])
  assert.deepEqual(runtimePathEntries(RT, 'win32'), [path.join(RT, 'node'), path.join(RT, 'pnpm')])
})

test('withRuntimePath: POSIX 用冒号且不污染入参', () => {
  const base = { PATH: '/usr/bin' }
  const next = withRuntimePath(base, RT, 'linux')
  assert.equal(next.PATH, `${path.join(RT, 'node', 'bin')}:${path.join(RT, 'pnpm')}:/usr/bin`)
  assert.equal(base.PATH, '/usr/bin')
})

test('withRuntimePath: Windows 用分号,并把已有的 Path 合并掉', () => {
  const next = withRuntimePath({ Path: 'C:\\Windows' }, RT, 'win32')
  const pathKeys = Object.keys(next).filter((key) => key.toLowerCase() === 'path')
  assert.equal(pathKeys.length, 1)
  assert.equal(next.PATH, `${path.join(RT, 'node')};${path.join(RT, 'pnpm')};C:\\Windows`)
})

test('withRuntimePath: 空 PATH 不产生多余分隔符', () => {
  assert.equal(withRuntimePath({}, RT, 'linux').PATH, `${path.join(RT, 'node', 'bin')}:${path.join(RT, 'pnpm')}`)
})

test('pnpmLaunch: Windows 用 node 跑 pnpm.cjs(绕开 .cmd 需要 shell 的限制)', () => {
  const win = pnpmLaunch(RT, 'win32')
  assert.equal(win.command, path.join(RT, 'node', 'node.exe'))
  assert.deepEqual(win.prefixArgs, [path.join(RT, 'pnpm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')])
  const posix = pnpmLaunch(RT, 'linux')
  assert.equal(posix.command, path.join(RT, 'pnpm', 'pnpm'))
  assert.deepEqual(posix.prefixArgs, [])
})

test('pnpmCmdShim: 指向 node 与 pnpm.cjs', () => {
  const shim = pnpmCmdShim()
  assert.match(shim, /node\.exe/)
  assert.match(shim, /pnpm\.cjs/)
  assert.match(shim, /%\*/)
})

test('killTreePlan: POSIX 杀进程组,Windows 用 taskkill /T', () => {
  assert.deepEqual(killTreePlan(1234, { platform: 'linux' }), { kind: 'signal', target: -1234, signal: 'SIGTERM' })
  assert.deepEqual(killTreePlan(1234, { platform: 'linux', force: true }), { kind: 'signal', target: -1234, signal: 'SIGKILL' })
  assert.deepEqual(killTreePlan(1234, { platform: 'win32' }), { kind: 'taskkill', command: 'taskkill', args: ['/PID', '1234', '/T'] })
  assert.deepEqual(killTreePlan(1234, { platform: 'win32', force: true }), { kind: 'taskkill', command: 'taskkill', args: ['/PID', '1234', '/T', '/F'] })
})

test('killTree: Windows 走注入的 run,失败被吞掉', async () => {
  const calls = []
  await killTree(4321, { platform: 'win32', force: true, run: async (command, args) => { calls.push([command, args]) } })
  assert.deepEqual(calls, [['taskkill', ['/PID', '4321', '/T', '/F']]])
  await killTree(4321, { platform: 'win32', run: async () => { throw new Error('taskkill 退出码 128') } })
})

test('killTree: POSIX 对不存在的进程组静默(等价 ESRCH)', async () => {
  await killTree(999_999, { platform: 'linux' })
})

test('killTree: 目标不是进程组长时也要能杀掉(真实复现 devrestart 卡住的 bug)', async () => {
  // 故意不用 detached:子进程落在本测试进程的进程组里,`kill(-child.pid)` 指向不存在的组
  const { spawn } = await import('node:child_process')
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  await new Promise((resolve) => child.once('spawn', resolve))
  const alive = () => {
    try {
      process.kill(child.pid, 0)
      return true
    } catch {
      return false
    }
  }
  assert.equal(alive(), true)
  await killTree(child.pid, { force: true, platform: 'linux' })
  const deadline = Date.now() + 3000
  while (Date.now() < deadline && alive()) await new Promise((r) => setTimeout(r, 50))
  assert.equal(alive(), false, 'killTree 必须把进程本身也杀掉,而不只是尝试杀进程组')
  try { child.kill('SIGKILL') } catch {}
})

test('aliveProbeTarget: POSIX 返回负进程组,Windows 返回 pid', () => {
  const record = { pid: 100, pgid: 100 }
  assert.equal(aliveProbeTarget(record, 'linux'), -100)
  assert.equal(aliveProbeTarget({ pid: 100 }, 'linux'), -100)
  assert.equal(aliveProbeTarget({ pid: 100, pgid: 200 }, 'linux'), -200)
  assert.equal(aliveProbeTarget(record, 'win32'), 100)
  assert.equal(aliveProbeTarget({}, 'win32'), undefined)
  assert.equal(aliveProbeTarget(undefined, 'linux'), undefined)
})

test('cmdlinePlan: POSIX 读 /proc,Windows 用 PowerShell CIM', () => {
  assert.deepEqual(cmdlinePlan(77, 'linux'), { kind: 'file', path: '/proc/77/cmdline' })
  const win = cmdlinePlan(77, 'win32')
  assert.equal(win.kind, 'command')
  assert.equal(win.command, 'powershell')
  assert.match(win.args.at(-1), /Win32_Process/)
  assert.match(win.args.at(-1), /ProcessId=77/)
})

test('listeningPortsPlan: Linux 读 /proc,Windows 用 netstat', () => {
  assert.equal(listeningPortsPlan('linux').kind, 'proc')
  const win = listeningPortsPlan('win32')
  assert.equal(win.command, 'netstat')
  assert.deepEqual(win.args, ['-ano', '-p', 'TCP'])
})

test('parseProcNetTcp: 只取 LISTEN(0A)端口', () => {
  const text = [
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
    '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1 1 0',
    '   1: 0100007F:1F91 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 2 1 0',
    '   2: 00000000:A374 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 3 1 0',
  ].join('\n')
  const ports = parseProcNetTcp(text)
  assert.equal(ports.has(8080), true)   // 0x1F90
  assert.equal(ports.has(8081), false)  // 状态 01 = ESTABLISHED
  assert.equal(ports.has(41844), true)  // 0xA374
})

test('parseNetstatPorts: Windows netstat 输出(IPv4/IPv6/大小写)', () => {
  const text = [
    '',
    '活动连接',
    '',
    '  协议  本地地址          外部地址        状态           PID',
    '  TCP    127.0.0.1:7940         0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:41800        0.0.0.0:0              LISTENING       5151',
    '  TCP    127.0.0.1:51000        127.0.0.1:7940         ESTABLISHED     5151',
    '  TCP    [::1]:37371            [::]:0                 LISTENING       6262',
  ].join('\r\n')
  const ports = parseNetstatPorts(text)
  assert.equal(ports.has(7940), true)
  assert.equal(ports.has(41800), true)
  assert.equal(ports.has(37371), true)
  assert.equal(ports.has(51000), false)
})

test('defaultConfigDir: Windows 用 %APPDATA%,POSIX 用 ~/.config', () => {
  assert.equal(defaultConfigDir({ platform: 'linux', homedir: '/home/u' }), path.join('/home/u', '.config', 'dshdock'))
  assert.equal(
    defaultConfigDir({ platform: 'win32', homedir: 'C:\\Users\\u', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' } }),
    path.join('C:\\Users\\u\\AppData\\Roaming', 'dshdock'),
  )
  assert.equal(
    defaultConfigDir({ platform: 'win32', homedir: 'C:\\Users\\u', env: {} }),
    path.join('C:\\Users\\u', 'AppData', 'Roaming', 'dshdock'),
  )
})

test('symlinkDir: Windows 用 junction,其它平台用 dir', () => {
  const made = []
  const fsImpl = { symlinkSync: (target, link, type) => { made.push([target, link, type]) } }
  symlinkDir('/data/home', '/containers/c1/profile', fsImpl, 'win32')
  symlinkDir('/data/home', '/containers/c1/profile', fsImpl, 'linux')
  assert.deepEqual(made, [['/data/home', '/containers/c1/profile', 'junction'], ['/data/home', '/containers/c1/profile', 'dir']])
})

test('isInside: 判断路径包含关系(删除前安全校验)', () => {
  assert.equal(isInside('/a/b/c', '/a/b'), true)
  assert.equal(isInside('/a/b', '/a/b'), false)
  assert.equal(isInside('/a/bc', '/a/b'), false)
  assert.equal(isInside('/x', '/a/b'), false)
})
