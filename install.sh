#!/bin/sh
# ============================================================================
# DSH Dock 一键安装(Linux / macOS / WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/dsh-dock/main/install.sh | sh
#
# 安装做什么:
#   1) 取源码:已在仓库目录内就地安装;否则 git clone 到 --dir
#   2) 准备自带运行时 runtime/<platform>/(固定版本 node + pnpm,sha256/sha512 校验)
#   3) 生成 `dshdock` 命令(默认 ~/.local/bin/dshdock)
#   4) 写部署目录配置(默认 = 安装目录),后台启动服务并打印访问地址
#
# 参数:
#   --dir <path>        安装目录(默认 ~/dsh-dock;在仓库内运行时默认就地)
#   --data-root <path>  部署目录(容器/版本/日志;默认 = 安装目录)
#   --bin-dir <path>    命令安装位置(默认 ~/.local/bin)
#   --repo <url>        源码仓库(默认本仓库;也可用环境变量 DSH_DOCK_REPO)
#   --runtime <mode>    download=下载固定运行时(默认)| system=用系统 node/pnpm 建软链
#   --port <n>          服务端口(默认 7940;写进 dshdock 命令的环境)
#   --no-start          只安装,不启动服务
#   --yes               非交互(agent/CI)
#   --skip-verify       跳过运行时校验和(不推荐)
#
# 重复执行是安全的:已就绪的运行时/命令/配置都会跳过。
# ============================================================================
set -eu

REPO_URL_DEFAULT="https://github.com/OWNER/dsh-dock.git"
NODE_MANIFEST_PATH="runtime/linux-x64/runtime-manifest.json"

DIR=""
DATA_ROOT_OPT=""
BIN_DIR="${HOME}/.local/bin"
REPO_URL="${DSH_DOCK_REPO:-$REPO_URL_DEFAULT}"
RUNTIME_MODE="download"
PORT="${DSHWEB_PORT:-7940}"
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
  *)      die "不支持的系统: $(uname -s)(Windows 请在 WSL2 里运行本脚本)" ;;
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

APP_DIR=""
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
    [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ] && die "目录非空且不是 DSH Dock: $APP_DIR"
    log "▸ 克隆源码 → $APP_DIR"
    mkdir -p "$(dirname -- "$APP_DIR")"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  fi
fi
APP_DIR="$(CDPATH= cd -- "$APP_DIR" && pwd)"
[ -f "$APP_DIR/app/server.mjs" ] || die "源码不完整: 缺少 $APP_DIR/app/server.mjs"
[ -n "$DATA_ROOT_OPT" ] || DATA_ROOT_OPT="$APP_DIR"

MANIFEST="$APP_DIR/$NODE_MANIFEST_PATH"
NODE_VERSION=""
[ -f "$MANIFEST" ] && NODE_VERSION="$(sed -n 's/.*"nodeVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST")"
[ -n "$NODE_VERSION" ] || NODE_VERSION="v24.11.1"
PNPM_VERSION=""
[ -f "$MANIFEST" ] && PNPM_VERSION="$(sed -n 's/.*"pnpmVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST")"
[ -n "$PNPM_VERSION" ] || PNPM_VERSION="11.7.0"

# 服务端 runtimeDir() 按 <平台>-<架构> 找运行时,回退兼容历史的 linux-x64 固定目录
RUNTIME_DIR="$APP_DIR/runtime/${PLATFORM}"
NODE_BIN="$RUNTIME_DIR/node/bin/node"
PNPM_BIN="$RUNTIME_DIR/pnpm/pnpm"

# ── 2. 运行时 ───────────────────────────────────────────────────────────────
runtime_ready() { [ -x "$NODE_BIN" ] && [ -x "$PNPM_BIN" ]; }

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

