import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// This records already opened images and the reviewer observations. It does not infer review
// from image generation or a passing geometry assertion.
const root = resolve(import.meta.dirname, '../..')
const sheets = JSON.parse(
  readFileSync(
    resolve(root, 'artifacts/qa/2026-10/head-scope/native-sheets/manifest.json'),
    'utf8',
  ).replace(/^\uFEFF/, ''),
)
const scopeFolders = {
  'en-light': '4debc',
  'en-dark': '95165',
  'ru-light': '2b1cc',
  'ru-dark': '01236',
  'uz-Latn-light': '73674',
  'uz-Latn-dark': '9ad1f',
  'uz-Cyrl-light': '165cb',
  'uz-Cyrl-dark': '3da48',
}
const reviewed = sheets.map((sheet) => ({
  artifact: sheet.sheet,
  scope: sheet.scope,
  kind: 'unscaled native sheet',
  opened: true,
  sourceCrops: sheet.sources,
  observation:
    'Main directory leadership grouping, own board card, indicator wrapping, Department-wide metadata/workload and visible scoped analytics rows inspected.',
  limitation:
    'Six 320px native-width crops, not whole-page review. Fixed mobile navigation may overlay lower head badge pixels; Russian analytics crop excludes the third unit row. No focus/contrast pass inferred.',
}))
for (const [scope, id] of Object.entries(scopeFolders))
  reviewed.push({
    artifact: `artifacts/qa/2026-10/head-scope/final-visual/results/head-scope.qa--head-visual-${id}-ow-tablet-and-enlarged-text-chromium/0-1280-2.png`,
    scope,
    kind: 'full original',
    opened: true,
    observation:
      'At 200% text, all three main directory names wrap completely and role badges have a separate row.',
    limitation: 'Directory content only; this is not a new shared-shell acceptance gate.',
  })
for (const browser of ['chromium', 'firefox', 'webkit']) {
  reviewed.push({
    artifact: `artifacts/qa/2026-10/head-scope/final-twenty-four/results/head-scope.qa-directory-na-e6787-le-at-200-percent-text-size-${browser}/directory-enlarged.png`,
    scope: `${browser}/en/200%`,
    kind: 'full original',
    opened: true,
    observation: 'Main directory names and badge wrapping inspected in all three engines.',
    limitation:
      'The other functional screenshot originals are not claimed reviewed by this record.',
  })
  reviewed.push({
    artifact: `artifacts/qa/2026-10/head-scope/indicator-after/results/head-scope.qa-narrow-Russi-f0eb8-dable-beside-the-head-badge-${browser}/indicator-narrow-ru.png`,
    scope: `${browser}/ru/320`,
    kind: 'full original',
    opened: true,
    observation:
      'Full main person name and task title fit/wrap; ordinary unassigned and actual unit groups remain distinct.',
    limitation:
      'Fixed bottom navigation overlays the head badge area at original viewport y580. No unobscured focus or badge pixel claim from this capture.',
  })
}
reviewed.push({
  artifact:
    'artifacts/qa/2026-10/head-scope/final-visual/results/head-scope.qa--head-visual-73674-ow-tablet-and-enlarged-text-chromium/2-768-1.png',
  scope: 'chromium/uz-Latn/light/768',
  kind: 'full original',
  opened: true,
  observation:
    'Name column now has readable width instead of one-character wrapping; head name/badge and task titles inspected.',
  limitation:
    'Existing horizontal table scroll contains later columns outside this original visible region.',
})
for (const image of reviewed)
  if (!existsSync(resolve(root, image.artifact)))
    throw new Error(`Missing actually reviewed artifact: ${image.artifact}`)
writeFileSync(
  resolve(root, 'docs/qa/2026-10/head-scope-pixel-review.json'),
  JSON.stringify(
    {
      owner: 'event_regressions-head-scope',
      reviewBasis: 'Actual view_image pixel inspection',
      reviewedImages: reviewed.length,
      capturedMatrixImages: 144,
      noBlanketPixelPass: true,
      reviewed,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  `Recorded ${reviewed.length} actually opened head-scope images; no unviewed capture inferred.`,
)
