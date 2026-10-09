import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const functionalReport = 'artifacts/qa/2026-10/goals/final-thirty-six/results.json'
const matrixReport = 'artifacts/qa/2026-10/goals/final-fifty-one/results.json'
for (const [path, expected] of [
  [functionalReport, 36],
  [matrixReport, 51],
]) {
  const report = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  if (
    report.stats.expected !== expected ||
    report.stats.unexpected !== 0 ||
    report.stats.flaky !== 0 ||
    report.stats.skipped !== 0
  )
    throw new Error(`Gate is not the expected unretried pass: ${path}`)
}
const evidence = {
  functional: {
    test: 'apps/web/test/e2e/goals.qa.spec.ts',
    report: functionalReport,
    roles: ['department-head', 'ordinary-member refused'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locale: 'en',
    scenario:
      '12 distinct local UI/API journeys:4 computed metrics, filtered counted-card link, stale edit409/recovery, held actual201/new dialog, required/fractional/zero targets, member/disabled gates, stale scope Undo, refused Undo/retry, refused create/pointer retry, list503/Retry and reload503/draft/retry. Real independent reads establish only the documented writes.',
  },
  visual: {
    test: 'apps/web/test/e2e/goals-visual.qa.spec.ts',
    report: matrixReport,
    roles: ['department-head'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
    themes: ['light', 'dark'],
    scenario:
      'Populated percentage goal/create/conflict dialog at320×640,768×800 and1280×600/text200%, Escape restores exact Edit opener, focused saved-version action inside viewport, scoped serious/critical axe.216 captures/scans; no full216 pixel-review claim.',
  },
}
const source = 'apps/web/src/features/work/components/goals-screen.tsx'
function record(component, kind, selector, states, evidenceId, scopeNote, recordSource = source) {
  return {
    match: { source: recordSource, component, kind, ...selector },
    expectedMatches: 1,
    scopeNote,
    states: Object.fromEntries(
      states.map((state) => [
        state,
        { status: 'verified', evidenceId, pixelReviewed: false, pixelReviewedArtifacts: [] },
      ]),
    ),
  }
}
const records = [
  record(
    'GoalCard',
    'article',
    {},
    ['populated'],
    'functional',
    'Only the real4 metric fixtures and explicit current1/target0 cap cue; other metrics/time/filter boundaries remain pending.',
  ),
  record(
    'GoalCard',
    'Progress',
    { labelIncludes: 'work.goals.progressLabel' },
    ['populated'],
    'functional',
    'Zero-cap overflow indicator class is actually destructive; other metric values are independently computed. No all Progress variants/animations pass.',
  ),
  record(
    'GoalCard',
    'IconButton',
    { labelIncludes: 'work.goals.edit' },
    ['active', 'focus'],
    'visual',
    'Opens actual edit dialog and restores exact opener after Escape in the executed24 locale/theme/browser journeys.',
  ),
  record(
    'GoalCard',
    'IconButton',
    { labelIncludes: 'work.goals.delete' },
    ['active', 'success'],
    'functional',
    'Real delete, independent empty read, failed/recovered Undo recreation; no delete-refusal claim.',
  ),
  record(
    'GoalCard',
    'a',
    { childSummaryIncludes: 'work.goals.matchedCards' },
    ['active'],
    'functional',
    '3 counted cards link actually navigates to /work/table?q=label:goal-fixture and shows real matching card.',
  ),
  record(
    'GoalCard',
    'Chip',
    { childSummaryIncludes: '{goal.filter}' },
    ['default'],
    'visual',
    'Only actual priority:high chip rendered in the percentage fixture; chip is immutable context, not a tested editing control.',
  ),
  record(
    'GoalCard',
    'Chip',
    { childSummaryIncludes: 'work.goals.noMatchingWork' },
    ['default'],
    'visual',
    'Only actual no-matching-work percentage fixture; no empty-all-goals inference.',
  ),
  record(
    'GoalDialog',
    'Dialog',
    {},
    ['default', 'populated', 'error'],
    'functional',
    'Actual create/edit, Cancel/reopen with held receipt, stale409 and reload503 retained draft; no other form refusal combinatorics.',
  ),
  record(
    'GoalDialog',
    'DialogContent',
    {},
    ['default', 'focus', 'error'],
    'visual',
    'Explicit create/conflict viewport reflow, axe and Escape focus return; visible image crops have footer/title limitations recorded separately.',
  ),
  record(
    'GoalDialog',
    'form',
    {},
    ['success', 'error', 'validation'],
    'functional',
    'Actual201/204,409/503 with retained draft, empty required target disabled and valid fractional/zero values.',
  ),
  record(
    'GoalDialog',
    'Input',
    { childSummaryIncludes: 'id="goal-title"' },
    ['populated', 'focus'],
    'functional',
    'Name filled/read retained or authoritative reloaded; no maximum-length server-refusal claim.',
  ),
  record(
    'GoalDialog',
    'Textarea',
    { childSummaryIncludes: 'id="goal-description"' },
    ['populated'],
    'functional',
    'Create503 retains typed description; actual Undo recreates the held description.',
  ),
  record(
    'GoalDialog',
    'Select',
    { childSummaryIncludes: 'id="goal-metric"' },
    ['selected'],
    'functional',
    'All4 documented metrics actually selected/created; no key-by-key native select navigation claim.',
  ),
  record(
    'GoalDialog',
    'Input',
    { childSummaryIncludes: 'id="goal-target"' },
    ['populated', 'validation'],
    'functional',
    'Blank disables submit;1.5 native step valid and API persisted;0 cap actual overflow cue checked.',
  ),
  record(
    'GoalDialog',
    'p',
    { childSummaryIncludes: 'goalsControls.conflict' },
    ['error'],
    'functional',
    'Actual409 keeps local draft, names explicit recovery and avoids overwriting newer server version.',
  ),
  record(
    'GoalDialog',
    'Button',
    { childSummaryIncludes: 'goalsControls.reload' },
    ['active', 'focus', 'error', 'success'],
    'functional',
    'Actual503 reload retains draft/conflict/disabled Save, explicit retry loads latest authoritative row; focus visibility independently covered in visual report.',
  ),
  record(
    'GoalDialog',
    'Input',
    { childSummaryIncludes: 'id="goal-filter"' },
    ['populated'],
    'functional',
    'Filled label filter narrows real counted cards; failed create/Undo retain exact filter; other grammar boundaries pending.',
  ),
  record(
    'GoalDialog',
    'Input',
    { childSummaryIncludes: 'id="goal-due"' },
    ['populated'],
    'functional',
    'Actual typed due value survives failed create and Undo recreation; no startsOn editor or invalid date-boundary claim.',
  ),
  record(
    'GoalDialog',
    'Button',
    { childSummaryIncludes: 'common.cancel' },
    ['active'],
    'functional',
    'Cancel held actual201 and reopen preserves the later draft; shared Dialog close animation permutations pending.',
  ),
  record(
    'GoalDialog',
    'Button',
    { labelIncludes: 'type="submit"' },
    ['active', 'disabled', 'error', 'success'],
    'functional',
    'Actual201/204 writes,409/503 refusals, required-target/conflict disable, native fast pointer retry dispatches second POST in all3.',
  ),
  record(
    'GoalsScreen',
    'Button',
    { childSummaryIncludes: 'work.goals.create' },
    ['active'],
    'functional',
    'Header Add opens real create dialog; this does not bind separate StateView Add action.',
  ),
  record(
    'GoalsScreen',
    'StateView',
    { labelIncludes: 'kind="error"' },
    ['error', 'active'],
    'functional',
    'Actual GET503 renders Retry and real subsequent200 restores saved goal.',
  ),
  record(
    'GoalsScreen',
    'StateView',
    { labelIncludes: 'kind="empty"' },
    ['empty'],
    'functional',
    'Fresh owned department has no goals; header Add used. Separate empty-action keyboard path remains pending.',
  ),
  record(
    'DepartmentFeatureScreen',
    'StateView',
    { labelIncludes: 'kind="forbidden"' },
    ['default'],
    'functional',
    'Only member Goals/Workload guards: correct department-head explanation and Cards recovery, actual403. Other shared wrapper callers pending.',
    'apps/web/src/lib/department-feature-screen.tsx',
  ),
]
const overlay = {
  schemaVersion: 1,
  owner: 'event_regressions-goals',
  provenance:
    'Actual local synthetic UI/API persistence and bounded visual matrix; no external integration or production calls.',
  policy:
    'Only exact selectors and named fixture states bound; newly discovered article/progress surfaces remain pending outside these records.',
  boundaries: {
    db: 'devon_flow_e2e_goals',
    apiPort: 48961,
    webPort: 48962,
    seedDemo: false,
    externalCalls: 'blocked',
    production: 'not exercised',
  },
  gates: {
    functional: '36/36 all3;12 distinct journeys',
    visual:
      '51/51 earlier integrated report includes24 visual journeys and27 original functional executions;216 captured/scanned states',
  },
  evidence,
  records,
  pixelLedger: 'docs/qa/2026-10/goals-pixel-review.json',
  workflows: [
    {
      route: '/goals',
      scope:
        'Only above12 actual journeys; Undo restores values under new ID, not identity-preserving restore. No all role×locale permutations.',
      evidenceId: 'functional',
    },
    {
      routes: ['/goals', '/work/workload'],
      scope:
        'Actual ordinary-member guard copy/403 and Cards navigation; disabled Goal writes404 leave original row unchanged.',
      evidenceId: 'functional',
    },
  ],
}
for (const path of [overlay.pixelLedger])
  if (!existsSync(resolve(root, path))) throw new Error(`Missing evidence: ${path}`)
writeFileSync(
  resolve(root, 'docs/qa/2026-10/goals-evidence.json'),
  JSON.stringify(overlay, null, 2) + '\n',
)
console.log(
  JSON.stringify({ records: records.length, reportsVerified: 2, pixelReview: 'not inferred' }),
)
