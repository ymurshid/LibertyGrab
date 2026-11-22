#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Builds two clean browser extension ZIP packages:
  1) dist/LibertyGrab-Full-Extension.zip          (Full GitHub / Unpacked Edition)
  2) dist/LibertyGrab-ChromeStore-Extension.zip   (Chrome Web Store Compliant Edition - excludes YouTube)
"""

import json
import shutil
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT_SRC = ROOT / "extension"
DIST_DIR = ROOT / "dist"


def zip_dir(source_dir: Path, out_zip: Path) -> None:
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    if out_zip.exists():
        out_zip.unlink()
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_file():
                # Exclude .ico (Windows installer only) from browser extension ZIP
                if file_path.suffix.lower() == ".ico":
                    continue
                zf.write(file_path, file_path.relative_to(source_dir).as_posix())


def build_all() -> None:
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Full Edition ZIP
    full_zip = DIST_DIR / "LibertyGrab-Full-Extension.zip"
    zip_dir(EXT_SRC, full_zip)
    print(f"[OK] Built Full Edition: {full_zip} ({full_zip.stat().st_size:,} bytes)")

    # 2. Chrome Web Store Edition ZIP (strictly complies with Chrome Web Store YouTube policy)
    with tempfile.TemporaryDirectory(prefix="lg_store_") as tmp:
        stage = Path(tmp) / "extension"
        shutil.copytree(EXT_SRC, stage)

        # Update config.js -> chrome_store edition
        (stage / "config.js").write_text(
            "// Chrome Web Store compliant build\n"
            "self.LIBERTYGRAB_CONFIG = {\n"
            '  edition: "chrome_store",\n'
            "  allowYoutube: false,\n"
            '  engineReleaseUrl: "https://github.com/ymurshid/LibertyGrab/releases/latest"\n'
            "};\n",
            encoding="utf-8",
        )

        # Update manifest.json -> remove YouTube mentions & exclude YouTube from content_scripts
        manifest_path = stage / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["description"] = (
            "LibertyGrab — محمّل الفيديوهات والوسائط المباشرة للمتصفح (MP4 / WebM / HLS M3U8 / DASH) "
            "بواجهة عربية داكنة، يدعم حفظ الفيديوهات من المواقع المدعومة بجودات متعددة."
        )
        for cs in manifest.get("content_scripts", []):
            cs["exclude_matches"] = [
                "*://*.youtube.com/*",
                "*://youtube.com/*",
                "*://youtu.be/*",
                "*://*.youtube-nocookie.com/*",
            ]
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        # Update popup.html -> remove YouTube placeholder/mention for Store compliance
        popup_html_path = stage / "popup.html"
        html = popup_html_path.read_text(encoding="utf-8")
        html = html.replace(
            'placeholder="https://www.youtube.com/watch?v=..."',
            'placeholder="https://vimeo.com/... أو رابط أي فيديو مدعوم"',
        )
        html = html.replace(
            "ندعم يوتيوب، فيسبوك، إنستجرام، تيك توك، X، وأكثر من 1000 موقع",
            "ندعم مئات المواقع، البث المباشر HLS/DASH، وفيديوهات HTML5 بجودات متعددة",
        )
        popup_html_path.write_text(html, encoding="utf-8")

        store_zip = DIST_DIR / "LibertyGrab-ChromeStore-Extension.zip"
        zip_dir(stage, store_zip)
        print(f"[OK] Built Chrome Web Store Edition: {store_zip} ({store_zip.stat().st_size:,} bytes)")


if __name__ == "__main__":
    build_all()
