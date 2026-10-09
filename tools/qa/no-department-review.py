"""Unscaled inspection sheets; generating them does not establish pixel review."""
from pathlib import Path
import json
import re
import sys
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
run_id = sys.argv[1] if len(sys.argv) > 1 else "no-department-locale-reflow"
if not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", run_id):
    raise ValueError("Expected a named local QA run, without path separators")
base = root / "artifacts/qa/2026-10/results/platform" / run_id
report = json.loads((base / "summary.json").read_text(encoding="utf-8"))
if report["stats"]["expected"] != 6 or any(report["stats"][key] for key in ("unexpected", "skipped", "flaky")) or report["errors"]:
    raise ValueError("Named six-case report must actually pass")
output = base / "pixel-review"
output.mkdir(exist_ok=True)
manifest = []
for browser in ("chromium", "firefox", "webkit"):
    for locale in ("en", "ru", "uz-Latn", "uz-Cyrl"):
        rows = []
        source_paths = []
        for role in ("member", "super_admin"):
            images = []
            for width, scale in ((1440, 1), (320, 2)):
                paths = list(base.glob(f"*{browser}/{role}-{locale}-{width}-text{scale}.png"))
                if len(paths) != 1:
                    raise ValueError(f"Expected one actual capture: {browser}/{role}/{locale}/{width}")
                source_paths.append(str(paths[0].relative_to(root)).replace("\\", "/"))
                source = Image.open(paths[0]).convert("RGB")
                # The desktop main and header are retained at 1:1 pixels; sidebar has separate QA.
                images.append(source.crop((264, 0, source.width, source.height)) if width == 1440 else source)
            height = max(image.height for image in images) + 36
            row = Image.new("RGB", (sum(image.width for image in images) + 12, height), "#e6e6e6")
            ImageDraw.Draw(row).text((8, 8), f"{browser} / {locale} / {role}; desktop main + full mobile, original pixel sizes", fill="black")
            x = 0
            for image in images:
                row.paste(image, (x, 36))
                x += image.width + 12
            rows.append(row)
        sheet = Image.new("RGB", (max(row.width for row in rows), sum(row.height for row in rows) + 12), "#e6e6e6")
        y = 0
        for row in rows:
            sheet.paste(row, (0, y))
            y += row.height + 12
        path = output / f"{browser}-{locale}.png"
        sheet.save(path)
        manifest.append({"sheet": str(path.relative_to(root)).replace("\\", "/"), "sources": source_paths,
                         "method": "Unscaled desktop header/main crop excluding sidebar; complete unscaled mobile original. Review not established by this generator."})
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sheets": len(manifest), "sourceImages": sum(len(item["sources"]) for item in manifest), "pixelReview": "pending actual opening"}))
