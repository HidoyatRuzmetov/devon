# Motion verdict — v1.1 `delight`, design lead

Judged against `DESIGN.md` §2.5 (motion tokens), §2.6 (ambient), §10 (the catalogue and its
reduced-motion contract), and read against `delight/motion-audit.md`. Everything below was **tried in
the running app** (dev server, `pnpm start --demo`) through the chrome-devtools MCP as
`demo.xodim` (xodim), `demo.boshliq` (boshliq) and `admin.super`, at 1440 and 390, in both themes,
with `prefers-reduced-motion` emulated (`matchMedia` override plus the exact
`@media (prefers-reduced-motion: reduce)` declarations from `tokens.css` injected as a stylesheet).
Measurements are frame intervals and `PerformanceObserver` `longtask` entries taken in the page, not
impressions.

Screenshots: `./shots/`.

---

## 1. The one-line answer

**The vocabulary is right and most of it is real; three of the product's most-repeated interactions
are not.** The refusal gesture, the celebration, the strikethrough, the ticking counts, the sidebar
pill, the flash-on-save and every reduced-motion replacement I could reach are genuinely there and
genuinely correct — I fired each one and watched it. But the command palette's gliding cursor does
not glide, the Pomodoro ring does not tick at all, and a removed row anywhere in the product
vanishes between two frames with no exit. On top of that, four repeated actions (palette open, inbox
tab, analytics range, table scroll) block the main thread for 0.3–0.9 s, which means the animation
that was designed for them cannot play even where it exists.

The motion audit's §3 tables are accurate about what was *written*. They are not accurate about four
rows of what **runs**. That gap is the substance of this verdict.

---

## 2. What I verified as working (so the fixes below are not read as a rejection)

| Interaction | How I checked it | Result |
|---|---|---|
| Rejected sign-in | wrong password at `/login` | `devon-shake` fires, 412 ms measured end-to-end; the error opens as an alert. `shots/01` |
| Rejected sign-in, reduced motion | `matchMedia` + CSS backstop | keyframe never applied; a `ring-2 ring-destructive` span is mounted instead. Replacement, not deletion — contract honoured |
| Sidebar active item | clicked `/personal`, sampled 20 frames | pill travels `translateY(-196px) → 0` over 13 frames on `spring.settle`. This is the reference mechanism, and it is correct |
| Personal task done | ticked a checkbox, MutationObserver | exactly **12** `size-1.5 rounded-full` particles; `text-decoration-color` transitions over 248 ms; undo toast slides up with the shrinking `origin-left bg-primary` bar |
| …the same, reduced motion | emulated | one `border-2 border-success` ring instead of the burst; strike arrives instantly (`transition-duration: 1e-05s`); toast still appears |
| Refused card move (board) | forced `403` on `PATCH /api/v1/cards/*` via an init script | `devon-shake` on the tile that came back **and** the toast "Koʻchirib boʻlmadi. Karta oldingi joyiga qaytarildi." — both, 1.1 s after the action (server round trip) |
| Refused inline property edit (card panel) | same, priority `Yuqori → Past` | toast "Saqlab boʻlmadi. Oldingi qiymat qaytarildi." at +800 ms, shake at +913 ms |
| Board column counts | 24 `number-flow-react` elements mounted on `/work` | ticking counts are real |
| RSVP yes | `/events`, submitted `Ha, boraman` | 12-particle burst + "Ishtirokingiz qayd etildi" undo toast |
| Theme toggle | wrapped `document.startViewTransition` | a real View Transition is started, not a class swap |
| Ambient gradient | Home and `/login` | two washes, `devon-ambient-drift` at 24 s and `calc(24s × 1.5)` reversed — both derived from `--dur-ambient`, not hardcoded. **Absent on `/work`, `/inbox`, `/analytics`** as §2.6 requires. Under reduced motion the drift class is never applied, so the gradient is static |
| Goals | `/goals` as boshliq | three progress bars; the one already at 100 % does **not** burst on mount |
| 390 px, dark | `/inbox` | bottom tab bar with its shared-layout pill, ticking bell badge, grouped rows. `shots/12` |

