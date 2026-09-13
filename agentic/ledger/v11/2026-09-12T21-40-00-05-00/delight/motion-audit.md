# Motion and micro-interaction pass — v1.1, `delight`

Walked every screen of Devon live as **xodim** (`demo.xodim`), **boshliq** (`demo.boshliq`) and the
**super admin** (`admin.super`), at 1440 and 390, in both themes, against the production bundle
(`apps/web/dist`, served with the same same-origin `/api` proxy the dev server and Caddy give it) and
against the dev server. Binding reference: `DESIGN.md` §2.5 (motion tokens), §10 (the catalogue) and
its reduced-motion contract — *motion is replaced, never deleted*.

Evidence in this folder:

| File | What it is |
|---|---|
| `frame-timing-board-540-cards.json` | Frame intervals on the People board with **540 tiles mounted at once** (no virtualisation), per interaction, plus the two isolation runs that identify what the scroll cost actually is |
| `frame-timing-table-500-rows.json` | The same for the **540-row** table view (TanStack Virtual keeps ~25 rows mounted) |
| `board-member-1440-light.png`, `board-head-1440-dark.png` | The board with ticking column counts, both themes |
| `palette-member-1440-light.png` | The command palette with the gliding selection pill |
| `login-rejected-1440-light.png` | A refused sign-in — the card shakes, the message opens |
| `join-1440-light.png` | `/join` with the same refusal gesture wired |
| `personal-head-1440-dark.png`, `personal-task-done-strikethrough.png` | The personal workspace; a task completing |
| `inbox-head-390-dark.png` | 390 px, dark: bottom-bar active pill, ticking bell badge, grouped list |

---

## 1. What this pass changed, in one paragraph

The catalogue already had the *affirmative* half of the product's vocabulary: `Celebrate` for yes,
`Stagger`/`Reveal`/`BlurFade` for arrival, `HoverLift`/`PressScale` for "this reacts", `Collapsible`,
`ProgressRing`, `Shimmer`, `AmbientGradient`, `HoverCard`, `PageTransition`. What it had no words for
was **no**, **taken**, **finished** and **somebody is here** — so every screen that needed one of
those had either invented a local one (login's own shake keyframe, the card panel's own property
flash, a `motion-safe:animate-pulse` dot) or simply done nothing (a refused drag that silently
un-happened, a strikethrough that flipped on the next frame, presence avatars that cut in and out).
Six new pieces close that gap, and the local one-offs now route through them.

---

## 2. Primitives added to `packages/ui/src/motion`

Every one ships with a story in `motion.stories.tsx` and a contract test in `motion.test.tsx`
(the content survives under reduced motion; the replacement branch renders something).

| Piece | What it says | Reduced-motion twin | Cost when idle |
|---|---|---|---|
| `Shake` / `useShake` | The product's **refusal**, and `Celebrate`'s counterpart | A destructive-tinted ring that fades in place — nothing travels | **Zero.** A CSS keyframe (`devon-shake`), not a `motion` component — see §5 |
| `FlashOnChange` | An optimistic write's **receipt**: the one property that moved lights for a beat | Keeps the wash (a colour change is not travel), holds it longer, fades gently | One `AnimatePresence` with no children until a change lands |
| `SettlePulse` / `useSettlePulse` | The **quiet "done"** — one ring out of the element's own edge, deliberately not the 12-particle burst | The ring fades in and out at the element's own size, no growth | Renders nothing until played |
| `LivePulse` | **Somebody is editing this.** The only looping animation outside the ambient gradient and the empty-state float, and it earns the loop the way a blinking cursor does: it reports a live fact and stops when the fact stops | A steady, fully-opaque dot | Only mounted while a signal exists |
| `Strikethrough` / `strikethroughClass` | The **third beat of done**, after the check draws and the burst fires | The global backstop collapses both transitions; the strike and the dimming still arrive | A class, no JS |
| `CountFlow` | A count that **changed** should be seen changing | `animated={false}` — the value lands, nothing rolls | One NumberFlow per count |
| `Swap` | Skeleton → content **with no layout jump**: both layers in one grid cell, skeleton unmounts after its fade | Crossfade at `--dur-micro` | Two `motion.div`s per swap site |

