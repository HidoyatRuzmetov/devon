# Shared shell and inbox repair evidence

This is a partial slice of the full-platform assignment. All data below is synthetic and local.
No production action, commit, push, deployment or tutorial recording is implied.

| Surface/state | Defect and cause | Repair | Evidence and current disposition |
| --- | --- | --- | --- |
| Header at 320 CSS px | Header controls exceeded the viewport by 9 px; the demo label competed with primary controls. | Demo information remains available in its own mobile strip; compact search/quick-add at constrained desktop widths. | Complete four-locale/two-theme/seven-width/three-engine matrix passed. All168 header cases inspected through12 unscaled crop sheets; `shell-pixel-review.json` records scope and limits. |
| Home at 768 px with sidebar | Viewport-based two-column management tiles squeezed names to near-unreadable fragments inside the narrower actual content area. | Container breakpoints determine tile columns from available content width. | Actual before pixels inspected. After captures and complete inspection pending. |
| Shared page headers on tablets | Nonshrinking, unwrapped actions squeezed headings and pushed controls outside the page. | Header title and action groups wrap into usable rows. | Inbox/people before pixels inspected; adjacent consumer sweep pending. |
| Inbox tablet detail | Two panes were forced into the 440 px remaining after the sidebar; detail became a roughly 48 px sliver. | Use the same detail in a sheet until 1280 px permits two useful panes. | Before screenshot inspected; cross-engine keyboard/overflow/after pixel checks running. |
| Inbox archive then immediate navigation | A success toast preceded persistence; unmount canceled the delayed write, so an archived notification returned. | Persist before announcing success. Undo is a real owner-scoped restore, with audit and realtime outbox emission in the transaction. | Real Chromium regression failed against the original hooks/screen, then source restored. Before trace and pixels: `artifacts/qa/2026-10/inbox/before-archive/`. Archive, undo-only-selected and controlled failure journeys passed in Chromium and Firefox before the focus extension; final three-engine batch pending. |
| Inbox keyboard toolbar Enter | Window-level Enter prevented native activation and opened the selected notification instead of the focused preferences button. | Interactive controls retain their native keyboard activation; global shortcuts do not intercept them. | Real before test failed at URL `/inbox` instead of `/account/notifications`; `results/platform/inbox-before-keyboard/`. Fifteen-case inbox batch passed in all three engines, including this regression. |
| Inbox sheet Escape | Controlled sheet had no trigger, so focus returned nowhere. | Track the actual row opener, restore it on close, or use the selected tab when the opener was removed. | Real Chromium focus assertion failed before repair. Original opener restoration passed all three engines. |
| Inbox detail archive failure | Detail closed immediately even if archive failed. | Close after successful persistence in the shared archive handler; preserve detail on failure. | Dedicated controlled503 failure, unchanged independent read, successful retry, archived persistence and stable focus passed all three engines. |
| Inbox removed row focus | Closing after archive initially restored a row still animating out; the sheet's unmount callback retained stale rows. | Read current rows through a layout-updated ref before restoring focus. | Same focus assertion failed after the initial opener fix; actual current-state repair passed3/3 engines at `results/platform/inbox-removed-row-focus/`. |
| Search overlay close | Controlled palette had no trigger and lost focus after Escape. Mobile sheet also did not initially focus search. | Capture explicit search opener or shortcut's focused control before opening; shared dialog/sheet close callbacks restore it. Enable autofocus on this search sheet. | Before matrix failed all three engines at focus restoration. After all168 geometry cases and desktop/mobile Enter/shortcut/Escape passed. Repeated Ctrl/Meta+K, search autofocus and opener restoration passed all three engines at `results/platform/keyboard-after-edges/`. |
| Inbox focused-row shortcuts | The broad native-button guard suppressed j/k/e on row openers; grouped ordering also differed from the raw query order. | Keep native row Enter; navigate the visible grouped order and use the actual focused notification for archive. Mobile navigation selects/focuses without opening a sheet. | Actual before j-to-next-focus failed in `keyboard-before-edges`. After visible-order j/k, Enter/Escape and focused-row archive with independent persistence passed all three engines. |
| Inbox row Archive button focus | The archive button is a sibling of the opener, so deleting it dropped keyboard focus to the body. | Identify focus within the complete notification row and move to the next surviving visible row, or selected tab. | Independent review found this gap; actual keyboard Enter before failure preserved in `inbox-row-action-before`. Native archive persistence and surviving-row focus passed3/3 engines in `card-inbox-final-focused`. |
| Inbox tabs | Handwritten tab buttons lacked shared roving keyboard and panel associations. | Shared semantic Tabs primitives with retained hidden panels. | End/Home switching passed before focus assertion was added. Final cross-engine batch pending. |
| Inbox snooze errors | Success toast appeared before the API result. | Show success on persistence; show failure on error. | Source repair; browser failure/persistence journey still pending. |

