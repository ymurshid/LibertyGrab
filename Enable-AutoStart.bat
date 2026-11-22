@echo off
chcp 65001 >nul
title Enable Liberty AutoStart
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=%~dp0Start-Engine.vbs"
set "SHORTCUT_PATH=%STARTUP_DIR%\Liberty-Engine.lnk"
if exist "%STARTUP_DIR%\OmniGrab-Engine.lnk" del /f /q "%STARTUP_DIR%\OmniGrab-Engine.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\" --silent'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

echo ==================================================
echo تم تفعيل التشغيل التلقائي للمحرك مع إقلاع ويندوز بنجاح!
echo كما سيتم تشغيله الآن في الخلفية فوراً...
echo ==================================================
wscript.exe "%TARGET_VBS%" --silent
timeout /t 3 >nul
