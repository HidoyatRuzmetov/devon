"""Build unscaled comparisons from actual work-control capture records.

This does not mark pixel review. Use --partial only while a named run is still in progress:
missing locale/theme groups are reported and never emitted as a complete sheet.
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--partial", action="store_true")
    args = parser.parse_args()
    groups = defaultdict(list)
    for source in sorted(args.run.rglob("captures.jsonl")):
        if "platform-work-controls-vis-" not in source.parent.name:
            continue
        engine = source.parent.name.rsplit("-", 1)[-1]
        if engine not in ["chromium", "firefox", "webkit"]:
            raise ValueError(f"Unknown engine: {source}")
        for line in source.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            record["engine"] = engine
            groups[(engine, record["state"])].append(record)
    output = args.run / "pixel-sheets"
    output.mkdir(exist_ok=True)
    manifest, pending = [], []
    for (engine, state), rows in sorted(groups.items()):
        combinations = {(row["locale"], row["theme"]) for row in rows}
        if len(rows) != 8 or len(combinations) != 8:
            pending.append({"engine": engine, "state": state, "records": len(rows)})
            if args.partial:
                continue
            raise ValueError(f"Incomplete matrix group: {engine}, {state}, {len(rows)}")
        rows.sort(key=lambda row: (["en", "ru", "uz-Latn", "uz-Cyrl"].index(row["locale"]), row["theme"]))
        tiles = []
        for row in rows:
            pixels = Image.open(row["screenshot"]).convert("RGB")
            crop = [0, 0, pixels.width, pixels.height]
            # CardPeekDialog docks to the right with the actual --width-detail-panel:580px.
            # Keep the complete visible card column, rather than an unrelated blurred board.
            if not state.startswith("bulk-") and pixels.width > 580:
                crop = [pixels.width - 580, 0, pixels.width, pixels.height]
                pixels = pixels.crop(crop)
            row["comparisonCrop"] = crop
            tiles.append(pixels)
        width, height = tiles[0].size
        sheet = Image.new("RGB", (width * 4, (height + 24) * 2), "#777777")
        draw = ImageDraw.Draw(sheet)
        for number, (row, pixels) in enumerate(zip(rows, tiles)):
            x, y = number % 4 * width, number // 4 * (height + 24)
            draw.text((x + 4, y + 4), f"{engine} {row['locale']} {row['theme']} {state}", fill="#ffffff")
            sheet.paste(pixels, (x, y + 24))
        path = output / f"{engine}-{state}.png"
        sheet.save(path)
        manifest.append({"comparison": str(path.resolve()), "records": rows, "pixelInspected": False})
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output / "pending-groups.json").write_text(json.dumps(pending, indent=2), encoding="utf-8")
    print(json.dumps({"sheets": len(manifest), "representedNativeCaptures": len(manifest) * 8, "incompleteGroups": len(pending), "pixelInspected": False}))


if __name__ == "__main__":
    main()