---

## 3. Findings

### F1 — The command palette cursor does not glide (SEV: high)

`DESIGN.md` §10: *"Command palette | Scale-in, row highlight…"*; the audit claims the highlight is now
"one pill [that] glides between rows on a shared `layoutId`, the same device the sidebar and the tab
strip use."

It does not move. Measured, twice, in both themes, with a real `ArrowDown` and with a dispatched one:

```
mountedPills: 66   totalItems: 66
before: { idx: 1, top: 243, transform: "none" }
frames: idx 2, top 287, transform "none"  × 10 consecutive frames
```

The pill jumps 44 px between frames with `transform: none` throughout. Compare the sidebar, which
over the same sampling window reports `matrix(1,0,0,1,0,-196) … -104 … -25 … -0.05 … none`.

**Cause** (`packages/ui/src/shell/command-palette.tsx` ~L196–207): the pill is rendered inside every
row, hidden by CSS —

```tsx
<span className="absolute inset-0 -z-10 hidden rounded-sm group-data-[selected=true]:block">
  <motion.span layoutId={`${cursorId}-cursor`} … />
</span>
```

`display:none` is not unmounting. All 66 `motion.span`s with the same `layoutId` are mounted at once,
so shared-layout has no unmount→mount pair to FLIP between and silently degrades to nothing. The
component that makes the sidebar work is doing the opposite of what makes the sidebar work.

**Fix.** Render exactly one. Read cmdk's selected value (`useCommandState((s) => s.value)`) in the
row, and mount the `motion.span` only in the row whose `value` matches; leave the others with no pill
node at all. One mounted `layoutId` at a time is the precondition shared layout has always had.

---

### F2 — Opening the command palette blocks the main thread for 0.35–0.63 s (SEV: high)

`DESIGN.md` §2.5 names this interaction by name: *"Repeated actions (palette open, row select) animate
at `--dur-micro` or not at all."* `--dur-micro` is 140 ms. Measured `longtask` durations, warm, three
consecutive opens on `/inbox` as xodim:

| Open | Close |
|---|---|
| 420 ms | 250 ms |
| 352 ms | 258 ms |
| 393 ms | 245 ms |

First open in a session: 594 ms + 122 ms. On the super-admin shell, where the palette has only 37
rows rather than 66, it is still **310 ms**. Under reduced motion (66 rows, plain spans instead of
`motion.span`) it is 175–353 ms — so the `motion.span`s are part of the cost but not all of it.

The `Dialog` scale-in is 220 ms. It cannot play: the frame it would start on has not been rendered
yet. `Ctrl/⌘+K` is the shortcut the product promises *reaches everything*; it currently answers a
keypress with a quarter-second of nothing.

**Fix.** Two changes, both cheap: (a) F1's fix removes 65 `motion` projection nodes per open; (b) build
the palette's group/item list once with `React.useMemo` keyed on `[can, locale, recents]` instead of
per render, and mount `Command.List` children only while the dialog is open (`<Dialog>` currently
keeps the tree warm). Target: one long task under 150 ms, measured the same way.

---

### F3 — The Pomodoro ring and the countdown never move (SEV: high)

`DESIGN.md` §10: *"Pomodoro | Animated ring stroke, phase colour crossfade | 1 s per tick."* The audit
says `sweep="tick"` replaced the old 220 ms-then-780 ms-of-nothing lurch with "a second hand".

There is no second hand. I started a focus phase and sampled for ~20 s:

```
clock text:            "24:37"  (unchanged across 3 separate sampling runs, > 20 s apart)
stroke-dashoffset:     649.4069740600047  (unchanged, 160 samples)
aria-valuenow:         2 → 2
Date.now()-derived remaining at the last sample: 1352 s = 22:32
```

The display is two minutes behind the clock it is displaying. The arc never advanced once.

