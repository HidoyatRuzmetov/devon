import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const sheets = JSON.parse(
  readFileSync(
    resolve(root, 'artifacts/qa/2026-10/goals/native-sheets/manifest.json'),
    'utf8',
  ).replace(/^\uFEFF/, ''),
)
// These images were actually opened. File existence only validates references; it never
// establishes review for a new capture or an unlisted state.
const images = sheets.map((sheet) => ({
  artifact: sheet.sheet,
  scope: sheet.scope,
  opened: true,
  kind: 'unscaled native sheet',
  sourceCrops: sheet.sources,
  observation:
    'Long title and unbroken description wrap; contextual edit/delete targets retain space; create fields and conflict recovery message/button are readable in the shown crops.',
  limitation:
    'Four320px crops: populated top/bottom and create/conflict viewport. Fixed navigation covers progress pixels in these full-page originals; due/footer and some dialog fields require scrolling and are not visually certified by this sheet. No whole-page or all-control pass.',
}))
for (const [scope, id, browser] of [
  ['en-light', '392b3', 'chromium'],
  ['ru-dark', 'c168f', 'firefox'],
  ['uz-Latn-light', 'b91fd', 'webkit'],
  ['uz-Cyrl-dark', '5efd2', 'webkit'],
]) {
  images.push({
    artifact: `artifacts/qa/2026-10/goals/final-fifty-one/results/goals-visual.qa-Goals-popu-${id}-eflow-and-keyboard-recovery-${browser}/conflict-1280-2.png`,
    scope: `${scope}/${browser}/200%`,
    opened: true,
    kind: 'full original',
    observation:
      'Enlarged target/help text and entire conflict explanation/reload control wrap visibly inside the dialog; all four locale scripts represented.',
    limitation:
      'Scrolled conflict viewport only: title and due/footer are outside the visible dialog. This is not every locale/theme/browser pixel combination.',
  })
}
images.push({
  artifact:
    'artifacts/qa/2026-10/goals/zero-cap-before/results/goals.qa-a-zero-card-cap-v-06df3-real-open-card-over-the-cap-chromium/zero-card-cap.png',
  scope: 'before/chromium/en/light',
  opened: true,
  kind: 'full original',
  observation:
    'Actual one-open-card/zero-cap renders amber100% of cap with no over-cap text; independent API values were1/0.',
  limitation: 'Before-fix failure evidence, not acceptance.',
})
for (const browser of ['chromium', 'firefox', 'webkit'])
  images.push({
    artifact: `artifacts/qa/2026-10/goals/final-thirty-six/results/goals.qa-a-zero-card-cap-v-06df3-real-open-card-over-the-cap-${browser}/zero-card-cap.png`,
    scope: `after/${browser}/en/light`,
    opened: true,
    kind: 'full original',
    observation:
      'Actual one-open-card/zero-cap visibly shows red bar and readable warning icon plus1 over the cap text; edit/delete and counted-card link retain space.',
    limitation:
      'Desktop English/light zero-cap acceptance only; other breakpoint/locale/color combinations are not established by these three images.',
  })
for (const item of images)
  if (!existsSync(resolve(root, item.artifact)))
    throw new Error(`Missing reviewed image: ${item.artifact}`)
writeFileSync(
  resolve(root, 'docs/qa/2026-10/goals-pixel-review.json'),
  JSON.stringify(
    {
      policy:
        'Only actual opened images recorded; capture/geometry/axe never implies pixel inspection.',
      reviewedImages: images.length,
      nativeSheetRegions: sheets.reduce((total, sheet) => total + sheet.sources.length, 0),
      images,
    },
    null,
    2,
  ) + '\n',
)
console.log(JSON.stringify({ reviewedImages: images.length, nativeSheetRegions: 32 }))
