@echo off
chcp 65001 >nul
cd /d "%~dp0"
set OPEN=1
node tools\server.js
pause
