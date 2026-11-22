# Builds LibertyGrab-Engine (--onedir to prevent AV false positives), Extension ZIPs, and LibertyGrab-Setup.exe
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $RootDir "server"
$DistDir = Join-Path $RootDir "dist"
$EngineOutDir = Join-Path $DistDir "engine"
$IconPath = Join-Path $RootDir "extension\icons\libertygrab.ico"
$VersionFile = Join-Path $PSScriptRoot "version_info.txt"

$PythonExe = Join-Path $ServerDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
  $PythonExe = "python"
}

Write-Host "[1/4] Resolving bundled FFmpeg binary..." -ForegroundColor Cyan
$FfmpegPath = & $PythonExe -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
if (-not $FfmpegPath -or -not (Test-Path $FfmpegPath)) {
  throw "Could not locate ffmpeg binary from imageio-ffmpeg."
}

$StagingBin = Join-Path $DistDir "staging_bin"
New-Item -ItemType Directory -Force -Path $StagingBin | Out-Null
$CleanFfmpeg = Join-Path $StagingBin "ffmpeg.exe"
Copy-Item -Force $FfmpegPath $CleanFfmpeg

Write-Host "[2/4] Packaging LibertyGrab-Engine (--onedir, --noupx, PE version info)..." -ForegroundColor Cyan
if (Test-Path $EngineOutDir) { Remove-Item -Recurse -Force $EngineOutDir }
New-Item -ItemType Directory -Force -Path $EngineOutDir | Out-Null

& $PythonExe -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --noconsole `
  --noupx `
  --name "LibertyGrab-Engine" `
  --icon "$IconPath" `
  --version-file "$VersionFile" `
  --distpath "$EngineOutDir" `
  --workpath (Join-Path $RootDir "build\pyinstaller") `
  --specpath (Join-Path $RootDir "build\pyinstaller") `
  --add-binary "$CleanFfmpeg;bin" `
  --collect-all "yt_dlp" `
  --collect-all "yt_dlp_ejs" `
  --hidden-import "tkinter" `
  --hidden-import "tkinter.filedialog" `
  (Join-Path $ServerDir "server.py")

$BuiltExe = Join-Path $EngineOutDir "LibertyGrab-Engine\LibertyGrab-Engine.exe"
if (-not (Test-Path $BuiltExe)) {
  throw "PyInstaller failed to produce $BuiltExe"
}

Write-Host "[3/4] Building Extension ZIPs (Full + Chrome Web Store Edition)..." -ForegroundColor Cyan
& $PythonExe (Join-Path $PSScriptRoot "build_extensions.py")

Write-Host "[4/4] Building LibertyGrab-Setup.exe via Inno Setup..." -ForegroundColor Cyan
$Iscc = Get-Command iscc -ErrorAction SilentlyContinue
if (-not $Iscc) {
  foreach ($cand in @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
  )) {
    if (Test-Path $cand) {
      $Iscc = $cand
      break
    }
  }
}

if ($Iscc) {
  $IsccPath = if ($Iscc -is [string]) { $Iscc } else { $Iscc.Source }
  & $IsccPath (Join-Path $PSScriptRoot "LibertyGrab.iss")
  Write-Host "[SUCCESS] LibertyGrab-Setup.exe created in $DistDir" -ForegroundColor Green
} else {
  Write-Host "[INFO] Inno Setup (ISCC.exe) not installed locally. GitHub Actions will compile LibertyGrab-Setup.exe automatically." -ForegroundColor Yellow
}
