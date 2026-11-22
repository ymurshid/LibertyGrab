// Liberty Video Downloader — Background Service Worker (Manifest V3)
// يجمع بين مراقبة الشبكة (MP4 / WebM / M3U8 / MPD) والفحص الحي لكل إطارات الصفحة والتواصل مع محرك Liberty المحلي

importScripts("config.js");

const APP_CFG = self.LIBERTYGRAB_CONFIG || { edition: "full", allowYoutube: true };
const ENGINE_BASE = "http://127.0.0.1:17890";
const CLIENT_TOKEN = "local-v1";
const BRAND_BADGE_COLOR = "#e07020";

function isStoreBlockedUrl(url) {
  if (APP_CFG.allowYoutube) return false;
  return /(^https?:\/\/)?([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)/i.test(url || "");
}

const memoryTabMedia = new Map();

// استبعاد قطع الفيديو المجزأة والإعلانات والتتبع فقط
const IGNORED_URL_PATTERNS = [
  /127\.0\.0\.1:17890/i,
  /googlevideo\.com\/videoplayback/i,
  /\.ts(\?|$)/i,
  /\.m4s(\?|$)/i,
  /\.fmp4(\?|$)/i,
  /\.aac(\?|$)/i,
  /\.vtt(\?|$)/i,
  /bytestart=/i,
  /byteend=/i,
  /doubleclick\.net/i,
  /googlesyndication\.com/i,
  /google-analytics\.com/i
];

const VIDEO_MIME_MAP = [
  { pattern: /application\/(vnd\.apple\.mpegurl|x-mpegurl)/i, ext: "m3u8", label: "بث HLS (M3U8)", isStream: true },
  { pattern: /application\/dash\+xml/i, ext: "mpd", label: "بث DASH (MPD)", isStream: true },
  { pattern: /video\/mp4/i, ext: "mp4", label: "فيديو MP4", isStream: false },
  { pattern: /video\/webm/i, ext: "webm", label: "فيديو WebM", isStream: false },
  { pattern: /video\/quicktime/i, ext: "mov", label: "فيديو MOV", isStream: false },
  { pattern: /video\/x-matroska/i, ext: "mkv", label: "فيديو MKV", isStream: false },
  { pattern: /video\/ogg/i, ext: "ogv", label: "فيديو OGG", isStream: false }
];

const VIDEO_EXT_MAP = [
  { regex: /\.m3u8(\?|#|$)/i, ext: "m3u8", label: "بث HLS (M3U8)", isStream: true },
  { regex: /\.mpd(\?|#|$)/i, ext: "mpd", label: "بث DASH (MPD)", isStream: true },
  { regex: /\.mp4(\?|#|$)/i, ext: "mp4", label: "فيديو MP4", isStream: false },
  { regex: /\.webm(\?|#|$)/i, ext: "webm", label: "فيديو WebM", isStream: false },
  { regex: /\.mov(\?|#|$)/i, ext: "mov", label: "فيديو MOV", isStream: false },
  { regex: /\.mkv(\?|#|$)/i, ext: "mkv", label: "فيديو MKV", isStream: false },
  { regex: /\.m4v(\?|#|$)/i, ext: "m4v", label: "فيديو M4V", isStream: false }
];

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let val = Number(bytes);
  for (const u of units) {
    if (val < 1024) return u === "B" ? `${Math.round(val)} B` : `${val.toFixed(1)} ${u}`;
    val /= 1024;
  }
  return `${val.toFixed(1)} TB`;
}

function guessNameFromUrl(url, fallbackTitle = "video") {
  try {
    const u = new URL(url);
    const lastSeg = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
    const cleanSeg = lastSeg.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[<>:"/\\|?*]+/g, "_").trim();
    if (cleanSeg && cleanSeg.length >= 3 && !/^(index|master|playlist|chunklist|video|playback|manifest|watch|home)$/i.test(cleanSeg)) {
      return cleanSeg.slice(0, 90);
    }
  } catch (_) {}
  return (fallbackTitle || `video_${Date.now()}`).replace(/[<>:"/\\|?*]+/g, "_").slice(0, 90);
}

async function getTabMediaList(tabId) {
  if (memoryTabMedia.has(tabId)) {
    return memoryTabMedia.get(tabId);
  }
  try {
    const key = `tab_media_${tabId}`;
    const stored = await chrome.storage.session.get(key);
    const list = Array.isArray(stored[key]) ? stored[key] : [];
    memoryTabMedia.set(tabId, list);
    return list;
  } catch (_) {
    return [];
  }
}

async function saveTabMediaList(tabId, list) {
  const trimmed = list.slice(0, 40);
  memoryTabMedia.set(tabId, trimmed);
  try {
    await chrome.storage.session.set({ [`tab_media_${tabId}`]: trimmed });
  } catch (_) {}
  updateBadge(tabId, trimmed.length);
}

function updateBadge(tabId, count) {
  try {
    const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    chrome.action.setBadgeText({ tabId, text });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ tabId, color: BRAND_BADGE_COLOR });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
      }
    }
  } catch (_) {}
}

async function addCapturedMedia(tabId, item) {
  if (tabId < 0 || !item || !item.url) return;
  if (!/^https?:\/\//i.test(item.url)) return;
  if (!item.allowAnyUrl) {
    for (const pat of IGNORED_URL_PATTERNS) {
      if (pat.test(item.url)) return;
    }
  }

  const list = await getTabMediaList(tabId);
  const existingIdx = list.findIndex((x) => x.url === item.url);
  if (existingIdx !== -1) {
    // تحديث الحجم أو الاسم إن كان أوضح
    if (!list[existingIdx].sizeBytes && item.sizeBytes) {
      list[existingIdx].sizeBytes = item.sizeBytes;
      list[existingIdx].sizeStr = formatSize(item.sizeBytes);
      await saveTabMediaList(tabId, list);
    }
    return;
  }

  list.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url: item.url,
    ext: item.ext || "mp4",
    label: item.label || "فيديو مباشر",
    isStream: Boolean(item.isStream),
    isPageVideo: Boolean(item.isPageVideo),
    sizeBytes: item.sizeBytes || 0,
    sizeStr: item.sizeStr || formatSize(item.sizeBytes || 0),
    name: item.name || guessNameFromUrl(item.url, item.pageTitle),
    referer: item.referer || "",
    capturedAt: Date.now()
  });

  await saveTabMediaList(tabId, list);
}

// 1) التقاط مبكر بالامتداد حتى لو كان الملف من الكاش أو بدون Content-Type دقيق
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const url = details.url || "";
    for (const pat of IGNORED_URL_PATTERNS) {
      if (pat.test(url)) return;
    }
    for (const rule of VIDEO_EXT_MAP) {
      if (rule.regex.test(url)) {
        addCapturedMedia(details.tabId, {
          url,
          ext: rule.ext,
          label: rule.label,
          isStream: rule.isStream,
          referer: details.initiator || ""
        });
        break;
      }
    }
  },
  { urls: ["http://*/*", "https://*/*"] }
);

// 2) التقاط عبر ترويسات استجابة الشبكة (Content-Type + الحجم)
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.statusCode < 200 || details.statusCode >= 400) return;
    const url = details.url || "";
    for (const pat of IGNORED_URL_PATTERNS) {
      if (pat.test(url)) return;
    }

    let contentType = "";
    let contentLength = 0;
    let contentRangeTotal = 0;

    for (const h of details.responseHeaders || []) {
      const name = (h.name || "").toLowerCase();
      if (name === "content-type") {
        contentType = h.value || "";
      } else if (name === "content-length") {
        contentLength = parseInt(h.value || "0", 10) || 0;
      } else if (name === "content-range") {
        const m = /\/(\d+)$/.exec(h.value || "");
        if (m) contentRangeTotal = parseInt(m[1], 10) || 0;
      }
    }

    const totalSize = contentRangeTotal || contentLength;
    let matched = null;

    for (const rule of VIDEO_MIME_MAP) {
      if (rule.pattern.test(contentType)) {
        matched = rule;
        break;
      }
    }
    if (!matched) {
      for (const rule of VIDEO_EXT_MAP) {
        if (rule.regex.test(url)) {
          matched = rule;
          break;
        }
      }
    }

    if (!matched) return;

    // تجاهل الملفات الصغيرة جداً أقل من 40 كيلوبايت (إلا لملفات البث m3u8 / mpd)
    if (!matched.isStream && totalSize > 0 && totalSize < 40 * 1024) {
      return;
    }

    addCapturedMedia(details.tabId, {
      url,
      ext: matched.ext,
      label: matched.label,
      isStream: matched.isStream,
      sizeBytes: totalSize,
      referer: details.initiator || ""
    });
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"]
);

// 3) دالة الفحص الحي داخل كل إطار بالصفحة (تلتقط <video>، البث blob، الـ iframe، وسجل موارد الأداء)
function liveScanFrameFunction() {
  const results = [];
  const seen = new Set();

  function formatDur(sec) {
    if (!sec || !Number.isFinite(sec) || sec <= 0) return "";
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function findFeedPostUrl(videoEl) {
    const host = (window.location.hostname || "").toLowerCase();
    const isSocial =
      host.includes("x.com") ||
      host.includes("twitter.com") ||
      host.includes("facebook.com") ||
      host.includes("instagram.com") ||
      host.includes("tiktok.com") ||
      host.includes("reddit.com");
    if (!isSocial) return "";
    const container =
      videoEl.closest("article") ||
      videoEl.closest('[role="article"]') ||
      videoEl.closest("shreddit-post") ||
      videoEl.closest('[data-testid="tweet"]');
    if (!container) return "";
    const sels = [
      'a[href*="/status/"]',
      'a[href*="/reel/"]',
      'a[href*="/reels/"]',
      'a[href*="/videos/"]',
      'a[href*="/watch"]',
      'a[href*="/p/"]',
      'a[href*="/video/"]',
      'a[href*="/comments/"]'
    ];
    for (const sel of sels) {
      const a = container.querySelector(sel);
      if (a && a.href && /^https?:\/\//i.test(a.href)) return a.href;
    }
    return "";
  }

  function pushItem(item) {
    if (!item || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    results.push(item);
  }

  // أ) مسح سجل موارد الشبكة في المتصفح (يلتقط الروابط حتى لو كانت الصفحة مفتوحة قبل تحديث الإضافة)
  try {
    const entries = performance.getEntriesByType("resource") || [];
    const extRegex = /\.(m3u8|mpd|mp4|webm|mov|mkv|m4v)(\?|#|$)/i;
    for (const e of entries) {
      const u = e.name || "";
      if (!/^https?:\/\//i.test(u)) continue;
      if (/googlevideo\.com\/videoplayback|bytestart=|byteend=|\.ts(\?|$)|\.m4s(\?|$)/i.test(u)) continue;
      const m = extRegex.exec(u);
      if (m) {
        const ext = m[1].toLowerCase();
        const isStream = ext === "m3u8" || ext === "mpd";
        pushItem({
          url: u,
          ext,
          label: ext === "m3u8" ? "بث HLS (M3U8)" : ext === "mpd" ? "بث DASH (MPD)" : `فيديو ${ext.toUpperCase()}`,
          isStream,
          sizeBytes: e.transferSize || e.encodedBodySize || 0,
          name: document.title || "فيديو من الصفحة",
          referer: window.location.href
        });
      }
    }
  } catch (_) {}

  // ب) مسح عناصر <video> و <source> (المباشرة + مشغلات blob:)
  const videos = Array.from(document.querySelectorAll("video"));
  videos.forEach((v, idx) => {
    const directCandidates = [v.currentSrc, v.src];
    for (const s of v.querySelectorAll("source")) {
      if (s.src) directCandidates.push(s.src);
    }
    const directHttp = directCandidates.find((c) => c && /^https?:\/\//i.test(c));
    const h = v.videoHeight || 0;
    const dur = formatDur(v.duration);
    const metaTag = [h ? `${h}p` : "", dur].filter(Boolean).join(" • ");

    if (directHttp) {
      const isHls = /\.m3u8(\?|#|$)/i.test(directHttp);
      pushItem({
        url: directHttp,
        ext: isHls ? "m3u8" : "mp4",
        label: isHls ? "بث HLS (M3U8)" : "فيديو HTML5 مباشر",
        isStream: isHls,
        sizeStr: metaTag || "فيديو مباشر",
        name: document.title || `فيديو بالصفحة #${idx + 1}`,
        referer: window.location.href
      });
    } else if (v.currentSrc || v.src || v.readyState >= 1) {
      // مشغل blob: (يوتيوب / X / فيسبوك / إنستجرام / تيك توك / كورسات)
      const postUrl = findFeedPostUrl(v);
      let pageUrl = postUrl || window.location.href;
      const containerText =
        (v.closest("article")?.innerText || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 75) || document.title || `فيديو مشغّل #${idx + 1}`;

      pushItem({
        url: pageUrl,
        ext: "mp4",
        label: "مشغّل فيديو بالصفحة",
        isStream: true,
        isPageVideo: true,
        allowAnyUrl: true,
        sizeStr: metaTag || "بث مشغّل (يُحمّل بالمحرك)",
        name: containerText,
        referer: window.location.href
      });
    }
  });

  // ج) مسح إطارات الفيديو المضمّنة <iframe> (يوتيوب / فيميو / ديلي موشن / لوم / باني وغيرها)
  const iframePatterns = /(youtube\.com\/embed|youtube-nocookie\.com\/embed|player\.vimeo\.com|dailymotion\.com\/embed|loom\.com\/embed|iframe\.mediadelivery\.net|fast\.wistia\.net|streamable\.com\/e\/|tiktok\.com\/embed|facebook\.com\/plugins\/video)/i;
  for (const ifr of document.querySelectorAll("iframe[src]")) {
    const src = ifr.src || "";
    if (src && iframePatterns.test(src)) {
      pushItem({
        url: src,
        ext: "mp4",
        label: "فيديو مضمّن (Embed)",
        isStream: true,
        isPageVideo: true,
        allowAnyUrl: true,
        sizeStr: "مشغّل مضمّن بالصفحة",
        name: ifr.title || document.title || "فيديو مضمّن",
        referer: window.location.href
      });
    }
  }

  return results;
}

async function runLiveScanForTab(tabId) {
  if (tabId < 0) return [];
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      return await getTabMediaList(tabId);
    }
    const execResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: liveScanFrameFunction
    });
    for (const frameRes of execResults || []) {
      const items = Array.isArray(frameRes?.result) ? frameRes.result : [];
      for (const item of items) {
        await addCapturedMedia(tabId, item);
      }
    }
  } catch (_) {
    // في بعض صفحات المتصفح المحمية مثل chrome:// لا يُسمح بالحقن
  }
  return await getTabMediaList(tabId);
}

// تنظيف قائمة التبويب عند الانتقال لصفحة جديدة تماماً أو إغلاق التبويب
const lastTabOriginPath = new Map();
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    try {
      const u = new URL(changeInfo.url);
      const key = `${u.origin}${u.pathname}${u.search}`;
      const prev = lastTabOriginPath.get(tabId);
      if (prev && prev !== key) {
        memoryTabMedia.delete(tabId);
        chrome.storage.session.remove(`tab_media_${tabId}`).catch(() => {});
        updateBadge(tabId, 0);
      }
      lastTabOriginPath.set(tabId, key);
    } catch (_) {}
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  memoryTabMedia.delete(tabId);
  lastTabOriginPath.delete(tabId);
  chrome.storage.session.remove(`tab_media_${tabId}`).catch(() => {});
});

// استدعاء محرك Liberty المحلي بأمان
async function callEngine(path, method = "GET", body = null, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opts = {
      method,
      headers: {
        "X-VideoGrab-Token": CLIENT_TOKEN,
        "X-Liberty-Token": CLIENT_TOKEN
      },
      signal: controller.signal
    };
    if (body !== null) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const resp = await fetch(`${ENGINE_BASE}${path}`, opts);
    const data = await resp.json();
    return data;
  } catch (_) {
    return {
      ok: false,
      offline: true,
      error: "محرك LibertyGrab المحلي غير متصل حالياً."
    };
  } finally {
    clearTimeout(timer);
  }
}

// قراءة كوكيز الموقع الحالي عند تفعيل خيار «جلسة المتصفح» فقط
async function collectSiteCookies(targetUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    const merged = new Map();
    for (const c of cookies) {
      merged.set(`${c.domain}|${c.path}|${c.name}`, c);
    }
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();
      if (host.includes("youtube.com") || host.includes("youtu.be")) {
        const ytExtra = await chrome.cookies.getAll({ domain: "youtube.com" });
        for (const c of ytExtra) {
          merged.set(`${c.domain}|${c.path}|${c.name}`, c);
        }
      }
    } catch (_) {}

    return Array.from(merged.values()).map((c) => ({
      domain: c.domain,
      hostOnly: c.hostOnly,
      path: c.path,
      secure: c.secure,
      expirationDate: c.expirationDate,
      name: c.name,
      value: c.value
    }));
  } catch (_) {
    return [];
  }
}

// استقبال الرسائل من الواجهة المنبثقة (popup.js) وسكريبت الصفحة (content.js)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "DOM_VIDEOS_FOUND": {
          const tabId = sender?.tab?.id;
          if (typeof tabId === "number" && Array.isArray(msg.videos)) {
            for (const v of msg.videos) {
              if (v.url && /^https?:\/\//i.test(v.url)) {
                await addCapturedMedia(tabId, {
                  url: v.url,
                  ext: v.ext || "mp4",
                  label: v.label || "فيديو من الصفحة",
                  isStream: Boolean(v.isStream || /\.m3u8(\?|$)/i.test(v.url)),
                  isPageVideo: Boolean(v.isPageVideo),
                  allowAnyUrl: Boolean(v.allowAnyUrl),
                  sizeStr: v.sizeStr || "",
                  name: v.title || sender?.tab?.title || "video",
                  referer: sender?.tab?.url || ""
                });
              }
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case "CHECK_ENGINE": {
          const res = await callEngine("/api/health", "GET", null, 2500);
          sendResponse(res);
          break;
        }

        case "EXTRACT_INFO": {
          if (isStoreBlockedUrl(msg.url)) {
            sendResponse({ ok: false, error: "نسخة متجر Chrome Web Store لا تدعم التحميل من YouTube." });
            break;
          }
          let cookies = [];
          if (msg.useCookies && msg.url) {
            cookies = await collectSiteCookies(msg.url);
          }
          const res = await callEngine(
            "/api/info",
            "POST",
            {
              url: msg.url,
              referer: msg.referer || "",
              userAgent: navigator.userAgent,
              cookies
            },
            30000
          );
          sendResponse(res);
          break;
        }

        case "START_ENGINE_DOWNLOAD": {
          if (isStoreBlockedUrl(msg.url)) {
            sendResponse({ ok: false, error: "نسخة متجر Chrome Web Store لا تدعم التحميل من YouTube." });
            break;
          }
          let cookies = [];
          if (msg.useCookies && (msg.cookieUrl || msg.url)) {
            cookies = await collectSiteCookies(msg.cookieUrl || msg.url);
          }
          const res = await callEngine(
            "/api/download",
            "POST",
            {
              url: msg.url,
              title: msg.title || "",
              thumbnail: msg.thumbnail || "",
              quality: msg.quality || "best",
              referer: msg.referer || "",
              userAgent: navigator.userAgent,
              cookies
            },
            10000
          );
          sendResponse(res);
          break;
        }

        case "QUICK_DOWNLOAD_FROM_PAGE": {
          const settings = await chrome.storage.local.get({ useCookies: true });
          const pageUrl = msg.pageUrl || sender?.tab?.url || "";
          const videoUrl = msg.videoUrl || "";
          const title = msg.pageTitle || sender?.tab?.title || "فيديو محمل";
          if (isStoreBlockedUrl(pageUrl) || isStoreBlockedUrl(videoUrl)) {
            sendResponse({ ok: false, message: "نسخة متجر Chrome Web Store لا تدعم التحميل من YouTube." });
            break;
          }

          const health = await callEngine("/api/health", "GET", null, 2000);
          const targetUrl =
            videoUrl && /^https?:\/\//i.test(videoUrl) && !/googlevideo\.com/i.test(videoUrl)
              ? videoUrl
              : pageUrl;

          if (health && health.ok) {
            const cookies = settings.useCookies && pageUrl ? await collectSiteCookies(pageUrl) : [];
            const dlRes = await callEngine("/api/download", "POST", {
              url: targetUrl,
              title,
              quality: "best",
              referer: pageUrl,
              userAgent: navigator.userAgent,
              cookies
            });
            sendResponse({
              ok: Boolean(dlRes && dlRes.ok),
              mode: "engine",
              message: dlRes?.ok
                ? "بدأ التحميل بأعلى جودة عبر محرك LibertyGrab!"
                : dlRes?.error || "تعذر بدء التحميل"
            });
          } else if (videoUrl && /^https?:\/\//i.test(videoUrl) && !/\.m3u8(\?|$)/i.test(videoUrl)) {
            const safeName = guessNameFromUrl(videoUrl, title) + ".mp4";
            await chrome.downloads.download({
              url: videoUrl,
              filename: `VideoDownloader/${safeName}`,
              saveAs: false
            });
            sendResponse({
              ok: true,
              mode: "browser",
              message: "بدأ التحميل المباشر عبر المتصفح!"
            });
          } else {
            sendResponse({
              ok: false,
              offline: true,
              message: "افتح إضافة LibertyGrab أو شغّل المحرك المحلي لتحميل هذا الفيديو بأعلى جودة."
            });
          }
          break;
        }

        case "GET_CAPTURED_MEDIA": {
          const list = msg.liveScan
            ? await runLiveScanForTab(msg.tabId)
            : await getTabMediaList(msg.tabId);
          sendResponse({ ok: true, items: list });
          break;
        }

        case "DIRECT_BROWSER_DOWNLOAD": {
          const ext = (msg.ext || "mp4").replace(/[^a-z0-9]/gi, "") || "mp4";
          const base = (msg.name || "video").replace(/[<>:"/\\|?*]+/g, "_").trim().slice(0, 90) || "video";
          const downloadId = await chrome.downloads.download({
            url: msg.url,
            filename: `VideoDownloader/${base}.${ext}`,
            saveAs: Boolean(msg.saveAs)
          });
          sendResponse({ ok: Boolean(downloadId), downloadId });
          break;
        }

        case "GET_JOBS": {
          const res = await callEngine("/api/jobs", "GET", null, 4000);
          sendResponse(res);
          break;
        }

        case "CANCEL_JOB": {
          const res = await callEngine("/api/cancel", "POST", { job_id: msg.jobId }, 5000);
          sendResponse(res);
          break;
        }

        case "CLEAR_JOBS": {
          const res = await callEngine("/api/clear-completed", "POST", {}, 5000);
          sendResponse(res);
          break;
        }

        case "OPEN_FOLDER": {
          const res = await callEngine("/api/open-folder", "POST", { job_id: msg.jobId || "" }, 5000);
          sendResponse(res);
          break;
        }

        case "GET_CONFIG": {
          const res = await callEngine("/api/config", "GET", null, 4000);
          sendResponse(res);
          break;
        }

        case "SET_CONFIG": {
          const res = await callEngine("/api/config", "POST", { download_dir: msg.downloadDir || "" }, 5000);
          sendResponse(res);
          break;
        }

        case "PICK_FOLDER": {
          const res = await callEngine("/api/pick-folder", "POST", {}, 125000);
          sendResponse(res);
          break;
        }

        case "CLEAN_TEMP": {
          const res = await callEngine("/api/clean-temp", "POST", {}, 5000);
          sendResponse(res);
          break;
        }

        default:
          sendResponse({ ok: false, error: "أمر غير معروف" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "حدث خطأ غير متوقع" });
    }
  })();
  return true;
});