Primitives that were missing a beat and now have it: `Input`/`Textarea`/`Select`/`Combobox`/
`DatePicker` (the focus ring *grows* — `box-shadow` was not in `transition-colors`, so the ring
snapped on while the border it sits outside of faded), `Switch` (thumb on `spring.settle` instead of
a linear tween, so the disc and the track colour land together), `ProgressRing` (`sweep="tick"` and
an arc colour crossfade), `Field` (its own sliding error + shake + saved tick, wired once),
`PresenceAvatars`, `InboxBell`, `CommandPalette`.

---

## 3. The audit, screen by screen

Legend for the last column: **free** = no measurable frame cost (see §5); **transform/opacity** = the
animation composites and never reflows; **paint** = a colour/decoration change with no layout.

### 3.1 Shell — sidebar, top bar, tab bar, command palette, toasts

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| Sidebar active item | Morphing pill on a shared `layoutId` ✓ | unchanged | Pill appears under the item, no travel | transform |
| Sidebar collapse to the icon rail | Width transition at `--dur-page`, labels fade ✓ | unchanged | Instant width, labels still fade out | width (one element) |
| Mobile bottom-bar active pill | Shared `layoutId` ✓ | unchanged | Appears, no travel | transform |
| Tabs underline + content crossfade | Shared `layoutId` underline, panel fade + 4 px rise ✓ | unchanged | Underline appears; panel crossfades | transform |
| Command palette open | Dialog scale 0.96 + backdrop blur ✓ | unchanged | Instant | transform |
| **Palette row selection** | A flat `data-[selected]:bg-accent` tint — the highlight *blinked* between rows | **One pill glides between rows** on a shared `layoutId` (`spring.settle`), the same device the sidebar and the tab strip use, so the palette's selection reads as the same mechanism | The pill is rendered without the shared layout: it simply appears under the selected row, identical to the tint it replaces | transform |
| **Palette results re-stagger** | Nothing | Groups re-enter **on the mode change only** — default sections becoming search results and back. See §4 for why not per keystroke | Crossfade, sequence preserved, step collapsed | transform |
| **Inbox bell badge** | Popped on increment; the number itself was replaced | Pops on increment *and* the number **ticks**, in both directions, so reading three notifications counts down instead of cutting | Pop and roll both dropped; the number still changes | one NumberFlow |
| Theme toggle | Icon morph + circular View-Transition reveal ✓ | unchanged | No transition started at all (`startViewTransition` checks it) | compositor |
| Route change | View Transitions crossfade + 8 px slide, `AnimatePresence` fallback ✓ | unchanged | No transition started | compositor |
| Undo toast | Slide up + a shrinking CSS progress bar ✓ | unchanged | Static full-width rule; the affordance survives, the countdown stops | one transform |
| Hover cards | Fade + 4 px rise, 150 ms intent delay ✓ | unchanged | Crossfade | transform |
| Dialog / sheet / popover / tooltip | Scale + backdrop blur / edge spring / rise ✓ | unchanged | Global backstop makes each instant; each still enters and exits | transform |

