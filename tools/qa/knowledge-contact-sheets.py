"""Build labelled comparison sheets from exact Playwright capture manifests.

This never marks images reviewed: pixel review is a separate, recorded action.
The full images remain available beside these reduced comparison sheets.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    records = [json.loads(line) for source in args.run.rglob("captures.jsonl")
               for line in source.read_text(encoding="utf-8").splitlines() if line]
    output = args.run / "pixel-sheets"
    output.mkdir(exist_ok=True)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 18)
    groups = {}
    for row in records:
        key = (row["surface"], row["width"], row["height"], row["scale"])
        groups.setdefault(key, []).append(row)
    index = []
    for key, rows in sorted(groups.items()):
        surface, width, height, scale = key
        rows.sort(key=lambda row: (row["locale"], row["theme"]))
        cell_width = 600
        cell_height = 1100 if surface == "template-card" else 900
        sheet = Image.new("RGB", (cell_width * 4, cell_height * 2), "#d9dce0")
        draw = ImageDraw.Draw(sheet)
        for number, row in enumerate(rows):
            source = Image.open(row["screenshot"]).convert("RGB")
            source.thumbnail((cell_width - 16, cell_height - 64), Image.Resampling.LANCZOS)
            x, y = number % 4 * cell_width, number // 4 * cell_height
            draw.text((x + 8, y + 6), f'{row["locale"]} / {row["theme"]} — {surface}', font=font, fill="black")
            draw.text((x + 8, y + 28), f'{width}×{height} text {int(scale * 100)}%', font=font, fill="black")
            sheet.paste(source, (x + 8, y + 56))
        path = output / f"{surface}-{width}-{height}-text{int(scale * 100)}.png"
        sheet.save(path)
        index.append({"sheet": str(path.resolve()), "surface": surface,
                      "width": width, "height": height, "textScale": scale,
                      "sources": [row["screenshot"] for row in rows],
                      "pixelInspected": False})
    (output / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"{len(records)} capture records; {len(index)} comparison sheets")


if __name__ == "__main__":
    main()
