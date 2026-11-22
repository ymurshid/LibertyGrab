@echo off
chcp 65001 >nul
title LibertyGrab Local Video Engine
cd /d "%~dp0server"
".venv\Scripts\python.exe" "server.py"
pause