## Test fixture and capture corrections

The latest shared-header run is `bell-large-history-after`. All **24 unscaled header inspection
sheets were opened**, covering 168 normal header captures and 72 doubled-text/short captures in
all three engines, four locales and both themes. The original files remain under
`artifacts/qa/2026-10/shell/runs/bell-large-history-after/`. At 320px some enlarged headers wrap
onto two rows; the controls and count remain readable. This is contained reflow, not clipping.

The notification count previously overlaid the bell icon (the seeded before fixture also measured
a 6px overlap at normal size). The count is now an inline sibling with a gap, and the button grows
to contain both. The accessible name includes the exact unread count, while the visible count
still caps at 99+. The dedicated boundary cases passed in all three engines: five count values
at three widths and two text sizes (**90 observations**). Six selected 320px enlarged count images
were also opened. The two shell cases passed in all three engines (**6/6**), including repeated
palette shortcut/focus restoration. The combined report has **9 passed/3 failed**: its three
long-page fixtures were rejected for exceeding a single text-node limit. The corrected long-page
journey passed later; the mixed report is not presented as an all-green suite.

The remaining full-home captures, complete palette command/search states, system-theme transition
and role-specific navigation are separate coverage. Shared sidebar defects reported during
Knowledge's enlarged-text inspection are assigned for actual reproduction and repair.

- A previous twelve-case inbox run passed nine cases and failed three because earlier browser tests
  consumed all five seeded notifications. Those failures are test preparation defects, not evidence
  of a WebKit product defect. Each journey now restores only its own local fixture's archived rows
  and independently requires at least two available notifications before opening the page.
- The first shell matrix attempted multiple theme toggles without waiting for each asynchronous
  view transition. It could cycle back to light. The corrected collector waits for the persisted
  preference and transition completion; no application assertion was removed.
- Full-page capture exercises actual scrolling and waits for finite entrances to finish. Loading
  skeletons expose `aria-busy`; captures of a skeleton or opacity-zero content are not accepted as
  loaded feature evidence. Capturing files alone is not pixel inspection.
- `QA_RUN_ID` separates root results from other runs and preserves failed traces. Both it and the
  route capture phase reject path separators. No retries, forced clicks or external service success
  mocks are used.
- The strengthened route collector records window errors (including ResizeObserver), console
  errors, and all tagged WCAG A/AA axe violations at each viewport. The earlier serious/critical-only
  axe pass and pageerror-only listener are not treated as complete accessibility/error coverage.

## Repeat

From `apps/web`, set a validated `FLOW_DB_NAME`, separate `FLOW_API_PORT`/`FLOW_WEB_PORT`, and
`FLOW_SEED_DEMO=1`. Run `pnpm exec playwright test --config test/e2e/platform-qa.config.ts` with the
appropriate named `platform-*.qa.spec.ts`, and a new `QA_RUN_ID` to preserve evidence. Current inbox
uses `devon_flow_e2e_inbox` on 48951/48952; shell uses `devon_flow_e2e_shell` on 48931/48932.

Remaining full-inventory routes, nested controls, text zoom/reflow, all role workflows and final
build gates remain explicit pending work in the inventory. This ledger does not claim completion.
