import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'docs/qa/2026-10')
const pixelsFile = 'docs/qa/2026-10/work-controls-pixels.json'
const evidence = {
  'functional-mixed-before': {
    run: 'work-controls-functional-complete',
    status: '50 passed / 4 failed',
    scope:
      'Three Cyrillic/Latin search fixture mismatches are excluded from product defect counts. One actual WebKit checkbox pointer retargeting failure was subsequently isolated as sticky-header/PressScale stacking. This historical mixed run is not a fully passing gate.',
  },
  'dependency-warm-before': {
    run: 'work-reopen-before',
    status:
      'one expected failing-before Chromium assertion; corrected pagination journey passed separately',
    scope:
      'A real separate reverse-edge API write while the picker was closed did not trigger a graph read on reopen within staleTime30s. The cycle candidate remained enabled; independent persisted edge read and native pixels inspected.',
  },
  'dependency-race-before': {
    run: 'work-dependency-race-before',
    status: 'one expected failing-before Chromium assertion',
    scope:
      'Two real browser POSTs released together both returned201; an independent graph read contained opposing persisted edges. Both result PNGs inspected. No success response injection.',
  },
  'bulk-pointer-boundary': {
    runs: [
      'work-controls-functional-complete',
      'work-bulk-pointer-diagnostic',
      'work-bulk-pointer-after',
      'work-bulk-sonner-before',
      'work-controls-affected-complete',
      'work-bulk-scroll-before',
      'work-bulk-scroll-before-second',
      'work-bulk-stacking-after',
    ],
    status: 'measured stacking cause repaired; affected bulk9 passed across all3 engines',
    scope:
      'Actual rich WebKit failing probe: down and up point989/372, board scroll4200/101 and HTML99 unchanged. Checkbox down977/360; release hits sticky header960/360/288/52 after PressScale matrix0.991188 creates a stacking context. Toast is at636 and is unrelated. Permanent card isolation repairs stable paint order; BoardColumn supplies measured header spacing. Exact full bulk workflow passed1/1 afterward and all9 affected bulk instances passed across3 engines. Earlier horizontal jump remains distinct historical evidence; no native-focus cause is inferred.',
  },
  'current-mixed-before': {
    run: 'work-controls-current-complete',
    status: '68 passed / 7 failed',
    engines: ['chromium', 'firefox', 'webkit'],
    scope:
      'Actual first100 dependency candidate omission: three CRUD failures plus four graph/candidate recovery failures after new blockers fell beyond the first page. The24 visual cases are a separate passing subset.',
  },
  'recurrence-text-before': {
    run: 'work-recurring-text-before-clip',
    status: 'one expected failing-before Chromium assertion',
    locale: 'uz-Cyrl',
    theme: 'light',
    viewport: [320, 600, 2],
    textRangeRight: 319.03125,
    scope:
      'Actual explanation clips outside the narrower recurrence panel. A preceding viewport-only assertion passed vacuously and is excluded; native PNG explicitly inspected.',
  },
  curation: {
    test: 'apps/web/test/e2e/platform-work-plus.qa.spec.ts',
    run: 'work-privacy-draft-after',
    status: 'passed',
    workCases: 15,
    unrelatedSidebarCases: 3,
    engines: ['chromium', 'firefox', 'webkit'],
    roles: ['department-head', 'ordinary-member'],
    locale: 'en',
    scope:
      'Actual curation cancel/create/refusal/held edit/use/delete; creator personal privacy, metadata preservation and persisted reload. Reminder interrupted typing and refused recurrence Stop. Not every validation branch.',
  },
  'curation-visual': {
    test: 'apps/web/test/e2e/platform-work-curation-visual.qa.spec.ts',
    run: 'work-curation-visual-complete',
    status: 'passed',
    cases: 24,
    nativeCaptures: 240,
    scopedAxe: 120,
    violations: 0,
    pageerrors: 0,
    engines: ['chromium', 'firefox', 'webkit'],
    locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
    themes: ['light', 'dark'],
    environments: [
      [1440, 900, 1],
      [768, 600, 2],
      [390, 600, 2],
      [320, 600, 2],
      [360, 225, 1],
    ],
    pixels: pixelsFile,
    sourceBoundary:
      'Predates later root-owned opaque TopBar/BottomTabBar fill. Comparison-level inspection; narrow tall-gallery footer not visible in initial viewport captures.',
  },
  recovery: {
    test: 'apps/web/test/e2e/platform-work-controls-extra.qa.spec.ts',
    run: 'work-reflow-recovery-current',
    status: 'five functional cases passed; whole run five passed / one visual failed',
    engine: 'chromium',
    locale: 'en',
    scope:
      'Initial dependency/reminder read refusal; graph/candidate503 explicit Retry and recovered disabled cycle candidate; recurrence blank-anchor-weekday/monthly/daily/held save; mixed real bulk ownership and controlled empty Undo response.',
    faultBoundary:
      '503 and empty Undo HTTP result are deliberate UI fault injections. Real API persistence/permission outcomes are independently read; empty Undo is not claimed as actual mid-Undo role revocation.',
  },
  transitions: {
    test: 'apps/web/test/e2e/platform-work-transitions.qa.spec.ts',
    run: 'work-transitions-after-first',
    status:
      'bounded passing Chromium transitions; later recurrence-save/current all-engine replay separate',
    engine: 'chromium',
    locale: 'en',
    scope:
      'Dependency CRUD/cancel/loop/blocked state/refused removal; personal reminder validation/read/create/delete/refusal/reload; read-only recurrence; newer bulk selection after delayed response. Includes unrelated gallery case.',
  },
  bulk: {
    test: 'apps/web/test/e2e/platform-work-bulk.qa.spec.ts',
    run: 'work-more-controls-before',
    status: 'bounded two passing bulk cases; whole run three passed / three failed',
    engine: 'chromium',
    locale: 'en',
    scope:
      'Mixed original label Undo; assignment/unassignment, all five priorities, estimate invalid/90/clear, calendar due/Undo, Done/archive/Undo, manual clear and503 retained selection. Empty Undo truthful feedback is later recovery evidence.',
  },
}
const currentRun = 'work-controls-functional-complete'
const affectedRun = 'work-controls-affected-complete'
const bulkRun = 'work-controls-normal-after'
function passedFile(run, file, expectedCases) {
  const summary = resolve(root, `artifacts/qa/2026-10/results/platform/${run}/summary.json`)
  if (!existsSync(summary)) return false
  const report = JSON.parse(readFileSync(summary, 'utf8'))
  const tests = []
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      if (spec.file?.replaceAll('\\', '/').endsWith(file)) tests.push(...spec.tests)
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites) visit(suite)
  return (
    report.errors.length === 0 &&
    tests.length === expectedCases &&
    tests.every(
      (test) =>
        test.status === 'expected' &&
        test.results.length === 1 &&
        test.results[0].status === 'passed',
    )
  )
}
const dependencyComplete =
  passedFile(affectedRun, 'platform-work-transitions.qa.spec.ts', 3) &&
  passedFile(affectedRun, 'platform-work-controls-extra.qa.spec.ts', 9) &&
  passedFile(affectedRun, 'platform-work-picker.qa.spec.ts', 3) &&
  passedFile(affectedRun, 'platform-work-graph-freshness.qa.spec.ts', 3) &&
  passedFile(affectedRun, 'platform-work-dependency-race.qa.spec.ts', 3)
