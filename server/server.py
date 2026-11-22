#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Liberty Local Companion Engine
محرك Liberty المحلي للتحميل (يدعم 1000+ موقع عبر yt-dlp + FFmpeg)
يعمل محلياً فقط على 127.0.0.1:17890 بأمان كامل.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

HOST = "127.0.0.1"
PORT = 17890
SERVER_VERSION = "1.1.0"
CLIENT_HEADER_NAME = "X-VideoGrab-Token"
CLIENT_HEADER_VALUE = "local-v1"

IS_FROZEN = bool(getattr(sys, "frozen", False))
BUNDLE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
if IS_FROZEN:
    BASE_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "LibertyGrab"
else:
    BASE_DIR = Path(__file__).resolve().parent

BASE_DIR.mkdir(parents=True, exist_ok=True)
BIN_DIR = BASE_DIR / "bin"
TEMP_COOKIES_DIR = BASE_DIR / "temp_cookies"
HISTORY_FILE = BASE_DIR / "jobs_history.json"
CONFIG_FILE = BASE_DIR / "config.json"
PID_FILE = BASE_DIR / "server.pid"

_CONFIG_LOCK = threading.Lock()


def load_saved_config() -> Dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def save_config(data: Dict[str, Any]) -> None:
    with _CONFIG_LOCK:
        CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_system_default_download_dir() -> Path:
    return Path.home() / "Downloads" / "VideoDownloader"


def resolve_download_dir() -> Path:
    saved = load_saved_config()
    saved_dir = str(saved.get("download_dir") or "").strip()
    custom = os.environ.get("OMNIGRAB_DOWNLOAD_DIR", "").strip()
    candidates = []
    if saved_dir:
        candidates.append(Path(saved_dir))
    if custom:
        candidates.append(Path(custom))
    candidates.append(get_system_default_download_dir())
    candidates.append(BASE_DIR.parent / "Downloads")
    for cand in candidates:
        try:
            cand.mkdir(parents=True, exist_ok=True)
            return cand
        except OSError:
            continue
    return BASE_DIR.parent / "Downloads"


# مجلد التحميل الافتراضي أو المختار من المستخدم
DEFAULT_DOWNLOAD_DIR = resolve_download_dir()


def get_download_dir() -> Path:
    with _CONFIG_LOCK:
        return DEFAULT_DOWNLOAD_DIR


def set_download_dir(path_str: str) -> Path:
    global DEFAULT_DOWNLOAD_DIR
    raw = (path_str or "").strip().strip('"').strip("'")
    if not raw:
        target = get_system_default_download_dir()
    else:
        target = Path(raw).expanduser()
        if not target.is_absolute():
            raise ValueError("يرجى كتابة مسار كامل مثل D:\\Videos")
    target.mkdir(parents=True, exist_ok=True)
    # اختبار إمكانية الكتابة داخل المجلد المختار
    probe = target / f".omnigrab_write_test_{uuid.uuid4().hex[:6]}"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink(missing_ok=True)

    cfg = load_saved_config()
    cfg["download_dir"] = str(target.resolve())
    save_config(cfg)
    with _CONFIG_LOCK:
        DEFAULT_DOWNLOAD_DIR = target.resolve()
    return target.resolve()


def cleanup_incomplete_files(directory: Path) -> int:
    """يمسح بقايا الملفات المؤقتة غير المكتملة (.part / .ytdl / .part-Frag* / .temp.*) فقط دون لمس الفيديوهات المكتملة."""
    if not directory.exists():
        return 0
    removed = 0
    incomplete_patterns = (
        re.compile(r"\.part$", re.IGNORECASE),
        re.compile(r"\.part-frag\d+", re.IGNORECASE),
        re.compile(r"\.ytdl$", re.IGNORECASE),
        re.compile(r"\.temp\.(mp4|webm|mkv|m4a|mp3)$", re.IGNORECASE),
        re.compile(r"\.f\d{2,4}\.(mp4|webm|m4a|opus)(\.part)?$", re.IGNORECASE),
        re.compile(r"\.fhls-[^.]+\.(mp4|webm|ts)(\.part)?$", re.IGNORECASE),
    )
    try:
        for entry in directory.iterdir():
            if not entry.is_file():
                continue
            name = entry.name
            if any(p.search(name) for p in incomplete_patterns):
                try:
                    entry.unlink()
                    removed += 1
                except OSError:
                    pass
    except OSError:
        pass
    return removed


class DownloadCancelledError(Exception):
    """يرفع عند إلغاء التحميل من قِبل المستخدم."""


def ensure_dirs() -> None:
    global DEFAULT_DOWNLOAD_DIR
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_COOKIES_DIR.mkdir(parents=True, exist_ok=True)
    DEFAULT_DOWNLOAD_DIR = resolve_download_dir()
    # تنظيف بقايا الملفات غير المكتملة القديمة من مجلد التحميلات تلقائياً
    cleanup_incomplete_files(DEFAULT_DOWNLOAD_DIR)
    # تنظيف أي ملفات كوكيز مؤقتة قديمة
    for f in TEMP_COOKIES_DIR.glob("cookies-*.txt"):
        try:
            f.unlink()
        except OSError:
            pass