**Cause** (`apps/web/src/features/personal/pomodoro-engine.ts`): the 250 ms interval calls `notify()`
without ever changing `state`, and `usePomodoroState()` is
`useSyncExternalStore(subscribePomodoro, getPomodoroState, …)`. `getPomodoroState()` returns the same
object reference every tick, so React compares with `Object.is`, finds no change and bails out. The
panel only re-renders when `setState` is called — i.e. on start, pause and phase change. The ring is
not lurching; it is frozen for the whole 25 minutes, and so is the number in the middle, which
§10's reduced-motion note calls "the feedback that survives".

**Fix.** Give the countdown its own snapshot that actually changes:

```ts
export function usePomodoroRemainingSec(): number {
  return React.useSyncExternalStore(subscribePomodoro, () => Math.ceil(remainingMs() / 1000), () => 0)
}
```

and have `pomodoro-panel.tsx` / `pomodoro-widget.tsx` derive `displayMs` and `ringValue` from it
(seconds, so the store notifies 4×/s but React re-renders 1×/s — which is exactly the tick
`sweep="tick"` was written for).

---

### F4 — A removed row never animates out, in twelve places (SEV: high)

Measured on `/inbox`, archiving one notification, counting every row's opacity each frame:

```
frame 0: 30 rows, min opacity 100
frame 1: 29 rows, min opacity 100     ← gone, in one frame
frames 2-15: 29 rows, min opacity 100
```

No row ever holds a fractional opacity; nothing translates; the remaining rows do not slide up. Same
on Home's `Diqqat markazi` list (3 → 2 rows in four frames, no exit). The only feedback a removal has
is the undo toast.

**Cause.** `AnimatePresence` animates the exit of its **direct children**. Every one of these call
sites puts it one level too high:

```tsx
<AnimatePresence initial={false}>
  <Stagger as="ul" …>
    {rows.map(n => <StaggerItem key={n.id} as="li" exit="hidden" layout>…</StaggerItem>)}
  </Stagger>
</AnimatePresence>
```

`AnimatePresence`'s only child is the `motion.ul` that `Stagger` renders, and that never unmounts.
The `StaggerItem`s are grandchildren, so their `exit="hidden"` and `layout` are inert — exactly the
condition `StaggerItem`'s own doc comment warns about ("when the immediate parent is wrapped in
framer-motion's own `AnimatePresence`").

Affected call sites, all with the same shape:
`inbox/inbox-screen.tsx` (×2), `home`'s `work/components/focus-list.tsx`, `work/components/mine-screen.tsx`,
`work/components/reminders-panel.tsx`, `work/components/time-log-panel.tsx`,
`work/components/dependencies-panel.tsx`, `work/components/templates-screen.tsx`,
`work/components/goals-screen.tsx`, `automations/components/automations-screen.tsx`,
`accounts/account-settings-screen.tsx` (×2).

**Fix — one change, in the primitive.** Add an opt-in to `packages/ui/src/motion/stagger.tsx` so the
presence boundary lives *inside* the list container:

```tsx
export function Stagger({ presence = false, … }) {
  …
  <Comp key={animateKey} variants={…} initial="hidden" animate="shown">
    {presence ? <AnimatePresence initial={false} mode="popLayout">{children}</AnimatePresence> : children}
  </Comp>
}
```

then pass `presence` at the twelve sites and delete the outer `<AnimatePresence>` wrappers. `popLayout`
is what makes the survivors slide up to close the gap.

---

### F5 — Switching an inbox tab freezes the UI for ~0.74 s (SEV: high)

```
baseline two-frame round trip on this page: 5, 9, 9 ms
after one tab click:  longtask 499 ms, then longtask 238 ms
four consecutive clicks, time to the 2nd painted frame: 527 / 508 / 526 / 511 ms
under reduced motion:  longtask 728 ms + 89 ms
```

The tab **is** the correct `animateKey` for a re-stagger (the audit's judgement there is right — a
different tab is a different list). But the re-stagger starts after half a second of nothing, which
reads as a stuck click, not as a filter change. Reduced motion makes it worse, not better, which
rules the motion out as the cause: the cost is re-rendering ~30 notification rows and remounting the
re-keyed `Stagger` container with them.