if (dependencyComplete)
  evidence['current-dependency'] = {
    run: affectedRun,
    status: '21 bounded dependency instances passed; mixed30 run29 passed/1 bulk failed',
    cases: 21,
    engines: ['chromium', 'firefox', 'webkit'],
    scope:
      'Seven dependency journeys per engine: CRUD/cancel/remove refusal/loop/blocked status, graph and candidate503 recovery, initial dependency and reminder read refusal, complete cursor list with later-page503/search retention, graph warm reopen after separate real write, opposing real browser writes with refreshed refusal. Independent persistence/reload where applicable; the single bulk pointer failure is separate.',
  }
const currentComplete =
  passedFile(currentRun, 'platform-work-plus.qa.spec.ts', 15) &&
  passedFile(currentRun, 'platform-work-transitions.qa.spec.ts', 15) &&
  passedFile(currentRun, 'platform-work-controls-extra.qa.spec.ts', 12) &&
  passedFile(bulkRun, 'platform-work-bulk.qa.spec.ts', 9) &&
  dependencyComplete
if (currentComplete)
  evidence['current-functional'] = {
    runs: [currentRun, affectedRun, bulkRun],
    status: '60 distinct bounded passing journey/engine instances across three runs',
    cases: 60,
    engines: ['chromium', 'firefox', 'webkit'],
    locale: 'en',
    tests: [
      'platform-work-plus.qa.spec.ts',
      'platform-work-transitions.qa.spec.ts',
      'platform-work-bulk.qa.spec.ts',
      'platform-work-controls-extra.qa.spec.ts',
      'platform-work-picker.qa.spec.ts',
      'platform-work-graph-freshness.qa.spec.ts',
      'platform-work-dependency-race.qa.spec.ts',
    ].map((file) => `apps/web/test/e2e/${file}`),
    scope:
      'Thirty unaffected instances from the mixed54 run plus30 freshly affected dependency/bulk instances. Twelve historical dependency instances are replaced, not counted twice. The mixed54 run itself finished50 passed/4 failed: three picker fixture failures used Cyrillic е against Latin é, and one WebKit bulk pointer retargeting failure was subsequently causally isolated and repaired. Controlled503/held/empty-Undo faults stay explicit; actual worker generation/delivery is not inferred.',
  }