def resolve_ffmpeg() -> Optional[str]:
    """يكتشف مسار ffmpeg من الحزمة المجمّعة أو النظام أو imageio-ffmpeg."""
    for candidate in (
        BUNDLE_DIR / "bin" / "ffmpeg.exe",
        Path(sys.executable).resolve().parent / "bin" / "ffmpeg.exe",
        Path(sys.executable).resolve().parent / "ffmpeg.exe",
        BIN_DIR / "ffmpeg.exe",
    ):
        if candidate.exists():
            return str(candidate)

    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg

    local_ffmpeg = BIN_DIR / "ffmpeg.exe"
    try:
        import imageio_ffmpeg  # type: ignore

        bundled_exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
        if bundled_exe.exists():
            try:
                BIN_DIR.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bundled_exe, local_ffmpeg)
                return str(local_ffmpeg)
            except OSError:
                return str(bundled_exe)
    except Exception:
        pass

    return None


FFMPEG_EXE: Optional[str] = None
JS_RUNTIMES: Dict[str, Dict[str, Any]] = {}


def resolve_js_runtimes() -> Dict[str, Dict[str, Any]]:
    """يكتشف Node.js أو Deno لتفعيل محرك yt-dlp-ejs تلقائياً لفك تحديات يوتيوب الحديثة."""
    runtimes: Dict[str, Dict[str, Any]] = {}
    node_exe = shutil.which("node")
    if not node_exe:
        for cand in (
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ):
            if Path(cand).exists():
                node_exe = cand
                break
    if node_exe:
        runtimes["node"] = {"path": node_exe}

    deno_exe = shutil.which("deno")
    if deno_exe:
        runtimes["deno"] = {"path": deno_exe}

    return runtimes


def is_youtube_url(url: str) -> bool:
    low = (url or "").lower()
    return any(h in low for h in ("youtube.com/", "youtu.be/", "youtube-nocookie.com/"))


def apply_platform_opts(
    base_opts: Dict[str, Any],
    url: str,
    headers: Dict[str, str],
    cookie_file: Optional[Path],
    use_cookies: bool,
) -> Dict[str, Any]:
    opts = dict(base_opts)
    if JS_RUNTIMES:
        opts["js_runtimes"] = JS_RUNTIMES

    yt = is_youtube_url(url)
    if yt:
        # لا نمرر Referer لليوتيوب حتى لا يعامله كمشغل مضمّن في موقع خارجي
        clean_headers = {k: v for k, v in headers.items() if k.lower() != "referer"}
        if clean_headers:
            opts["http_headers"] = clean_headers
        if use_cookies and cookie_file and cookie_file.exists():
            opts["cookiefile"] = str(cookie_file)
            opts["extractor_args"] = {
                "youtube": {"player_client": ["web", "tv_samsung", "web_safari"]}
            }
        else:
            opts["extractor_args"] = {
                "youtube": {"player_client": ["tv_samsung", "visionos", "web"]}
            }
    else:
        if headers:
            opts["http_headers"] = dict(headers)
        if use_cookies and cookie_file and cookie_file.exists():
            opts["cookiefile"] = str(cookie_file)

    return opts


def format_bytes(num: Optional[float]) -> str:
    if not num or num <= 0:
        return ""
    units = ["B", "KB", "MB", "GB", "TB"]
    val = float(num)
    for unit in units:
        if val < 1024.0:
            return f"{val:.1f} {unit}" if unit != "B" else f"{int(val)} B"
        val /= 1024.0
    return f"{val:.1f} PB"


def format_eta(seconds: Optional[float]) -> str:
    if seconds is None or seconds < 0:
        return ""
    sec = int(seconds)
    if sec < 60:
        return f"{sec} ث"
    mins, rem = divmod(sec, 60)
    if mins < 60:
        return f"{mins:02d}:{rem:02d}"
    hrs, mins = divmod(mins, 60)
    return f"{hrs}:{mins:02d}:{rem:02d}"


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "video")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:150] or "video"


def friendly_arabic_error(raw_err: str) -> str:
    lower = (raw_err or "").lower()
    if "drm" in lower or "widevine" in lower or "playready" in lower or "fairplay" in lower:
        return "هذا الفيديو محمي بحقوق تشفير رقمية (DRM) ولا يمكن تحميله."
    if "private video" in lower or "login required" in lower or "sign in" in lower or "cookies" in lower:
        return "هذا الفيديو يتطلب تسجيل الدخول. فعّل خيار «استخدام جلسة المتصفح» ثم أعد المحاولة."
    if "unsupported url" in lower:
        return "هذا الرابط لا يحتوي على فيديو مدعوم مباشر، جرّب تبويب «التقاط الصفحة» لتحميل البث المباشر."
    if "http error 403" in lower or "forbidden" in lower:
        return "رفض الموقع الوصول المباشر (403). فعّل خيار «استخدام جلسة المتصفح» وأعد المحاولة."
    if "http error 404" in lower or "not found" in lower:
        return "الفيديو غير موجود أو انتهت صلاحية الرابط (404)."
    if "geo" in lower and ("restricted" in lower or "blocked" in lower):
        return "هذا الفيديو مقيد جغرافياً في منطقتك من قِبل الموقع المصدر."
    # تقليم رسائل yt-dlp الطويلة
    clean = re.sub(r"\x1b\[[0-9;]*m", "", raw_err or "حدث خطأ غير متوقع أثناء التحميل.")
    clean = clean.replace("ERROR:", "").strip()
    return clean[:240]


