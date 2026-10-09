"""Create complete original-pixel recurrence comparisons; never imply pixel review."""
import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    groups = defaultdict(list)
    for source in sorted(args.run.rglob("text-ranges.json")):
        engine = source.parent.name.rsplit("-", 1)[-1]
        if engine not in ["chromium", "firefox", "webkit"]:
            raise ValueError(f"Unknown engine: {source}")
        document = json.loads(source.read_text(encoding="utf-8"))
        for row in document["rows"]:
            groups[(engine, row["width"])].append({
                **row, "engine": engine, "locale": document["locale"], "theme": document["theme"],
            })
    if len(groups) != 6:
        raise ValueError(f"Expected six engine/width groups, found {len(groups)}")
    output = args.run / "pixel-sheets"
    output.mkdir(exist_ok=True)
    manifest = []
    for (engine, width), rows in sorted(groups.items()):
        if len(rows) != 8 or len({(row["locale"], row["theme"]) for row in rows}) != 8:
            raise ValueError(f"Incomplete {engine}/{width} locale/theme matrix")
        rows.sort(key=lambda row: (["en", "ru", "uz-Latn", "uz-Cyrl"].index(row["locale"]), row["theme"]))
        tile_height = 624
        sheet = Image.new("RGB", (width * 4, tile_height * 2), "#777777")
        draw = ImageDraw.Draw(sheet)
        for index, row in enumerate(rows):
            native = Image.open(row["screenshot"]).convert("RGB")
            if native.size != (width, 600):
                raise ValueError(f"Unexpected native dimensions {native.size}")
            left, top = (index % 4) * width, (index // 4) * tile_height
            draw.text((left + 4, top + 4), f"{engine} {row['locale']} {row['theme']} {width} text200", fill="white")
            sheet.paste(native, (left, top + 24))
        comparison = output / f"{engine}-recurrence-text-{width}.png"
        sheet.save(comparison)
        manifest.append({"comparison": str(comparison.resolve()), "records": rows, "pixelInspected": False})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sheets": len(manifest), "nativeCaptures": sum(len(item["records"]) for item in manifest)}))


if __name__ == "__main__":
    main()
