#!/bin/sh
# 用法: dshdock [前台默认, Ctrl+C 退出] / dshdock bg [后台+浏览器] / stop / status / restart / fg [--no-browser] / devrestart
# 用法:
#   dshdock              启动服务并打开浏览器
#   dshdock --no-browser 只启动服务
#   dshdock stop         优雅关闭(先停运行中的容器)
#   dshdock status       查看服务与容器状态
#   dshdock restart      重启服务(优雅:先停所有容器)
#   dshdock devrestart   开发模式重启:SIGKILL 服务进程,容器进程保留,新服务以独立会话拉起
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
  pgrep -f "$APP/server[.]mjs" | head -1
}

start_server() {
  if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then return 0; fi
  mkdir -p "$DATA/logs"
  # setsid 独立会话 + 开发模式:服务不随调用方终端死亡;信号退出时容器进程保留
  DSHDOCK_DEV=1 setsid nohup node "$APP/server.mjs" >> "$LOG" < /dev/null 2>&1 &
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
    cl_root="$DATA"
    cl_cfg="$HOME/.config/dshdock/config.json"
    if [ -f "$cl_cfg" ]; then
      cl_r=$(python3 -c "import json;print(json.load(open('$cl_cfg')).get('dataRoot',''))" 2>/dev/null)
      [ -n "$cl_r" ] && cl_root="$cl_r"
    fi
    cl_n=$(grep -l '"state": *"running"' "$cl_root"/containers/*/state/host.json 2>/dev/null | wc -l)
    [ "$cl_n" -gt 0 ] && echo "发现 $cl_n 条运行中容器记录(可能为孤儿进程),可执行 dshdock cleanup 清理"
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

cmd_devrestart() {
  # 开发模式重启保护:SIGKILL 服务进程(不触发 gracefulShutdown 的停容器逻辑),
  # detached 的容器进程组原样保留;新服务以 setsid 独立会话拉起,
  # 不随调用方终端/命令组的退出或被杀而死亡。进行中的后台任务会随服务中断。
  pid="$(server_pid)"
  if [ -n "$pid" ]; then
    kill -9 "$pid" 2>/dev/null
    down=""
    for _ in $(seq 20); do
      curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1 || { down=1; break; }
      sleep 0.3
    done
    # kill 必须确实生效:若信号未送达(权限/pid 命名空间隔离等),绝不能带着旧服务拉起新服务
    # (否则新进程 EADDRINUSE,而探活打在旧服务上,造成"已重启"假象)
    if [ -z "$down" ]; then
      echo "✗ 无法确认服务进程(pid=$pid)已停止,放弃本次重启;请手动检查: ss -tlnp | grep $PORT"
      return 1
    fi
  elif curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then
    echo "✗ 找不到服务进程记录,但端口 $PORT 仍有服务在响应,放弃本次重启;请手动排查"
    return 1
  fi
  mkdir -p "$DATA/logs"
  # 开发模式信号保护:误发的 SIGINT/SIGTERM 只退出服务,不停容器
  DSHDOCK_DEV=1 setsid nohup node "$APP/server.mjs" >> "$LOG" < /dev/null 2>&1 &
  ok=""
  for _ in $(seq 40); do
    if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then ok=1; break; fi
    sleep 0.5
  done
  [ "$ok" ] || {
    echo "✗ 服务重启失败,最近的错误输出:"
    tail -10 "$LOG" 2>/dev/null | sed 's/^/    /'
    return 1
  }
  echo "DSH Dock 已重启(容器进程保留): $BASE_URL/"
  curl -s "$BASE_URL/api/containers" | python3 -c "
import json, sys
try:
    containers = json.load(sys.stdin)
except Exception:
    exit(0)
for c in containers:
    line = '  容器 {}: {}'.format(c['name'], c['status'])
    if c.get('url'):
        line += '  ' + c['url']
    print(line)"
}

cmd_cleanup() {
  # 清理孤儿 DSH 容器进程:仅当 dshdock 服务未运行(运行中容器由服务管理)。
  # 按容器记录(host.json 的 pid/pgid/port)三重核对(进程存活 + cmdline 为 DSH
  # host + 端口在监听)后杀进程组,防 pid 复用误杀;受开发保护的容器跳过。
  if curl -sf "$BASE_URL/api/settings" >/dev/null 2>&1; then
    echo "✗ DSH Dock 服务运行中,容器由服务管理;请用 UI 停止容器或执行 dshdock stop"
    return 1
  fi
  cl_port=""
  if [ "$1" = "-port" ]; then
    cl_port="$2"
    [ -z "$cl_port" ] && { echo "用法: dshdock cleanup -port <端口号>"; return 1; }
  fi
  cl_root="$DATA"
  cl_cfg="$HOME/.config/dshdock/config.json"
  if [ -f "$cl_cfg" ]; then
    cl_r=$(python3 -c "import json;print(json.load(open('$cl_cfg')).get('dataRoot',''))" 2>/dev/null)
    [ -n "$cl_r" ] && cl_root="$cl_r"
  fi
  python3 - "$cl_root" "$cl_port" <<'PYEOF'
import glob, json, os, signal, sys, time

root = sys.argv[1]
port_filter = int(sys.argv[2]) if sys.argv[2] else None

listeners = set()
for f in ('/proc/net/tcp', '/proc/net/tcp6'):
    try:
        lines = open(f).read().splitlines()[1:]
    except OSError:
        continue
    for line in lines:
        parts = line.split()
        if len(parts) > 3 and parts[3] == '0A':
            listeners.add(int(parts[1].split(':')[1], 16))

victims = []
for host_file in sorted(glob.glob(os.path.join(root, 'containers', '*', 'state', 'host.json'))):
    cdir = os.path.dirname(os.path.dirname(host_file))
    try:
        rec = json.load(open(host_file))
        meta = json.load(open(os.path.join(cdir, 'container.json')))
    except Exception:
        continue
    if rec.get('state') not in ('running', 'starting'):
        continue
    name = meta.get('name') or meta.get('id') or '?'
    port, pgid = rec.get('port'), rec.get('pgid')
    if not port or not pgid:
        continue
    if port_filter is not None and port != port_filter:
        continue
    alive = True
    try:
        os.kill(pgid, 0)
    except ProcessLookupError:
        alive = False
    except PermissionError:
        alive = True
    if not alive:
        continue
    try:
        cmd = open(f'/proc/{pgid}/cmdline', 'rb').read().decode('utf-8', 'replace')
    except OSError:
        continue
    if not ('bin.ts' in cmd and '--profile' in cmd):
        print(f'跳过 {name}: pid {pgid} 不是 DSH host 进程(防 pid 复用误杀)')
        continue
    if meta.get('devProtect'):
        print(f'跳过 {name}: 受开发保护(如确认要清理,先在 UI 关闭保护)')
        continue
    victims.append((cdir, meta, rec, name, port, pgid))

if port_filter is not None and not victims:
    print(f'没有找到使用端口 {port_filter} 的存活 DSH 容器')
    sys.exit(1)
if not victims:
    print('没有需要清理的孤儿容器进程')
    sys.exit(0)

for cdir, meta, rec, name, port, pgid in victims:
    print(f'停止 {name} (pid={pgid}, port={port}) ...')
    try:
        os.kill(-pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass
time.sleep(5)
for cdir, meta, rec, name, port, pgid in victims:
    alive = True
    try:
        os.kill(pgid, 0)
    except ProcessLookupError:
        alive = False
    if alive:
        print(f'  {name} 5s 未退出,SIGKILL')
        try:
            os.kill(-pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    rec['state'] = 'stopped'
    rec['exitStatus'] = {'signal': 'SIGTERM'}
    try:
        json.dump(rec, open(os.path.join(cdir, 'state', 'host.json'), 'w'), indent=2)
    except OSError:
        pass
print(f'清理完成: {len(victims)} 个')
PYEOF
}

case "$1" in
  stop)    cmd_stop ;;
  uninstall-data) cmd_uninstall_data "$@" ;;
  status)  cmd_status ;;
  restart) cmd_stop; cmd_start --no-browser ;;
  devrestart) cmd_devrestart ;;
  cleanup) shift; cmd_cleanup "$@" ;;
  start|bg) cmd_start "$2" ;;
  fg)      cmd_fg "$2" ;;
  *)       cmd_fg "$1" ;;
esac