const visualRun = 'work-controls-current-complete'
const currentVisualComplete = passedFile(visualRun, 'platform-work-controls-visual.qa.spec.ts', 24)
const textRun = 'work-controls-bulk-after'
const currentTextComplete = passedFile(textRun, 'platform-work-recurring-text.qa.spec.ts', 24)
const cardRun = 'work-card-native-final'
const currentCardComplete = passedFile(cardRun, 'platform-work-card-stacking.qa.spec.ts', 3)
if (currentCardComplete)
  evidence['card-stacking-current'] = {
    run: cardRun,
    status: '3 bounded normal-use cases passed',
    cases: 3,
    engines: ['chromium', 'firefox', 'webkit'],
    locales: ['en'],
    themes: ['light'],
    environments: [
      [1440, 900, 1],
      [390, 600, 1],
    ],
    scope:
      'Actual pointer select/clear and title open, native backward Tab/Space after programmatic Title entry, emulated touch checkbox/title at390, safe measured sticky geometry/hit target and6 scoped axe checks at normal text. Existing global72px focus margin takes precedence over measured column spacing in these normal environments; no stronger margin is claimed. Current Avatar tokens are readable; a static delegated-avatar wrapper opacity80 caused actual3.33 contrast and was removed. No native long-press drag or physical device claim. Head grouping labels preserved; source geometry postdates prior head board captures. Latest user steering removed tiny/enlarged-text release expansion; aborted57 remains separate.',
  }
if (currentVisualComplete) {
  evidence['current-nested-visual'] = {
    run: visualRun,
    status: 'passed',
    cases: 24,
    engines: ['chromium', 'firefox', 'webkit'],
    locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
    themes: ['light', 'dark'],
    environments: [
      [1440, 900, 1],
      [768, 600, 2],
      [390, 600, 2],
      [320, 600, 2],
      [360, 225, 1],
    ],
    scopedAxe: 360,
    axeViolations: 0,
    pageerrors: 0,
    nativeCaptures: 552,
    scope:
      'Dependency/reminder/monthly repeat disclosures plus bulk toolbar, programmatic focus plus Enter/Escape, all5 environments and320 header supplement. This24-case subset is separate from the mixed75-case run. Text-range recurrence correction after replay was removed from release scope by latest human steering; pointer-to-programmatic bulk occlusion is not native Tab evidence. Time disclosure and other recurrence modes are not included.',
    pixels: pixelsFile,
  }
}
const records = []
if (currentTextComplete)
  add(
    'recurrence-field',
    'RecurrenceField',
    'RadioOption',
    1,
    ['selected', 'focus'],
    'recurrence-text',
    {
      labelIncludes: 'work.recurrence.mode.schedule',
    },
  )
if (currentCardComplete)
  records.push({
    match: {
      source: 'apps/web/src/features/work/components/card-tile.tsx',
      component: 'CardTile',
      kind: 'Checkbox',
      labelIncludes: 'work.bulk.selectCard',
    },
    expectedMatches: 1,
    scopeNote: evidence['card-stacking-current'].scope,
    states: Object.fromEntries(
      ['hover', 'active', 'selected', 'focus'].map((state) => [
        state,
        {
          status: 'tested',
          evidenceId: 'card-stacking-current',
          pixelReviewed: false,
          pixelReviewedArtifacts: [],
        },
      ]),
    ),
  })
