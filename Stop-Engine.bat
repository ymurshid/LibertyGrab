@echo off
chcp 65001 >nul
title Stop LibertyGrab Engine
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:17890/api/shutdown' -Method Post -Headers @{'X-VideoGrab-Token'='local-v1'} -Body '{}' -ContentType 'application/json' -TimeoutSec 3 | Out-Null; Write-Host 'تم إيقاف المحرك المحلي بنجاح.' -ForegroundColor Green } catch { Write-Host 'المحرك المحلي متوقف بالفعل.' -ForegroundColor Yellow }"
timeout /t 2 >nul
