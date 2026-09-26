@echo off
title 推送到 GitHub
cd /d "%~dp0"
set "NODE_EXE=D:\DSnode\node.exe"
if exist "%NODE_EXE%" goto RUN
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE_EXE%" goto RUN
set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%NODE_EXE%" goto RUN
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
if exist "%NODE_EXE%" goto RUN
echo [错误] 没找到 node.exe
pause
exit /b 1
:RUN
"%NODE_EXE%" "%~dp0push-interactive.mjs"
pause