install_runtime_download() {
  need_cmd tar "用于解压运行时"
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/dshdock-rt.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT INT TERM
  NODE_TARBALL="node-${NODE_VERSION}-${PLATFORM}.tar.gz"

  log "▸ 下载 Node ${NODE_VERSION} (${PLATFORM})"
  NODE_HTTP=""
  for base in "${NODE_DIST_MIRROR:-https://npmmirror.com/mirrors/node}" "https://nodejs.org/dist"; do
    if fetch "$base/$NODE_VERSION/$NODE_TARBALL" "$TMP/node.tar.gz"; then NODE_HTTP="$base"; break; fi
    log "  镜像不可用,换下一个: $base"
  done
  [ -n "$NODE_HTTP" ] || die "Node 下载失败(可设 NODE_DIST_MIRROR 指定镜像)"

  EXPECT_SHA=""
  EXPECT_SHA="$(sed -n 's/.*"nodeSha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" 2>/dev/null || true)"
  if [ "$PLATFORM" = "linux-x64" ] && [ -n "$EXPECT_SHA" ]; then
    verify_sha256 "$TMP/node.tar.gz" "$EXPECT_SHA"
  else
    # 非清单平台:用官方 SHASUMS256.txt 校验
    if fetch "$NODE_HTTP/$NODE_VERSION/SHASUMS256.txt" "$TMP/SHASUMS256.txt" 2>/dev/null; then
      verify_sha256 "$TMP/node.tar.gz" "$(awk -v f="$NODE_TARBALL" '$2==f {print $1}' "$TMP/SHASUMS256.txt")"
    else
      warn "拿不到 SHASUMS256.txt,跳过 Node 校验"
    fi
  fi

  rm -rf "$RUNTIME_DIR/node"
  mkdir -p "$RUNTIME_DIR"
  tar -xzf "$TMP/node.tar.gz" -C "$RUNTIME_DIR"
  mv "$RUNTIME_DIR/node-${NODE_VERSION}-${PLATFORM}" "$RUNTIME_DIR/node"
  [ -x "$NODE_BIN" ] || die "Node 解压后不可用: $NODE_BIN"
  log "  ✓ Node $("$NODE_BIN" -v)"

  log "▸ 下载 pnpm ${PNPM_VERSION}"
  PNPM_TGZ="pnpm-${PNPM_VERSION}.tgz"
  PNPM_HTTP=""
  for base in "${NPM_REGISTRY_MIRROR:-https://registry.npmmirror.com}" "https://registry.npmjs.org"; do
    if fetch "$base/pnpm/-/$PNPM_TGZ" "$TMP/pnpm.tgz"; then PNPM_HTTP="$base"; break; fi
    log "  镜像不可用,换下一个: $base"
  done
  [ -n "$PNPM_HTTP" ] || die "pnpm 下载失败(可设 NPM_REGISTRY_MIRROR 指定镜像)"

  EXPECT_INTEGRITY=""
  EXPECT_INTEGRITY="$(sed -n 's/.*"pnpmIntegrity"[[:space:]]*:[[:space:]]*"sha512-\([^"]*\)".*/\1/p' "$MANIFEST" 2>/dev/null || true)"
  if [ "$PNPM_VERSION" = "11.7.0" ] && [ -n "$EXPECT_INTEGRITY" ] && [ "$SKIP_VERIFY" != 1 ] && command -v openssl >/dev/null 2>&1; then
    got="$(openssl dgst -sha512 -binary "$TMP/pnpm.tgz" | base64 | tr -d '\n')"
    [ "$got" = "$EXPECT_INTEGRITY" ] || die "pnpm sha512 校验失败"
    log "  ✓ sha512 校验通过"
  fi

  rm -rf "$RUNTIME_DIR/pnpm/node_modules/pnpm"
  mkdir -p "$RUNTIME_DIR/pnpm/node_modules"
  tar -xzf "$TMP/pnpm.tgz" -C "$TMP"
  mv "$TMP/package" "$RUNTIME_DIR/pnpm/node_modules/pnpm"
  write_pnpm_shim
}

# 与服务端自带运行时同构的 pnpm 启动器(server 只认 <runtime>/pnpm/pnpm)
write_pnpm_shim() {
  mkdir -p "$RUNTIME_DIR/pnpm/bin"
  cat > "$PNPM_BIN" <<'SHIM'
#!/bin/sh
exec "$(dirname "$0")/../node/bin/node" "$(dirname "$0")/node_modules/pnpm/bin/pnpm.cjs" "$@"
SHIM
  cp "$PNPM_BIN" "$RUNTIME_DIR/pnpm/bin/pnpm"
  chmod +x "$PNPM_BIN" "$RUNTIME_DIR/pnpm/bin/pnpm"
  log "  ✓ pnpm $("$PNPM_BIN" -v)"
}

install_runtime_system() {
  need_cmd node "(--runtime system 需要系统已装 Node ≥ 22)"
  SYS_NODE="$(command -v node)"
  SYS_MAJOR="$("$SYS_NODE" -p 'process.versions.node.split(".")[0]')"
  [ "$SYS_MAJOR" -ge 22 ] || warn "系统 Node $("$SYS_NODE" -v) 偏旧,建议 ≥ 22 或改用 --runtime download"
  rm -rf "$RUNTIME_DIR/node" "$RUNTIME_DIR/pnpm"
  mkdir -p "$RUNTIME_DIR/node/bin" "$RUNTIME_DIR/pnpm"
  ln -sf "$SYS_NODE" "$RUNTIME_DIR/node/bin/node"
  if command -v pnpm >/dev/null 2>&1; then
    SYS_PNPM="$(command -v pnpm)"
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$SYS_PNPM" > "$PNPM_BIN"
    chmod +x "$PNPM_BIN"
    cp "$PNPM_BIN" "$RUNTIME_DIR/pnpm/bin/pnpm"
    log "  ✓ 复用系统 pnpm: $SYS_PNPM"
  else
    die "系统没有 pnpm;请先安装 pnpm,或改用 --runtime download"
  fi
  log "  ✓ 复用系统 Node: $SYS_NODE"
}

if runtime_ready; then
  log "▸ 运行时已就绪:$("$NODE_BIN" -v) + pnpm $("$PNPM_BIN" -v)"
else
  if [ "$ASSUME_YES" != 1 ] && [ -t 0 ]; then
    printf '将准备自带运行时(Node %s + pnpm %s,约 60MB 下载)到 %s,继续? [Y/n] ' "$NODE_VERSION" "$PNPM_VERSION" "$RUNTIME_DIR"
    read -r ans || ans=""
    case "$ans" in n|N|no|NO) die "已取消" ;; esac
  fi
  case "$RUNTIME_MODE" in
    download) install_runtime_download ;;
    system)   install_runtime_system ;;
  esac