if (currentTextComplete)
  evidence['recurrence-text'] = {
    run: textRun,
    cases: 24,
    status: 'passed',
    engines: ['chromium', 'firefox', 'webkit'],
    locales: ['en', 'ru', 'uz-Latn', 'uz-Cyrl'],
    themes: ['light', 'dark'],
    scope:
      'Actual text-range extents inside the recurrence field at320/390×600/text200 after long-word wrapping;48 scoped axe checks. Programmatic radio focus, Enter disclosure, not a complete native Tab journey.',
    pixels: pixelsFile,
  }

function add(
  file,
  component,
  kind,
  expectedMatches,
  states,
  evidenceId,
  extra = {},
  scopeNote = '',
) {
  records.push({
    match: {
      source: `apps/web/src/features/work/components/${file}.tsx`,
      component,
      kind,
      ...extra,
    },
    expectedMatches,
    scopeNote: scopeNote || evidence[evidenceId].scope || evidence[evidenceId].sourceBoundary,
    states: Object.fromEntries(
      states.map((state) => [
        state,
        { status: 'tested', evidenceId, pixelReviewed: false, pixelReviewedArtifacts: [] },
      ]),
    ),
  })
}
add('card-template-editor', 'CardTemplateEditor', 'Input', 2, ['populated', 'disabled'], 'curation')
add(
  'card-template-editor',
  'CardTemplateEditor',
  'Textarea',
  1,
  ['populated', 'disabled'],
  'curation',
)
add('card-template-editor', 'CardTemplateEditor', 'Select', 1, ['selected', 'disabled'], 'curation')
for (const key of ['common.save', 'common.cancel'])
  add(
    'card-template-editor',
    'CardTemplateEditor',
    'Button',
    1,
    ['active', 'disabled'],
    'curation',
    { childSummaryIncludes: key },
  )
add(
  'card-template-editor',
  'CardTemplateEditor',
  'p',
  1,
  ['error'],
  'curation',
  {},
  'Only saveFailed503 inline alert; invalid-schema alert is unit-covered, not browser-covered here.',
)
add(
  'card-template-editor',
  'CardTemplateEditor',
  'DialogContent',
  1,
  ['focus', 'populated'],
  'curation-visual',
)
add(
  'templates-screen',
  'TemplateCard',
  'article',
  1,
  ['default', 'populated'],
  'curation-visual',
  {},
  'Only the long card-template gallery item across the stated matrix. Narrow/short initial viewport contains its middle; footer simultaneous visibility is not claimed. Shared opaque shell fill postdates these images.',
)
add(
  'templates-screen',
  'TemplatesScreen',
  'SegmentedControl',
  1,
  ['default', 'selected'],
  'curation-visual',
  {},
  'Only default Cards selected and both Cards/Projects labels wrapping within gallery width; switching to Projects is not claimed by this visual record.',
)
for (const key of ['work.templateEditor.edit', 'work.templates.delete'])
  add('templates-screen', 'TemplateCard', 'IconButton', 1, ['active'], 'curation', {
    labelIncludes: key,
  })
add(
  'templates-screen',
  'TemplateCard',
  'Button',
  1,
  ['active', 'error', 'success'],
  'curation',
  {},
  'Only card-template use; project consumption is separately owned. Refused503 leaves count/card unchanged, accepted201 preserves payload.',
)
add('templates-screen', 'TemplatesScreen', 'Button', 1, ['active', 'focus'], 'curation')
add('dependencies-panel', 'DependencyRow', 'button', 1, ['active'], 'transitions')
add(
  'dependencies-panel',
  'DependencyRow',
  'IconButton',
  1,
  ['active', 'error', 'success'],
  'transitions',
)
add('dependencies-panel', 'DependenciesPanel', 'StateView', 2, ['error', 'active'], 'recovery')
add(
  'dependencies-panel',
  'DependenciesPanel',
  'Combobox',
  1,
  ['active', 'selected'],
  'transitions',
  {},
  'Only selected blocker, search, disabled cycle candidate and Cancel; graph/candidates refused picker recovery is a separate StateView.',
)
for (const key of ['common.cancel', 'work.dependencies.add'])
  add('dependencies-panel', 'DependenciesPanel', 'Button', 1, ['active'], 'transitions', {
    childSummaryIncludes: key,
  })
