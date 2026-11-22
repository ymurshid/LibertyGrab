# Privacy Policy — LibertyGrab Browser Extension

**Last Updated:** November 22, 2026  
**Publisher:** Liberty Dev (`https://github.com/ymurshid/LibertyGrab`)

---

## 1. Overview (Zero Data Collection)
**LibertyGrab** is a 100% local-first video download manager. We do **not** collect, store, sell, transmit, or share any personal data, browsing history, analytics, telemetry, or downloaded media URLs with any external server or third party.

## 2. How Permissions Are Used
All processing happens strictly inside your browser or between your browser and the optional companion application running locally on your own computer (`http://127.0.0.1:17890`):

- **`activeTab` & `tabs`**: Reads the URL and title of the active tab only when you open the extension or initiate a download.
- **`webRequest`**: Passively detects direct media files (`MP4`, `WebM`, `HLS .m3u8`, `DASH .mpd`) loaded in the current tab so you can save them.
- **`scripting`**: Scans the active tab's `<video>` elements and embedded players on demand when you inspect or refresh the "Page Capture" tab.
- **`downloads`**: Saves direct media files to your browser's local Downloads directory.
- **`cookies`**: Optional and user-controlled (toggleable in the popup). When enabled by you, reads cookies only for the active video website and sends them solely to your own local companion engine (`127.0.0.1`) inside a temporary file that is immediately deleted after the download finishes. Cookies are never transmitted over the internet to any third party.
- **`storage`**: Stores your local UI preferences (e.g., floating button toggle, cookie toggle) and per-tab detected media list locally inside your browser.

## 3. Data Security & Third-Party Services
- LibertyGrab communicates **only** with `127.0.0.1:17890` (your own machine) when the companion engine is installed, and rejects all external web page origins (`HTTP 403`).
- No analytics SDKs, ads, trackers, or remote code execution exist in LibertyGrab.

## 4. Contact
For privacy inquiries or questions, open an issue at:  
https://github.com/ymurshid/LibertyGrab/issues

---

## سياسة الخصوصية (بالعربية)
إضافة **LibertyGrab** تعمل محلياً بالكامل على جهازك، ولا تجمع أو ترسل أو تشارك أي بيانات شخصية أو سجل تصفح أو روابط مع أي خادم خارجي. كل الصلاحيات تُستخدم فقط لاكتشاف وحفظ الفيديوهات في جهازك عبر المتصفح أو المحرك المحلي على `127.0.0.1` فقط، وملفات الكوكيز المؤقتة (عند تفعيلك للخيار يدوياً) تُحذف فوراً بعد انتهاء كل تحميل.
