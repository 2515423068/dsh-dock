#!/bin/sh
# ============================================================================
# DSH Dock 一键安装(Linux / macOS / WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/2515423068/dsh-dock/main/install.sh | sh
#
#   Windows 原生请用:install.ps1(见 README「平台支持」)
#
# 本脚本只做「取源码 + 准备 Node」,其余(自带 pnpm、部署目录配置、dshdock 命令、
# 启动服务)统一交给 app/setup.mjs —— 那份实现跨平台只有一份,且可被单元测试覆盖。
#
# 参数:
#   --dir <path>        安装目录(默认 ~/dsh-dock;在仓库内运行时默认就地)
#   --data-root <path>  部署目录(容器/版本/日志;默认 = 安装目录)
#   --bin-dir <path>    命令安装位置(默认 ~/.local/bin)
#   --repo <url>        源码仓库(默认本仓库;也可用环境变量 DSH_DOCK_REPO)
#   --runtime <mode>    download=下载固定运行时(默认)| system=用系统 node/pnpm
#   --port <n>          服务端口(默认 7940)
#   --no-start          只安装,不启动服务
#   --yes               非交互(agent/CI)
#   --skip-verify       跳过运行时校验和(不推荐)
#
# 重复执行是安全的:已就绪的运行时/命令/配置都会跳过。
# ============================================================================
set -eu

REPO_URL_DEFAULT="https://github.com/2515423068/dsh-dock.git"
NODE_MANIFEST_PATH="runtime/linux-x64/runtime-manifest.json"

DIR=""
DATA_ROOT_OPT=""
BIN_DIR=""
REPO_URL="${DSH_DOCK_REPO:-$REPO_URL_DEFAULT}"
RUNTIME_MODE="download"
PORT=""
DO_START=1
ASSUME_YES=0
SKIP_VERIFY=0

log()  { printf '%s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)          DIR="${2:?--dir 需要路径}"; shift 2 ;;
    --data-root)    DATA_ROOT_OPT="${2:?--data-root 需要路径}"; shift 2 ;;
    --bin-dir)      BIN_DIR="${2:?--bin-dir 需要路径}"; shift 2 ;;
    --repo)         REPO_URL="${2:?--repo 需要 URL}"; shift 2 ;;
    --runtime)      RUNTIME_MODE="${2:?--runtime 需要 download|system}"; shift 2 ;;
    --port)         PORT="${2:?--port 需要端口}"; shift 2 ;;
    --no-start)     DO_START=0; shift ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --skip-verify)  SKIP_VERIFY=1; shift ;;
    -h|--help)      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              die "未知参数: $1(用 --help 查看用法)" ;;
  esac
done

[ "$RUNTIME_MODE" = "download" ] || [ "$RUNTIME_MODE" = "system" ] || die "--runtime 只支持 download 或 system"

# ── 平台 ────────────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=darwin ;;
  *)      die "不支持的系统: $(uname -s)(Windows 请用 install.ps1,或 WSL2 里跑本脚本)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *)             die "不支持的架构: $(uname -m)" ;;
esac
PLATFORM="${OS}-${ARCH}"

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1,$2"; }

