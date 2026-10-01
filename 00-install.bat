@echo off
setlocal
chcp 65001 >nul
rem Works next to scripts\ or as a standalone copy (install folder is looked up in the registry).
set "ROOT=%~dp0"
if not exist "%ROOT%scripts\common.ps1" for /f "tokens=2,*" %%A in ('reg query "HKCU\Software\Bonsai27B-CLI" /v InstallDir 2^>nul ^| "%SystemRoot%\System32\find.exe" "InstallDir"') do set "ROOT=%%B\"
if not exist "%ROOT%scripts\common.ps1" (echo Bonsai27B-CLI not found. Run the installer or 00-install.bat first.& pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\install.ps1" %*
set "result=%errorlevel%"
pause
exit /b %result%
