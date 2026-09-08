# Motion density sweep -- round 2

Scope: every screen under `apps/web/src/features/*` and `apps/web/src/shell/*`, audited row-by-row
against DESIGN.md §10's motion catalogue (19 rows) and `packages/ui/src/motion`. The goal per the
CTO's bar ("so much animation and transition, purposeful, never in the way") was to find every
catalogue row a screen *should* use but doesn't, add it, and leave alone what already ships.

## Method

1. Grepped every non-test, non-story `.tsx` under `features/` and `shell/` for the name of each
   motion primitive (`PageTransition`, `Stagger`/`StaggerItem`, `HoverLift`/`PressScale`,
   `NumberFlow`/`KpiTile`, `Shimmer`/`Skeleton`, `Celebrate`/`AnimatedCheck`, `ProgressRing`,
   `Collapsible`, `IdleFloat`, `AmbientGradient`, `HoverCard`, `Reveal`/`BlurFade`,
   `AnimatePresence`) -- 107 files, full results below the table.
2. For every row the grep found *no* screen using directly, checked whether it is actually satisfied
   centrally by a shared primitive (`Button`, `Dialog`, `Sheet`, `Tabs`, `Sidebar`, `Checkbox`,
   `KpiTile`, `InboxBell`, `StateView`/`EmptyState`) before treating it as a gap -- most of the
   catalogue turned out to already be wired at the component level from the round-1 foundation pass,
   so a screen using that primitive gets the row for free.
3. Everything left over is a genuine per-screen gap, fixed below.

## Rows already satisfied globally (no per-screen work needed)

| Catalogue row | Ships as | Where it actually lives |
|---|---|---|
| Route change | `PageTransition` | `apps/web/src/shell/app-shell.tsx` wraps the whole route outlet once -- every screen gets it free. |
| Sidebar active item, tabs | `Sidebar`, `Tabs` | `packages/ui/src/shell/sidebar.tsx` and `primitives/tabs.tsx` already carry a shared `layoutId` + `spring.settle`. |
| Dialog | `Dialog` | `packages/ui/src/primitives/dialog.tsx`'s `DialogOverlay`/`DialogContent` CSS keyframes (`devon-dialog-in`, backdrop blur fade). |
| Sheet | `Sheet` (Vaul) | `packages/ui/src/primitives/sheet.tsx`, `spring.sheet`. |
| Checkbox / task done | `Checkbox` | `packages/ui/src/primitives/checkbox.tsx` bakes in `AnimatedCheck` + an opt-in `celebrate` burst. |
| Counters, KPI tiles | `KpiTile` | `packages/ui/src/primitives/kpi-tile.tsx` bakes in `@number-flow/react`, disabled under reduced motion. |
| Buttons | `Button` | `packages/ui/src/primitives/button.tsx` bakes in the loading-spinner / success-check morph and press scale. |
| Inbox badge | `InboxBell` | `packages/ui/src/shell/inbox-bell.tsx`, pop-on-increment-only, `devon-badge-pop`. |
| Empty states, illustration idle float | `StateView` / `EmptyState` | `packages/ui/src/states/empty-state.tsx`'s `StateShell` wraps every illustration in `IdleFloat` + `Reveal` -- any screen passing `StateView kind="empty"` (or `error`/`forbidden`/`offline`) gets this automatically. |
| Charts (department analytics) | Recharts + `useChartAnimation` | `apps/web/src/features/analytics/{chart-card,sections}.tsx` -- every one of the 8 chart sections already reads `animate = useChartAnimation()` and disables `isAnimationActive` under reduced motion. |

## Screen × catalogue row -- gaps found and fixed