add('reminders-panel', 'RemindersPanel', 'StateView', 1, ['error', 'active'], 'recovery')
add(
  'reminders-panel',
  'RemindersPanel',
  'Input',
  2,
  ['populated'],
  'curation',
  {},
  'Actual newer date/note typing survives delayed successful create; broader datetime/note validation is tracked in transitions.',
)
add(
  'reminders-panel',
  'RemindersPanel',
  'Button',
  1,
  ['active', 'validation', 'error', 'success'],
  'transitions',
)
add(
  'reminders-panel',
  'RemindersPanel',
  'IconButton',
  1,
  ['active', 'error', 'success'],
  'transitions',
)
add('reminders-panel', 'RemindersPanel', 'Chip', 1, ['populated'], 'transitions', {
  childSummaryIncludes: 'work.reminders.pending',
})
add('recurrence-field', 'RecurrenceField', 'RadioGroup', 1, ['disabled'], 'transitions')
add('recurrence-field', 'RecurrenceField', 'Select', 1, ['selected', 'disabled'], 'recovery')
add(
  'recurrence-field',
  'RecurrenceField',
  'button',
  1,
  ['selected', 'active'],
  'recovery',
  {},
  'Only Mon off and Tue/Sun on; not each weekday by pointer/touch.',
)
for (const key of ['common.save', 'work.recurrence.stop'])
  add(
    'recurrence-field',
    'RecurrenceField',
    'Button',
    1,
    ['active', 'disabled', 'success'],
    'recovery',
    { childSummaryIncludes: key },
  )
add('recurrence-field', 'RecurrenceField', 'Button', 1, ['active'], 'recovery', {
  childSummaryIncludes: 'work.recurrence.enable',
})
for (const key of [
  'work.bulk.assign',
  'work.bulk.label',
  'work.bulk.priority',
  'work.bulk.estimate',
  'work.bulk.markDone',
  'work.card.archive',
  'work.bulk.clear',
  'work.bulk.clearEstimate',
  'common.save',
])
  add('multitask-toolbar', 'MultitaskToolbar', 'Button', 1, ['active'], 'bulk', {
    childSummaryIncludes: `t('${key}')`,
  })
add('multitask-toolbar', 'MultitaskToolbar', 'DatePicker', 1, ['active', 'success'], 'bulk')
for (const record of records) {
  for (const state of Object.values(record.states)) {
    if (state.evidenceId === 'curation-visual') {
      state.pixelReviewed = true
      state.pixelReviewedArtifacts = [pixelsFile]
    }
  }
}
if (currentComplete) {
  for (const record of records) {
    for (const state of Object.values(record.states)) {
      if (state.evidenceId !== 'curation-visual') state.evidenceId = 'current-functional'
    }
  }
  add(
    'multitask-toolbar',
    'MultitaskToolbar',
    'DatePicker',
    1,
    ['disabled'],
    'current-functional',
    {},
    'Due trigger is disabled during the actual held bulk response; later selection remains after response.',
  )
}
if (dependencyComplete) {
  for (const record of records) {
    if (record.match.source.endsWith('/dependencies-panel.tsx'))
      for (const state of Object.values(record.states))
        if (state.evidenceId !== 'current-nested-visual') state.evidenceId = 'current-dependency'
  }
}
if (currentVisualComplete) {
  add(
    'card-plus-sections',
    'Section',
    'button',
    1,
    ['default', 'focus', 'active'],
    'current-nested-visual',
    {},
    'Only dependencies/reminders/repeat programmatic focus plus Enter; excludes the time section despite its shared signature and does not establish a full native Tab journey.',
  )
  add(
    'dependencies-panel',
    'DependencyRow',
    'IconButton',
    1,
    ['default', 'focus'],
    'current-nested-visual',
  )
  add(
    'reminders-panel',
    'RemindersPanel',
    'IconButton',
    1,
    ['default', 'focus'],
    'current-nested-visual',
  )
  add(
    'recurrence-field',
    'RecurrenceField',
    'Button',
    1,
    ['default', 'focus'],
    'current-nested-visual',
    { childSummaryIncludes: 'work.recurrence.stop' },
  )
  add(
    'multitask-toolbar',
    'MultitaskToolbar',
    'div',
    1,
    ['populated', 'selected'],
    'current-nested-visual',
    { labelIncludes: 'work.bulk.toolbarLabel' },
  )
}

