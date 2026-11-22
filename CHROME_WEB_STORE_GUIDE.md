# دليل رفع LibertyGrab على متجر كروم (Chrome Web Store)

## 1️⃣ الملف الجاهز للرفع (متوافق 100% مع سياسات Google)
بعد تشغيل `installer/build_extensions.py` أو تحميله من **GitHub Releases**، ستحصل على ملف:
```text
dist/LibertyGrab-ChromeStore-Extension.zip
```
هذا الملف مخصص لمتجر كروم ويستبعد تلقائياً نطاقات `youtube.com` / `youtu.be` وأي ذكر ليوتيوب من الوصف والواجهة التزاماً بسياسة Chrome Web Store، مع إبقاء زر تحميل **محرك LibertyGrab للويندوز (`LibertyGrab-Setup.exe`)** بضغطة واحدة من داخل الإضافة.

---

## 2️⃣ خطوات الرفع على Chrome Web Store Developer Dashboard
1. افتح لوحة المطورين: https://chrome.google.com/webstore/devconsole
   - رسوم تفعيل حساب المطور: **\$5 مرة واحدة فقط مدى الحياة**.
2. اضغط **New Item** وارفع ملف **`LibertyGrab-ChromeStore-Extension.zip`**.
3. في تبويب **Store listing**:
   - **Title:** `LibertyGrab — Video & Media Downloader`
   - **Category:** `Tools` (أو `Productivity`)
   - **Language:** `Arabic` / `English`
   - **Store Icon:** ارفع `extension/icons/icon128.png`
   - **Screenshots:** خذ 2–3 لقطات شاشة لنافذة الإضافة بمقاس `1280x800` أو `640x400` (تجنب ظهور موقع YouTube في أي لقطة شاشة!).
4. في تبويب **Privacy practices**:
   - **Privacy Policy URL:**
     ```text
     https://github.com/ymurshid/LibertyGrab/blob/main/PRIVACY_POLICY.md
     ```
   - **Single Purpose Description (نسخ ولصق جاهز):**
     ```text
     Detect and download direct HTML5 videos and non-DRM media streams (MP4, WebM, HLS, DASH) from supported web pages via the browser or the optional local LibertyGrab companion app.
     ```
   - **Permission Justifications (تبريرات الصلاحيات جاهزة للنسخ):**
     - **`activeTab` & `tabs`**: Required to read the active tab URL and title when the user clicks the extension icon to detect or save media from the current page.
     - **`webRequest`**: Passively monitors media response headers (`video/*`, `.m3u8`, `.mpd`) per tab to list downloadable non-DRM streams in the popup.
     - **`scripting`**: Scans `<video>` elements and embedded media frames on the active tab on demand when the user opens the Page Capture tab.
     - **`downloads`**: Saves direct media files to the user's Downloads folder.
     - **`cookies`**: Optional, user-toggled feature that reads cookies only for the current video site to pass to the user's own local companion app (`127.0.0.1`) for authenticated non-DRM videos the user already has access to; never transmitted externally.
     - **`storage`**: Persists local UI preferences (floating download button toggle, cookie toggle) and per-tab detected media lists.
     - **`host_permissions (<all_urls>, http://127.0.0.1:17890/*)`**: Required because users visit arbitrary video websites across the web, and to communicate exclusively with the user's optional local companion engine on `127.0.0.1:17890`.
   - **Remote Code:** اختر **No, I am not using remote code**.
   - **Data Usage Certification:** فعّل الإقرار بأن الإضافة لا تجمع ولا تبيع أي بيانات مستخدم.
5. اضغط **Submit for review** — المراجعة عادةً تستغرق 1 إلى 3 أيام.

---

## 3️⃣ بديل مجاني بالكامل (بدون رسوم \$5)
يمكنك أيضاً رفع ملف **`LibertyGrab-Full-Extension.zip`** على:
- **Microsoft Edge Add-ons Store** (مجاني \$0): https://partner.microsoft.com/dashboard/microsoftedge
- **GitHub Releases** (مُفعّل تلقائياً لدينا مع `LibertyGrab-Setup.exe`!).
