import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const manifestPath = 'artifacts/qa/2026-10/events-nested/final-anchored-sheets/manifest.json'
const sheets = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8').replace(/^\uFEFF/, ''))
if (sheets.length !== 16)
  throw new Error('Expected the exact16 current native sheets that were opened.')
const sha256 = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex')

// These16 specific sheets, the four enlarged originals below and the actual caption original
// were opened with view_image(original) on2026-10-09. Hash checks validate those recorded images;
// they do not establish review for any new/replaced captures or other content below the viewport.
const images = sheets.map((sheet) => {
  if (sha256(sheet.sheet) !== sheet.sha256) throw new Error(`Sheet changed: ${sheet.sheet}`)
  for (const source of sheet.sources)
    if (sha256(source.source) !== source.sha256) throw new Error(`Source changed: ${source.source}`)
  return {
    artifact: sheet.sheet,
    sha256: sheet.sha256,
    scope: sheet.scope,
    opened: true,
    kind: 'unscaled native sheet',
    sourceCrops: sheet.sources,
    observation:
      'Seven selected-tab viewport regions across each locale/theme: visible RSVP controls/read list, discussion composer/text, full-width item field/text, intact driver word and wrapped seat badge, poll question, owned local photo and wrapped caption, feedback rating/comment. Localized labels wrap in their actual visible regions.',
    limitation:
      'Each original is320×640 and often includes a scrolled header. Several long rows, claim/vote footers, saved-feedback content and close control are outside these viewports. No whole-dialog, full-scroll focus, nested creation-form or all-browser pixel pass. Native keyboard evidence is separate.',
  }
})
for (const scope of ['en-light', 'ru-dark', 'uz-Latn-light', 'uz-Cyrl-dark']) {
  const carpool = sheets
    .find((sheet) => sheet.scope === scope)
    .sources.find((source) => source.tab === 'carpool')
  const artifact = `${dirname(carpool.source).replaceAll('\\', '/')}/carpool-1280-2.png`
  images.push({
    artifact,
    sha256: sha256(artifact),
    scope: `${scope}/chromium/text200%`,
    opened: true,
    kind: 'full original',
    observation:
      'Actual enlarged carpool driver word remains intact beside the seat badge; translated Add/Edit/Offer controls and selected carpool tab retain readable space.',
    limitation:
      'Scrolled header/upper offer viewport only; departure/note/claim footer and close control are outside these images. These four represent scripts, not every locale/theme/browser combination.',
  })
}
const caption = 'artifacts/qa/2026-10/events-nested/final-anchored-caption/chromium.png'
images.push({
  artifact: caption,
  sha256: sha256(caption),
  scope: 'en/light/chromium/320×640',
  opened: true,
  kind: 'full original',
  observation:
    'The entire actual saved160-character caption is visibly wrapped below the owned local PNG, without the previous ellipsis; all caption text fits inside the scrolled narrow gallery viewport.',
  limitation:
    'One concrete caption fixture and local linked image only. No arbitrary caption length, remote photo transport or image-upload pixel claim.',
})
const ledger = {
  policy:
    'Actual opened images only. Capture/geometry/axe/file existence never implies pixel review.',
  reviewedOn: '2026-10-09',
  manifest: manifestPath,
  reviewedImages: images.length,
  nativeSheetRegions: sheets.reduce((total, sheet) => total + sheet.sources.length, 0),
  separateGeometryStates: '168 current Chromium states; these do not imply168 opened images.',
  images,
}
writeFileSync(
  resolve(root, 'docs/qa/2026-10/events-nested-pixel-review.json'),
  JSON.stringify(ledger, null, 2) + '\n',
)
console.log(
  JSON.stringify({ reviewedImages: images.length, nativeSheetRegions: ledger.nativeSheetRegions }),
)
