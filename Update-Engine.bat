@echo off
chcp 65001 >nul
title Update LibertyGrab Video Engine
cd /d "%~dp0server"
echo جاري تحديث محرك التحميل (yt-dlp) لأحدث إصدار لدعم كل تغييرات المواقع...
".venv\Scripts\python.exe" -m pip install -U "yt-dlp[default]" imageio-ffmpeg
".venv\Scripts\pip.exe" freeze > requirements.txt
echo.
echo اكتمل التحديث بنجاح! يرجى إعادة تشغيل المحرك عبر Stop-Engine.bat ثم Start-Engine.vbs
pause
