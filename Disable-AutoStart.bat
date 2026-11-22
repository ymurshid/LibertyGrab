@echo off
chcp 65001 >nul
title Disable Liberty AutoStart
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Liberty-Engine.lnk"
set "OLD_SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OmniGrab-Engine.lnk"
if exist "%OLD_SHORTCUT%" del /f /q "%OLD_SHORTCUT%"
if exist "%SHORTCUT_PATH%" (
  del /f /q "%SHORTCUT_PATH%"
  echo تم إلغاء التشغيل التلقائي مع ويندوز بنجاح.
) else (
  echo التشغيل التلقائي غير مفعّل حالياً.
)
timeout /t 2 >nul
