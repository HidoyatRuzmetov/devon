import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const functionalReport = 'artifacts/qa/2026-10/head-scope/final-twenty-four/results.json'
const narrowReport = 'artifacts/qa/2026-10/head-scope/indicator-after/results.json'
const visualReport = 'artifacts/qa/2026-10/head-scope/final-visual/results.json'
for (const [path, count] of [
  [functionalReport, 24],
  [narrowReport, 3],
  [visualReport, 8],
]) {
  const report = JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  if (report.stats.expected !== count || report.stats.unexpected || report.stats.skipped)
    throw new Error(`Head scope report is not the exact completed gate: ${path}`)
}

const evidence = {
  directory: {
    test: 'apps/web/test/e2e/head-scope.qa.spec.ts',
    scenario:
      'Directory leadership separate from ordinary unassigned; Cards/Table switch and actual optional-unit filter; independent roster, unit-role and owned-card reads.',
    roles: ['department-head'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locale: 'en',
    report: functionalReport,
  },
  assignment: {
    test: 'apps/web/test/e2e/head-scope.qa.spec.ts',
    scenario:
      'Ordinary colleague selects active department head in native composer, creates a real card, then head Mine/reload retains both own cards.',
    roles: ['ordinary-member', 'department-head'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locale: 'en',
    report: functionalReport,
  },
  analytics: {
    test: 'apps/web/test/e2e/head-scope.qa.spec.ts',
    scenario:
      'Unit-load table/actual CSV preserve leadership, ordinary unassigned, real units and total3; duplicate real unit names retain independent IDs and chart categories.',
    roles: ['department-head'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locale: 'en',
    report: functionalReport,
  },
  indicator: {
    test: 'apps/web/test/e2e/head-scope.qa.spec.ts',
    scenario:
      'Indicator heading/display distinguish leadership; raw physical unit stays null, own open count stays1; narrow Russian name/task leaf widths checked after wrapping.',
    roles: ['department-head'],
    browsers: ['chromium', 'firefox', 'webkit'],
    locale: 'ru for narrow regression; en for persistence',
    report: narrowReport,
    additionalReport: functionalReport,
  },
  visual: {
    test: 'apps/web/test/e2e/head-scope.qa.spec.ts',
    scenario:
      'Six affected routes at320/768 and1280 with200% text, all4 locales×2 themes; leadership and visible person/task leaf text geometry plus page-width assertions. Capturing is not pixel review.',
    roles: ['department-head'],
    browsers: ['chromium'],
    locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
    themes: ['light', 'dark'],
    report: visualReport,
  },
}

function record(source, component, kind, selector, states, evidenceId, scopeNote) {
  return {
    match: { source, component, kind, ...selector },
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

const directory = 'apps/web/src/features/structure/people-screen.tsx'
const composer = 'apps/web/src/features/work/components/new-card-dialog.tsx'
const chart = 'apps/web/src/features/analytics/chart-card.tsx'
const records = [
  record(
    directory,
    'PeopleScreen',
    'SegmentedControl',
    { labelIncludes: 'structure.people.layout.label' },
    ['selected'],
    'directory',
    'Only actual Cards→Table switch in the head directory fixture; other options/states are pending.',
  ),
  record(
    directory,
    'PeopleScreen',
    'FilterChip',
    { childSummaryIncludes: '{u.name}' },
    ['selected'],
    'directory',
    'Only the actual physical unit filter with an optionally assigned head and ordinary assigned member; no synthetic unit created for classification.',
  ),
  record(
    composer,
    'NewCardDialog',
    'select',
    { labelIncludes: 'work.field.assignee' },
    ['selected', 'success'],
    'assignment',
    'Only choosing the active head as recipient and persisting that assignment from an ordinary member.',
  ),
  record(
    composer,
    'NewCardDialog',
    'Button',
    { childSummaryIncludes: 'work.actions.create' },
    ['success'],
    'assignment',
    'Only the nonempty title/head-assignee create path; due field and other errors are not covered by this slice.',
  ),
  record(
    'apps/web/src/features/work/components/board-screen.tsx',
    'BoardScreenInner',
    'SegmentedControl',
    { labelIncludes: 'work.board.scopeLabel' },
    ['selected'],
    'assignment',
    'Only head Mine scope/reload retaining both personal cards; other users and scope transitions remain pending.',
  ),
  record(
    'apps/web/src/features/people/people-table-screen.tsx',
    'PersonCell',
    'a',
    {},
    ['populated'],
    'indicator',
    'Only visible head/ordinary names in the narrow Russian fixture and the explicit expanded text geometry; no keyboard/link navigation pass inferred.',
  ),
  record(
    'apps/web/src/features/people/people-table-screen.tsx',
    'TaskChips',
    'a',
    { labelIncludes: 'title={card.title}' },
    ['populated'],
    'indicator',
    'Only the fully visible owned task title; no task-link navigation/hover pass inferred.',
  ),
  record(
    chart,
    'ChartCard',
    'IconButton',
    { labelIncludes: 'analytics.actions.viewAsTable' },
    ['active'],
    'analytics',
    'Only the unit-load instance, changing its chart into the real table; other ChartCard instances are not covered.',
  ),
  record(
    chart,
    'ChartCard',
    'IconButton',
    { labelIncludes: 'analytics.actions.export' },
    ['active'],
    'analytics',
    'Only opening the unit-load export menu; no PNG or other chart export pass inferred.',
  ),
  record(
    chart,
    'ChartCard',
    'DropdownMenuItem',
    { childSummaryIncludes: 'analytics.actions.exportCsv' },
    ['success'],
    'analytics',
    'Only actual unit-load CSV download and content assertion in this fixture; other metrics remain pending.',
  ),
]

const overlay = {
  schemaVersion: 1,
  owner: 'event_regressions-head-scope',
  provenance:
    'Actual isolated synthetic local UI/API persistence gates and bounded geometry. Pixel review is maintained separately; generator does not establish it.',
  policy:
    'Only named states and fixture scopes gain evidence. No whole-component, all-role, accessibility or external-integration pass is inferred.',
  boundaries: {
    db: 'devon_flow_e2e_head',
    apiPort: 48961,
    webPort: 48962,
    seedDemo: false,
    externalCalls: 'blocked',
    production: 'not exercised',
  },
  gates: {
    functional: '24/24 all3 engines (8 distinct journeys)',
    narrow: '3/3 all3 engines (1 distinct journey)',
    visual:
      '8/8 Chromium4locales×2themes×6routes×3environments =144 captures; geometry assertions, not full pixel/axe coverage',
  },
  evidence,
  records,
  entries: [
    {
      route: '/people',
      scope:
        'Department-role head leadership grouping; ordinary unassigned distinct; optional physical unit retained and filtered truthfully.',
      evidenceId: 'directory',
    },
    {
      route: '/work',
      scope:
        'Head owns and receives work normally, classified at department scope without invented unit IDs.',
      evidenceId: 'assignment',
    },
    {
      route: '/analytics',
      scope:
        'Head/group/unit stable scope IDs; counts preserved; same-named real units do not collide.',
      evidenceId: 'analytics',
    },
    {
      route: '/people/table',
      scope:
        'Presentation fallback is Department-wide, while raw indicator unit remains null; names and task titles wrap.',
      evidenceId: 'indicator',
    },
    {
      route: '/people?person=<head>',
      scope:
        'Null physical unit metadata says Department-wide; actual optional physical unit continues to show its name.',
      evidenceId: 'directory',
    },
    {
      route: '/work/workload',
      scope: 'Head retains actual own load/card capacity with Department-wide caption.',
      evidenceId: 'assignment',
    },
    {
      routes: [
        '/people',
        '/work',
        '/people/table',
        '/people?person=<head>',
        '/work/workload',
        '/analytics',
      ],
      scope:
        'Only affected head fixture geometry across the explicitly executed144 environment/route observations; unlisted interaction states are pending.',
      evidenceId: 'visual',
    },
  ],
}
writeFileSync(
  resolve(root, 'docs/qa/2026-10/head-scope-evidence.json'),
  `${JSON.stringify(overlay, null, 2)}\n`,
)
console.log(
  JSON.stringify({ records: records.length, reportsVerified: 3, pixelReview: 'not inferred' }),
)
