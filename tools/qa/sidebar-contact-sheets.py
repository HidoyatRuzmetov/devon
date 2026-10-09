"""Build unscaled sidebar and account-menu comparison sheets from exact capture manifests.

No review flags are changed. Sidebar images are complete original-size captures. Account-menu
images keep the original pixels in the left 264px region containing this bounded menu and sidebar.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("runs", type=Path, nargs="+")
    args = parser.parse_args()
    captures = [json.loads(line) for run in args.runs for source in run.rglob("captures.jsonl")
                for line in source.read_text(encoding="utf-8").splitlines() if line]
    latest = {}
    for row in captures:
        browser = Path(row["screenshot"]).parent.name.rsplit("-", 1)[-1]
        key = (browser, row["locale"], row["theme"], row.get("surface", "sidebar"),
               row["width"], row["height"], row["scale"])
        latest[key] = row
    records = list(latest.values())
    output = args.runs[-1] / "pixel-sheets"
    output.mkdir(exist_ok=True)
    font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 16)
    groups = {}
    for row in records:
        browser = Path(row["screenshot"]).parent.name.rsplit("-", 1)[-1]
        key = (browser, row.get("surface", "sidebar"), row["width"], row["height"], row["scale"])
        groups.setdefault(key, []).append(row)
    index = []
    for key, rows in sorted(groups.items()):
        browser, surface, width, height, scale = key
        rows.sort(key=lambda row: (row["theme"], row["locale"]))
        if len(rows) != 8:
            raise ValueError(f"Incomplete locale/theme group: {key}, {len(rows)} captures")
        cell_width, cell_height = 280, height + 48
        sheet = Image.new("RGB", (cell_width * 4, cell_height * 2), "#d9dce0")
        draw = ImageDraw.Draw(sheet)
        for number, row in enumerate(rows):
            source = Image.open(row["screenshot"]).convert("RGB")
            region = source.crop((0, 0, min(264, source.width), source.height))
            x, y = number % 4 * cell_width, number // 4 * cell_height
            draw.text((x + 8, y + 4), f'{row["locale"]} / {row["theme"]}', font=font, fill="black")
            draw.text((x + 8, y + 23), f'{browser} {width}x{height} {int(scale * 100)}%', font=font, fill="black")
            sheet.paste(region, (x + 8, y + 48))
        path = output / f"{browser}-{surface}-{width}-{height}-text{int(scale * 100)}.png"
        sheet.save(path)
        index.append({"sheet": str(path.resolve()), "browser": browser, "surface": surface,
                      "width": width, "height": height, "textScale": scale,
                      "sources": [row["screenshot"] for row in rows],
                      "method": "unscaled paste; full sidebar or left264px native account-menu region",
                      "pixelInspected": False})
    (output / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print(f"{len(records)} capture records; {len(index)} unscaled comparison sheets")


if __name__ == "__main__":
    main()
