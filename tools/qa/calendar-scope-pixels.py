"""Generate native comparison sheets from an exact passing run, never inspection claims."""
import json
import hashlib
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
run = sys.argv[1] if len(sys.argv) > 1 else 'calendar-scope-normal-release'
if not run or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in run):
    raise ValueError('A local QA run ID is required, never a path')
base = root / 'artifacts/qa/2026-10/results/platform' / run
report = json.loads((base / 'summary.json').read_text(encoding='utf-8'))

def collect(suite):
    tests = [t for s in suite.get('specs', [])
             if s['file'] == 'platform-calendar-scope.qa.spec.ts'
             and 'subscription event scope' in s['title']
             for t in s['tests']]
    return tests + [t for s in suite.get('suites', []) for t in collect(s)]

tests = [t for s in report['suites'] for t in collect(s)]
assert len(tests) == 6 and not report['errors']
assert all(t['status'] == 'expected' and t['expectedStatus'] == 'passed'
           and len(t['results']) == 1 and t['results'][0]['status'] == 'passed'
           and t['results'][0]['retry'] == 0 for t in tests)
output = base / 'pixel-review'
output.mkdir(exist_ok=True)
manifest = []
locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl']
for browser in ['chromium', 'firefox', 'webkit']:
    for theme in ['light', 'dark']:
        folders = [p for p in base.iterdir() if p.is_dir()
                   and p.name.startswith('platform-calendar-scope')
                   and p.name.endswith(f'{theme}-{browser}')]
        assert len(folders) == 1, (browser, theme, folders)
        for width, height, text in [(1280, 720, 100), (768, 720, 100),
                                    (390, 600, 100)]:
            # Wide viewports stay native in two-locale sheets; narrow ones in four-locale sheets.
            per_sheet = 2 if width >= 768 else 4
            for offset in range(0, 4, per_sheet):
                subset = locales[offset:offset + per_sheet]
                sheet = Image.new('RGB', (width * len(subset), height + 36), '#f4f4f4')
                draw = ImageDraw.Draw(sheet)
                sources = []
                for column, locale in enumerate(subset):
                    source = folders[0] / f'{locale}-{width}-{height}-text{text}.png'
                    with Image.open(source) as image:
                        assert image.size == (width, height), (source, image.size)
                        sheet.paste(image.convert('RGB'), (column * width, 36))
                    draw.text((column * width + 8, 10),
                              f'{browser}/{theme}/{locale} {width}x{height} text{text}',
                              fill='#111111')
                    sources.append(str(source.relative_to(root)).replace('\\', '/'))
                path = output / f'{browser}-{theme}-{width}-{height}-text{text}-{offset}.png'
                sheet.save(path)
                manifest.append({
                    'sheet': str(path.relative_to(root)).replace('\\', '/'),
                    'sources': sources,
                    'scale': 1,
                    'width': sheet.width,
                    'height': sheet.height,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                })
assert len(manifest) == 30 and sum(len(s['sources']) for s in manifest) == 72
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Generated {len(manifest)} native sheets for72 viewports. No review is inferred.')
