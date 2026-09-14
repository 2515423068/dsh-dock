<#
.SYNOPSIS
  DSH Dock 一键安装(原生 Windows)。

.DESCRIPTION
  只做两件事:取源码 + 把自带 Node 下载解压到 runtime\win-<arch>\node;
  其余(自带 pnpm、部署目录配置、dshdock 命令、启动服务)统一交给 app\setup.mjs ——
  跨平台逻辑只有那一份实现。

  用法(在本机 PowerShell 里):
    powershell -ExecutionPolicy Bypass -File .\install.ps1

  从网络一键(不落地):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.ps1))) -Yes

  参数:
    -Dir <path>        安装目录(默认 $HOME\dsh-dock)
    -DataRoot <path>   部署目录(容器/版本/日志;默认 = 安装目录)
    -BinDir <path>     命令目录(默认 <安装目录>\bin,并加入用户 PATH)
    -Repo <url>        源码仓库(默认本仓库)
    -Runtime download|system
    -Port <n>          服务端口(默认 7940)
    -NoStart           只安装不启动
    -NoPath            不修改用户 PATH
    -Yes               非交互
    -SkipVerify        跳过校验和(不推荐)

.NOTES
  需要 Windows 10 1803+ 自带的 tar.exe(setup.mjs 用它解压 pnpm;缺失会明确报错)。
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Dir,
  [string]$DataRoot,
  [string]$BinDir,
  [string]$Repo = $env:DSH_DOCK_REPO,
  [ValidateSet('download', 'system')][string]$Runtime = 'download',
  [int]$Port = 0,
  [switch]$NoStart,
  [switch]$NoPath,
  [switch]$Yes,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # PS 5.1 的进度条会让大文件下载极慢
$RepoDefault = 'https://github.com/2515423068/dsh-dock.git'
if (-not $Repo) { $Repo = $RepoDefault }

function Write-Info([string]$Message) { Write-Host $Message }
function Write-Warn([string]$Message) { Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { Write-Host "✗ $Message" -ForegroundColor Red; exit 1 }

# ── 平台 ────────────────────────────────────────────────────────────────────
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  'x86'   { Fail '不支持 32 位 Windows(需要 x64 或 arm64)' }
  default { 'x64' }
}
$target = "win-$arch"

# ── 1. 取源码 ───────────────────────────────────────────────────────────────
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (Test-Path (Join-Path $scriptDir 'app\server.mjs')) {
  $appDir = $scriptDir
  Write-Info "▸ 在仓库目录内就地安装: $appDir"
} else {
  if (-not $Dir) { $Dir = Join-Path $HOME 'dsh-dock' }
  $appDir = $Dir
  if (Test-Path (Join-Path $appDir 'app\server.mjs')) {
    Write-Info "▸ 复用已有安装: $appDir"
  } else {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      Fail '缺少 git:请先安装 Git for Windows(https://git-scm.com/download/win),它同时是安装 DSH 版本所必需的'
    }
    if ((Test-Path $appDir) -and (Get-ChildItem -Force $appDir | Select-Object -First 1)) {
      Fail "目录非空且不是 DSH Dock: $appDir"
    }
    Write-Info "▸ 克隆源码 → $appDir"
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $appDir) | Out-Null
    git clone --depth 1 $Repo $appDir
    if ($LASTEXITCODE -ne 0) { Fail 'git clone 失败' }
  }
}
$appDir = (Resolve-Path $appDir).Path
if (-not (Test-Path (Join-Path $appDir 'app\setup.mjs'))) { Fail "源码不完整: 缺少 $appDir\app\setup.mjs" }
if (-not $DataRoot) { $DataRoot = $appDir }

if ($appDir.Length -gt 90) {
  Write-Warn "安装路径较长($($appDir.Length) 字符):容器内的 node_modules 可能触及 Windows 260 字符路径上限;建议换短路径(如 C:\dsh-dock)或启用系统长路径支持"
}

# ── 2. Node ─────────────────────────────────────────────────────────────────
$manifestPath = Join-Path $appDir 'runtime\linux-x64\runtime-manifest.json'
$nodeVersion = 'v24.11.1'
if (Test-Path $manifestPath) {
  try {
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.nodeVersion) { $nodeVersion = $manifest.nodeVersion }
  } catch { Write-Warn "读取 runtime-manifest.json 失败,使用默认 Node $nodeVersion" }
}

$runtimeDir = Join-Path $appDir "runtime\$target"
$nodeBin = Join-Path $runtimeDir 'node\node.exe'
$distDirName = "node-$nodeVersion-$target"

