// Liberty Video Downloader — Content Script
// يكتشف عناصر <video> في الصفحة ويعرض زر تحميل عائم بألوان هوية Liberty داخل Shadow DOM معزول

(() => {
  if (window.__libertyDownloaderInjected) return;
  window.__libertyDownloaderInjected = true;

  let floatingEnabled = true;
  let activeVideo = null;
  let hideTimer = null;
  let shadowHost = null;
  let pillBtn = null;
  let toastBox = null;
  const reportedUrls = new Set();

  try {
    chrome.storage.local.get({ showFloatingBtn: true }, (res) => {
      floatingEnabled = Boolean(res.showFloatingBtn);
      if (!floatingEnabled && pillBtn) {
        pillBtn.classList.remove("visible");
      }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.showFloatingBtn) {
        floatingEnabled = Boolean(changes.showFloatingBtn.newValue);
        if (!floatingEnabled && pillBtn) {
          pillBtn.classList.remove("visible");
        }
      }
    });
  } catch (_) {}

  function ensureUI() {
    if (shadowHost) return;
    shadowHost = document.createElement("div");
    shadowHost.id = "liberty-downloader-shadow-root";
    shadowHost.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none;";
    const shadow = shadowHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .lb-pill {
        position: fixed;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        direction: rtl;
        font-family: 'Segoe UI', Tahoma, system-ui, sans-serif;
        font-size: 12.5px;
        font-weight: 600;
        color: #f8fafc;
        background: rgba(11, 22, 38, 0.92);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(224, 112, 32, 0.65);
        border-radius: 999px;
        padding: 6px 13px;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(6, 13, 24, 0.55);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-4px) scale(0.96);
        transition: opacity 0.18s ease, transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
        user-select: none;
        z-index: 2147483646;
      }
      .lb-pill.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      .lb-pill:hover {
        background: linear-gradient(135deg, #e07020, #c95f14);
        border-color: #f08232;
        color: #ffffff;
      }
      .lb-pill:not(.visible) {
        pointer-events: none;
      }
      .lb-icon {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .lb-toast {
        position: fixed;
        bottom: 24px;
        left: 24px;
        direction: rtl;
        font-family: 'Segoe UI', Tahoma, system-ui, sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #f8fafc;
        background: rgba(11, 22, 38, 0.96);
        border: 1px solid rgba(224, 112, 32, 0.7);
        border-radius: 12px;
        padding: 10px 16px;
        box-shadow: 0 12px 30px rgba(6, 13, 24, 0.55);
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.22s ease, transform 0.22s ease;
        pointer-events: none;
        z-index: 2147483647;
        max-width: 340px;
      }
      .lb-toast.show {
        opacity: 1;
        transform: translateY(0);
      }
      .lb-toast.warn {
        border-color: rgba(245, 158, 11, 0.75);
      }
    `;

    pillBtn = document.createElement("button");
    pillBtn.type = "button";
    pillBtn.className = "lb-pill";
    pillBtn.innerHTML = `
      <svg class="lb-icon" viewBox="0 0 24 24">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
      </svg>
      <span>تحميل الفيديو</span>
    `;

    toastBox = document.createElement("div");
    toastBox.className = "lb-toast";

    pillBtn.addEventListener("mouseenter", () => {
      if (hideTimer) clearTimeout(hideTimer);
    });

    pillBtn.addEventListener("mouseleave", () => {
      scheduleHide();
    });

    pillBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      triggerQuickDownload();
    });

    shadow.appendChild(style);
    shadow.appendChild(pillBtn);
    shadow.appendChild(toastBox);
    (document.documentElement || document.body).appendChild(shadowHost);
  }

  function showToast(text, isWarn = false) {
    ensureUI();
    toastBox.textContent = text;
    toastBox.classList.toggle("warn", isWarn);
    toastBox.classList.add("show");
    setTimeout(() => {
      toastBox.classList.remove("show");
    }, 3600);
  }

  function getDirectVideoSrc(videoEl) {
    if (!videoEl) return "";
    const candidates = [videoEl.currentSrc, videoEl.src];
    for (const srcEl of videoEl.querySelectorAll("source")) {
      if (srcEl.src) candidates.push(srcEl.src);
    }
    for (const c of candidates) {
      if (c && /^https?:\/\//i.test(c)) {
        return c;
      }
    }
    return "";
  }

  function findFeedPostUrl(videoEl) {
    if (!videoEl) return "";
    const host = (window.location.hostname || "").toLowerCase();
    const isSocialFeed =
      host.includes("x.com") ||
      host.includes("twitter.com") ||
      host.includes("facebook.com") ||
      host.includes("instagram.com") ||
      host.includes("tiktok.com") ||
      host.includes("reddit.com");

    if (!isSocialFeed) return "";

    const container =
      videoEl.closest("article") ||
      videoEl.closest('[role="article"]') ||
      videoEl.closest("shreddit-post") ||
      videoEl.closest('[data-testid="tweet"]');
    if (!container) return "";

    const selectors = [
      'a[href*="/status/"]',
      'a[href*="/reel/"]',
      'a[href*="/reels/"]',
      'a[href*="/videos/"]',
      'a[href*="/watch"]',
      'a[href*="/p/"]',
      'a[href*="/video/"]',
      'a[href*="/comments/"]'
    ];
    for (const sel of selectors) {
      const link = container.querySelector(sel);
      if (link && link.href && /^https?:\/\//i.test(link.href)) {
        return link.href;
      }
    }
    return "";
  }

  function triggerQuickDownload() {
    if (!activeVideo) return;
    const directSrc = getDirectVideoSrc(activeVideo);
    let topUrl = window.location.href;
    try {
      if (window.top && window.top.location && window.top.location.href) {
        topUrl = window.top.location.href;
      }
    } catch (_) {}

    const postUrl = findFeedPostUrl(activeVideo);
    if (postUrl) {
      topUrl = postUrl;
    }

    const span = pillBtn.querySelector("span");
    const oldText = span.textContent;
    span.textContent = "جاري الإرسال...";

    try {
      chrome.runtime.sendMessage(
        {
          type: "QUICK_DOWNLOAD_FROM_PAGE",
          videoUrl: directSrc,
          pageUrl: topUrl,
          pageTitle: document.title || "video"
        },
        (res) => {
          span.textContent = oldText;
          if (chrome.runtime.lastError || !res) {
            showToast("افتح أيقونة LibertyGrab بالأعلى لبدء التحميل.", true);
            return;
          }
          showToast(res.message || "تمت معالجة الطلب", !res.ok);
        }
      );
    } catch (_) {
      span.textContent = oldText;
    }
  }

  function positionPill(videoEl) {
    if (!floatingEnabled || !videoEl) return;
    if (document.fullscreenElement) {
      if (pillBtn) pillBtn.classList.remove("visible");
      return;
    }
    const rect = videoEl.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 130) return;
    if (rect.bottom < 40 || rect.top > window.innerHeight - 40) return;

    ensureUI();
    const top = Math.max(10, rect.top + 12);
    const left = Math.max(10, rect.left + 12);
    pillBtn.style.top = `${Math.round(top)}px`;
    pillBtn.style.left = `${Math.round(left)}px`;
    pillBtn.classList.add("visible");
  }

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (pillBtn) pillBtn.classList.remove("visible");
    }, 900);
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      if (!floatingEnabled) return;
      const target = e.target;
      if (!target || typeof target.closest !== "function") return;
      let vid = target.tagName === "VIDEO" ? target : target.closest("video");
      if (!vid) {
        const videos = document.querySelectorAll("video");
        for (const v of videos) {
          const r = v.getBoundingClientRect();
          if (
            r.width >= 220 &&
            r.height >= 130 &&
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            vid = v;
            break;
          }
        }
      }
      if (vid) {
        if (hideTimer) clearTimeout(hideTimer);
        activeVideo = vid;
        positionPill(vid);
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!floatingEnabled || !activeVideo || !pillBtn || !pillBtn.classList.contains("visible")) return;
      const r = activeVideo.getBoundingClientRect();
      const inside =
        e.clientX >= r.left - 10 &&
        e.clientX <= r.right + 10 &&
        e.clientY >= r.top - 10 &&
        e.clientY <= r.bottom + 10;
      if (!inside) {
        scheduleHide();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (activeVideo && pillBtn && pillBtn.classList.contains("visible")) {
        positionPill(activeVideo);
      }
    },
    { passive: true }
  );

  function scanPageVideos() {
    const found = [];
    const videos = document.querySelectorAll("video");
    for (const v of videos) {
      const src = getDirectVideoSrc(v);
      if (src && !reportedUrls.has(src)) {
        reportedUrls.add(src);
        const isHls = /\.m3u8(\?|$)/i.test(src);
        found.push({
          url: src,
          ext: isHls ? "m3u8" : "mp4",
          label: isHls ? "بث HLS (M3U8)" : "فيديو HTML5 مباشر",
          isStream: isHls,
          title: document.title || "video"
        });
      } else if (!src && (v.currentSrc || v.src || v.readyState >= 1)) {
        const postUrl = findFeedPostUrl(v) || window.location.href;
        if (postUrl && /^https?:\/\//i.test(postUrl) && !reportedUrls.has(postUrl)) {
          reportedUrls.add(postUrl);
          found.push({
            url: postUrl,
            ext: "mp4",
            label: "مشغّل فيديو بالصفحة",
            isStream: true,
            isPageVideo: true,
            allowAnyUrl: true,
            sizeStr: v.videoHeight ? `${v.videoHeight}p` : "بث مشغّل",
            title: document.title || "فيديو بالصفحة"
          });
        }
      }
    }
    if (found.length > 0) {
      try {
        chrome.runtime.sendMessage({ type: "DOM_VIDEOS_FOUND", videos: found }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
    }
  }

  scanPageVideos();
  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanPageVideos();
    }, 1500);
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"]
    });
  }
})();
