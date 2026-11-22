@echo off
chcp 65001 >nul
title Restart LibertyGrab Engine
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:17890/api/shutdown' -Method Post -Headers @{'X-VideoGrab-Token'='local-v1'} -Body '{}' -ContentType 'application/json' -TimeoutSec 3 | Out-Null } catch {}"
timeout /t 2 >nul
wscript.exe "%~dp0Start-Engine.vbs"
