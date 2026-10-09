"""Make labeled, unscaled inspection crops from already captured local QA headers.

For wide bars, the left/right crops are shown separately; their juxtaposition is not a claim
about spacing. Original PNGs and browser geometry assertions remain the layout evidence.
"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "artifacts/qa/2026-10/shell"
DESTINATION = SOURCE / "inspection-crops"
DESTINATION.mkdir(parents=True, exist_ok=True)

for browser in ("chromium", "firefox", "webkit"):
    for locale in ("en", "uz-Latn", "uz-Cyrl", "ru"):
        rows = []
        for theme in ("light", "dark"):
            for width in (1920, 1440, 1280, 1024, 768, 390, 320):
                source = SOURCE / browser / f"{locale}-{theme}-{width}-header.png"
                original = Image.open(source).convert("RGB")
                row = Image.new("RGB", (1040, original.height + 28), "#dddddd")
                ImageDraw.Draw(row).text((8, 6), f"{browser} / {locale} / {theme} / {width} CSS px", fill="black")
                if original.width <= 1040:
                    row.paste(original, (0, 28))
                else:
                    row.paste(original.crop((0, 0, 516, original.height)), (0, 28))
                    row.paste(original.crop((original.width - 516, 0, original.width, original.height)), (524, 28))
                rows.append(row)
        sheet = Image.new("RGB", (1040, sum(row.height for row in rows)), "#dddddd")
        top = 0
        for row in rows:
            sheet.paste(row, (0, top))
            top += row.height
        sheet.save(DESTINATION / f"{browser}-{locale}.png")

        enlarged = []
        for theme in ("light", "dark"):
            for width in (1440, 768, 320):
                source = SOURCE / browser / f"{locale}-{theme}-{width}-text200-short-header.png"
                original = Image.open(source).convert("RGB")
                row = Image.new("RGB", (1040, original.height + 28), "#dddddd")
                ImageDraw.Draw(row).text((8, 6), f"{browser} / {locale} / {theme} / {width} CSS px / text200 / height480", fill="black")
                if original.width <= 1040:
                    row.paste(original, (0, 28))
                else:
                    row.paste(original.crop((0, 0, 516, original.height)), (0, 28))
                    row.paste(original.crop((original.width - 516, 0, original.width, original.height)), (524, 28))
                enlarged.append(row)
        sheet = Image.new("RGB", (1040, sum(row.height for row in enlarged)), "#dddddd")
        top = 0
        for row in enlarged:
            sheet.paste(row, (0, top))
            top += row.height
        sheet.save(DESTINATION / f"{browser}-{locale}-text200-short.png")

print("Created 24 unscaled normal/enlarged header inspection sheets; original PNGs retained.")
