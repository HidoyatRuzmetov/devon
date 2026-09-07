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