const comparison = JSON.parse(
  readFileSync(
    resolve(root, 'artifacts/qa/2026-10/work-curation-comparison/manifest.json'),
    'utf8',
  ),
)
const pixels = {
  schemaVersion: 1,
  owner: 'knowledge_nested-work',
  date: '2026-10-09',
  method:
    'All30 generated original-pixel comparison PNGs explicitly opened through view_image. Desktop viewer downsizing is retained as a review limit. Capture metadata itself is not pixel proof.',
  sourceBoundary: evidence['curation-visual'].sourceBoundary,
  inspected: comparison.map((item) => ({
    ...item,
    pixelInspected: true,
    review:
      'Long names/translated labels wrap within gallery/editor; keyboard-focused Save is bounded. Narrow tall gallery initial image does not show footer; no full-resolution per-source inspection claim.',
  })),
  inspectedNativeSupplement: [
    'deps-heading-320-text200.png',
    'deps-320-600-text200.png',
    'reminders-390-600-text200.png',
    'reminders-360-225-text100.png',
  ].map((name) => ({
    screenshot: resolve(
      root,
      'artifacts/qa/2026-10/results/platform/work-reflow-pending-current/platform-work-controls-vis-344f3-rk-controls-reflow-ru-light-chromium',
      name,
    ),
    pixelInspected: true,
    sourceBoundary:
      'Current repaired rows/header, Chromium Russian/light; precedes only bulk Due disabledTrigger. Exact original image opened through view_image.',
  })),
  pending: [
    'Current narrow gallery footer native pixels',
    'Shared shell opaque fill replay is root-owned',
  ],
}
const reviewedPixels = resolve(output, 'work-controls-reviewed-pixels.json')
if (existsSync(reviewedPixels))
  pixels.currentReviews = JSON.parse(readFileSync(reviewedPixels, 'utf8'))
writeFileSync(resolve(output, 'work-controls-pixels.json'), JSON.stringify(pixels, null, 2) + '\n')
const overlay = {
  schemaVersion: 1,
  owner: 'knowledge_nested-work',
  date: '2026-10-09',
  policy:
    'Exact named selectors and states only. Old passing slices have explicit source/environment limits. Unlisted states and current unfinished runs remain pending.',
  boundaries: {
    database: 'devon_flow_e2e_knowledge_nested',
    apiPort: 48921,
    webPort: 48922,
    seedDemo: true,
    externalAI: 'excluded',
    externalTelegram: 'excluded',
    externalMail: 'excluded',
    production: 'not exercised',
    commitPushDeployVideo: 'not performed',
  },
  gates: {
    apiPrivacy: {
      status: 'passed',
      cases: 4,
      regression: 'apps/api/test/integration/work-template-privacy.test.ts',
      adjacentAtomicGalleryCases: 12,
    },
    apiBulk: {
      status: 'passed',
      cases: 6,
      regression: 'apps/api/test/integration/work-bulk-integrity.test.ts',
      adjacentAssignmentLockCases: 7,
      concurrency:
        'Actual pg_blocking_pids observed before committing member removal or label deletion; bulk422 leaves every row unchanged.',
    },
    apiDependencies: {
      status: 'passed',
      cases: 3,
      regression: 'apps/api/test/integration/work-dependency-integrity.test.ts',
      adjacentBulkCases: 6,
      scope:
        'Actual opposing and triangular concurrent HTTP writes preserve an acyclic graph. Actual PostgreSQL blocking followed by target soft-delete returns404 without an edge. Department-scoped transaction lock precedes active-card locks.',
    },
    seed: {
      status: 'passed',
      cases: 20,
      scope:
        'Supported seed/idempotence plus actual subsequent FLOW_SEED_DEMO=1 boots; policy unchanged.',
    },
    editorUnits: {
      status: 'passed',
      cases: 3,
      regression: 'apps/web/test/unit/card-template-editor.test.tsx',
    },
    candidatePaginationUnits: {
      status: 'passed',
      cases: 3,
      regression: 'apps/web/test/unit/dependency-candidates.test.ts',
      scope:
        'Complete cursor traversal/deduplication, later-page refusal rejects partial results, repeated cursor terminates with error.',
    },
    currentDependencyAllEngines: dependencyComplete
      ? { status: 'passed bounded21', run: affectedRun, cases: 21 }
      : { status: 'pending' },
    currentFunctionalAllEngines: currentComplete
      ? {
          status: '60 bounded passing instances',
          runs: [currentRun, affectedRun, bulkRun],
          cases: 60,
        }
      : { status: 'pending' },
    currentNestedGeometry: currentVisualComplete
      ? {
          status: 'passed bounded element geometry',
          run: visualRun,
          cases: 24,
          textRangeBoundary:
            'Separate recurrence-text after proof; no blanket clipping or native Tab pass',
          pixelReview: pixelsFile,
        }
      : { status: 'pending' },
    currentRecurrenceText: currentTextComplete
      ? { status: 'passed', run: textRun, cases: 24, scopedAxe: 48, pixelReview: pixelsFile }
      : { status: 'after replay removed from release scope by latest human steering; not passed' },
    currentCardStacking: currentCardComplete
      ? { status: 'passed bounded3 normal use', run: cardRun, cases: 3, scopedAxe: 6 }
      : { status: 'pending' },
    currentTypesLintFormat: {
      apiTypes: 'passed',
      webTypes: 'passed after complete-cursor hook and recurrence wrapping source',
      workScopedESLint:
        'passed0errors/2existingwarnings: blockedBy memo fallback and estimate autofocus',
      workScopedPrettier: 'passed current product+test source',
    },
  },
  evidence,
  records,
  entries: [
    {
      workflow: 'Work controls',
      status: 'partial bounded evidence',
      reference: 'docs/qa/2026-10/work-controls.md',
      note: 'API/worker and browser responsibilities remain separate; no blanket work feature pass.',
    },
  ],
  pending: [
    'Current full functional all-engine replay',
    'Bulk pending DatePicker probe',
    'Recurrence worker generation/count/until and reminder sent/delivery',
    'Template current scope switching/concurrent role revocation browser',
    'Gallery empty/loading/read-error recovery',
    'Offline/reconnect and actual mid-Undo revoked role',
    'Native browser zoom/touch/physical devices',
    'Current release gates owned by parent',
    'Measured sticky-header/card stacking repair full affected pointer/native/touch replay',
  ],
  releaseScopeRemoved: [
    {
      scope: 'New tiny-screen and200% text matrices',
      authority: 'Latest human steering relayed by root2026-10-09',
      disposition:
        'Stopped current57 matrix; retain already obtained historical evidence. Recurrence320/390 text200 after replay is not a release blocker.',
    },
  ],
}
if (currentVisualComplete && currentTextComplete)
  overlay.pending = overlay.pending.filter((item) => item !== 'Current nested reflow/pixel matrix')