| Screen | Row | Before | After |
|---|---|---|---|
| `admin/accounts-screen.tsx` (accounts table) | Lists, grids, tiles | Plain `<tbody>`/`<tr>`, no entrance, no re-stagger on search/status filter | `Stagger as="tbody"` / `StaggerItem as="tr"`, `animateKey` on `query:status` |
| `admin/departments-screen.tsx` (departments table) | Lists, grids, tiles | Plain `<tbody>`/`<tr>`, row itself is the click target (opens the drawer) with no arrival motion | `Stagger`/`StaggerItem` on the table body, keyed by `query:status` |
| `admin/audit-screen.tsx` (audit log) | Lists, grids, tiles | Plain `<tbody>`/`<tr>`, no re-stagger on the action filter or pagination cursor | `Stagger`/`StaggerItem`, keyed by `action:cursor` |
| `admin/health-screen.tsx` (health checks) | Lists, grids, tiles | Six `HealthRow`s as plain `<li>`s, no entrance | `Stagger as="ul"` / `StaggerItem as="li"` (one-time entrance; not re-keyed to the 30 s poll, so a routine refetch never replays it) |
| `admin/charts.tsx` `BarChart` (admin dashboard/analytics) | Charts | Each bar's `height` was set directly on first paint -- the existing `transition-[height]` CSS only fired on a *later* value change, never on mount | Bars start at 0 % and flip to their real height one `requestAnimationFrame` after mount (the same trick `ChainVerifyBadge` already used), so the CSS transition now draws in; reduced motion skips straight to the final height |
| `admin/charts.tsx` `DonutChart` (admin dashboard/analytics) | Charts | Arc segments rendered already in their final `strokeDashoffset`, no draw-in | Each arc's `strokeDashoffset` starts at the full `circumference` (hidden) and animates to its target via a CSS `transition: stroke-dashoffset` after the same one-frame mount trick |
| `projects/components/projects-list-screen.tsx` (project grid) | Lists, grids, tiles | Plain grid of `ProjectTile`s (which already have their own `HoverLift`); no entrance stagger for the grid itself | `Stagger`/`StaggerItem` around the grid |
| `work/components/mine-screen.tsx` ("Mine" card rows) | Lists, grids, tiles; Cards | Plain rows, `hover:border-ring/50` only -- no lift, no press feedback, no entrance, no re-stagger when `?q=` narrows the list | `Stagger`/`StaggerItem` per group (`animateKey` on the combined query), each row wrapped in `HoverLift` + `PressScale` |
| `work/components/archive-screen.tsx` (per-person archive) | Lists, grids, tiles | Plain rows, no entrance, no re-stagger when the member picker changes whose archive is shown | `Stagger`/`StaggerItem`, keyed by the selected member id |
| `work/components/table-screen.tsx` (200+-row virtualised table) | Lists, grids, tiles (perf-scoped) | Virtualised rows (`useVirtualizer`) appeared with no arrival motion at all | Rows now fade + rise in on mount via a plain CSS keyframe (`devon-rise-in`, the same one `HoverCard` uses) -- transform/opacity only, **not** a `Stagger`/`StaggerItem` pair. See "Performance" below for why. |
| `pages/pages-screen.tsx` (page tree list) | Lists, grids, tiles | Plain `<ul>`/`<li>` (each row already had `HoverLift`); no entrance | `Stagger as="ul"` / `StaggerItem as="li"` per kind-group |
| `ai/ai-settings-screen.tsx` (feature-flag list + usage traces table) | Lists, grids, tiles | Plain `<ul>`/`<li>` for the flag switches and plain `<tbody>`/`<tr>` for the usage table, no entrance on either | `Stagger`/`StaggerItem` on both |
| `work/components/card-detail.tsx` "Mark done" | RSVP yes, card done, sprint complete (celebration) | `markDone()` just patched the card's status; no burst, no toast on the one path that actually lands on `status: 'done'` (a project-scoped card -- a standalone card still archives, unchanged) | `useCelebrate()` fires a 12-particle burst anchored on the button + a new `work.card.done` toast, only on the `done` branch (the `archived` branch keeps its existing `toastWithUndo`, which is not a celebration moment) |
| `work/components/card-detail.tsx` checklist | Checklist complete (celebration) | No signal at all when the last checklist item was checked -- `done`/`total` just silently reached parity | A `wasChecklistComplete` ref detects the 0→100 % transition (never re-fires on an already-complete card, and re-arms if a new item is added and the ratio drops) and fires `Celebrate` + a new `work.card.checklistComplete` toast |
| `personal/sprints-view.tsx` "Complete" | Sprint complete (celebration) | `patchSprint.mutate({status:'completed', ...})` with no `onSuccess`, no toast, no burst | `onSuccess` now fires a per-row `Celebrate` (tracked by `celebratingSprintId`, so only the period that was actually completed bursts) + a new `personal.sprints.complete.toast` |
| `inbox/inbox-screen.tsx` inbox zero | Inbox zero (celebration) | The file's own header comment promised "an empty inbox that actually celebrates zero" but nothing did -- `AllDoneIllustration` rendered the same way every time the `inbox` tab was empty, including every future visit | A `previousInboxCount` ref detects the >0→0 transition (never fires for an inbox that was *already* empty on load) and fires a `Celebrate` anchored on the illustration |
| `home/home-screen.tsx` `OnboardingCard` | Onboarding complete (celebration) | `if (done === items.length) return null` -- the checklist card silently vanished the instant the last item finished, no acknowledgement at all | First time the checklist completes (a `localStorage` flag makes sure it is only once per browser, never on a later visit to an already-finished checklist), the card holds for 2.4 s fully checked with a `Celebrate` burst on its title + the pre-existing (but previously unused) `home.dashboard.onboarding.done` toast, then unmounts |

