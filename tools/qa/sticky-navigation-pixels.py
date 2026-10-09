"""Build unscaled comparison sheets; generation never establishes pixel review."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
base = root / 'artifacts/qa/2026-10/results/platform/sticky-navigation-current'
report = json.loads((base / 'summary.json').read_text(encoding='utf-8'))
assert report['stats']['expected'] == 6
assert not any(report['stats'][key] for key in ['unexpected', 'skipped', 'flaky'])
assert not report['errors']
output = base / 'pixel-review'
output.mkdir(exist_ok=True)
manifest = []
for browser in ['chromium', 'firefox', 'webkit']:
    for theme in ['light', 'dark']:
        folders = [p for p in base.iterdir() if p.is_dir() and p.name.endswith(f'{theme}-{browser}')]
        assert len(folders) == 1, (browser, theme, folders)
        sheet = Image.new('RGB', (1280, 636), '#f4f4f4')
        draw = ImageDraw.Draw(sheet)
        sources = []
        for column, locale in enumerate(['en', 'ru', 'uz-Latn', 'uz-Cyrl']):
            source = folders[0] / f'{locale}-scrolled-navigation.png'
            with Image.open(source) as image:
                assert image.size == (320, 600), (source, image.size)
                sheet.paste(image.convert('RGB'), (column * 320, 36))
            draw.text((column * 320 + 8, 10), f'{browser} / {theme} / {locale}', fill='#111111')
            sources.append(str(source.relative_to(root)).replace('\\', '/'))
        path = output / f'{browser}-{theme}.png'
        sheet.save(path)
        manifest.append({
            'sheet': str(path.relative_to(root)).replace('\\', '/'),
            'sources': sources,
            'scale': 1,
            'width': 1280,
            'height': 636,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        })
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Generated {len(manifest)} native comparison sheets; none marked reviewed.')
