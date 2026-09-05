#!/bin/sh
# 用法: dshdock [前台默认, Ctrl+C 退出] / dshdock bg [后台+浏览器] / stop / status / restart / fg [--no-browser]
# 用法:
#   dshdock              启动服务并打开浏览器
#   dshdock --no-browser 只启动服务
#   dshdock stop         优雅关闭(先停运行中的容器)
#   dshdock status       查看服务与容器状态
#   dshdock restart      重启服务
PORT="${DSHWEB_PORT:-7940}"
SELF="$(readlink -f "$0")"
APP="$(cd "$(dirname "$SELF")" && pwd)"
DATA="$(cd "$APP/.." && pwd)"
LOG="$DATA/logs/stdout.log"
PID_FILE="$DATA/state/dshdock.pid"
BASE_URL="http://127.0.0.1:$PORT"

server_pid() {
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid"; return; fi
  pgrep -f "DSHProgram/DSHBox/app/server[.]mjs" | head -1
}

start_server() {
  if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then return 0; fi
  mkdir -p "$DATA/logs"
  nohup node "$APP/server.mjs" >> "$LOG" 2>&1 &
  ok=""
  for _ in $(seq 20); do
    if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.5
  done
  [ "$ok" ] || {
    echo "✗ DSH Dock 服务启动失败,最近的错误输出:"
    tail -10 "$LOG" 2>/dev/null | sed 's/^/    /'
    echo "  完整日志: $LOG"
    return 1
  }
}

cmd_start() {
  start_failed() {
    echo "✗ DSH Dock 服务启动失败,最近的错误输出:"
    tail -10 "$LOG" 2>/dev/null | sed 's/^/    /'
    echo "  完整日志: $LOG"
    exit 1
  }
  start_server || exit 1
  echo "DSH Dock: $BASE_URL/"
  [ "$1" = "--no-browser" ] && exit 0
  exec xdg-open "$BASE_URL/"
}

cmd_uninstall_data() {
  # 卸载原则:只删除应用自己产生的文件/目录,绝不触碰用户文档与项目其他内容
  echo "将删除以下应用生成内容:"
  echo "  部署目录: containers/ versions/ pnpm-store/ state/ logs/ plugins/"
  echo "  配置:     ~/.config/dshdock/"
  echo "保留: app/ runtime/ DSHDock_Docs/ AGENTS.md 及部署目录中其他所有文件"
  if [ "$2" != "--yes" ]; then
    printf "确认? [y/N] "
    read -r answer
    case "$answer" in y|Y|yes|YES) ;; *) echo "已取消"; exit 0;; esac
  fi
  cmd_stop_inner
  for d in containers versions pnpm-store state logs plugins; do
    rm -rf "$DATA/$d"
  done
  rm -rf "$HOME/.config/dshdock"
  echo "卸载完成。部署目录剩余内容:"
  ls -A "$DATA" 2>/dev/null | sed 's/^/  /'
}

cmd_stop() {
  pid="$(server_pid)"
  if [ -z "$pid" ]; then
    echo "DSH Dock 未在运行"
    return 0
  fi
  # 优雅关闭:服务端先停容器再退出
  if curl -sf -X POST "$BASE_URL/api/shutdown" >/dev/null 2>&1; then
    for _ in $(seq 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    sleep 1
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
  fi
  rm -f "$PID_FILE"
  echo "DSH Dock 已停止"
}

cmd_stop_inner() { cmd_stop >/dev/null 2>&1 || true; }

cmd_status() {
  if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then
    echo "服务: 运行中 ($BASE_URL)"
    curl -s "$BASE_URL/api/containers" | python3 -c "
import json, sys
try:
    containers = json.load(sys.stdin)
except Exception:
    exit(0)
if not containers:
    print('容器: (无)')
for c in containers:
    line = '容器 {}: {}'.format(c['name'], c['status'])
    if c.get('url'):
        line += '  ' + c['url']
    print(line)"
  else
    echo "服务: 未运行"
  fi
}

cmd_fg() {
  # 前台模式(默认):进程占用终端,Ctrl+C = 停容器并退出(日志实时可见)
  if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then
    echo "✗ 服务已在后台运行,先执行 dshdock stop 再用前台模式"
    exit 1
  fi
  echo "DSH Dock 前台模式: $BASE_URL/ (Ctrl+C 停止所有容器并退出)"
  [ "$2" = "--no-browser" ] || ( sleep 2; xdg-open "$BASE_URL/" >/dev/null 2>&1 ) &
  cd "$APP" && exec node server.mjs
}

case "$1" in
  stop)    cmd_stop ;;
  uninstall-data) cmd_uninstall_data "$@" ;;
  status)  cmd_status ;;
  restart) cmd_stop; cmd_start --no-browser ;;
  start|bg) cmd_start "$2" ;;
  fg)      cmd_fg "$2" ;;
  *)       cmd_fg "$1" ;;
esac
