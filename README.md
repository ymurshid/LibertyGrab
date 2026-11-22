<p align="center">
  <img src="extension/icons/libertygrab-mark.svg" alt="LibertyGrab Logo" width="84" height="84" />
</p>

<h1 align="center">LibertyGrab</h1>

<p align="center">
  <strong>Universal Chromium Video Downloader Extension + Lightweight Local Companion Engine</strong><br/>
  محمّل الفيديوهات الشامل للمتصفح بواجهة عربية داكنة بهوية Liberty Dev
</p>

---

## Features / المميزات

- **1,000+ Supported Sites** — YouTube, X (Twitter), Facebook, Instagram, TikTok, Reddit, Vimeo, Dailymotion, HLS (`.m3u8`), DASH (`.mpd`), and direct HTML5 `<video>` files.
- **Quality & Format Picker** — Auto-detects video thumbnail, duration, and available resolutions (`4K`, `1440p`, `1080p`, `720p`, `480p`, `360p`) plus **Audio Only (`MP3 192kbps`)** with automatic FFmpeg muxing.
- **3-Layer Live Page Video Detector («التقاط الصفحة»)** — Combines network request sniffing (`webRequest`), active multi-frame DOM & `<iframe>` inspection (`chrome.scripting`), and browser resource timing (`performance.getEntriesByType`) to catch direct streams, `blob:` players, and embedded videos.
- **Non-Intrusive Floating Hover Button** — Shadow-DOM isolated download pill on video players with automatic feed post/tweet/reel permalink detection (toggleable on/off).
- **Spotless Download Folder & Custom Save Path** — Downloads and muxes inside an isolated per-job temp directory and moves only 100% verified completed files to your chosen folder (changeable anytime via native Windows Folder Picker).
- **Local-Only Security** — Companion server binds strictly to `127.0.0.1:17890`, blocks all external web origins (`HTTP 403`), requires extension token headers, and deletes temporary browser cookie files immediately after each job.

---

## Quick Install on Windows (No Python Required!)

### Option A — 1-Click Windows Setup (Recommended)
1. Download **`LibertyGrab-Setup.exe`** from the [**Latest Release**](https://github.com/ymurshid/LibertyGrab/releases/latest).
2. Run **`LibertyGrab-Setup.exe`** (`Next -> Next -> Finish`) — includes bundled `yt-dlp` + `FFmpeg` + optional Windows AutoStart.
3. Load the extension in **Chrome / Edge / Brave**:
   - Navigate to `chrome://extensions` (or `edge://extensions` / `brave://extensions`).
   - Enable **Developer mode**, click **Load unpacked**, and select `%LocalAppData%\LibertyGrab\extension`.

### Option B — From Source
1. Clone this repository:
   ```bash
   git clone https://github.com/ymurshid/LibertyGrab.git
   ```
2. Double-click **`Install.bat`** — automatically sets up Python `.venv`, installs `yt-dlp[default]` + `FFmpeg`, starts the background engine, and opens the `extension` folder.

> - For Arabic instructions, see [README-AR.md](README-AR.md).
> - For Chrome Web Store publishing & Store build, see [CHROME_WEB_STORE_GUIDE.md](CHROME_WEB_STORE_GUIDE.md) and [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

---

## Utility Scripts

| File | Purpose |
| :--- | :--- |
| `Install.bat` | One-click setup on any new Windows PC |
| `Start-Engine.vbs` | Start the local engine silently in the background (no terminal window) |
| `Start-Engine-Console.bat` | Start with a visible console log window |
| `Restart-Engine.bat` | Restart the local engine |
| `Stop-Engine.bat` | Gracefully stop the local engine |
| `Enable-AutoStart.bat` | Automatically start the engine on Windows login |
| `Disable-AutoStart.bat` | Remove Windows login autostart |
| `Update-Engine.bat` | Update `yt-dlp` to the latest release |

---

## Disclaimer

LibertyGrab is intended solely for downloading publicly accessible or personal non-DRM media that you have permission to save. DRM-encrypted content (Widevine, PlayReady, FairPlay) is not supported.

## License

MIT License — see [LICENSE](LICENSE).
