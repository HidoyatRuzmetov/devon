"""Create labeled CSS-pixel overview sheets from retained Canvas QA captures.

WebKit's 2x originals are displayed at CSS scale in these overviews. Readability at
device resolution must also be reviewed in selected originals; no crop replaces
the source capture or its independent geometry assertions.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "artifacts/qa/2026-10/canvas-nested/canvas-final-root"
DEST = SOURCE / "pixel-sheets"
DEST.mkdir(parents=True, exist_ok=True)

for browser in ("chromium", "firefox", "webkit"):
    for locale in ("en", "uz-Latn", "uz-Cyrl", "ru"):
        for theme in ("light", "dark"):
            images = []
            for width, scale in ((1440, 1), (320, 1), (320, 2)):
                name = f"controls-{locale}-{theme}-{width}-text{scale}.png"
                original = Image.open(SOURCE / browser / name).convert("RGB")
                ratio = original.width / width
                css = original.resize((width, round(original.height / ratio))) if ratio != 1 else original
                images.append(css)
            top = images[0].crop((0, 0, 1440, min(500, images[0].height)))
            height = 560 + max(images[1].height, images[2].height)
            sheet = Image.new("RGB", (1440, height), "#dddddd")
            draw = ImageDraw.Draw(sheet)
            draw.text((8, 8), f"{browser} / {locale} / {theme} / desktop upper surface at CSS scale", fill="black")
            sheet.paste(top, (0, 30))
            for x, index, scale in ((0, 1, 1), (336, 2, 2)):
                draw.text((x + 8, 540), f"320 CSS px / text {scale}x / full page", fill="black")
                sheet.paste(images[index], (x, 560))
            sheet.save(DEST / f"{browser}-{locale}-{theme}.png")
print("Created 24 labeled Canvas overview sheets; originals retained.")