function Install-Node {
  $tarball = "$distDirName.zip"
  $tmp = Join-Path $env:TEMP ("dshdock-rt-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp $tarball
  $bases = @($env:NODE_DIST_MIRROR, 'https://npmmirror.com/mirrors/node', 'https://nodejs.org/dist') |
    Where-Object { $_ } | Select-Object -Unique
  $baseOk = $null
  foreach ($base in $bases) {
    try {
      Write-Info "▸ 下载 Node $nodeVersion ($target)"
      Invoke-WebRequest -Uri "$base/$nodeVersion/$tarball" -OutFile $zip -UseBasicParsing
      $baseOk = $base
      break
    } catch {
      Write-Warn "镜像不可用($base):$($_.Exception.Message)"
    }
  }
  if (-not $baseOk) { Fail 'Node 下载失败;可用 $env:NODE_DIST_MIRROR 指定镜像' }

  if (-not $SkipVerify) {
    try {
      $sums = (Invoke-WebRequest -Uri "$baseOk/$nodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
      $expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($tarball) } | Select-Object -First 1) -split '\s+' | Select-Object -First 1
      if ($expected) {
        $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) { Fail "sha256 校验失败(期望 $expected,实际 $actual)" }
        Write-Info '  ✓ sha256 校验通过'
      } else {
        Write-Warn 'SHASUMS256.txt 里没有该文件条目,跳过校验'
      }
    } catch {
      Write-Warn "拿不到 SHASUMS256.txt,跳过校验:$($_.Exception.Message)"
    }
  }

  if (Test-Path (Join-Path $runtimeDir 'node')) { Remove-Item -Recurse -Force (Join-Path $runtimeDir 'node') }
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $extracted = Join-Path $tmp $distDirName
  if (-not (Test-Path $extracted)) { Fail "解压结果异常:找不到 $distDirName" }
  Move-Item -Path $extracted -Destination (Join-Path $runtimeDir 'node')
  Remove-Item -Recurse -Force $tmp
  if (-not (Test-Path $nodeBin)) { Fail "Node 解压后不可用: $nodeBin" }
  Write-Info "  ✓ Node $(& $nodeBin -v)"
}

if (Test-Path $nodeBin) {
  Write-Info "▸ 自带 Node 已就绪:$(& $nodeBin -v)"
} elseif ($Runtime -eq 'system') {
  Write-Info '▸ -Runtime system:不下载 Node,由 setup.mjs 复用系统 node/pnpm'
} else {
  Install-Node
}

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
  Write-Warn '未找到 tar.exe(Windows 10 1803+ 自带):setup.mjs 需要它解压 pnpm;请更新系统或手动放置运行时'
}

# ── 3. 收尾(共用实现) ───────────────────────────────────────────────────────
$setupArgs = @((Join-Path $appDir 'app\setup.mjs'), '--data-root', $DataRoot)
if ($BinDir) { $setupArgs += @('--bin-dir', $BinDir) }
if ($Port -gt 0) { $setupArgs += @('--port', "$Port") }
if ($Runtime -ne 'download') { $setupArgs += @('--runtime', $Runtime) }
if ($NoStart) { $setupArgs += '--no-start' }
if ($SkipVerify) { $setupArgs += '--skip-verify' }

$setupNode = if (Test-Path $nodeBin) { $nodeBin } else { 'node' }
Write-Info "▸ 收尾(pnpm / 配置 / dshdock 命令 / 启动)"
& $setupNode @setupArgs
if ($LASTEXITCODE -ne 0) { Fail "安装收尾失败(退出码 $LASTEXITCODE)" }

# ── 4. 把命令目录加入用户 PATH ──────────────────────────────────────────────
$effectiveBin = if ($BinDir) { $BinDir } else { Join-Path $appDir 'bin' }
if (-not $NoPath) {
  try {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    $parts = $userPath -split ';' | Where-Object { $_ }
    if ($parts -notcontains $effectiveBin) {
      $next = (@($parts) + $effectiveBin) -join ';'
      [Environment]::SetEnvironmentVariable('Path', $next, 'User')
      Write-Info "▸ 已把 $effectiveBin 加入用户 PATH(新开的终端生效)"
    }
  } catch {
    Write-Warn "未能自动修改用户 PATH:$($_.Exception.Message);请手动把 $effectiveBin 加入 PATH"
  }
}

Write-Info ''
Write-Info '完成。'
Write-Info "  服务地址: http://127.0.0.1:$(if ($Port -gt 0) { $Port } else { 7940 })/(首次打开即容器管理界面)"
Write-Info "  常用命令: dshdock status | dshdock stop | dshdock devrestart | dshdock selftest"
Write-Info "  入口文件: $(Join-Path $appDir 'app\dshdock.cmd')(未加入 PATH 时用它)"
Write-Info "  部署数据: $DataRoot(containers\ versions\ logs\)"
Write-Info '  下一步:  在 WebUI 安装一个 DSH 版本 → 新建容器 → 启动 → 打开该容器的 DSH UI'