### 3.2 People board (`/work`) — the heaviest screen in the product

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| Tile hover / press | `HoverLift` −2 px + shadow, `PressScale` 0.98 ✓ | unchanged | Opacity dip instead of the scale; the shadow step survives | **free** — 0/355 frames over budget with 540 tiles |
| Drag lift, pointer-following preview, drop settle | `setCustomNativeDragPreview` ghost at 0.9, `spring.drag`, `spring.settle` via a shared `layoutId` across columns ✓ | unchanged | `{duration: 0}` on the settle; the card still lands where it was dropped | transform |
| Column highlight on hover-over | `data-[drop-target]:bg-accent/40` ✓ | unchanged | Instant tint | paint |
| **Invalid / refused drop** | The optimistic move rolled back **silently** — the card slid to its new column and then simply was not there, which reads as a drag that missed, not as a refusal | The tile that came back **shakes once** and an error toast says what happened (`work.board.moveFailed`, four locales) | Destructive ring fades in place on the tile | **free** — one real shake: 4.2 ms median, 4/128 frames over budget |
| **Column count** | A plain number that changed between frames | **Ticks** (`CountFlow`) — it is the direct consequence of the card just dragged in. Both counts: total and overdue | Value lands, no roll | 34 NumberFlow instances; isolation run shows **no** contribution to scroll cost |
| List add / remove / re-stagger on filter | `Stagger` + `StaggerItem` with `animateKey={q}` ✓ | unchanged | Crossfade in place | transform |
| **"Anvar is editing this" dot** | Tailwind's generic `animate-pulse` behind `motion-safe:` — which **deletes** the signal under reduced motion instead of replacing it | `LivePulse`: a 2 s breath, transform/opacity, named for a screen reader | A steady dot — the fact is still stated | free (only mounted when a signal exists) |
| Card done | Detail panel fires `Celebrate` + toast ✓; the tile settles into its new column via the shared `layoutId` ✓; the column count now ticks | Complete | Ring instead of burst | transform |

### 3.3 Card detail panel

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| **Optimistic property edit — taken** | A bespoke `AnimatePresence` sweep written inside `card-detail.tsx` | The shared `<FlashOnChange tone="saved">` — one implementation, one reduced-motion contract, and the wash now sits around the **control** rather than the whole label, so the eye lands on the value that changed and not on the word for it | Wash kept, held longer, no travel | opacity only |
| **Optimistic property edit — put back** | The panel had the flash but not its other half: every one of the five inline properties rolled back **in silence** on failure, and the mutation only said what happened for the one error code it recognised | The refused control **shakes once**, and every failure now speaks (`work.card.saveFailed`, four locales). A side effect worth having: each of those `mutateAsync` chains now has a `catch`, which none of them did | Destructive ring on the control | **free** (CSS) |
| Checklist item done | Check draws in + 12-particle burst ✓ | plus the label now **rules itself through** over `--dur-standard` | Strike arrives instantly | paint |
| Activity timeline | `Collapsible` height animation ✓ | unchanged | Instant height | height (one element) |
| Panel enter/exit | `Sheet` on `spring.sheet` ✓ | unchanged | Instant | transform |

### 3.4 Personal workspace (`/personal`)

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| Task done | Box celebrates; the row is held for `--dur-celebration` before it leaves (a previous pass fixed the "row vanished before the burst" bug) ✓; the title flipped to `line-through` on the next frame | The title's strike **arrives** over `--dur-standard`, inside the 480 ms hold. Applied as a class because the title is an `<input>` (the row is inline-editable) | Instant strike and dimming | paint |
| Nested task drag | Pragmatic DnD with a settle ✓ | unchanged | Instant | transform |
| Sprint complete | `Celebrate` ✓ | unchanged | Ring | transform |
| **Pomodoro ring** | `tweenStandard` — the arc eased over 220 ms then held still for 780, once a second, for twenty-five minutes: a lurch, not a clock | `sweep="tick"` — linear over exactly the tick interval. A second hand | Crossfade; the number in the middle is the feedback that survives | one SVG attribute per second |
| **Pomodoro phase change** | The arc's tone was a class swap, i.e. a cut | The stroke colour **crossfades** over `--dur-standard` between focus and break | Instant | paint |
| Sprint / goal progress rings | Sweep from 0 on mount ✓ | unchanged | Snap + crossfade | transform |