if (currentComplete)
  overlay.pending = overlay.pending.filter(
    (item) =>
      !['Current full functional all-engine replay', 'Bulk pending DatePicker probe'].includes(
        item,
      ),
  )
if (currentComplete && currentCardComplete)
  overlay.pending = overlay.pending.filter(
    (item) => !item.startsWith('Measured sticky-header/card stacking'),
  )
writeFileSync(
  resolve(output, 'work-controls-evidence.json'),
  JSON.stringify(overlay, null, 2) + '\n',
)
const sidebar = JSON.parse(readFileSync(resolve(output, 'sidebar-evidence.json'), 'utf8'))
sidebar.gates.scopedESLint = {
  status: 'passed',
  config: 'packages/ui/src/lint/eslint.config.js',
  scope:
    'src/shell/sidebar.tsx and src/shell/sidebar-user-block.tsx; zero diagnostics. Wrong generic React config/plugin crash excluded.',
}
sidebar.gates.scopedPrettier = {
  status: 'passed current product source',
  scope: 'sidebar.tsx and sidebar-user-block.tsx; docs separately formatted',
}
writeFileSync(resolve(output, 'sidebar-evidence.json'), JSON.stringify(sidebar, null, 2) + '\n')
const knowledge = JSON.parse(
  readFileSync(resolve(output, 'knowledge-nested-evidence.json'), 'utf8'),
)
knowledge.pending = knowledge.pending.map((item) =>
  item.startsWith('Shared shell 768px200%')
    ? 'Shared sidebar defect was subsequently repaired and retested in docs/qa/2026-10/sidebar-evidence.json; InboxBell/topbar separate root evidence.'
    : item,
)
writeFileSync(
  resolve(output, 'knowledge-nested-evidence.json'),
  JSON.stringify(knowledge, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    records: records.length,
    curationInspectedSheets: comparison.length,
    currentFunctionalComplete: currentComplete,
    currentVisualComplete,
    currentTextComplete,
  }),
)
