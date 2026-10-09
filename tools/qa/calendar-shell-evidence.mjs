import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { mergeInventoryEvidence } from './merge-inventory-evidence.mjs'

const root = resolve(import.meta.dirname, '../..')
const load = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const combined = 'artifacts/qa/2026-10/results/platform/calendar-shell-inbox-current'
const calendar = 'artifacts/qa/2026-10/results/platform/calendar-copy-current'
const sticky = 'artifacts/qa/2026-10/results/platform/sticky-navigation-current'
const focus = 'artifacts/qa/2026-10/results/platform/work-native-focus-current'
function checkReport(path, file, expected) {
  const report = load(path)
  const collect = (suite) => [
    ...(suite.specs ?? []).filter((spec) => spec.file === file).flatMap((spec) => spec.tests),
    ...(suite.suites ?? []).flatMap(collect),
  ]
  const tests = report.suites.flatMap(collect)
  if (
    tests.length !== expected ||
    report.errors.length ||
    tests.some(
      (test) =>
        test.status !== 'expected' ||
        test.expectedStatus !== 'passed' ||
        test.results.length !== 1 ||
        test.results[0].status !== 'passed' ||
        test.results[0].retry,
    )
  )
    throw new Error(`Named execution slice did not pass without skips or retries: ${path}/${file}`)
}
checkReport(`${calendar}/summary.json`, 'platform-calendar-deep.qa.spec.ts', 21)
checkReport(`${combined}/summary.json`, 'platform-inbox-header.qa.spec.ts', 3)
checkReport(`${sticky}/summary.json`, 'platform-sticky-chrome.qa.spec.ts', 6)
checkReport(`${focus}/summary.json`, 'platform-work-focus.qa.spec.ts', 6)
const hash = (path) =>
  createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex')
const originals = readdirSync(resolve(root, combined), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /calendar-deep|inbox-header/.test(entry.name))
  .flatMap((entry) =>
    readdirSync(resolve(root, combined, entry.name))
      .filter((name) =>
        /^(cancelled-agenda|subscription-cap|held-create-draft|clipboard-fallback|unread-header-(?:before|after)-data)\.png$/.test(
          name,
        ),
      )
      .map((name) => `${combined}/${entry.name}/${name}`),
  )
if (originals.length !== 18) throw new Error('The exact eighteen opened originals must exist')
const currentCalendar = readdirSync(resolve(root, calendar), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('platform-calendar-deep'))
  .flatMap((entry) =>
    readdirSync(resolve(root, calendar, entry.name))
      .filter((name) =>
        /^(cancelled-agenda|subscription-cap|held-create-draft|clipboard-fallback|late-clipboard-(?:success|denied))\.png$/.test(
          name,
        ),
      )
      .map((name) => `${calendar}/${entry.name}/${name}`),
  )
if (currentCalendar.length !== 18)
  throw new Error('The eighteen opened later calendar originals must exist')
const nativeFocus = readdirSync(resolve(root, focus), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('platform-work-focus'))
  .flatMap((entry) =>
    readdirSync(resolve(root, focus, entry.name))
      .filter((name) => name === 'native-priority-focus.png')
      .map((name) => `${focus}/${entry.name}/${name}`),
  )
if (nativeFocus.length !== 6)
  throw new Error('The six opened native keyboard-focus originals must exist')
const sheets = load(`${sticky}/pixel-review/manifest.json`)
if (sheets.length !== 6 || sheets.flatMap((sheet) => sheet.sources).length !== 24)
  throw new Error('The complete named native navigation sheet matrix is missing')