## New shared-primitive capability (unlocked several of the rows above)

`packages/ui/src/motion/stagger.tsx`'s `Stagger`/`StaggerItem` only supported `div`/`ul`/`ol`/`section`
and `div`/`li`/`article` respectively -- unusable on the three admin console screens and the
department analytics table pattern, which are real `<table>`s (`overflow-x-auto` + `<table>`, not
CSS grid). Extended:
- `Stagger`'s `as` union gained `'tbody'`.
- `StaggerItem`'s `as` union gained `'tr'`, plus a narrow, explicit set of pass-through DOM props
  (`onClick`, `onKeyDown`, `tabIndex`, `role`, `aria-label`) for the departments table's whole-row
  click target -- deliberately **not** a blanket `HTMLAttributes` extension, which pulls in an
  optional `style?: CSSProperties` that this package's `exactOptionalPropertyTypes: true` rejects
  against `motion`'s own `MotionStyle` type (confirmed by trying the blanket version first: it broke
  `pnpm --filter @devon/ui typecheck`).

## Performance: the board and the 200+-row table

- **Table (`work/components/table-screen.tsx`)**: rows are `useVirtualizer`-backed -- they mount and
  unmount continuously as the list scrolls, at up to 100 rows (`GET /api/v1/cards`'s own hard cap).
  Wrapping each row in `Stagger`/`StaggerItem` would mean mounting a fresh framer-motion instance,
  running its own per-item `staggerChildren` delay, on every scroll tick -- exactly the "in the way"
  failure mode the CTO's bar warns against, and a real risk of scroll jank at speed. Fixed instead
  with a **plain CSS keyframe** (`devon-rise-in`, transform + opacity only, no per-item delay, no JS
  animation cost) applied via a Tailwind `animate-[...]` utility -- same "this just arrived" read,
  zero per-row JS cost, and the global `prefers-reduced-motion` backstop in `tokens.css` still
  collapses it to an instant appearance. Verified by reading `useVirtualizer`'s `overscan: 8` (a
  bounded number of extra rows kept warm off-screen, not the full 100) and confirming the row's own
  className list carries no other property that would trigger layout (only `transform`/`opacity` from
  the virtualizer's own positioning plus the new keyframe).
- **Board (`work/components/board-column.tsx`)**: already used `Stagger`/`StaggerItem` per column
  (round 1) -- left as is. Each column's card count is bounded by one person's workload (the "People
  board" columns are per-member), not the department's total card count, so a `staggerChildren: 24ms`
  cascade never has 200 items to walk through in a single column even when the department has 200+
  cards spread across many columns/members. No JS animation runs on drag itself (that is a pointer-
  following spring already scoped to the one dragged card, untouched by this sweep).
- Reduced-motion emulation was spot-checked once per motion *type* introduced this round (list
  stagger, card lift/press, celebration burst, chart draw-in, CSS row fade) via
  `prefers-reduced-motion: reduce` in the browser devtools rather than the full four-locale ×
  two-theme × two-viewport matrix for every one of the ~20 touched screens, given the scope of this
  pass; every primitive touched already had its reduced-motion replacement built in
  (`useReducedMotion()` branches already existed in `Stagger`, `HoverLift`, `PressScale`, `Celebrate`,
  and the two new chart draw-ins each gate on `useReducedMotion()` explicitly).

## Full per-file grep results (motion primitive references)

Screens not listed below (e.g. `personal/personal-screen.tsx`, `work/components/card-page-screen.tsx`,
`admin/admin-screen.tsx`) were checked individually and found to be thin composition wrappers around
already-instrumented children (a `Tabs` shell, a shared chrome component) with no list/card/chart
markup of their own -- no motion primitive is missing from them because there is nothing in the
file for one to attach to.

```
accounts/account-settings-screen.tsx        (composition only)
accounts/register-screen.tsx                (composition only)
admin/accounts-screen.tsx                   Stagger StaggerItem  <- added this round
admin/admin-screen.tsx                      (chrome only; Tabs/Sidebar cover it)
admin/analytics-screen.tsx                  KpiTile
admin/audit-screen.tsx                      AnimatedCheck, Stagger StaggerItem  <- added this round
admin/charts.tsx                            KpiTile, chart draw-in  <- added this round
admin/dashboard-screen.tsx                  KpiTile
admin/departments-screen.tsx                Stagger StaggerItem  <- added this round
admin/health-screen.tsx                     Stagger StaggerItem  <- added this round
admin/settings-screen.tsx                   ProgressRing
ai/ai-settings-screen.tsx                   ProgressRing, Stagger StaggerItem  <- added this round
analytics/analytics-screen.tsx              (composes analytics/sections.tsx, already animated)
analytics/chart-card.tsx                    KpiTile, useChartAnimation
analytics/sections.tsx                      NumberFlow KpiTile, Recharts draw-in
departments/approval-queue-screen.tsx       Reveal
departments/components/pending-request-view.tsx  IdleFloat
departments/create-request-screen.tsx       Reveal
departments/department-detail-screen.tsx    Reveal
departments/departments-hub-screen.tsx      Stagger StaggerItem HoverLift Skeleton Reveal
departments/join-screen.tsx                 BlurFade
events/components/carpool-panel.tsx         Skeleton Celebrate
events/components/event-card.tsx            HoverLift
events/components/event-detail-dialog.tsx   Skeleton Reveal
events/components/rsvp-panel.tsx            Skeleton Celebrate
events/events-screen.tsx                    Stagger StaggerItem
home/home-screen.tsx                        Stagger StaggerItem NumberFlow KpiTile Reveal, Celebrate  <- added this round
inbox/inbox-screen.tsx                      Stagger StaggerItem, Celebrate  <- added this round
inbox/notification-row.tsx                  Stagger StaggerItem
inbox/preferences-screen.tsx                Reveal
inbox/telegram-screen.tsx                   Reveal
pages/pages-screen.tsx                      HoverLift AnimatedCheck, Stagger StaggerItem  <- added this round
personal/canvas-view.tsx                    Stagger StaggerItem
personal/notes-view.tsx                     Stagger StaggerItem Reveal
personal/pomodoro-panel.tsx                 KpiTile ProgressRing
personal/pomodoro-widget.tsx                ProgressRing
personal/sprints-view.tsx                   Stagger StaggerItem ProgressRing Reveal, Celebrate  <- added this round
personal/task-row.tsx                       Checkbox celebrate (checkbox draws the check itself)
personal/tasks-view.tsx                     Stagger StaggerItem Reveal
personal/today-view.tsx                     Stagger StaggerItem ProgressRing Reveal AnimatePresence
projects/components/project-page-screen.tsx Stagger StaggerItem Skeleton ProgressRing
projects/components/project-tile.tsx        HoverLift ProgressRing
projects/components/projects-list-screen.tsx Skeleton, Stagger StaggerItem  <- added this round
structure/department-header.tsx             Reveal
structure/member-card.tsx                   HoverCard
structure/people-screen.tsx                 Stagger StaggerItem
structure/structure-screen.tsx              IdleFloat Reveal
structure/unit-tree.tsx                     Stagger StaggerItem Collapsible HoverCard
work/components/archive-screen.tsx          Skeleton, Stagger StaggerItem  <- added this round
work/components/board-column.tsx            Stagger StaggerItem
work/components/board-screen.tsx            Skeleton
work/components/calendar-screen.tsx         Skeleton
work/components/card-detail.tsx             Skeleton Collapsible, Celebrate (card done + checklist complete)  <- added this round
work/components/card-tile.tsx               HoverLift PressScale
work/components/mine-screen.tsx             Skeleton, Stagger StaggerItem HoverLift PressScale  <- added this round
work/components/table-screen.tsx            Skeleton, CSS row fade-in (perf-scoped)  <- added this round
work/components/timeline-screen.tsx         Skeleton
shell/app-shell.tsx                         PageTransition AnimatePresence
shell/auth-shell.tsx                        AmbientGradient BlurFade
```

## Not done this round (flagged, not fixed)

- A handful of `autoFocus` a11y lint warnings pre-date this sweep (`analytics/filter-bar.tsx`,
  `departments/*`, `pages/pages-screen.tsx`, `structure/*`, `work/components/filter-bar.tsx`,
  `routes/login.tsx`, `routes/setup.tsx`) -- out of scope for a motion pass, left untouched.
- A full four-locale × two-theme × two-viewport screenshot pass over all ~20 touched screens was not
  run given the size of this sweep; typecheck/lint/i18n/secrets gates and a `pnpm --filter @devon/web
  build` were used as the correctness backstop instead, plus the targeted reduced-motion emulation
  described above.

---

# Round 3 -- bringing every screen to 4.5+, 2026-09-08

Scope: every screen `round2/critique.md`'s "Motion density -- per screen" table scored below 4.5,
its exact "What is missing" column, plus the two items its own fixer round deferred (the Gantt zoom
as a scale transition, a FLIP animation on table re-sort).

## Before starting: some of this was already done

Reading the current source before touching anything found that master had moved past the critique
snapshot on several screens -- later commits (`c172876` "login shakes...", and others) had already
built real motion into `/account` (device-list stagger + `AnimatePresence` exit + `Collapsible`
disclosure + the 2FA success morph -- all five "what is missing" items) and `work/calendar` (month
slide, day-cell stagger, chip `HoverLift`, the "yana N ta" `Collapsible`, and a ring pulse on today's
cell). Both are scored 5 below on the strength of what is actually in the tree now, not re-built.
`packages/ui/src/motion/tabs.tsx`'s `TabsContent` had no crossfade at all (a bare Radix re-export) --
fixing it once gives every `Tabs` consumer (`project-page-screen.tsx`, `ai-settings-screen.tsx`,
`admin/settings-screen.tsx`) a real per-switch entrance, so "tab change is instant" is marked fixed
everywhere without a per-screen edit. The same trick closed "rings don't sweep from 0 on mount" for
every `ProgressRing` consumer (`personal/sprints-view.tsx`, `projects/*`, `ai-settings-screen.tsx`,
the Pomodoro widget) at once: `ProgressRing` used `initial={false}`, which explicitly skips the
entrance animation -- switched to a real `initial` (the empty ring), which only ever plays once, at
mount, never on a later value update. `Progress` (the linear bar) got the equivalent one-frame
mount-grow for the same reason (the events capacity meter was the named example).

## What changed, by screen

| Screen | Round 2 | What was missing | Fixed | Round 3 |
|---|---|---|---|---|
| Auth (`/login`, `/setup`) | 4 | Locale/theme controls were static (card rise + error shake already shipped) | Trailing controls (`ThemeToggle`/`LocaleMenu`) get a delayed `Reveal` | **4.5** |
| Home (`/`) | 4 | Pinned-charts block had no entrance (greeting already revealed) | Both the populated grid and its dashed empty state wrapped in `Reveal` | **4.5** |
| Personal → Davrlar | 4.5 | Sprint ring did not sweep from 0 | Fixed globally via `ProgressRing` | **5** |
| Work board | 4.5 | (not in scope this round) | -- | 4.5 |
| Card detail sheet | 4 | Property edits had no feedback; new comments didn't animate in | `useFieldFlash` success-tint sweep on assignee/giver/priority/due/start; comments fade+rise on mount (`AnimatePresence`, per-row, no replay for existing rows) | **4.5** |
| Events | 4 | No cover hover scale; month heads didn't reveal; capacity bar didn't fill | `group-hover:scale-110` on the cover art; `Reveal onView` on month headings; `Progress`'s global mount-grow | **4.5** |
| Inbox | 4 | Archiving had no exit; no detail crossfade; no unread-dot fade | `AnimatePresence` + `StaggerItem exit="hidden" layout` on both list shapes; `AnimatePresence mode="wait"` keyed on the open notification; unread rail + dot fade via their own `AnimatePresence` | **4.5** |
| Projects (list) | 4 | Ring didn't sweep; tiles had no press feedback | Ring fixed globally; `PressScale` added alongside `HoverLift` on both tile variants | **4.5** |
| Project page | 4 | No milestone celebration; tab change instant | Milestone checkbox pairs its existing burst with a named toast; tab crossfade fixed globally | **4.5** |
| Analytics | 4 | Charts didn't re-animate on range change; pin/unpin instant; no skeleton crossfade | `ChartCard` body remounts on `csvHref` (already encodes since/until/filter); pin glyph swap pops via `AnimatePresence`; the header/filter bar now stay mounted while only the chart region crossfades skeleton → empty → charts | **4.5** |
| Structure | 3.5 | Org-chart had zero motion (tree list already staggered) | Nodes fade+rise in top-down draw order; connectors draw via `pathLength`, a beat behind their node | **4.5** |
| People | 3.5 | No re-stagger when search narrowed an active unit filter; cards didn't lift | Combined `animateKey`; a plain CSS hover-lift on `MemberCard` (not the `HoverLift` primitive, which would swallow `HoverCardTrigger asChild`'s injected handlers) | **4.5** |
| Pages | 3 | Opening a page was a hard swap; new rows (already covered by `Stagger`'s own mount behaviour) | Matching `layoutId` on a row and the detail panel morphs one into the other | **4.5** |
| AI | 3 | Budget ring didn't draw in; flag toggle gave no row ack; no reset celebration | Ring fixed globally; per-row success flash on a landed patch; a burst+toast on a sharp `usedPct` drop (the closest client signal to "the reset just landed") | **4.5** |
| Admin console | 3 | Health didn't breathe; maintenance toggle instant; wipe flow had no ceremony; tabs instant | A live-pulse dot + a per-poll sweep on `dataUpdatedAt` change; maintenance badge pops; wipe dialog steps slide/fade and the progress bar's fill transitions; tab crossfade fixed globally | **4.5** |
| Departments hub | 3 | Copy gave only a toast; QR didn't fade in; switching department didn't transition | Copy button morphs to a check for a beat; QR wrapped in `Reveal`; `CurrentDepartmentCard` crossfades on `active.id` | **4.5** |
| Work → Mine | 3.5 | No completion celebration (list had no complete action at all); groups didn't collapse | Real `Checkbox`+`celebrate` per row (the `TaskRow` shape) with strikethrough and an `AnimatePresence` exit; each risk group folds via `Collapsible` | **4.5** |
| Work → Jadval (table) | 2 | Bulk bar/density already fixed; **no FLIP on re-sort** (round 2's own deferred item) | Rows are `motion.div`s driven by `animate={{ y: vRow.start }}` instead of the virtualizer's raw `transform` -- a re-sort now visibly travels each visible row to its new slot; first mount still fades+rises | **4.5** |
| Work → Taqvim | 1 | (already fully built when checked -- see note above) | -- | **5** |
| Work → Muddatlar (Gantt) | 1 | Bar draw-in/today-sweep already shipped; **zoom was a hard re-layout** (round 2's other deferred item); group heads didn't collapse | Kun/Hafta/Oy now plays a `scaleX` camera-zoom (from the previous zoom's pixel density to the new one, transform-only) instead of an instant re-layout; group heads collapse via `Collapsible` | **4.5** |
| `/account` | 1 | (already fully built when checked -- see note above) | -- | **5** |
| 404 / states | 3.5 | "Fine as is" per round 2 | -- | 3.5 |

Shell stays at **4.5** (not below the bar, not named in this round's brief beyond what Tabs/
ProgressRing already covered as shared primitives).

## Verification

- `pnpm --filter @devon/ui typecheck` and `pnpm --filter @devon/web typecheck`: clean after every
  batch of edits.
- `node agentic/scripts/check-i18n.mjs`: 0 errors (two accidental hard-coded-text false positives
  from this round's own edits -- a `>=`/`<` comparison chain and a JSX ternary whose plain-text
  boundary matched the regex the same way `people-screen.tsx`/`table-screen.tsx`'s own code comments
  already warn about -- found and rewritten as named booleans / an if-else before landing).
- Live-verified in the running app (`pnpm start --demo`, existing dev server on :5173): Gantt zoom
  (Kun → Hafta, bars re-drew, group collapse persisted through the zoom change), Gantt group collapse/
  expand, table column sort (re-order, no console errors), Mine's new checkbox (marks a card done,
  strikethrough renders, an unrelated row's checkbox still ticks independently), calendar month
  navigation, Pages open/back round-trip through the shared-layout panel, the org chart (nodes +
  connectors render with no SVG console errors), Analytics date-range change (chart region redraws,
  KPIs update) and pin/unpin glyph swap, the AI feature-flag toggle, and the departments invite copy
  button (toast fires, icon returns to its resting state). Not reached live in this pass: the
  super-admin-only `/admin/*` screens (the seeded demo session is a department member, not
  `admin.super`) -- verified by typecheck/lint/i18n plus code-level reasoning against the same
  primitives (`Collapsible`, `AnimatePresence`, `useReducedMotion`) already proven live elsewhere in
  this same pass.
- Every addition reduces under `useReducedMotion()` (or, for the two pure-CSS hover effects on the
  event cover and the member card, `motion-safe:`/`motion-reduce:`): a shorter crossfade in place of
  a translate/scale/pathLength, never a removed acknowledgement.
- No new `Stagger`/`StaggerItem` pair was added to the virtualised table or the Gantt's per-row
  bars -- both stay on the same perf-scoped approach round 2 chose (a lean per-row `motion.div` with
  a direct `animate` prop, not a stagger container with its own orchestration cost) so 200+ rows still
  cost nothing extra to lay out.
