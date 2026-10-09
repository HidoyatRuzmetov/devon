import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const base = 'artifacts/qa/2026-10/results/platform/shared-recovery-all-themes'
const load = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const passed = (path, expected) => {
  const report = load(path)
  if (
    report.stats.expected !== expected ||
    ['unexpected', 'skipped', 'flaky'].some((key) => report.stats[key]) ||
    report.errors.length
  )
    throw new Error(`The exact named report must pass without skipped or retried cases: ${path}`)
}
passed(`${base}/summary.json`, 24)
passed('artifacts/qa/2026-10/results/platform/scope-recovery-after/summary.json', 18)
const manifest = load(`${base}/pixel-review/manifest.json`)
if (manifest.length !== 54 || manifest.flatMap((entry) => entry.sources).length !== 288)
  throw new Error('The named complete shared-recovery comparison matrix is missing')
const hash = (path) => {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing named artifact: ${path}`)
  return createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex')
}
// The named sheets were actually opened by the reviewers below. This validator cannot look at
// pixels and cannot establish review of any regenerated or later capture.
const sheets = manifest.map(({ sheet, sources, scale }) => ({
  sheet,
  sha256: hash(sheet),
  sources: sources.map((path) => ({ path, sha256: hash(path) })),
  scale,
  reviewer: sheet.includes('/onboarding-') ? 'local_services' : 'root',
}))
writeFileSync(
  resolve(root, 'docs/qa/2026-10/shared-recovery-pixels.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      date: '2026-10-09',
      provenance:
        'Root actually opened all24 state sheets and all6 demo sheets (192 captures); local_services actually opened all24 onboarding sheets (96 captures). See onboarding-pixel-review.md. Generation and hashing are not inspection.',
      boundary:
        'Chromium/Firefox/WebKit; light/dark; en/ru/uz-Latn/uz-Cyrl. Organic no-membership member/admin at1440x900 normal and320x480 doubled text; forced error/forbidden/offline cards and mobile demo at320x480 doubled text. Desktop onboarding crops exclude the sidebar. Forced states establish designed geometry, not actual API fault or authorization behavior. Full-page fixed-nav stamps alone do not establish persistent occlusion.',
      report: `${base}/summary.json`,
      passed: 24,
      failed: 0,
      skipped: 0,
      retries: 0,
      sheets,
      pending: [
        'Physical device and physical OS magnification',
        'Uncaptured widths/data/consumer routes',
        'Full clean and populated inventory sweep',
      ],
    },
    null,
    2,
  ) + '\n',
)
const artifacts = (prefix) =>
  sheets
    .filter((entry) => entry.sheet.split('/').at(-1).startsWith(prefix))
    .map((entry) => entry.sheet)
const scope = 'artifacts/qa/2026-10/results/platform/scope-recovery-after'
const pagePixels = readdirSync(resolve(root, scope), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `${scope}/${entry.name}/replacement-denied-old-page.png`)
  .filter((path) => existsSync(resolve(root, path)))
if (pagePixels.length !== 3)
  throw new Error('The three actually inspected replacement-account page captures must exist')
const state = (evidenceId, paths = []) => ({
  status: 'verified',
  evidenceId,
  pixelReviewed: paths.length > 0,
  pixelReviewedArtifacts: paths,
})
const record = (source, component, kind, labelIncludes, states, scopeNote) => ({
  match: { source, component, kind, ...(labelIncludes ? { labelIncludes } : {}) },
  expectedMatches: 1,
  states,
  scopeNote,
})
const note =
  'Only the named states and environments are bounded; other controls, roles and combinations remain pending.'
const records = [
  record(
    'apps/web/src/features/home/home-screen.tsx',
    'HomeScreen',
    'StateView',
    'titleKey={empty.titleKey}',
    { empty: state('onboarding', artifacts('onboarding-')) },
    note,
  ),
  record(
    'apps/web/src/features/pages/pages-screen.tsx',
    'PagesScreen',
    'StateView',
    'departments.detail.noDepartment.title',
    { empty: state('pagesNoMembership', pagePixels) },
    note,
  ),
  record(
    'apps/web/src/shell/app-shell.tsx',
    'AppShell',
    'DemoChip',
    "label={t('shell.demo.chip.label')}",
    { default: state('demo', artifacts('demo-')), focus: state('demo', artifacts('demo-')) },
    note,
  ),
  record(
    'apps/web/src/shell/app-shell.tsx',
    'AppShell',
    'ThemeToggle',
    null,
    {
      default: state('systemTheme'),
      focus: state('systemTheme'),
      selected: state('systemTheme'),
      success: state('systemTheme'),
    },
    note,
  ),
  ...['error', 'forbidden', 'offline'].map((kind) =>
    record(
      'apps/web/src/shell/forced-state-block.tsx',
      'ForcedStateBlock',
      'StateView',
      `kind="${kind}"`,
      {
        [kind === 'error' ? 'error' : 'default']: state('designedRecovery', artifacts('states-')),
        focus: state('designedRecovery', artifacts('states-')),
      },
      `${note} Designed forced-state geometry and native unobscured focus only; no real failure/retry or permission acceptance is inferred.`,
    ),
  ),
]
writeFileSync(
  resolve(root, 'docs/qa/2026-10/shell-recovery-evidence.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      owner: 'root-shared-recovery',
      provenance:
        'Actual named browser reports, persisted membership/theme reads, box/glyph checks and actual opened rendered pixels. This generator validates existing artifacts, never visually inspects them.',
      policy: note,
      boundaries: {
        db: 'devon_flow_e2e_root',
        apiPort: 48951,
        webPort: 48952,
        externalCalls: 'blocked',
        production: 'not exercised',
      },
      evidence: {
        onboarding: {
          test: 'apps/web/test/e2e/platform-no-department.qa.spec.ts',
          report: `${base}/summary.json`,
          scenario:
            '12 executions: organic no-membership member/admin, four locales/two themes, actual next-step CTA, loaded destination, independent membership/admin reads, box/glyph containment and minimum24px target.',
        },
        pagesNoMembership: {
          test: 'apps/web/test/e2e/platform-realtime-scope.qa.spec.ts',
          report: `${scope}/summary.json`,
          scenario:
            'Three account-replacement journeys: the old private-page read is403, no old title/editor remains, explicit Departments guide and actual navigation. English/light/1280x720 only.',
        },
        demo: {
          test: 'apps/web/test/e2e/platform-demo-chip.qa.spec.ts',
          report: `${base}/summary.json`,
          scenario:
            'Six executions: mobile full label inside row padding,24px target, actual explanation opens within320px, Escape restores focus, four locales/two themes/all3engines.',
        },
        systemTheme: {
          test: 'apps/web/test/e2e/platform-theme-system.qa.spec.ts',
          report: `${scope}/summary.json`,
          scenario:
            'Three executions: native Enter/Space cycle, actual browser-media changes, persisted System follows them, explicit light survives changed media and reload. English/light/dark resolved state. Browser media emulation, not physical OS changes.',
        },
        designedRecovery: {
          test: 'apps/web/test/e2e/platform-state-card.qa.spec.ts',
          report: `${base}/summary.json`,
          scenario:
            'Six executions: forced error/forbidden/offline at320x480/text200 in four locales/two themes, box/glyph containment and native Tab focus with center+edge hit tests after natural settle, zero72 scoped axe violations. Primary actions are focused, not executed; these are not actual API faults.',
        },
      },
      records,
    },
    null,
    2,
  ) + '\n',
)
console.log(
  JSON.stringify({
    sheets: sheets.length,
    sourceImages: sheets.flatMap((entry) => entry.sources).length,
    exactRecords: records.length,
    review: 'only previously opened named artifacts',
  }),
)