fi
runtime_ready || die "运行时准备失败:$NODE_BIN / $PNPM_BIN"

# ── 3. dshdock 命令 ─────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
chmod +x "$APP_DIR/app/run.sh"
ln -sf "$APP_DIR/app/run.sh" "$BIN_DIR/dshdock"
log "▸ 命令已就绪: $BIN_DIR/dshdock → $APP_DIR/app/run.sh"
case ":${PATH}:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR 不在 PATH 里;把它加进 shell 配置(或直接用 $BIN_DIR/dshdock 全路径)" ;;
esac

# ── 4. 部署目录配置 ─────────────────────────────────────────────────────────
CONFIG_DIR="${DSHDOCK_CONFIG_DIR:-$HOME/.config/dshdock}"
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ -f "$CONFIG_FILE" ]; then
  log "▸ 已有部署目录配置,保持不变: $CONFIG_FILE"
else
  mkdir -p "$CONFIG_DIR"
  printf '{\n  "dataRoot": "%s"\n}\n' "$DATA_ROOT_OPT" > "$CONFIG_FILE"
  log "▸ 部署目录: $DATA_ROOT_OPT(配置写入 $CONFIG_FILE)"
fi

# ── 5. 启动 ─────────────────────────────────────────────────────────────────
if [ "$DO_START" = 1 ]; then
  log "▸ 启动 DSH Dock 服务(端口 $PORT)"
  DSHWEB_PORT="$PORT" "$BIN_DIR/dshdock" bg || die "服务启动失败,日志见 $DATA_ROOT_OPT/logs/stdout.log"
else
  log "▸ 已跳过启动;稍后执行: dshdock bg"
fi

log ""
log "完成。"
log "  服务地址: http://127.0.0.1:$PORT/(首次打开即容器管理界面)"
log "  常用命令: dshdock status | dshdock stop | dshdock devrestart"
log "  部署数据: $DATA_ROOT_OPT(containers/ versions/ logs/)"
log "  下一步:  在 WebUI 安装一个 DSH 版本 → 新建容器 → 启动 → 打开该容器的 DSH UI"
