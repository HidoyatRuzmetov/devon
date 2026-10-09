"""Derive labelled local QA comparisons and unmodified readable detail crops.

Run after a completed knowledge-controls run. No image is marked reviewed here.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    families = {
        "create-refused": "bottom",
        "incoming-items-draft": "bottom",
        "slash-short-mobile": "full",
        "toggle-refused": "bottom",
        "delete-refused": "bottom",
        "template-conflict": "bottom",
        "rich-editor-callout": "full",
        "mention-no-results-dismissed": "full",
        "template-context-tooltip": "bottom",
        "templates-empty": "full",
    }
    groups = {}
    for source in args.run.rglob("*.png"):
        if source.parent.name == "functional-pixel-sheets":
            continue
        if source.stem not in families:
            continue
        engine = next((name for name in ("chromium", "firefox", "webkit")
                       if source.parent.name.endswith("-" + name)), None)
        if not engine:
            raise ValueError(f"Unknown engine for actual capture: {source}")
        groups.setdefault(source.stem, []).append((engine, source))
    output = args.run / "functional-pixel-sheets"
    output.mkdir(exist_ok=True)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
    manifest = []
    for family, sources in sorted(groups.items()):
        sheet = Image.new("RGB", (2400, 1150), "#d9dce0")
        draw = ImageDraw.Draw(sheet)
        details = []
        for number, (engine, source) in enumerate(sorted(sources)):
            original = Image.open(source)
            side = families[family]
            height = min(original.height, 1600 if family == "incoming-items-draft" else 900)
            top = original.height - height if side == "bottom" else 0
            scope = original if side == "full" else original.crop((0, top, original.width, top + height))
            detail = output / f"{family}-{engine}-detail.png"
            scope.save(detail)
            reduced = scope.convert("RGB")
            reduced.thumbnail((784, 1080), Image.Resampling.LANCZOS)
            x = number * 800
            draw.text((x + 8, 8), f"{family} / {engine}", font=font, fill="black")
            draw.text((x + 8, 34), f"{side} original pixels; {original.width}×{original.height}",
                      font=font, fill="black")
            sheet.paste(reduced, (x + 8, 64))
            details.append({"engine": engine, "screenshot": str(source.resolve()),
                            "detail": str(detail.resolve()), "scope": side,
                            "originalWidth": original.width, "originalHeight": original.height,
                            "pixelInspected": False})
        path = output / f"{family}.png"
        sheet.save(path)
        manifest.append({"family": family, "sheet": str(path.resolve()),
                         "details": details, "pixelInspected": False})
    (output / "index.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"{sum(len(row['details']) for row in manifest)} originals; {len(manifest)} comparison sheets")


if __name__ == "__main__":
    main()
