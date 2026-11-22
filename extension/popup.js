// Liberty Video Downloader — Popup Controller (Arabic RTL)

(() => {
  const els = {
    engineStatusBtn: document.getElementById("engineStatusBtn"),
    engineStatusText: document.getElementById("engineStatusText"),
    openFolderTopBtn: document.getElementById("openFolderTopBtn"),
    offlineBanner: document.getElementById("offlineBanner"),
    retryEngineBtn: document.getElementById("retryEngineBtn"),
    switchToSnifferBtn: document.getElementById("switchToSnifferBtn"),
    tabBtns: Array.from(document.querySelectorAll(".tab-btn")),
    tabPanels: {
      smart: document.getElementById("tab-smart"),
      sniffer: document.getElementById("tab-sniffer"),
      downloads: document.getElementById("tab-downloads")
    },
    snifferCountBadge: document.getElementById("snifferCountBadge"),
    activeJobsBadge: document.getElementById("activeJobsBadge"),
    urlInput: document.getElementById("urlInput"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    infoLoadingState: document.getElementById("infoLoadingState"),
    videoCard: document.getElementById("videoCard"),
    videoThumb: document.getElementById("videoThumb"),
    thumbFallback: document.getElementById("thumbFallback"),
    videoDuration: document.getElementById("videoDuration"),
    videoSite: document.getElementById("videoSite"),
    videoTitle: document.getElementById("videoTitle"),
    videoUploader: document.getElementById("videoUploader"),
    infoErrorBox: document.getElementById("infoErrorBox"),
    infoErrorText: document.getElementById("infoErrorText"),
    qualitySelect: document.getElementById("qualitySelect"),
    startDownloadBtn: document.getElementById("startDownloadBtn"),
    startDownloadBtnText: document.getElementById("startDownloadBtnText"),
    useCookiesToggle: document.getElementById("useCookiesToggle"),
    floatingBtnToggle: document.getElementById("floatingBtnToggle"),
    refreshSnifferBtn: document.getElementById("refreshSnifferBtn"),
    snifferEmpty: document.getElementById("snifferEmpty"),
    snifferList: document.getElementById("snifferList"),
    clearFinishedBtn: document.getElementById("clearFinishedBtn"),
    downloadDirInput: document.getElementById("downloadDirInput"),
    saveFolderBtn: document.getElementById("saveFolderBtn"),
    pickFolderBtn: document.getElementById("pickFolderBtn"),
    cleanTempBtn: document.getElementById("cleanTempBtn"),
    jobsEmpty: document.getElementById("jobsEmpty"),
    jobsList: document.getElementById("jobsList"),
    popupToast: document.getElementById("popupToast")
  };

  const state = {
    engineOnline: false,
    activeTabId: -1,
    activeTabUrl: "",
    activeTabTitle: "",
    currentMeta: null,
    capturedItems: [],
    jobs: [],
    pollTimer: null
  };

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  let toastTimeout = null;
  function showPopupToast(text) {
    els.popupToast.textContent = text;
    els.popupToast.classList.remove("hidden");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      els.popupToast.classList.add("hidden");
    }, 3000);
  }

  function switchTab(tabName) {
    for (const btn of els.tabBtns) {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    }
    for (const [key, panel] of Object.entries(els.tabPanels)) {
      panel.classList.toggle("active", key === tabName);
    }
    if (tabName === "sniffer") {
      loadCapturedMedia();
    } else if (tabName === "downloads") {
      refreshJobs();
    }
  }

  // إعداد خيارات الجودة الافتراضية
  function resetDefaultQualities() {
    const defaults = [
      { id: "best", label: "أفضل جودة متاحة تلقائياً (MP4)" },
      { id: "2160", label: "4K Ultra HD (2160p)" },
      { id: "1080", label: "Full HD (1080p)" },
      { id: "720", label: "HD عالي الجودة (720p)" },
      { id: "480", label: "متوسط (480p)" },
      { id: "360", label: "اقتصادي سريع (360p)" },
      { id: "audio_mp3", label: "ملف صوتي فقط (MP3 - 192kbps)" }
    ];
    populateQualityOptions(defaults);
  }

  function populateQualityOptions(qualities) {
    els.qualitySelect.textContent = "";
    for (const q of qualities) {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = q.size_hint ? `${q.label} — تقريباً ${q.size_hint}` : q.label;
      els.qualitySelect.appendChild(opt);
    }
  }

  async function checkEngineStatus(autoAnalyze = false) {
    els.engineStatusBtn.className = "status-pill checking";
    els.engineStatusText.textContent = "جاري الفحص...";

    const res = await sendMsg({ type: "CHECK_ENGINE" });
    state.engineOnline = Boolean(res && res.ok);

    if (state.engineOnline) {
      els.engineStatusBtn.className = "status-pill online";
      els.engineStatusText.textContent = "المحرك متصل";
      els.offlineBanner.classList.add("hidden");
      if (res.download_dir && els.downloadDirInput) {
        els.downloadDirInput.value = res.download_dir;
      }
      if (autoAnalyze && els.urlInput.value.trim()) {
        analyzeCurrentUrl();
      }
      refreshJobs();
    } else {
      els.engineStatusBtn.className = "status-pill offline";
      els.engineStatusText.textContent = "وضع المتصفح فقط";
      els.offlineBanner.classList.remove("hidden");
    }
  }

  async function analyzeCurrentUrl() {
    const url = els.urlInput.value.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      els.infoErrorText.textContent = "يرجى فتح صفحة فيديو أو لصق رابط صالح يبدأ بـ http أو https.";
      els.infoErrorBox.classList.remove("hidden");
      return;
    }

    if (!state.engineOnline) {
      els.offlineBanner.classList.remove("hidden");
      return;
    }

    els.infoErrorBox.classList.add("hidden");
    els.videoCard.classList.add("hidden");
    els.infoLoadingState.classList.remove("hidden");
    els.analyzeBtn.disabled = true;

    const res = await sendMsg({
      type: "EXTRACT_INFO",
      url,
      referer: state.activeTabUrl || url,
      useCookies: els.useCookiesToggle.checked
    });

    els.infoLoadingState.classList.add("hidden");
    els.analyzeBtn.disabled = false;

    if (!res || !res.ok) {
      state.currentMeta = null;
      resetDefaultQualities();
      if (state.capturedItems.length > 0) {
        els.infoErrorText.textContent =
          `تم رصد (${state.capturedItems.length}) ملف فيديو مباشر في هذه الصفحة! انتقل إلى تبويب «التقاط الصفحة» بالأعلى لتحميله فوراً.`;
      } else {
        els.infoErrorText.textContent =
          res?.error || "لم يتم العثور على بيانات مسبقة؛ يمكنك تجربة زر التحميل مباشرة أو تشغيل الفيديو لالتقاطه.";
      }
      els.infoErrorBox.classList.remove("hidden");
      return;
    }

    state.currentMeta = res;
    els.videoTitle.textContent = res.title || "فيديو جاهز للتحميل";
    els.videoUploader.textContent = res.uploader || "";

    if (res.thumbnail) {
      els.videoThumb.src = res.thumbnail;
      els.videoThumb.classList.remove("hidden");
      els.thumbFallback.classList.add("hidden");
    } else {
      els.videoThumb.classList.add("hidden");
      els.thumbFallback.classList.remove("hidden");
    }

    if (res.duration_str) {
      els.videoDuration.textContent = res.duration_str;
      els.videoDuration.classList.remove("hidden");
    } else {
      els.videoDuration.classList.add("hidden");
    }

    if (res.site) {
      els.videoSite.textContent = res.site;
      els.videoSite.classList.remove("hidden");
    } else {
      els.videoSite.classList.add("hidden");
    }

    if (Array.isArray(res.qualities) && res.qualities.length > 0) {
      populateQualityOptions(res.qualities);
    } else {
      resetDefaultQualities();
    }

    els.videoCard.classList.remove("hidden");
  }

  els.videoThumb.addEventListener("error", () => {
    els.videoThumb.classList.add("hidden");
    els.thumbFallback.classList.remove("hidden");
  });

  async function handleStartSmartDownload() {
    const url = els.urlInput.value.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      showPopupToast("يرجى إدخال رابط فيديو صحيح أولاً");
      return;
    }

    if (!state.engineOnline) {
      // إذا كان الرابط مباشراً لملف mp4/webm نحمّله عبر المتصفح فوراً
      if (/\.(mp4|webm|mov|mkv)(\?|#|$)/i.test(url)) {
        await sendMsg({
          type: "DIRECT_BROWSER_DOWNLOAD",
          url,
          name: state.activeTabTitle || "video",
          ext: "mp4"
        });
        showPopupToast("بدأ التحميل المباشر في المتصفح!");
        return;
      }
      els.offlineBanner.classList.remove("hidden");
      showPopupToast("شغّل المحرك المحلي أولاً لتحميل هذا الرابط بأعلى جودة");
      return;
    }

    els.startDownloadBtn.disabled = true;
    els.startDownloadBtnText.textContent = "جاري إضافة التحميل...";

    const title = state.currentMeta?.title || state.activeTabTitle || "فيديو محمّل";
    const thumbnail = state.currentMeta?.thumbnail || "";
    const quality = els.qualitySelect.value || "best";

    const res = await sendMsg({
      type: "START_ENGINE_DOWNLOAD",
      url,
      cookieUrl: state.activeTabUrl || url,
      title,
      thumbnail,
      quality,
      referer: state.activeTabUrl || url,
      useCookies: els.useCookiesToggle.checked
    });

    els.startDownloadBtn.disabled = false;
    els.startDownloadBtnText.textContent = "بدء التحميل الآن";

    if (res && res.ok) {
      showPopupToast("✓ تم بدء التحميل بنجاح!");
      await refreshJobs();
      switchTab("downloads");
    } else {
      showPopupToast(res?.error || "تعذر بدء التحميل");
    }
  }

  async function loadCapturedMedia(liveScan = true) {
    if (state.activeTabId < 0) return;
    const res = await sendMsg({
      type: "GET_CAPTURED_MEDIA",
      tabId: state.activeTabId,
      liveScan: Boolean(liveScan)
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    state.capturedItems = items;

    if (items.length > 0) {
      els.snifferCountBadge.textContent = String(items.length);
      els.snifferCountBadge.classList.remove("hidden");
      els.snifferEmpty.classList.add("hidden");
    } else {
      els.snifferCountBadge.classList.add("hidden");
      els.snifferEmpty.classList.remove("hidden");
    }

    els.snifferList.textContent = "";
    for (const item of items) {
      const card = document.createElement("div");
      card.className = "media-item";

      const top = document.createElement("div");
      top.className = "media-top";

      const nameEl = document.createElement("div");
      nameEl.className = "media-name";
      nameEl.textContent = item.name || "ملف فيديو مكتشف";

      const tag = document.createElement("span");
      tag.className = `tag ${item.isStream ? "stream" : ""}`;
      tag.textContent = item.label || item.ext.toUpperCase();

      top.appendChild(nameEl);
      top.appendChild(tag);

      const meta = document.createElement("div");
      meta.className = "media-meta";
      let host = "";
      try {
        host = new URL(item.url).hostname;
      } catch (_) {}
      const hostSpan = document.createElement("span");
      hostSpan.textContent = host;
      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = item.sizeStr
        ? item.sizeStr
        : (item.isStream ? "بث متعدد المقاطع" : "ملف مباشر");
      meta.appendChild(hostSpan);
      meta.appendChild(sizeSpan);

      const actions = document.createElement("div");
      actions.className = "media-actions";

      if (!item.isStream && !item.isPageVideo) {
        const directBtn = document.createElement("button");
        directBtn.type = "button";
        directBtn.className = "action-chip primary";
        directBtn.textContent = "⬇ تحميل مباشر بالمتصفح";
        directBtn.addEventListener("click", async () => {
          await sendMsg({
            type: "DIRECT_BROWSER_DOWNLOAD",
            url: item.url,
            name: item.name || state.activeTabTitle || "video",
            ext: item.ext || "mp4"
          });
          showPopupToast("بدأ التحميل عبر المتصفح!");
        });
        actions.appendChild(directBtn);
      }

      const engineBtn = document.createElement("button");
      engineBtn.type = "button";
      engineBtn.className = `action-chip ${(item.isStream || item.isPageVideo) ? "primary" : ""}`;
      engineBtn.textContent = item.isPageVideo
        ? "⚡ تحميل بأعلى جودة (LibertyGrab)"
        : item.isStream
          ? "⬇ تحميل ودمج كـ MP4 (LibertyGrab)"
          : "⚡ تحميل سريع (LibertyGrab)";
      engineBtn.addEventListener("click", async () => {
        if (!state.engineOnline) {
          els.offlineBanner.classList.remove("hidden");
          showPopupToast("يلزم تشغيل محرك LibertyGrab المحلي لتحميل ودمج هذا الفيديو");
          return;
        }
        const dlRes = await sendMsg({
          type: "START_ENGINE_DOWNLOAD",
          url: item.url,
          cookieUrl: state.activeTabUrl || item.url,
          title: item.name || state.activeTabTitle || "فيديو ملتقط",
          quality: "best",
          referer: state.activeTabUrl || item.referer || "",
          useCookies: els.useCookiesToggle.checked
        });
        if (dlRes && dlRes.ok) {
          showPopupToast("✓ بدأ التحميل عبر محرك LibertyGrab!");
          await refreshJobs();
          switchTab("downloads");
        } else {
          showPopupToast(dlRes?.error || "تعذر بدء التحميل");
        }
      });
      actions.appendChild(engineBtn);

      if (item.isPageVideo || item.isStream) {
        const pickQualityBtn = document.createElement("button");
        pickQualityBtn.type = "button";
        pickQualityBtn.className = "action-chip";
        pickQualityBtn.textContent = "اختيار الجودة";
        pickQualityBtn.addEventListener("click", () => {
          els.urlInput.value = item.url;
          switchTab("smart");
          analyzeCurrentUrl();
        });
        actions.appendChild(pickQualityBtn);
      }

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "action-chip";
      copyBtn.textContent = "نسخ الرابط";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(item.url);
          showPopupToast("تم نسخ رابط الفيديو");
        } catch (_) {}
      });
      actions.appendChild(copyBtn);

      card.appendChild(top);
      card.appendChild(meta);
      card.appendChild(actions);
      els.snifferList.appendChild(card);
    }
  }

  async function refreshJobs() {
    if (!state.engineOnline) {
      els.activeJobsBadge.classList.add("hidden");
      return;
    }
    const res = await sendMsg({ type: "GET_JOBS" });
    if (!res || !res.ok || !Array.isArray(res.jobs)) return;

    state.jobs = res.jobs;
    const activeCount = state.jobs.filter((j) =>
      ["queued", "downloading", "merging", "converting_mp3"].includes(j.status)
    ).length;

    if (activeCount > 0) {
      els.activeJobsBadge.textContent = String(activeCount);
      els.activeJobsBadge.classList.remove("hidden");
    } else {
      els.activeJobsBadge.classList.add("hidden");
    }

    if (state.jobs.length === 0) {
      els.jobsEmpty.classList.remove("hidden");
      els.jobsList.textContent = "";
      return;
    }

    els.jobsEmpty.classList.add("hidden");
    els.jobsList.textContent = "";

    for (const job of state.jobs) {
      const card = document.createElement("div");
      card.className = `job-item ${job.status}`;

      const top = document.createElement("div");
      top.className = "job-top";

      const titleEl = document.createElement("div");
      titleEl.className = "job-title";
      titleEl.textContent = job.title || "فيديو";

      const qTag = document.createElement("span");
      qTag.className = "tag";
      qTag.textContent = job.quality_label || job.quality;

      top.appendChild(titleEl);
      top.appendChild(qTag);

      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("div");
      fill.className = "progress-fill";
      fill.style.width = `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`;
      track.appendChild(fill);

      const meta = document.createElement("div");
      meta.className = "job-meta";
      const statusSpan = document.createElement("span");
      statusSpan.textContent = job.status_text || job.status;

      const statsParts = [];
      if (typeof job.progress === "number" && job.progress > 0 && job.status !== "completed") {
        statsParts.push(`${job.progress.toFixed(1)}%`);
      }
      if (job.speed_str) statsParts.push(job.speed_str);
      if (job.eta_str) statsParts.push(`متبقي ${job.eta_str}`);
      if (job.total_str) statsParts.push(job.total_str);

      const statsSpan = document.createElement("span");
      statsSpan.dir = "ltr";
      statsSpan.textContent = statsParts.join(" • ");

      meta.appendChild(statusSpan);
      meta.appendChild(statsSpan);

      card.appendChild(top);
      card.appendChild(track);
      card.appendChild(meta);

      if (job.status === "error" && job.error) {
        const errDiv = document.createElement("div");
        errDiv.className = "job-error";
        errDiv.textContent = job.error;
        card.appendChild(errDiv);
      }

      const actions = document.createElement("div");
      actions.className = "job-actions";

      if (job.status === "completed") {
        const showBtn = document.createElement("button");
        showBtn.type = "button";
        showBtn.className = "action-chip primary";
        showBtn.textContent = "📂 عرض الفيديو في المجلد";
        showBtn.addEventListener("click", () => {
          sendMsg({ type: "OPEN_FOLDER", jobId: job.id });
        });
        actions.appendChild(showBtn);
      } else if (["queued", "downloading", "merging", "converting_mp3"].includes(job.status)) {
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "action-chip danger";
        cancelBtn.textContent = "إلغاء التحميل";
        cancelBtn.addEventListener("click", async () => {
          await sendMsg({ type: "CANCEL_JOB", jobId: job.id });
          refreshJobs();
        });
        actions.appendChild(cancelBtn);
      }

      if (actions.childNodes.length > 0) {
        card.appendChild(actions);
      }

      els.jobsList.appendChild(card);
    }
  }

  // ربط الأحداث
  for (const btn of els.tabBtns) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }

  els.engineStatusBtn.addEventListener("click", () => {
    if (!state.engineOnline) {
      els.offlineBanner.classList.toggle("hidden");
    } else {
      showPopupToast("محرك LibertyGrab المحلي يعمل وجاهز للتحميل بأقصى سرعة ✓");
    }
  });

  els.openFolderTopBtn.addEventListener("click", async () => {
    if (state.engineOnline) {
      await sendMsg({ type: "OPEN_FOLDER" });
    } else {
      chrome.downloads.showDefaultFolder();
    }
  });

  els.retryEngineBtn.addEventListener("click", () => checkEngineStatus(true));
  els.switchToSnifferBtn.addEventListener("click", () => switchTab("sniffer"));
  els.analyzeBtn.addEventListener("click", () => analyzeCurrentUrl());
  els.urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      analyzeCurrentUrl();
    }
  });
  els.startDownloadBtn.addEventListener("click", handleStartSmartDownload);
  els.refreshSnifferBtn.addEventListener("click", () => loadCapturedMedia(true));

  els.clearFinishedBtn.addEventListener("click", async () => {
    await sendMsg({ type: "CLEAR_JOBS" });
    refreshJobs();
  });

  async function saveDownloadDir() {
    if (!state.engineOnline) {
      showPopupToast("شغّل المحرك المحلي أولاً لتغيير مجلد الحفظ");
      return;
    }
    const dir = (els.downloadDirInput.value || "").trim();
    els.saveFolderBtn.disabled = true;
    const res = await sendMsg({ type: "SET_CONFIG", downloadDir: dir });
    els.saveFolderBtn.disabled = false;
    if (res && res.ok) {
      els.downloadDirInput.value = res.download_dir || dir;
      showPopupToast("✓ تم حفظ مجلد التحميل الجديد بنجاح!");
    } else {
      showPopupToast(res?.error || "تعذر حفظ المسار، تأكد من صحته");
    }
  }

  els.saveFolderBtn.addEventListener("click", saveDownloadDir);
  els.downloadDirInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveDownloadDir();
    }
  });

  els.pickFolderBtn.addEventListener("click", async () => {
    if (!state.engineOnline) {
      showPopupToast("شغّل المحرك المحلي أولاً لاختيار المجلد");
      return;
    }
    showPopupToast("جاري فتح نافذة اختيار المجلد...");
    const res = await sendMsg({ type: "PICK_FOLDER" });
    if (res && res.ok && !res.cancelled && res.download_dir) {
      els.downloadDirInput.value = res.download_dir;
      showPopupToast("✓ تم تغيير مجلد الحفظ بنجاح!");
    } else if (res && !res.ok) {
      showPopupToast(res.error || "تعذر اختيار المجلد");
    }
  });

  els.cleanTempBtn.addEventListener("click", async () => {
    if (!state.engineOnline) {
      showPopupToast("شغّل المحرك المحلي أولاً");
      return;
    }
    const res = await sendMsg({ type: "CLEAN_TEMP" });
    if (res && res.ok) {
      const n = Number(res.removed || 0);
      showPopupToast(n > 0 ? `✓ تم تنظيف ${n} ملف مؤقت غير مكتمل` : "المجلد نظيف تماماً لا توجد بقايا ✓");
    }
  });

  els.useCookiesToggle.addEventListener("change", () => {
    chrome.storage.local.set({ useCookies: els.useCookiesToggle.checked });
  });

  els.floatingBtnToggle.addEventListener("change", () => {
    chrome.storage.local.set({ showFloatingBtn: els.floatingBtnToggle.checked });
  });

  // تهيئة الإضافة عند الفتح
  async function init() {
    const saved = await chrome.storage.local.get({
      useCookies: true,
      showFloatingBtn: true
    });
    els.useCookiesToggle.checked = Boolean(saved.useCookies);
    els.floatingBtnToggle.checked = Boolean(saved.showFloatingBtn);

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (tab) {
      state.activeTabId = tab.id ?? -1;
      state.activeTabTitle = tab.title || "";
      if (tab.url && /^https?:\/\//i.test(tab.url)) {
        state.activeTabUrl = tab.url;
        els.urlInput.value = tab.url;
      }
    }

    await loadCapturedMedia();
    await checkEngineStatus(Boolean(state.activeTabUrl));

    state.pollTimer = setInterval(() => {
      if (state.engineOnline) {
        refreshJobs();
      }
    }, 1200);
  }

  init();
})();
