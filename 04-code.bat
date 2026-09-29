@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" %*
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
