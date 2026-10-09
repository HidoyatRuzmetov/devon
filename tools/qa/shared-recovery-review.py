"""Build unscaled comparison sheets. This script never establishes pixel review."""
from pathlib import Path
import json
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
base = root / "artifacts/qa/2026-10/results/platform/shared-recovery-all-themes"
report = json.loads((base / "summary.json").read_text(encoding="utf-8"))
if report["stats"]["expected"] != 24 or any(report["stats"][k] for k in ("unexpected", "skipped", "flaky")) or report["errors"]:
    raise ValueError("The exact 24-case report must pass without skipped or retried cases")
output = base / "pixel-review"
output.mkdir(exist_ok=True)
manifest = []

def capture(prefix, theme, browser, name):
    paths = list(base.glob(f"{prefix}*in-{theme}-{browser}/{name}"))
    if len(paths) != 1:
        raise ValueError(f"Expected one actual {prefix}/{theme}/{browser}/{name} capture")
    return paths[0], Image.open(paths[0]).convert("RGB")

def sheet(name, cells, columns):
    cell_width = max(image.width for _, image, _ in cells) + 12
    cell_height = max(image.height for _, image, _ in cells) + 36
    canvas = Image.new("RGB", (cell_width * columns, cell_height * ((len(cells) + columns - 1) // columns)), "#e6e6e6")
    drawing = ImageDraw.Draw(canvas)
    for i, (source, image, label) in enumerate(cells):
        x, y = (i % columns) * cell_width, (i // columns) * cell_height
        drawing.text((x + 4, y + 8), label, fill="black")
        canvas.paste(image, (x, y + 36))
    path = output / f"{name}.png"
    canvas.save(path)
    manifest.append({"sheet": str(path.relative_to(root)).replace("\\", "/"), "sources": [str(c[0].relative_to(root)).replace("\\", "/") for c in cells], "scale": "1:1 original pixels", "review": "pending actual opening"})

for browser in ("chromium", "firefox", "webkit"):
    for theme in ("light", "dark"):
        demo = []
        for locale in ("en", "ru", "uz-Latn", "uz-Cyrl"):
            states = []
            for kind in ("error", "forbidden", "offline"):
                for mode in ("focus", "full"):
                    path, image = capture("platform-state-card.qa-", theme, browser, f"{locale}-{kind}-{mode}.png")
                    states.append((path, image, f"{browser}/{theme}/{locale}/{kind}/{mode}"))
            sheet(f"states-{browser}-{theme}-{locale}", states, 6)
            for mode in ("closed", "open"):
                path, image = capture("platform-demo-chip.qa-", theme, browser, f"{locale}-{mode}.png")
                demo.append((path, image, f"{browser}/{theme}/{locale}/{mode}"))
            onboarding = []
            for role in ("member", "super_admin"):
                for width, scale in ((1440, 1), (320, 2)):
                    path, image = capture("platform-no-department.qa-", theme, browser, f"{role}-{locale}-{width}-text{scale}.png")
                    # Desktop sidebar has its own evidence. Main/header remain at native size.
                    if width == 1440:
                        image = image.crop((264, 0, image.width, image.height))
                    onboarding.append((path, image, f"{browser}/{theme}/{locale}/{role}/{width}"))
            sheet(f"onboarding-{browser}-{theme}-{locale}", onboarding, 2)
        sheet(f"demo-{browser}-{theme}", demo, 2)

(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sheets": len(manifest), "sourceImages": sum(len(item["sources"]) for item in manifest), "pixelReview": "pending actual opening"}))
