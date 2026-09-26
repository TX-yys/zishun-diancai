@echo off
title 志顺小馆（小仝宝店）· 点菜服务
cd /d "%~dp0"

echo.
echo ============================================================
echo   志顺小馆（小仝宝店）· 点菜 + 接单后台
echo ============================================================
echo.

rem ---- 找到 node.exe ----
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "D:\DSnode\node.exe" set "NODE_EXE=D:\DSnode\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE_EXE (
  echo [错误] 没有找到 node.exe，无法启动服务。
  echo        请先安装 Node.js，或把本脚本里的路径改成你电脑上的 node.exe 位置。
  echo.
  pause
  exit /b 1
)

rem ---- 可选：设置后台口令（想开启就把下面这行前面的 rem 去掉并改口令）----
rem set "ADMIN_TOKEN=zishun2024"

rem ---- 启动服务 ----
echo 正在启动服务，请稍候...
echo.
start "" /min "%NODE_EXE%" "%~dp0server.js" 8080

rem ---- 等待端口就绪 ----
set /a TRIES=0
:WAIT
set /a TRIES+=1
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -Command "try{Invoke-WebRequest 'http://127.0.0.1:8080/api/health' -UseBasicParsing -TimeoutSec 2 > $null; exit 0}catch{exit 1}" >nul 2>nul
if %errorlevel%==0 goto READY
if %TRIES% GEQ 15 goto FAILED
goto WAIT

:READY
echo 服务已启动，正在打开二维码页（打印桌贴用）...
start "" "http://127.0.0.1:8080/qr"
echo.
echo  顾客点菜页 :  http://127.0.0.1:8080/
echo  店员接单台 :  http://127.0.0.1:8080/admin
echo  扫码桌贴页 :  http://127.0.0.1:8080/qr
echo.
echo  关闭本窗口不会停止服务；要停止服务请运行「停止服务.bat」
ping -n 9 127.0.0.1 >nul
exit /b 0

:FAILED
echo.
echo [错误] 服务启动失败，常见原因：
echo   1) 8080 端口已被占用（可改用 8081：把本脚本里的 8080 改成 8081）
echo   2) node.exe 路径不对
echo.
pause
exit /b 1
