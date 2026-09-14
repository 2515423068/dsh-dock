@echo off
rem ============================================================================
rem  `dshdock` 的 Windows 入口(cmd / PowerShell / Git Bash 均可调用)。
rem
rem  与 POSIX 的 app/run.sh 等价:定位自带运行时的 node.exe,再把命令交给
rem  app/cli.mjs —— 所有逻辑(启动/停止/状态/重启/清理)都在这份 Node 实现里。
rem
rem  用法:  dshdock [bg^|stop^|status^|restart^|devrestart^|cleanup ^[-port N^]^|selftest^|uninstall-data --yes]
rem          dshdock            = 前台启动(Ctrl+C 停止所有容器并退出)
rem ============================================================================
setlocal enableextensions
set "APP=%~dp0"

set "NODE="
if not defined NODE if exist "%APP%..\runtime\win-x64\node\node.exe" set "NODE=%APP%..\runtime\win-x64\node\node.exe"
if not defined NODE if exist "%APP%..\runtime\win-arm64\node\node.exe" set "NODE=%APP%..\runtime\win-arm64\node\node.exe"
if not defined NODE if exist "%APP%runtime\win-x64\node\node.exe" set "NODE=%APP%runtime\win-x64\node\node.exe"
if not defined NODE set "NODE=node"

"%NODE%" "%APP%cli.mjs" %*
exit /b %ERRORLEVEL%
