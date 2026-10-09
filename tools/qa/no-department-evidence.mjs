import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const runs = ['no-department-locale-reflow', 'no-department-containment-after']
const review = runs.map((run) => {
  const base = `artifacts/qa/2026-10/results/platform/${run}`
  const report = JSON.parse(readFileSync(resolve(root, base, 'summary.json'), 'utf8'))
  if (report.stats.expected !== 6 || report.stats.unexpected || report.stats.skipped || report.stats.flaky || report.errors.length)
    throw new Error(`The named six-case run must pass: ${run}`)
  const manifest = JSON.parse(readFileSync(resolve(root, base, 'pixel-review/manifest.json'), 'utf8'))
  if (manifest.length !== 12 || manifest.flatMap((entry) => entry.sources).length !== 48)
    throw new Error(`Incomplete comparison matrix: ${run}`)
  const hash = (path) => {
    if (!existsSync(resolve(root, path))) throw new Error(`Missing actual capture: ${path}`)
    return createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
  }
  return {
    run, report: `${base}/summary.json`, passed: 6, failed: 0, skipped: 0, retries: 0,
    inspectedSheets: manifest.map(({ sheet, sources, method }) => ({
      sheet, sha256: hash(sheet), sources: sources.map((path) => ({ path, sha256: hash(path) })), method,
    })),
  }
})
// Opening these exact24 sheets was performed by root. This script verifies the named artifacts;
// it cannot visually inspect them and must not be used to establish review of a later run.
writeFileSync(resolve(root, 'docs/qa/2026-10/no-department-pixels.json'), JSON.stringify({
  schemaVersion: 1, owner: 'root', date: '2026-10-09',
  provenance: 'Root actually opened all24 original-size comparison sheets: twelve before and twelve after,96 underlying captures. Artifact generation or this validator alone is not pixel review.',
  boundary: 'Desktop main/header original pixels excluding the separately tested sidebar; complete mobile full-page original. Light theme, four locales, member/super-admin without membership, Chromium/Firefox/WebKit;1440x900 normal and320x480 doubled text. Fixed bottom navigation appears at the initial viewport position in full-page captures; that alone is not evidence of persistent occlusion.',
  review,
  findings: [
    { status: 'fixed-and-retested', severity: 'medium', source: 'packages/ui/src/states/empty-state.tsx',
      before: 'Russian enlarged super-admin body and recovery button visibly spilled outside card padding. Page-wide overflow assertion alone had passed. The tightened Chromium regression failed with38.03125px of title-box encroachment; no tolerance was widened.',
      beforeReport: 'artifacts/qa/2026-10/results/platform/no-department-containment-before/summary.json',
      cause: 'The centered flex content column retained intrinsic minimum width; its long words/action could exceed the available card content width.',
      change: 'Constrain the content column to the available width and allow emergency word wrapping; constrain the primary action while retaining text size and card padding.',
      after: 'All6 actual role/locale/browser journeys passed. Every heading/body/action box and glyph fits card padding; targets are at least24px and the real next-step action opens its loaded destination. All48 after captures were represented in the twelve inspected original-size sheets.',
    },
    { status: 'pending-reproduction', source: 'packages/ui/src/shell/demo-chip.tsx',
      observation: 'At320px with doubled text, the Cyrillic demo label reaches the left edge of its secondary row. A dedicated actual box/glyph and popover journey is prepared; no product diagnosis or successful repair is claimed yet.',
    },
  ],
  pending: ['Dark no-membership organic-state pixels beyond other scoped consumer checks', 'Physical device and OS zoom', 'Full clean/populated inventory sweep'],
}, null, 2) + '\n')
console.log(JSON.stringify({ reviewedSheets: 24, sourceImages: 96, scope: 'only named original artifacts' }))
