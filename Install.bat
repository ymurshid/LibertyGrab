@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title LibertyGrab — 1-Click Installer

echo ==============================================================
echo   LibertyGrab — Universal Browser Video Downloader Installer
echo ==============================================================
echo.

:: 1. Check Python
where python >nul 2>&1
if errorlevel 1 (
  echo [1/4] Python not found. Attempting automatic install via winget...
  where winget >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH", then run Install.bat again.
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo.
  echo Please close this window and run Install.bat again so PATH refreshes.
  pause
  exit /b 0
) else (
  echo [1/4] Python detected.
)

:: 2. Check Node.js (recommended for YouTube EJS challenge solver)
where node >nul 2>&1
if errorlevel 1 (
  echo [2/4] Node.js not found. Installing Node.js LTS via winget for full YouTube support...
  where winget >nul 2>&1
  if not errorlevel 1 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  ) else (
    echo [WARN] Node.js not found. YouTube 4K/1080p works best with Node.js installed from https://nodejs.org/
  )
) else (
  echo [2/4] Node.js detected.
)

:: 3. Create isolated Python virtual environment and install yt-dlp + FFmpeg
cd /d "%~dp0server"
if not exist ".venv\Scripts\python.exe" (
  echo [3/4] Creating isolated virtual environment...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create Python virtual environment.
    pause
    exit /b 1
  )
)

echo [3/4] Installing yt-dlp[default] and bundled FFmpeg...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>&1
".venv\Scripts\pip.exe" install -U "yt-dlp[default]" imageio-ffmpeg
if errorlevel 1 (
  echo [ERROR] Failed to install Python dependencies. Check your internet connection.
  pause
  exit /b 1
)

:: 4. Start the local engine silently
echo [4/4] Starting LibertyGrab Local Engine in background...
cd /d "%~dp0"
wscript.exe "%~dp0Start-Engine.vbs" --silent

echo.
echo ==============================================================
echo   Installation Complete! (تم التثبيت بنجاح)
echo ==============================================================
echo.
echo   Final step (10 seconds in Chrome / Edge / Brave):
echo   1. Open  chrome://extensions  (or edge://extensions)
echo   2. Enable "Developer mode" (وضع المطور)
echo   3. Click  "Load unpacked"  (تحميل اضافة غير محزومة)
echo   4. Select this folder:
echo      %~dp0extension
echo.
set /p AUTOSTART="Enable automatic engine startup with Windows? (Y/N): "
if /i "%AUTOSTART%"=="Y" (
  call "%~dp0Enable-AutoStart.bat"
)

explorer.exe "%~dp0extension"
pause