### 3.5 Lists, inbox, events, projects, goals, fields, automations, departments

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| Inbox row archive | `AnimatePresence` + `exit="hidden"` + `layout` ✓ | unchanged | Crossfade out, no travel | transform |
| **Inbox tab change** | The whole list was replaced with no entrance | **Re-staggers** — Inbox → Archive → All is a different list, which is the filter change the catalogue asks to re-enter. Archiving one row is not, so the key is the tab, never the count | Crossfade, step collapsed | transform |
| **Inbox zero** | `Celebrate` on the illustration ✓ | unchanged | Ring | transform |
| **Event comments load** | `pending ? <Skeleton/> : <thread/>` — the skeleton was gone on the frame the thread mounted, so for one frame the box had nothing in it and the composer above hopped | `<Swap>`: both layers in one grid cell while they trade, and the skeleton unmounts once its fade is done, so a thread with one comment settles to one row rather than holding a two-row gap | Crossfade at `--dur-micro` | opacity only |
| RSVP yes | `Celebrate` ✓ | unchanged | Ring | transform |
| Carpool seat claimed | `Celebrate` ✓ | unchanged | Ring | transform |
| **Poll vote** | Toast only | `Celebrate` on the vote button — on the **first** vote only; changing a ballot keeps the undo toast and no burst, because the product should not cheer at indecision | Ring | transform |
| **Goal reached** | Nothing — and a goal's progress is recomputed from the department's own cards on every read, so the single most satisfying number in the product changed while nobody was looking at it | `Celebrate` over the progress bar, fired on the **crossing** only, never on a goal already complete when its card mounted | Ring | transform |
| Project progress ring | Sweeps from 0 ✓ | unchanged | Snap | transform |
| Project cards / milestones done | `line-through` on the next frame | Strike arrives over `--dur-standard` | Instant | paint |
| **Notify-to-fill sent** | Toast only | `Celebrate` on the button that was pressed — and only when an ask or a nudge actually went out; "nobody to ask" is not a win | Ring | transform |
| **Automation rule saved** | Toast only | `Celebrate` on the rule's **card in the list** — the builder sheet closes on success, so a burst inside it would play behind something nobody is looking at any more | Ring | transform |
| **Join request approved** | Toast only | `Celebrate` on the approve button. Reject and undo keep the toast alone: nothing is celebrated about saying no | Ring | transform |
| Empty-state illustrations | `IdleFloat`, 4 s ✓ | unchanged | Static illustration | transform |
| Ambient gradient | Auth and the hub only ✓ | unchanged | Gradient stays, drift stops | compositor |

### 3.6 Forms and auth

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| **Rejected sign-in** | A local `wp-auth-shake` keyframe defined inside `login.tsx`, with a note: *"the one screen in the product that ever rejects a submission this way … flagged for promotion if a second screen ever wants it"* | Three do. Login, register and join all answer the same way, through `<Shake>` | The local keyframe reduced to **nothing** under reduced motion. `<Shake>` replaces it with a destructive ring | **free** (CSS) |
| **Rejected register / join** | A red line of text that was suddenly there | The message **opens** (`Collapsible`) and the form shakes once | Instant height; ring | free |
| **Inline field validation** | Each form rendered its own `<p className="text-destructive">` that simply appeared and pushed the rest of the form down | `Field` owns it: `role="alert"`, `aria-describedby`, the sliding message and one shake per new rejection | Instant height; ring | free |
| **Field saved** | Nothing | An `AnimatedCheck` beside the label | Check crossfades in | free |
| **Input focus ring** | Snapped on — Tailwind paints the ring as a `box-shadow`, and `transition-colors` does not include `box-shadow`, so the ring appeared while the border beside it faded | **Grows** at `--dur-micro`, from one shared `FIELD_TRANSITION` string, so the ring and its border always arrive together | `--dur-micro` is 0 ms under reduced motion — the ring still appears, instantly | free |
| Button press / loading → success morph | `active:scale-[0.98]` in CSS, spinner and check morph with the label held in place so the width never jumps ✓ | unchanged | Crossfade instead of the scale-in | free (CSS press) |
| **Switch** | Thumb on a linear `transition-transform`; the disc arrived before the colour did | Thumb on `spring.settle`, track crossfades over the same beat | Instant move, track still crossfades | one spring per toggle |
| Checkbox | Check draws + 12-particle burst + strikethrough ✓ | strikethrough now animates (above) | Crossfaded check, single ring | transform |