def write_netscape_cookies(cookies: List[Dict[str, Any]], job_id: str) -> Optional[Path]:
    """يحول مصفوفة كوكيز المتصفح إلى ملف Netscape مؤقت آمن لـ yt-dlp."""
    if not cookies:
        return None
    cookie_path = TEMP_COOKIES_DIR / f"cookies-{job_id}.txt"
    lines = ["# Netscape HTTP Cookie File", "# Generated temporarily by OmniGrab"]
    now_plus_year = int(time.time()) + 86400 * 365
    for c in cookies:
        domain = str(c.get("domain") or "").strip()
        name = str(c.get("name") or "").strip()
        value = str(c.get("value") or "")
        if not domain or not name:
            continue
        # تنسيق Netscape يتطلب مطابقة include_subdomains مع وجود نقطة في بداية النطاق
        include_subdomains = "TRUE" if domain.startswith(".") else "FALSE"
        path = str(c.get("path") or "/")
        secure = "TRUE" if c.get("secure") else "FALSE"
        exp = c.get("expirationDate")
        expiry = str(int(exp)) if isinstance(exp, (int, float)) and exp > 0 else str(now_plus_year)
        # منع كسر السطور
        value = value.replace("\n", "").replace("\r", "").replace("\t", " ")
        lines.append(f"{domain}\t{include_subdomains}\t{path}\t{secure}\t{expiry}\t{name}\t{value}")

    cookie_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return cookie_path


class JobManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._load_history()

    def _load_history(self) -> None:
        if not HISTORY_FILE.exists():
            return
        try:
            data = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for item in data[:40]:
                    if isinstance(item, dict) and item.get("id"):
                        # أي مهام كانت عالقة قبل إغلاق السيرفر نعتبرها متوقفة
                        if item.get("status") in ("queued", "downloading", "merging", "converting_mp3"):
                            item["status"] = "cancelled"
                            item["status_text"] = "توقف بسبب إغلاق المحرك"
                        self._jobs[item["id"]] = item
        except Exception:
            pass

    def _save_history_unlocked(self) -> None:
        try:
            ordered = sorted(
                self._jobs.values(),
                key=lambda x: x.get("created_at", 0),
                reverse=True,
            )[:40]
            serializable = [
                {k: v for k, v in j.items() if not k.startswith("_")}
                for j in ordered
            ]
            HISTORY_FILE.write_text(
                json.dumps(serializable, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass

    def list_jobs(self) -> List[Dict[str, Any]]:
        with self._lock:
            ordered = sorted(
                self._jobs.values(),
                key=lambda x: x.get("created_at", 0),
                reverse=True,
            )
            return [
                {k: v for k, v in j.items() if not k.startswith("_")}
                for j in ordered[:40]
            ]

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def cancel_job(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            job["_cancel"] = True
            if job["status"] == "queued":
                job["status"] = "cancelled"
                job["status_text"] = "تم الإلغاء"
                self._save_history_unlocked()
            return True

    def clear_finished(self) -> int:
        with self._lock:
            to_delete = [
                jid
                for jid, j in self._jobs.items()
                if j.get("status") in ("completed", "error", "cancelled")
            ]
            for jid in to_delete:
                del self._jobs[jid]
            self._save_history_unlocked()
            return len(to_delete)

    def create_and_start(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        url = str(payload.get("url") or "").strip()
        title = str(payload.get("title") or "").strip() or "جاري تجهيز الفيديو..."
        quality = str(payload.get("quality") or "best").strip()
        thumbnail = str(payload.get("thumbnail") or "").strip()

        # منع تكرار تحميل نفس الرابط ونفس الجودة في نفس اللحظة لتجنب تعارض الملفات المؤقتة
        with self._lock:
            for existing in self._jobs.values():
                if (
                    existing.get("url") == url
                    and existing.get("quality") == quality
                    and existing.get("status") in ("queued", "downloading", "merging", "converting_mp3")
                ):
                    return {k: v for k, v in existing.items() if not k.startswith("_")}

        job_id = uuid.uuid4().hex[:10]

        quality_labels = {
            "best": "أفضل جودة متاحة",
            "2160": "4K (2160p)",
            "1440": "2K (1440p)",
            "1080": "Full HD (1080p)",
            "720": "HD (720p)",
            "480": "SD (480p)",
            "360": "توفير بيانات (360p)",
            "audio_mp3": "صوت فقط (MP3)",
            "direct": "تحميل مباشر",
        }

        job: Dict[str, Any] = {
            "id": job_id,
            "url": url,
            "title": title,
            "thumbnail": thumbnail,
            "quality": quality,
            "quality_label": quality_labels.get(quality, f"{quality}p"),
            "status": "queued",
            "status_text": "في انتظار البدء...",
            "progress": 0.0,
            "downloaded_str": "",
            "total_str": "",
            "speed_str": "",
            "eta_str": "",
            "filename": "",
            "filepath": "",
            "error": "",
            "created_at": time.time(),
            "_cancel": False,
        }

        with self._lock:
            self._jobs[job_id] = job
            self._save_history_unlocked()

        worker = threading.Thread(
            target=self._run_download,
            args=(job_id, payload),
            daemon=True,
        )
        worker.start()
        return {k: v for k, v in job.items() if not k.startswith("_")}

    def _update(self, job_id: str, persist: bool = False, **kwargs: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.update(kwargs)
            if persist:
                self._save_history_unlocked()

    def _is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            return bool(job and job.get("_cancel"))

    def _run_download(self, job_id: str, payload: Dict[str, Any]) -> None:
        import yt_dlp  # type: ignore

        url = str(payload.get("url") or "").strip()
        quality = str(payload.get("quality") or "best").strip()
        referer = str(payload.get("referer") or "").strip()
        user_agent = str(payload.get("userAgent") or "").strip()
        cookies = payload.get("cookies") if isinstance(payload.get("cookies"), list) else []
        custom_title = str(payload.get("title") or "").strip()

        cookie_file: Optional[Path] = None
        job_temp_dir: Optional[Path] = None
        final_filepath: Optional[Path] = None

        try:
            DEFAULT_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            if cookies:
                cookie_file = write_netscape_cookies(cookies, job_id)

            headers: Dict[str, str] = {}
            if referer:
                headers["Referer"] = referer
            if user_agent:
                headers["User-Agent"] = user_agent

            # تحديد صيغة الجودة في yt-dlp
            has_ffmpeg = bool(FFMPEG_EXE)
            if quality == "audio_mp3":
                fmt = "bestaudio/best"
            elif quality in ("2160", "1440", "1080", "720", "480", "360"):
                h = int(quality)
                if has_ffmpeg:
                    fmt = (
                        f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/"
                        f"bestvideo[height<={h}]+bestaudio/"
                        f"best[height<={h}]/best"
                    )
                else:
                    fmt = f"best[height<={h}][ext=mp4]/best[height<={h}]/best"
            else:
                if has_ffmpeg:
                    fmt = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
                else:
                    fmt = "best[ext=mp4]/best"

            def progress_hook(d: Dict[str, Any]) -> None:
                if self._is_cancelled(job_id):
                    raise DownloadCancelledError("تم إلغاء التحميل")

                st = d.get("status")
                if st == "downloading":
                    downloaded = d.get("downloaded_bytes") or 0
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    pct = 0.0
                    if total > 0:
                        pct = min(99.5, round((downloaded / total) * 100.0, 1))
                    else:
                        frag_idx = d.get("fragment_index")
                        frag_cnt = d.get("fragment_count")
                        if frag_idx and frag_cnt and frag_cnt > 0:
                            pct = min(99.5, round((frag_idx / frag_cnt) * 100.0, 1))

                    speed = d.get("speed")
                    eta = d.get("eta")
                    self._update(
                        job_id,
                        status="downloading",
                        status_text="جاري التحميل...",
                        progress=pct,
                        downloaded_str=format_bytes(downloaded),
                        total_str=format_bytes(total),
                        speed_str=(f"{format_bytes(speed)}/s" if speed else ""),
                        eta_str=format_eta(eta),
                    )
                elif st == "finished":
                    fn = d.get("filename") or ""
                    if quality == "audio_mp3":
                        msg = "جاري استخراج ملف الصوت MP3..."
                    elif has_ffmpeg:
                        msg = "جاري دمج الصوت والفيديو بأعلى جودة..."
                    else:
                        msg = "جاري إنهاء الملف..."
                    self._update(
                        job_id,
                        status="merging",
                        status_text=msg,
                        progress=99.5,
                        speed_str="",
                        eta_str="",
                        filename=Path(fn).name if fn else "",
                    )

            def postprocessor_hook(d: Dict[str, Any]) -> None:
                if self._is_cancelled(job_id):
                    raise DownloadCancelledError("تم إلغاء التحميل")
                info = d.get("info_dict") or {}
                fp = info.get("filepath")
                if fp:
                    nonlocal final_filepath
                    final_filepath = Path(fp)

            job_temp_dir = Path(tempfile.gettempdir()) / f"og_{job_id}"
            job_temp_dir.mkdir(parents=True, exist_ok=True)

            outtmpl = "%(title).80B [%(id).20B].%(ext)s"
            # للروابط المباشرة مثل ملفات mp4 أو m3u8 بدون معرف واضح، استخدم العنوان الممرر
            if custom_title and any(ext in url.lower() for ext in (".m3u8", ".mp4", ".webm", ".ts")):
                safe_custom = sanitize_filename(custom_title)[:80]
                outtmpl = f"{safe_custom} [{job_id[:6]}].%(ext)s"

            # التحميل والدمج والتحويل يتم بالكامل داخل مجلد مؤقت معزول
            # ولا يُنقل لمجلد المستخدم النهائي إلا الملف المكتمل 100% فقط
            ydl_base_opts: Dict[str, Any] = {
                "format": fmt,
                "paths": {
                    "home": str(job_temp_dir),
                    "temp": str(job_temp_dir),
                },
                "outtmpl": outtmpl,
                "trim_file_name": 90,
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "concurrent_fragment_downloads": 4,
                "retries": 5,
                "fragment_retries": 5,
                "progress_hooks": [progress_hook],
                "postprocessor_hooks": [postprocessor_hook],
                "windowsfilenames": True,
                "overwrites": True,
            }

            if FFMPEG_EXE:
                ydl_base_opts["ffmpeg_location"] = FFMPEG_EXE
                if quality != "audio_mp3":
                    ydl_base_opts["merge_output_format"] = "mp4"

            self._update(job_id, status="downloading", status_text="جاري الاتصال بالموقع...")

            # في يوتيوب نجرب الوضع العام أولاً (بدون web_embedded)، ثم الكوكيز تلقائياً إن تطلّب الأمر
            if is_youtube_url(url):
                attempts = [False, True] if (cookie_file and cookie_file.exists()) else [False]
            else:
                attempts = [True] if (cookie_file and cookie_file.exists()) else [False]

            info = None
            last_exc: Optional[Exception] = None
            for idx, use_ck in enumerate(attempts):
                try:
                    ydl_opts = apply_platform_opts(ydl_base_opts, url, headers, cookie_file, use_ck)
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(url, download=True)
                        if info:
                            real_title = info.get("title") or custom_title or "فيديو محمّل"
                            thumb = info.get("thumbnail") or ""
                            prepared = Path(ydl.prepare_filename(info))
                            if not final_filepath or not final_filepath.exists():
                                mp4_candidate = prepared.with_suffix(".mp4")
                                if mp4_candidate.exists():
                                    final_filepath = mp4_candidate
                                elif prepared.exists():
                                    final_filepath = prepared
                            self._update(
                                job_id,
                                title=real_title,
                                thumbnail=thumb or payload.get("thumbnail") or "",
                            )
                    last_exc = None
                    break
                except DownloadCancelledError:
                    raise
                except Exception as exc:
                    last_exc = exc
                    if idx + 1 < len(attempts):
                        self._update(job_id, status="downloading", status_text="جاري المحاولة بجلسة المتصفح...")
                        continue
            if last_exc is not None:
                raise last_exc

            if self._is_cancelled(job_id):
                raise DownloadCancelledError("تم إلغاء التحميل")

            # تحويل الصوت إلى MP3 باستخدام FFmpeg مباشرة دون الحاجة لـ ffprobe
            if quality == "audio_mp3" and final_filepath and final_filepath.exists() and FFMPEG_EXE:
                self._update(
                    job_id,
                    status="converting_mp3",
                    status_text="جاري التحويل إلى MP3 بجودة 192kbps...",
                    progress=99.7,
                )
                mp3_target = final_filepath.with_suffix(".mp3")
                if mp3_target.resolve() != final_filepath.resolve():
                    cmd = [
                        FFMPEG_EXE,
                        "-y",
                        "-i",
                        str(final_filepath),
                        "-vn",
                        "-acodec",
                        "libmp3lame",
                        "-ab",
                        "192k",
                        "-ar",
                        "44100",
                        str(mp3_target),
                    ]
                    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    proc = subprocess.run(
                        cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        creationflags=creationflags,
                    )
                    if proc.returncode == 0 and mp3_target.exists():
                        try:
                            final_filepath.unlink()
                        except OSError:
                            pass
                        final_filepath = mp3_target

            # التحقق من الملف النهائي داخل المجلد المؤقت قبل نقله لمجلد التحميلات
            if not final_filepath or not final_filepath.exists():
                candidates = [
                    p
                    for p in job_temp_dir.iterdir()
                    if p.is_file()
                    and not p.name.endswith((".part", ".ytdl"))
                    and ".part-Frag" not in p.name
                    and p.stat().st_size > 0
                ]
                if candidates:
                    final_filepath = max(candidates, key=lambda p: p.stat().st_size)

            if not final_filepath or not final_filepath.exists() or final_filepath.stat().st_size == 0:
                raise RuntimeError("لم يكتمل إنشاء ملف الفيديو بشكل سليم.")

            target_dir = get_download_dir()
            target_dir.mkdir(parents=True, exist_ok=True)
            dest_path = target_dir / final_filepath.name
            if dest_path.exists():
                stem = final_filepath.stem
                suffix = final_filepath.suffix
                counter = 2
                while dest_path.exists():
                    dest_path = target_dir / f"{stem} ({counter}){suffix}"
                    counter += 1

            shutil.move(str(final_filepath), str(dest_path))
            final_filepath = dest_path.resolve()
            size_str = format_bytes(final_filepath.stat().st_size)

            self._update(
                job_id,
                persist=True,
                status="completed",
                status_text="اكتمل التحميل بنجاح ✓",
                progress=100.0,
                total_str=size_str or "",
                downloaded_str=size_str or "",
                speed_str="",
                eta_str="",
                filename=final_filepath.name,
                filepath=str(final_filepath),
            )

        except DownloadCancelledError:
            self._update(
                job_id,
                persist=True,
                status="cancelled",
                status_text="تم إلغاء التحميل",
                speed_str="",
                eta_str="",
            )
        except Exception as exc:
            err_msg = friendly_arabic_error(str(exc))
            self._update(
                job_id,
                persist=True,
                status="error",
                status_text="فشل التحميل",
                error=err_msg,
                speed_str="",
                eta_str="",
            )
        finally:
            if cookie_file and cookie_file.exists():
                try:
                    cookie_file.unlink()
                except OSError:
                    pass
            if job_temp_dir and job_temp_dir.exists():
                try:
                    shutil.rmtree(job_temp_dir, ignore_errors=True)
                except OSError:
                    pass


JOBS = JobManager()


def extract_video_metadata(payload: Dict[str, Any]) -> Dict[str, Any]:
    """يستخرج عنوان الفيديو والصورة المصغرة والجودات المتاحة بدون تحميل الفيديو."""
    import yt_dlp  # type: ignore

    url = str(payload.get("url") or "").strip()
    if not url:
        raise ValueError("الرابط فارغ")

    referer = str(payload.get("referer") or "").strip()
    user_agent = str(payload.get("userAgent") or "").strip()
    cookies = payload.get("cookies") if isinstance(payload.get("cookies"), list) else []

    temp_id = uuid.uuid4().hex[:8]
    cookie_file: Optional[Path] = None

    try:
        if cookies:
            cookie_file = write_netscape_cookies(cookies, temp_id)

        headers: Dict[str, str] = {}
        if referer:
            headers["Referer"] = referer
        if user_agent:
            headers["User-Agent"] = user_agent

        ydl_base_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "skip_download": True,
        }

        if is_youtube_url(url):
            attempts = [False, True] if (cookie_file and cookie_file.exists()) else [False]
        else:
            attempts = [True] if (cookie_file and cookie_file.exists()) else [False]

        info = None
        last_exc: Optional[Exception] = None
        for use_ck in attempts:
            try:
                ydl_opts = apply_platform_opts(ydl_base_opts, url, headers, cookie_file, use_ck)
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                if info:
                    last_exc = None
                    break
            except Exception as exc:
                last_exc = exc
                continue

        if last_exc is not None and not info:
            raise last_exc

        if not info:
            raise ValueError("تعذر قراءة بيانات الفيديو من هذا الرابط")

        # في حال أعاد المستخرج قائمة entries (مثل منشور انستجرام أو تويتر متعدد الوسائط)
        if "entries" in info and isinstance(info["entries"], list) and info["entries"]:
            first_entry = next((e for e in info["entries"] if e), None)
            if first_entry:
                info = first_entry

        formats = info.get("formats") or []
        standard_buckets = [2160, 1440, 1080, 720, 480, 360]
        height_sizes: Dict[int, float] = {}
        found_heights = set()

        # تقدير حجم الصوت لإضافته لحجم الفيديو في صيغ DASH
        best_audio_bytes = 0.0
        for f in formats:
            vcodec = f.get("vcodec")
            acodec = f.get("acodec")
            if vcodec == "none" and acodec and acodec != "none":
                sz = f.get("filesize") or f.get("filesize_approx") or 0
                if sz and sz > best_audio_bytes:
                    best_audio_bytes = float(sz)

        for f in formats:
            if f.get("drm"):
                continue
            h = f.get("height")
            vcodec = f.get("vcodec")
            if not isinstance(h, int) or h < 144 or vcodec == "none":
                continue
            # تقريب الارتفاع لأقرب دقة قياسية مناسبة أو الاحتفاظ به
            bucket = None
            for b in standard_buckets:
                if abs(h - b) <= 60:
                    bucket = b
                    break
            if bucket is None:
                if h > 2160:
                    bucket = 2160
                elif h >= 240:
                    bucket = 360
                else:
                    continue

            found_heights.add(bucket)
            sz = float(f.get("filesize") or f.get("filesize_approx") or 0)
            if sz > 0:
                acodec = f.get("acodec")
                total_est = sz + (best_audio_bytes if acodec == "none" else 0.0)
                if total_est > height_sizes.get(bucket, 0.0):
                    height_sizes[bucket] = total_est

        quality_names = {
            2160: "4K Ultra HD (2160p)",
            1440: "2K QHD (1440p)",
            1080: "Full HD (1080p)",
            720: "HD عالي الجودة (720p)",
            480: "متوسط (480p)",
            360: "اقتصادي سريع (360p)",
        }

        qualities: List[Dict[str, Any]] = [
            {
                "id": "best",
                "label": "أفضل جودة متاحة تلقائياً (MP4)",
                "size_hint": "",
            }
        ]

        for b in standard_buckets:
            if b in found_heights:
                qualities.append(
                    {
                        "id": str(b),
                        "label": quality_names.get(b, f"{b}p"),
                        "size_hint": format_bytes(height_sizes.get(b)),
                    }
                )

        # إذا لم يفصل الموقع الجودات (مثلاً تيك توك أو ريلز مباشر)، نترك أفضل جودة + MP3
        qualities.append(
            {
                "id": "audio_mp3",
                "label": "ملف صوتي فقط (MP3 - 192kbps)",
                "size_hint": format_bytes(best_audio_bytes) if best_audio_bytes else "",
            }
        )

        duration = info.get("duration")
        duration_str = format_eta(duration) if duration else ""

        return {
            "ok": True,
            "title": info.get("title") or "فيديو جاهز للتحميل",
            "thumbnail": info.get("thumbnail") or "",
            "uploader": info.get("uploader") or info.get("channel") or info.get("extractor_key") or "",
            "site": info.get("extractor_key") or "",
            "duration_str": duration_str,
            "webpage_url": info.get("webpage_url") or url,
            "qualities": qualities,
        }
    finally:
        if cookie_file and cookie_file.exists():
            try:
                cookie_file.unlink()
            except OSError:
                pass


def _select_file_windows_shell(fp: Path) -> bool:
    """يستخدم Windows Shell API الرسمي لتحديد الملف بدقة حتى مع الحروف العربية والمسافات والفواصل."""
    try:
        import ctypes

        ole32 = ctypes.windll.ole32
        shell32 = ctypes.windll.shell32
        shell32.ILCreateFromPathW.argtypes = [ctypes.c_wchar_p]
        shell32.ILCreateFromPathW.restype = ctypes.c_void_p
        shell32.SHOpenFolderAndSelectItems.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.c_void_p,
            ctypes.c_uint,
        ]
        shell32.SHOpenFolderAndSelectItems.restype = ctypes.c_long
        shell32.ILFree.argtypes = [ctypes.c_void_p]

        ole32.CoInitialize(None)
        try:
            pidl = shell32.ILCreateFromPathW(str(fp))
            if not pidl:
                return False
            try:
                hr = shell32.SHOpenFolderAndSelectItems(pidl, 0, None, 0)
                return hr == 0
            finally:
                shell32.ILFree(pidl)
        finally:
            ole32.CoUninitialize()
    except Exception:
        return False


def open_in_explorer(filepath_str: str) -> None:
    """يفتح مجلد التحميلات في ويندوز ويحدد الملف المحمّل بدقة دون فتح Documents بالخطأ."""
    target_dir = get_download_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        return

    if filepath_str:
        try:
            fp = Path(filepath_str).resolve()
            if fp.exists() and fp.is_file():
                if _select_file_windows_shell(fp):
                    return
                # بديل آمن بفصل /select, عن المسار حتى لا يفسد Windows Explorer علامات الاقتباس
                subprocess.Popen(["explorer.exe", "/select,", str(fp)])
                return
            if fp.parent.exists():
                subprocess.Popen(["explorer.exe", str(fp.parent)])
                return
        except OSError:
            pass

    subprocess.Popen(["explorer.exe", str(target_dir.resolve())])


def _run_folder_picker_cli(initial_dir: str) -> None:
    """وضع فرعي نظيف لفتح نافذة اختيار المجلد في ويندوز ويعمل في Python وفي نسخة .exe."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    chosen = filedialog.askdirectory(
        initialdir=initial_dir,
        title="اختر مجلد حفظ الفيديوهات - LibertyGrab",
    )
    root.destroy()
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    print(chosen or "", flush=True)


def pick_folder_via_dialog() -> Optional[str]:
    """يفتح نافذة اختيار المجلد الأصلية في ويندوز عبر عملية فرعية نظيفة."""
    initial = str(get_download_dir())
    cmd = (
        [sys.executable, "--pick-folder", initial]
        if IS_FROZEN
        else [sys.executable, str(Path(__file__).resolve()), "--pick-folder", initial]
    )
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
            creationflags=creationflags,
        )
        chosen = (proc.stdout or "").strip()
        return chosen or None
    except Exception:
        return None


class LocalAPIHandler(BaseHTTPRequestHandler):
    server_version = f"LibertyLocal/{SERVER_VERSION}"

    def log_message(self, fmt: str, *args: Any) -> None:
        # تسجيل هادئ ومختصر في وضع النافذة المرئية
        if sys.stdout and hasattr(sys.stdout, "write"):
            try:
                sys.stdout.write(f"[{time.strftime('%H:%M:%S')}] {fmt % args}\n")
                sys.stdout.flush()
            except Exception:
                pass

    def _is_origin_allowed(self) -> Optional[str]:
        origin = self.headers.get("Origin")
        if not origin:
            return None
        if origin.startswith("chrome-extension://") or origin.startswith("moz-extension://"):
            return origin
        return "FORBIDDEN"

    def _check_security(self) -> bool:
        origin_check = self._is_origin_allowed()
        if origin_check == "FORBIDDEN":
            self._send_json(403, {"ok": False, "error": "غير مصرح للمواقع الخارجية بالاتصال بالمحرك المحلي."})
            return False

        # السماح لـ /api/health بدون التوكن لفحص عمل السيرفر من سكريبتات الإقلاع المحلية فقط إن لم يكن من موقع ويب
        if self.path == "/api/health" and origin_check is None:
            return True

        token = self.headers.get("X-Liberty-Token") or self.headers.get(CLIENT_HEADER_NAME)
        if token != CLIENT_HEADER_VALUE:
            self._send_json(403, {"ok": False, "error": "رمز التحقق المحلي مفقود."})
            return False
        return True

    def _add_cors_headers(self) -> None:
        origin = self._is_origin_allowed()
        if origin and origin != "FORBIDDEN":
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", f"Content-Type, X-Liberty-Token, {CLIENT_HEADER_NAME}")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self, status_code: int, data: Dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self._add_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 5 * 1024 * 1024:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        origin_check = self._is_origin_allowed()
        if origin_check == "FORBIDDEN":
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self._add_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if not self._check_security():
            return

        if self.path == "/api/health":
            import yt_dlp  # type: ignore

            self._send_json(
                200,
                {
                    "ok": True,
                    "version": SERVER_VERSION,
                    "yt_dlp_version": getattr(yt_dlp.version, "__version__", "unknown"),
                    "ffmpeg_ready": bool(FFMPEG_EXE),
                    "download_dir": str(get_download_dir()),
                },
            )
            return

        if self.path == "/api/config":
            self._send_json(
                200,
                {
                    "ok": True,
                    "download_dir": str(get_download_dir()),
                    "default_download_dir": str(get_system_default_download_dir()),
                },
            )
            return

        if self.path == "/api/jobs":
            self._send_json(200, {"ok": True, "jobs": JOBS.list_jobs()})
            return

        self._send_json(404, {"ok": False, "error": "المسار غير موجود"})

    def do_POST(self) -> None:
        if not self._check_security():
            return

        try:
            payload = self._read_json_body()
        except Exception:
            self._send_json(400, {"ok": False, "error": "بيانات JSON غير صالحة"})
            return

        if self.path == "/api/info":
            try:
                result = extract_video_metadata(payload)
                self._send_json(200, result)
            except Exception as exc:
                self._send_json(200, {"ok": False, "error": friendly_arabic_error(str(exc))})
            return

        if self.path == "/api/download":
            url = str(payload.get("url") or "").strip()
            if not url or not (url.startswith("http://") or url.startswith("https://")):
                self._send_json(400, {"ok": False, "error": "يرجى تمرير رابط صالح يبدأ بـ http أو https"})
                return
            job = JOBS.create_and_start(payload)
            self._send_json(200, {"ok": True, "job": job})
            return

        if self.path == "/api/cancel":
            job_id = str(payload.get("job_id") or "")
            ok = JOBS.cancel_job(job_id)
            self._send_json(200, {"ok": ok})
            return

        if self.path == "/api/clear-completed":
            removed = JOBS.clear_finished()
            self._send_json(200, {"ok": True, "removed": removed})
            return

        if self.path == "/api/config":
            try:
                new_dir = str(payload.get("download_dir") or "")
                saved_path = set_download_dir(new_dir)
                self._send_json(200, {"ok": True, "download_dir": str(saved_path)})
            except Exception as exc:
                self._send_json(200, {"ok": False, "error": str(exc)})
            return

        if self.path == "/api/pick-folder":
            chosen = pick_folder_via_dialog()
            if not chosen:
                self._send_json(200, {"ok": True, "cancelled": True, "download_dir": str(get_download_dir())})
                return
            try:
                saved_path = set_download_dir(chosen)
                self._send_json(200, {"ok": True, "cancelled": False, "download_dir": str(saved_path)})
            except Exception as exc:
                self._send_json(200, {"ok": False, "error": str(exc)})
            return

        if self.path == "/api/clean-temp":
            removed = cleanup_incomplete_files(get_download_dir())
            self._send_json(200, {"ok": True, "removed": removed})
            return

        if self.path == "/api/open-folder":
            job_id = str(payload.get("job_id") or "")
            filepath = ""
            if job_id:
                j = JOBS.get_job(job_id)
                if j:
                    filepath = str(j.get("filepath") or "")
            open_in_explorer(filepath)
            self._send_json(200, {"ok": True})
            return

        if self.path == "/api/shutdown":
            self._send_json(200, {"ok": True, "message": "جاري إيقاف المحرك المحلي..."})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        self._send_json(404, {"ok": False, "error": "المسار غير موجود"})


def is_already_running() -> bool:
    try:
        req = urllib.request.Request(f"http://{HOST}:{PORT}/api/health", method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            return resp.status == 200
    except Exception:
        return False


def configure_stdio() -> None:
    """يضمن عدم حدوث أي خطأ ترميز مع الحروف العربية في ويندوز أو عند التشغيل الصامت عبر pythonw.exe."""
    log_path = BASE_DIR / "server.log"
    if sys.stdout is None:
        sys.stdout = open(log_path, "a", encoding="utf-8", buffering=1)
    elif hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    if sys.stderr is None:
        sys.stderr = open(log_path, "a", encoding="utf-8", buffering=1)
    elif hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main() -> None:
    global FFMPEG_EXE, JS_RUNTIMES
    ensure_dirs()
    configure_stdio()

    if is_already_running():
        print(f"المحرك المحلي يعمل بالفعل على http://{HOST}:{PORT}")
        return

    FFMPEG_EXE = resolve_ffmpeg()
    JS_RUNTIMES = resolve_js_runtimes()
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")

    server = ThreadingHTTPServer((HOST, PORT), LocalAPIHandler)

    def handle_sig(*_: Any) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    print("=" * 60, flush=True)
    print("  LibertyGrab Local Video Engine - محرك LibertyGrab لتحميل الفيديوهات", flush=True)
    print(f"  العنوان المحلي : http://{HOST}:{PORT}", flush=True)
    print(f"  دمج الفيديو HD : {'جاهز (FFmpeg مفعل)' if FFMPEG_EXE else 'وضع أساسي بدون FFmpeg'}", flush=True)
    print(f"  محرك JS يوتيوب : {', '.join(JS_RUNTIMES.keys()) if JS_RUNTIMES else 'غير متوفر'}", flush=True)
    print(f"  مجلد التحميلات : {DEFAULT_DOWNLOAD_DIR}", flush=True)
    print("=" * 60, flush=True)

    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            PID_FILE.unlink()
        except OSError:
            pass


def request_remote_shutdown() -> None:
    try:
        req = urllib.request.Request(
            f"http://{HOST}:{PORT}/api/shutdown",
            data=b"{}",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Liberty-Token": CLIENT_HEADER_VALUE,
            },
        )
        with urllib.request.urlopen(req, timeout=2.5):
            pass
    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--pick-folder":
        _run_folder_picker_cli(sys.argv[2] if len(sys.argv) >= 3 else str(get_download_dir()))
    elif len(sys.argv) >= 2 and sys.argv[1] == "--shutdown":
        request_remote_shutdown()
    else:
        main()