# ── 1. 取源码 ───────────────────────────────────────────────────────────────
SCRIPT_PATH="$0"
SCRIPT_DIR=""
case "$SCRIPT_PATH" in
  */*) SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)" ;;
  *)   SCRIPT_DIR="$(pwd)" ;;
esac

if [ -f "$SCRIPT_DIR/app/server.mjs" ]; then
  APP_DIR="$SCRIPT_DIR"
  log "▸ 在仓库目录内就地安装: $APP_DIR"
else
  [ -n "$DIR" ] || DIR="$HOME/dsh-dock"
  APP_DIR="$DIR"
  if [ -f "$APP_DIR/app/server.mjs" ]; then
    log "▸ 复用已有安装: $APP_DIR"
  else
    need_cmd git "用于克隆源码"
    if [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
      die "目录非空且不是 DSH Dock: $APP_DIR"
    fi
    log "▸ 克隆源码 → $APP_DIR"
    mkdir -p "$(dirname -- "$APP_DIR")"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  fi
fi
APP_DIR="$(CDPATH= cd -- "$APP_DIR" && pwd)"
[ -f "$APP_DIR/app/server.mjs" ] || die "源码不完整: 缺少 $APP_DIR/app/server.mjs"
[ -f "$APP_DIR/app/setup.mjs" ] || die "源码不完整: 缺少 $APP_DIR/app/setup.mjs"
[ -n "$DATA_ROOT_OPT" ] || DATA_ROOT_OPT="$APP_DIR"

MANIFEST="$APP_DIR/$NODE_MANIFEST_PATH"
NODE_VERSION=""
[ -f "$MANIFEST" ] && NODE_VERSION="$(sed -n 's/.*"nodeVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST")"
[ -n "$NODE_VERSION" ] || NODE_VERSION="v24.11.1"

# 服务端 runtimeDir() 按 <平台>-<架构> 找运行时,回退兼容历史的 linux-x64 固定目录
RUNTIME_DIR="$APP_DIR/runtime/${PLATFORM}"
NODE_BIN="$RUNTIME_DIR/node/bin/node"

fetch() { # fetch <url> <out>
  if command -v curl >/dev/null 2>&1; then curl -fsSL --max-time 900 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
  else die "需要 curl 或 wget 下载运行时"; fi
}

verify_sha256() { # verify_sha256 <file> <expected>
  [ "$SKIP_VERIFY" = 1 ] && return 0
  [ -n "${2:-}" ] || return 0
  if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$1" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then got="$(shasum -a 256 "$1" | awk '{print $1}')"
  else warn "没有 sha256sum/shasum,跳过校验"; return 0; fi
  [ "$got" = "$2" ] || die "sha256 校验失败:$1(期望 $2,实际 $got)"
  log "  ✓ sha256 校验通过"
}

# ── 2. Node(自带运行时;pnpm/配置/命令由 setup.mjs 收尾) ─────────────────────
install_node() {
  need_cmd tar "用于解压运行时"
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/dshdock-rt.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT INT TERM

  # 优先 .tar.xz:体积小,且 runtime-manifest.json 的 nodeSha256 就是针对它
  NODE_TARBALL="node-${NODE_VERSION}-${PLATFORM}.tar.xz"
  log "▸ 下载 Node ${NODE_VERSION} (${PLATFORM})"
  NODE_HTTP=""
  for base in "${NODE_DIST_MIRROR:-https://npmmirror.com/mirrors/node}" "https://nodejs.org/dist"; do
    if fetch "$base/$NODE_VERSION/$NODE_TARBALL" "$TMP/node.tar.xz"; then NODE_HTTP="$base"; break; fi
    log "  镜像不可用,换下一个: $base"
  done
  [ -n "$NODE_HTTP" ] || die "Node 下载失败(可设 NODE_DIST_MIRROR 指定镜像)"

  # 校验:优先官方 SHASUMS256.txt(全平台通用),拿不到则用清单里的 linux-x64 固定值
  EXPECT_SHA=""
  if fetch "$NODE_HTTP/$NODE_VERSION/SHASUMS256.txt" "$TMP/SHASUMS256.txt" 2>/dev/null; then
    EXPECT_SHA="$(awk -v f="$NODE_TARBALL" '$2 == f { print $1 }' "$TMP/SHASUMS256.txt")"
  fi
  if [ -z "$EXPECT_SHA" ] && [ "$PLATFORM" = "linux-x64" ]; then
    EXPECT_SHA="$(sed -n 's/.*"nodeSha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" 2>/dev/null || true)"
  fi
  [ -n "$EXPECT_SHA" ] || warn "没有可用的 Node 校验和,跳过校验"
  verify_sha256 "$TMP/node.tar.xz" "$EXPECT_SHA"

  rm -rf "$RUNTIME_DIR/node"
  mkdir -p "$RUNTIME_DIR"
  NODE_SRC="$RUNTIME_DIR/node-${NODE_VERSION}-${PLATFORM}"
  if ! tar -xf "$TMP/node.tar.xz" -C "$RUNTIME_DIR" 2>/dev/null; then
    # 个别 tar 不带 xz 支持:退回 .tar.gz(校验和同样取 SHASUMS256.txt)
    log "  tar 不支持 xz,改用 .tar.gz"
    NODE_TARBALL="node-${NODE_VERSION}-${PLATFORM}.tar.gz"
    fetch "$NODE_HTTP/$NODE_VERSION/$NODE_TARBALL" "$TMP/node.tar.gz" || die "Node(.tar.gz)下载失败"
    verify_sha256 "$TMP/node.tar.gz" "$(awk -v f="$NODE_TARBALL" '$2 == f { print $1 }' "$TMP/SHASUMS256.txt" 2>/dev/null || true)"
    tar -xzf "$TMP/node.tar.gz" -C "$RUNTIME_DIR"
  fi
  mv "$NODE_SRC" "$RUNTIME_DIR/node"
  [ -x "$NODE_BIN" ] || die "Node 解压后不可用: $NODE_BIN"
  log "  ✓ Node $("$NODE_BIN" -v)"
}

if [ -x "$NODE_BIN" ]; then
  log "▸ 自带 Node 已就绪:$("$NODE_BIN" -v)"
elif [ "$RUNTIME_MODE" = "system" ]; then
  log "▸ --runtime system:不下载 Node,由 setup.mjs 复用系统 node/pnpm"
else
  if [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
    printf '将准备自带运行时(Node %s,约 30MB 下载)到 %s,继续? [Y/n] ' "$NODE_VERSION" "$RUNTIME_DIR"
    read -r ans || ans=""
    case "$ans" in n|N|no|NO) die "已取消" ;; esac
  fi
  install_node
fi

# ── 3. 收尾(共用实现:pnpm / 配置 / dshdock 命令 / 启动) ─────────────────────
if [ -x "$NODE_BIN" ]; then
  SETUP_NODE="$NODE_BIN"
else
  need_cmd node "(--runtime system 需要系统已装 Node ≥ 22)"
  SETUP_NODE="$(command -v node)"
fi

set -- "$SETUP_NODE" "$APP_DIR/app/setup.mjs"
[ -n "$DATA_ROOT_OPT" ] && set -- "$@" --data-root "$DATA_ROOT_OPT"
[ -n "$BIN_DIR" ] && set -- "$@" --bin-dir "$BIN_DIR"
[ -n "$PORT" ] && set -- "$@" --port "$PORT"
[ "$RUNTIME_MODE" != "download" ] && set -- "$@" --runtime "$RUNTIME_MODE"
[ "$DO_START" = 0 ] && set -- "$@" --no-start
[ "$SKIP_VERIFY" = 1 ] && set -- "$@" --skip-verify
exec "$@"
