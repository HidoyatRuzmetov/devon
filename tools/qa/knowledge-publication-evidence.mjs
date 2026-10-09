import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const browsers = ['chromium', 'firefox', 'webkit']
const report = 'artifacts/qa/2026-10/results/platform/knowledge-publications-valid/summary.json'
const run = JSON.parse(readFileSync(resolve(root, report), 'utf8'))
if (run.stats.expected !== 6 || run.stats.unexpected || run.stats.skipped || run.stats.flaky || run.errors.length)
  throw new Error('The named six-case publication report must actually pass without retries or skips')
const pixels = browsers.map(browser => `artifacts/qa/2026-10/results/platform/knowledge-publications-valid/platform-pages-live.qa--qa-96ef7-dit-restore-delete-and-undo-${browser}/live-page-restored.png`)
if (pixels.some(path => !existsSync(resolve(root, path)))) throw new Error('Reviewed publication pixels are missing')
const common = { test: 'apps/web/test/e2e/platform-pages-live.qa.spec.ts', roles: ['department head', 'ordinary member'], browsers, locale: 'en', theme: 'light', viewport: { width: 1280, height: 720 }, report }
const evidence = {
  lifecycle: { ...common, scenario: 'Actual UI page creation, title edit, version restore, delete and Undo; independent reads and real broker receipts update another open member view.' },
  templatePeer: { ...common, roles: ['department head, two legitimate sessions'], scenario: 'Actual template creation, dirty-name peer conflict, explicit overwrite, enabled refresh and confirmed delete; independent reads and broker receipts.' },
  historyContrast: { test: 'apps/web/test/e2e/platform-pages-large-history.qa.spec.ts', scenario: 'Accepted 36KB/6000-word snapshot in both themes, native keyboard history selection, complete reconstruction and zero scoped axe violations.', roles: ['department head'], browsers, locale: 'en', themes: ['light', 'dark'], viewport: { width: 1440, height: 900 }, report: 'artifacts/qa/2026-10/results/platform/large-history-contrast-after/summary.json' },
}
const state = (evidenceId, reviewed = false) => ({ status: 'verified', evidenceId, pixelReviewed: reviewed, pixelReviewedArtifacts: reviewed ? pixels : [] })
const source = 'apps/web/src/features/pages/pages-screen.tsx'
const note = 'Only the named lifecycle/peer state in the explicit fixture; no blanket role, locale, mobile, control or state acceptance.'
const records = [
  { match: { source, component: 'PageList', kind: 'motion.button', childSummaryIncludes: 'FileText' }, expectedMatches: 1, scopeNote: note, states: { populated: state('lifecycle', true), success: state('lifecycle', true) } },
  { match: { source, component: 'PageDetail', kind: 'button', childSummaryIncludes: 'pages.backToList' }, expectedMatches: 1, scopeNote: note, states: { default: state('lifecycle'), success: state('lifecycle') } },
  { match: { source, component: 'PageDetail', kind: 'IconButton', labelIncludes: 'pages.moreActions' }, expectedMatches: 1, scopeNote: note, states: { default: state('lifecycle') } },
  { match: { source, component: 'PageDetail', kind: 'DropdownMenuItem', childSummaryIncludes: 'pages.delete' }, expectedMatches: 1, scopeNote: note, states: { default: state('lifecycle'), success: state('lifecycle') } },
  { match: { source, component: 'PageDetail', kind: 'PageEditor', labelIncludes: 'localTitle' }, expectedMatches: 1, scopeNote: 'Title-only autosave, peer update and restore in the named lifecycle; other rich-text commands have separate evidence.', states: { populated: state('lifecycle'), success: state('lifecycle') } },
  { match: { source: 'apps/web/src/features/pages/version-history.tsx', component: 'VersionHistory', kind: 'Button', childSummaryIncludes: 'pages.versions.restore' }, expectedMatches: 1, scopeNote: note, states: { default: state('lifecycle'), success: state('lifecycle') } },
  { match: { source: 'apps/web/src/features/pages/version-history.tsx', component: 'VersionHistory', kind: 'button', childSummaryIncludes: 'formatDate' }, expectedMatches: 1, scopeNote: '6000-word selected preview and native keyboard selection in the named large-history case; mobile/other locale boundaries remain pending.', states: { selected: state('historyContrast'), focus: state('historyContrast') } },
]
writeFileSync(resolve(root, 'docs/qa/2026-10/knowledge-publication-evidence.json'), JSON.stringify({
  schemaVersion: 1, owner: 'root-knowledge-publication',
  provenance: 'Actual named browser reports, independent persisted reads and inspected restored-page screenshots. The generator checks reports and paths, never establishes visual inspection itself.',
  policy: 'Only explicitly listed states and fixture scopes are bounded. Unlisted combinations remain pending.',
  boundaries: { db: 'devon_flow_e2e_root', apiPort: 48951, webPort: 48952, externalCalls: 'blocked', production: 'not exercised' },
  gates: { functional: { passed: 6, failed: 0, skipped: 0, retries: 0, browsers, distinctWorkflows: 2 }, integration: { tests: ['apps/api/test/integration/pages-publication.test.ts', 'apps/api/test/integration/pages-restore.test.ts'], passed: 15 } },
  evidence, records,
}, null, 2) + '\n')
console.log(JSON.stringify({ records: records.length, policy: 'bounded states only' }))