writeFileSync(
  resolve(root, 'docs/qa/2026-10/calendar-shell-pixels.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      reviewer: 'root',
      reviewBasis:
        'Actual view_image inspection of eighteen earlier originals, eighteen later calendar originals, six native focus originals and six unscaled sheets',
      policy:
        'Hashing or generating images cannot establish inspection. Earlier artifacts are not relabeled as later source captures.',
      originals: originals.map((path) => ({ path, sha256: hash(path), opened: true })),
      laterCalendarOriginals: currentCalendar.map((path) => ({
        path,
        sha256: hash(path),
        opened: true,
      })),
      nativeKeyboardFocusOriginals: nativeFocus.map((path) => ({
        path,
        sha256: hash(path),
        opened: true,
      })),
      sheets: sheets.map((sheet) => ({
        ...sheet,
        sha256: hash(sheet.sheet),
        opened: true,
        sources: sheet.sources.map((path) => ({ path, sha256: hash(path) })),
      })),
      boundaries: [
        'Originals: English/light, calendar1280x720 and Inbox390x844, all three engines; synthetic local data only.',
        'Cap/later-draft images crop only the actual dialog. Clipboard credentials are masked.',
        'Clipboard originals establish the focused URL row, not a readable toast: they predate its completed entrance.',
        'Navigation: all four locales/two themes/all three engines at320x600 with actual doubled typography and wheel scrolling. The entire native viewport is retained.',
        'Earlier originals predate the clipboard scope guard; later calendar originals establish that guard but predate the event-scope help merge. Neither is relabeled as current full-source acceptance.',
        'Later Chromium/Firefox clipboard captures include readable feedback. The WebKit normal-denial viewport mask overlaps part of the toast; a separate readable feedback crop remains pending.',
        'Native keyboard-focus originals: EN/light/all three engines at360x225/text100 and390x600/text200. Real Tab/Enter/Escape reaches Priority and retains an unobscured ring; a programmatic focus capture is a different modality.',
        'No physical device, physical magnification, complete route/component or full-platform pixel pass is inferred.',
      ],
    },
    null,
    2,
  ) + '\n',
)

