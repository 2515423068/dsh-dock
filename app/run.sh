#!/bin/sh
# `dshdock` 的 POSIX 入口(POSIX = Linux / macOS / WSL)。
#
# 这里只做两件事:定位自带运行时的 node,然后把命令原样交给 app/cli.mjs ——
# 跨平台逻辑都在 cli.mjs 里(一份实现,Windows 由 app/dshdock.cmd 走同一入口)。
# 之所以不再用 setsid/nohup/pgrep/python3:那些在 macOS 与 Windows 上并不齐备,
# 而 cli.mjs 用 detached+unref / taskkill 提供了等价能力。
set -eu

# 解析符号链接(不依赖 readlink -f:macOS 的 readlink 没有 -f)
SELF="$0"
while [ -L "$SELF" ]; do
  DIR="$(cd -P "$(dirname "$SELF")" && pwd)"
  SELF="$(readlink "$SELF")"
  case "$SELF" in
    /*) ;;
    *) SELF="$DIR/$SELF" ;;
  esac
done
APP="$(cd -P "$(dirname "$SELF")" && pwd)"

# DATA_ROOT 解析与服务端一致(env → 配置文件 → 安装目录),仅用于定位自带运行时
DATA="${DSHBOX_DATA_ROOT:-}"
if [ -z "$DATA" ]; then
  CFG="${DSHDOCK_CONFIG_DIR:-$HOME/.config/dshdock}/config.json"
  if [ -f "$CFG" ]; then
    DATA="$(sed -n 's/.*"dataRoot"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CFG" | head -1)"
  fi
fi
[ -z "$DATA" ] && DATA="$(cd "$APP/.." && pwd)"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64|Linux-amd64)  NODE_TARGET="linux-x64" ;;
  Linux-aarch64|Linux-arm64) NODE_TARGET="linux-arm64" ;;
  Darwin-x86_64)             NODE_TARGET="darwin-x64" ;;
  Darwin-arm64)              NODE_TARGET="darwin-arm64" ;;
  *)                         NODE_TARGET="linux-x64" ;;
esac

NODE=""
for cand in \
  "$DATA/runtime/$NODE_TARGET/node/bin/node" "$APP/../runtime/$NODE_TARGET/node/bin/node" \
  "$DATA/runtime/linux-x64/node/bin/node" "$APP/../runtime/linux-x64/node/bin/node"; do
  if [ -x "$cand" ]; then NODE="$cand"; break; fi
done
if [ -z "$NODE" ]; then
  NODE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE" ]; then
  echo "✗ 找不到 node:请先运行 install.sh 准备自带运行时,或安装 Node.js(≥22)" >&2
  exit 1
fi

exec "$NODE" "$APP/cli.mjs" "$@"