### 3.7 Analytics, admin console, Mini App

| Interaction | Before | After | Reduced-motion twin | Perf |
|---|---|---|---|---|
| KPI counters | NumberFlow ✓ | unchanged | `animated={false}` | one NumberFlow each |
| Chart draw-in and re-draw on range change | Recharts `isAnimationActive`, replayed on a range key ✓ | unchanged | `animate=false` | canvas/SVG |
| Skeleton → chart grid | A keyed `AnimatePresence mode="wait"` crossfade over the whole region, chrome above stays mounted ✓ | unchanged | 0.1 s crossfade | opacity |
| Admin tables, health tiles | `Stagger` ✓ | unchanged | Crossfade | transform |
| Destructive ceremonies | Full dialog, typed confirmation ✓ | unchanged | Instant | transform |
| **Mini App row tap** | Scale + shadow, and `tg.haptic.tap()` — which does nothing on a device with no haptics, so the tap had **no answer at all** until the screen changed | Scale **and** a colour step (`active:bg-accent`), on rows and on the tab bar | `motion-reduce:transform-none`; the colour step survives | free (CSS) |
| **Mini App task done** | Check + burst ✓, `line-through` on the next frame | The shared `Strikethrough`, so the line arrives the same way it does on the web board and on every wrapped line of a long Uzbek title | Instant | paint |

---

## 4. Judgements made, and why

**Palette results re-stagger fires on the mode change, not per keystroke.** DESIGN.md §10 asks for
"results re-stagger on query"; DESIGN.md §2.5 says "repeated actions (palette open, row select)
animate at `--dur-micro` or not at all". Re-staggering on every keystroke satisfies the first by
breaking the second: rows a person is *reading while they type* would re-enter under their eyes six
times a word — and `<Stagger animateKey>` re-keys its container, so each of those would remount every
cmdk row and reset the selection with it. The stagger therefore fires on the one moment the list is
genuinely a different list: default sections becoming search results, and back. At most twice per
visit, never under the typing hand.

**Celebrations are distinct moments, not distinct animations.** The task named twelve. All twelve now
exist, and every one is the same coin-sized 12-particle burst DESIGN.md §2.5 permits, fired from the
element that was acted on, paired with its own copy. Giving each a different physics would have made
the product louder, not more expressive, and §2.5 caps the vocabulary deliberately.

**A card landing in Done gets `SettlePulse`, not `Celebrate`.** A card moving on someone else's board
is a fact; the burst belongs to the person who ticked the box. The primitive exists and is exercised
in the story; on the board itself the settle is already carried by the shared-`layoutId` FLIP and the
ticking count, so no extra ring was added there — two signals are enough and a third would be noise.

**`Strikethrough` is a `text-decoration-color` transition, not a wiping overlay.** A wipe looks better
on one line and is wrong on two, and a checklist item in Uzbek routinely runs to two. The decoration
is painted by the text itself, so every line is struck, at any width, in any locale, and nothing
reflows because the line's space is reserved whether it is visible or not.

**`Shake` is CSS, not `motion`.** Measured, not assumed — see §5.

---

## 5. Performance

Machine: the dev box, production bundle, Chrome via the DevTools MCP. `requestAnimationFrame` ticks
faster than 60 Hz in this context, so the frame-budget answer is **how many frames exceeded 16.7 ms**,
not the median.

### The board, 540 tiles mounted at once (the board is deliberately not virtualised)