const state = (evidenceId, pixels = []) => ({
  status: 'verified',
  evidenceId,
  pixelReviewed: pixels.length > 0,
  pixelReviewedArtifacts: pixels,
})
const record = (source, component, kind, selector, states, note) => ({
  match: { source, component, kind, ...selector },
  expectedMatches: 1,
  states,
  scopeNote: `${note} Other actions, states, roles and combinations remain pending.`,
})
const agenda = 'apps/web/src/features/calendar/components/agenda-panel.tsx'
const feeds = 'apps/web/src/features/calendar/components/feeds-panel.tsx'
const inbox = 'apps/web/src/features/inbox/inbox-screen.tsx'
const shots = (name) => originals.filter((path) => path.endsWith(`/${name}.png`))
const overlay = {
  schemaVersion: 1,
  owner: 'root-calendar-shell',
  provenance:
    'Exact real-service browser receipts and independent reads; named already-opened pixel artifacts with explicit capture limits.',
  policy:
    'Only named states and scopes receive bounded evidence; a child action cannot establish its whole parent.',
  boundaries: {
    db: 'devon_flow_e2e_root',
    apiPort: 48952,
    webPort: 48951,
    externalCalls: 'blocked',
    production: 'not exercised',
  },
  evidence: {
    agenda: {
      test: 'apps/web/test/e2e/platform-calendar-deep.qa.spec.ts',
      report: `${calendar}/summary.json`,
      scenario:
        'Three range/scope journeys: actual7/30/90 radios, own head/member tasks, department events without RSVP, independent reads, task/event deep links and visible cancelled cue. English/light/1280x720/all3.',
    },
    recovery: {
      test: 'apps/web/test/e2e/platform-calendar-deep.qa.spec.ts',
      report: `${calendar}/summary.json`,
      scenario:
        'Three organic empty + actual agenda/feed503 Retry200 journeys. English/light/1280x720/all3; offline not covered.',
    },
    cap: {
      test: 'apps/web/test/e2e/platform-calendar-deep.qa.spec.ts',
      report: `${calendar}/summary.json`,
      scenario:
        'Three real21st-subscription structured422 refusals, specific remedy, retained draft and independent20-record read. English/light/1280x720/all3.',
    },
    lateCreate: {
      test: 'apps/web/test/e2e/platform-calendar-deep.qa.spec.ts',
      report: `${calendar}/summary.json`,
      scenario:
        'Three actual committed200 held receipts, Escape/reopen/later draft, delivery/refetch without discarding later dialog. English/light/1280x720/all3.',
    },
    clipboard: {
      test: 'apps/web/test/e2e/platform-calendar-deep.qa.spec.ts',
      report: `${calendar}/summary.json`,
      scenario:
        'Nine controlled clipboard boundary journeys: denial selects/focuses actual URL with truthful remedy; held old success/denial after real renewal gives no stale feedback or focus theft. Real independent reads and old404/new200. No operating-system clipboard write claim. English/light/1280x720/all3.',
    },
    inbox: {
      test: 'apps/web/test/e2e/platform-inbox-header.qa.spec.ts',
      report: `${combined}/summary.json`,
      scenario:
        'Three read-only seeded head journeys: held actual unread response, disabled action before data and enabled afterward, existing All-tab list position changes≤1px. English/light/390x844/all3; no Mark-all-read mutation claim.',
    },
    navigation: {
      test: 'apps/web/test/e2e/platform-sticky-chrome.qa.spec.ts',
      report: `${sticky}/summary.json`,
      scenario:
        'Six executed cases/four locales each, actual native wheel overlap, opaque header/footer geometry and24 scoped axe scans. All3 engines/two themes/320x600/text200. All24 native captures opened through6 unscaled sheets.',
    },
  },
  records: [
    record(
      agenda,
      'AgendaPanel',
      'SegmentedControl',
      {},
      { selected: state('agenda') },
      'Actual range selection only.',
    ),
    record(
      agenda,
      'body',
      'button',
      {},
      { populated: state('agenda', shots('cancelled-agenda')) },
      'Actual rendered task/event entries, cancelled label and navigation; no hover/keyboard claim.',
    ),
    record(
      agenda,
      'body',
      'StateView',
      { labelIncludes: 'calendar.agenda.empty.title' },
      { empty: state('recovery') },
      'Organic empty guide and actual Go-to-events action.',
    ),
    record(
      agenda,
      'body',
      'StateView',
      { labelIncludes: 'calendar.agenda.error.title' },
      { error: state('recovery') },
      'Controlled503 and actual Retry/read recovery.',
    ),
    record(
      feeds,
      'body',
      'StateView',
      { labelIncludes: 'calendar.feeds.error.title' },
      { error: state('recovery') },
      'Controlled503 and actual Retry/read recovery.',
    ),
    record(
      feeds,
      'body',
      'StateView',
      { labelIncludes: 'calendar.feeds.empty.title' },
      { empty: state('recovery') },
      'Organic empty subscription guide only; create action is separately exercised.',
    ),
    record(
      feeds,
      'CreateFeedDialog',
      'Input',
      {},
      { populated: state('lateCreate', shots('held-create-draft')) },
      'Later typed draft remains after older receipt; image includes pointer text-edit focus, no Tab claim.',
    ),
    record(
      feeds,
      'CreateFeedDialog',
      'p',
      { labelIncludes: 'role="alert"' },
      { error: state('cap', shots('subscription-cap')) },
      'Actual structured cap refusal remedy; other errors remain separately scoped.',
    ),
    record(
      feeds,
      'CopyRow',
      'input',
      {},
      { focus: state('clipboard', shots('clipboard-fallback')), selected: state('clipboard') },
      'Denial fallback focus/selection measured; masked images cannot show secret or selected glyphs.',
    ),
    record(
      feeds,
      'CopyRow',
      'IconButton',
      {},
      { error: state('clipboard') },
      'Controlled denied/stale clipboard receipt behavior, no tooltip/state-color pixel claim.',
    ),
    record(
      inbox,
      'InboxScreen',
      'Button',
      { childSummaryIncludes: "t('inbox.markAllRead')" },
      {
        disabled: state('inbox', shots('unread-header-before-data')),
        default: state('inbox', shots('unread-header-after-data')),
      },
      'Action availability/layout only; no mutation.',
    ),
    record(
      inbox,
      'InboxScreen',
      'TabsContent',
      {},
      {
        loading: state('inbox', shots('unread-header-before-data')),
        populated: state('inbox', shots('unread-header-after-data')),
      },
      'Only selected All/inbox panel is exercised; other tabs are not inferred.',
    ),
  ],
  entries: [
    {
      surface: 'Shared sticky TopBar and mobile BottomTabBar',
      evidenceId: 'navigation',
      note: 'Rendered shared navigation has no standalone exact JSX surface in the current scanner. This workflow stays explicit and does not bind child controls as blanket passes.',
    },
  ],
}
const { report } = mergeInventoryEvidence(
  load('docs/qa/2026-10/inventory.json'),
  [overlay],
  (path) => existsSync(resolve(root, path)),
)
if (report.issues.length) throw new Error(JSON.stringify(report.issues))
writeFileSync(
  resolve(root, 'docs/qa/2026-10/calendar-shell-evidence.json'),
  JSON.stringify(overlay, null, 2) + '\n',
)
console.log(
  JSON.stringify({
    records: report.exactRecordsApplied,
    bindings: report.stateBindingsApplied,
    reviewedEarlierOriginals: originals.length,
    reviewedLaterCalendarOriginals: currentCalendar.length,
    reviewedNativeFocusOriginals: nativeFocus.length,
    reviewedSheets: sheets.length,
    noBlanketPass: true,
  }),
)
