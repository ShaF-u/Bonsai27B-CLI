@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0chat.ps1" -PromptFile "%~dp0test-prompt.txt" -NoThinking -MaxTokens 256 %*
set "result=%errorlevel%"
pause
exit /b %result%