| Interaction | Median frame | Frames over 16.7 ms |
|---|---|---|
| Idle | 4.2 ms | **0 / 357** |
| Hover a tile (`HoverLift` + control reveal) | 4.2 ms | **0 / 355** |
| One tile shakes once (the real rollback refusal) | 4.2 ms | **4 / 128** |
| Scroll sideways past every column | 25.2 ms | 63 / 68 |
| …the same scroll, board `visibility: hidden` (identical DOM and JS, nothing painted) | **8.4 ms** | 3 / 68 |
| …the same scroll, every ticking count `display: none` | 29.1 ms | 64 / 68 |

**Reading:** every interaction this pass added runs inside budget with 540 tiles on screen.
Horizontal scrolling misses frames, and the last two rows say why: with the identical DOM and
JavaScript but nothing painted the same scroll costs 8.4 ms instead of 25.2, and removing every
ticking count changes nothing at all. The cost is the browser rasterising newly revealed columns of a
17-column, 540-tile board — **paint, not animation**. No motion change can move it; windowing the
columns would, and that is a structural change outside a motion pass.

### The table view, 540 rows (TanStack Virtual keeps ~25 mounted)

| Interaction | Median frame | Frames over 16.7 ms |
|---|---|---|
| Idle | 4.2 ms | **0 / 355** |
| Hover rows | 4.2 ms | **0 / 357** |
| Scroll the whole list | 91.7 ms | 60 / 68 |
| …the same scroll, list not painted | 87.5 ms | 59 / 68 |

**Reading:** idle and hover are free. Scrolling is not, and it is **not the motion** — measured two
ways. (a) Rebuilding both virtualised row components as plain `div`s with an inline `translateY`
instead of `motion.div` changed the median by under 4 % (91.6 → 87.4 ms at one row per frame;
29.1 → 29.2 ms at a realistic wheel step); the experiment was then reverted. (b) Running the identical
scroll unpainted costs 87.5 ms against 91.7, so unlike the board it is not paint either. What is left
is the virtualiser: TanStack Virtual sets state on every scroll event and the whole visible window of
~25 heavy rows re-renders with it. **That is a rendering concern inside `table-screen.tsx`, untouched
by this pass and outside its scope. It belongs in the backlog as its own item** — recorded here so the
finding is not lost.

### Why `Shake` is a CSS keyframe

`<Shake>` wraps things that exist in *quantity* — every tile on a 540-card board is a potential
rollback, so every tile carries one. A `motion` component pays its layout bookkeeping on every render
whether or not it is animating; a keyframe costs nothing until the class lands on the element. The
first implementation was a `motion.div`; it was rewritten after the board measurement, and the
reduced-motion branch is an explicit replacement (a destructive ring) rather than a reliance on the
global `prefers-reduced-motion` backstop, which would collapse the keyframe to nothing and leave a
refusal with no feedback at all.

Everything added in this pass animates **transform, opacity or a paint-only property** (colour,
`text-decoration-color`, `stroke`). Nothing animates width, height, `top` or `left`, with the one
pre-existing exception of `Collapsible`, whose whole purpose is an animated height.

---

## 6. Left undone

1. **The table view's scroll cost** (above). Real, measured, pre-existing, not motion. Needs the
   virtualiser's per-scroll re-render narrowed or the row made cheaper — a `table-screen.tsx` item,
   not a motion item.
2. **The board's horizontal-scroll paint cost** (above). Also real, also not motion; the fix is
   windowing the columns, which changes the board's structure.
3. **The super admin's department-approval burst.** `/departments/requests` approves a whole new
   department from a panel that closes on success, so a burst would play behind a closing panel. It
   keeps its toast. The *join-request* approval — the one the task named — is on `/department`, stays
   on screen, and does celebrate.
4. **A DevTools `.trace` file.** Two attempts produced a 972 MB artefact and then an `IO.read`
   protocol failure on this host; the frame-interval JSON in this folder is the evidence instead, and
   it carries the isolation runs a raw trace would not have given without manual reading anyway.