**Fix.** `React.memo` `NotificationRow` on `(id, readAt, archivedAt)`, and keep the three tab lists
mounted (`hidden` on the inactive ones) so a tab switch is a visibility change plus one stagger
rather than a full unmount/remount of 30 rows. Re-measure: the click-to-second-frame number must sit
under 100 ms.

---

### F6 — The table view scrolls at about 10 fps (SEV: high)

`/work/table`, 26 virtualised rows mounted, programmatic wheel of 60 px per frame, 70 frames:

```
median frame 98.4 ms   p95 423 ms   over 16.7 ms: 69 / 70
```

The audit measured this (91.7 ms median), attributed it correctly to TanStack Virtual's per-scroll
state update rather than to motion, and moved it out of scope. I am scoring what the person using the
product feels, and a list that stutters at ten frames a second while they drag the scrollbar is the
loudest "motion" on the screen. It stays open.

**Fix.** `React.memo` the virtualised row and give the virtualiser stable inputs
(`useCallback`'d `estimateSize`, `getItemKey` by row id), so a scroll re-renders the two rows entering
and leaving the window rather than all ~25; drop the per-row `motion.div` for a plain `div` with an
inline `translate3d` (the audit's own experiment showed this is within 4 %, so it is free to keep and
cheap to remove). Target: median under 16.7 ms at 540 rows.

---

### F7 — Changing the analytics range blocks for 0.84 s (SEV: medium)

`/analytics`, `Oxirgi 7 kun → Oxirgi 90 kun`: `longtask 838 ms`, then 73 ms. 10 `number-flow-react`
counters and 14 Recharts surfaces all re-render synchronously. The catalogue's two animations for this
moment — the skeleton→chart crossfade and the chart draw-in replayed on a range key — cannot be seen,
because nothing paints until they are already at their end state.

**Fix.** Wrap the range change in `React.startTransition` and render the chart grid behind
`<Suspense>` with `RouteSkeleton`, so the skeleton actually gets a frame; memoise each chart's
`data`/`series` on the query result so a range change re-renders 14 charts once, not once per KPI
state settle.

---

### F8 — A refused board move still announces success to a screen reader (SEV: medium)

Same forced-403 run as F1's verification. The visual half is right (shake + error toast); the
`aria-live` half is not:

```
status region: "\"Moslashuv tartibi loyihasini yozish\" Anvar Aliyev ustuniga koʻchirildi"
toast:         "Koʻchirib boʻlmadi. Karta oldingi joyiga qaytarildi."
```

`board-screen.tsx` L253 calls `announce(t('work.board.moved', …))` unconditionally, right after
`moveCard.mutate(...)`, so the optimistic announcement is never retracted. A person who cannot see the
shake is told the move worked.

**Fix.** Announce optimistically as now, and in the existing `onError` callback (which already sets
`rejectedCardId` and toasts) add
`announce(t('work.board.moveFailed'))` — the key exists in all four locales
(`packages/i18n/messages/modules/work/*.json`, `work.board.moveFailed`).

---

### F9 — The board's horizontal scroll misses two frames in three (SEV: medium)

`/work` as xodim, 39 tiles mounted over 16 columns (demo scale, not the audit's 540-tile stress):

```
median frame 29.2 ms   p95 37.3 ms   over 16.7 ms: 46 / 70
```

The audit's isolation runs already proved this is rasterising newly revealed columns, not animation,
and that no motion change moves it. Agreed on cause; still a judder on the product's centrepiece at
ordinary size, so it is recorded rather than waived.

**Fix.** Window the columns — render only the columns intersecting the scroll port plus one either
side (an `IntersectionObserver` per column header is enough; the columns are fixed-width, so no
measurement pass is needed). Structural, so it is a backlog item, not a motion-pass edit.

---

### F10 — Under reduced motion the button's loading spinner freezes (SEV: low)

`/login` with reduced motion emulated: submitting starts `animation-name: spin`, and the global
backstop in `tokens.css` sets `animation-duration: 0.01ms; animation-iteration-count: 1` on `*`, so
the spinner lands on one static frame for the whole request. §10's contract is explicit —
*"Nothing becomes silent"* — and a frozen spinner is a button that looks broken rather than busy.

**Fix.** In `Button`, when `useReducedMotion()` is true, replace the spinning glyph with a
non-transform busy signal: the label crossfades to the loading label and the button carries a
2 s `opacity: 1 → .72 → 1` pulse (opacity is not a transform, and the backstop's
`animation-iteration-count: 1` must be overridden for this one class the way `devon-shake` already
sidesteps the backstop by not relying on it).

---

### F11 — The admin console's KPI tiles are the only counters that do not tick (SEV: low)

`/admin` as `admin.super`: `document.querySelectorAll('number-flow-react').length === 0`, while
`/analytics` has 10 and `/work` has 24. "FOYDALANUVCHILAR SONI 62" is plain text. §10 lists
*"Counters, KPI tiles | NumberFlow ticker"* without an exemption, and the number does change (a
department approval moves it) — just not while anyone is looking, which is precisely the argument the
audit itself used to add the burst to `Goal reached`.

**Fix.** Render the three overview tiles through the shared `KpiTile` (or at least `CountFlow` with
`locale`), so the count rolls when the poll or an approval changes it, and `animated={false}` under
reduced motion comes for free.

---

## 4. Scores

"Every little interaction answers what just happened, and the done moments feel earned." 0–5.

| Screen / surface | Score | What holds it back |
|---|---|---|
| Auth — `/login`, `/register`, `/join` | 4.6 | F10 |
| Shell — sidebar, top bar, 390 tab bar, theme, routes | 4.7 | — |
| Command palette (`Ctrl/⌘+K`) | 2.0 | F1, F2 |
| People board `/work` | 4.0 | F8, F9 |
| Card detail panel | 4.6 | — |
| Personal — Bugun / Vazifalar | 4.7 | F4 (nested-task removal) |
| Personal — Pomodoro | 1.5 | F3 |
| Inbox `/inbox` | 2.5 | F4, F5 |
| Home / hub `/` | 3.8 | F4 (focus list) |
| Events `/events` | 4.6 | — |
| Goals `/goals` | 4.6 | F4 (goals list) |
| Projects `/projects` | 4.5 | F4 |
| Work table `/work/table` | 1.5 | F6 |
| Analytics `/analytics` | 3.0 | F7 |
| Admin console `/admin` | 4.2 | F2, F11 |
| Lists with removable rows (reminders, time log, dependencies, templates, automations, sessions) | 2.5 | F4 |

Nine of sixteen surfaces are under 4.5.

---

## 5. What I could not settle

- **`LivePulse` with a real second session.** I opened the same card as `demo.boshliq` and
  `demo.xodim` at once and typed into the description on one side; no editing indicator, no presence
  avatar and no infinite-iteration animation appeared on the other, and the board's "Jonli" pill was
  absent on the second load. That is a realtime-delivery question, not a motion one, so it is not
  scored — but the primitive's only claimed consumer could not be observed firing, and somebody
  should reproduce it with the broker confirmed connected before the catalogue row is called done.
- **A DevTools `.trace`.** Same host limitation the audit hit. The `longtask` and frame-interval
  numbers above are taken in-page and are reproducible by pasting the same scripts into the console.

## 6. Evidence

`shots/01-login-rejected-1440-light.png` · `02-palette-cursor-member-1440-light.png` ·
`03-personal-task-done-member-1440-light.png` · `04-pomodoro-running-member-1440-light.png` ·
`05-board-member-1440-light.png` · `06-personal-reduced-motion-ring-1440-light.png` ·
`07-inbox-archive-empty-member-1440-light.png` · `08-event-rsvp-member-1440-light.png` (dark) ·
`09-work-table-member-1440-dark.png` · `10-home-head-1440-light.png` · `11-goals-head-1440-light.png` ·
`12-inbox-member-390-dark.png` · `13-admin-super-1440-light.png` ·
`14-analytics-member-1440-dark.png` · `15-palette-member-1440-dark.png`
