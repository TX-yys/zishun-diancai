@echo off
title 停止点菜服务
cd /d "%~dp0"

echo.
echo 正在停止占用 8080 端口的点菜服务...
echo.

set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
  echo   结束进程 PID=%%p
  taskkill /F /PID %%p >nul 2>nul
  set "FOUND=1"
)

if "%FOUND%"=="0" (
  echo   没有发现正在运行的服务（8080 端口空闲）。
) else (
  echo.
  echo   服务已停止。订单数据仍保存在 data\orders.json 中，不会丢失。
)

echo.
ping -n 6 127.0.0.1 >nul
exit /b 0
