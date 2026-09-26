@echo off
title 部署点菜系统到公网
cd /d "%~dp0"

rem ---- 依次探测 node.exe（不依赖 PATH，最可靠）----
set "NODE_EXE="
if exist "D:\DSnode\node.exe" set "NODE_EXE=D:\DSnode\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"

if not defined NODE_EXE (
  echo.
  echo [错误] 没找到 node.exe，无法部署。
  echo        请先安装 Node.js: https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo 使用 node: %NODE_EXE%
echo.
"%NODE_EXE%" "%~dp0deploy-render.mjs"

echo.
echo ^(脚本已结束^)
pause