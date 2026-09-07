# Designer critique — UI overhaul pass, 2026-09-07

Judged against `docs/03-plan/UI-OVERHAUL.md` (§1 principles, §2 Jakob map, §3 motion catalogue, §6
definition of done) and `DESIGN.md` v2 (§2 tokens, §4 states, §5 copy, §8 Jakob map, §9 recipes,
§10 motion catalogue). Bar: it must hold up next to Linear, Huly and Luma.

## How this was judged

- `after/` only covers the five routes in `e2e/routes.json` (404, admin, login, root, setup). Every
  feature route was walked **live** against the running `pnpm start --demo` as `demo.boshliq`, at
  1440×900 and 390×844, light and dark, uz-Latn and ru. Those captures are in
  `critique-shots/` beside this file (naming: `<route>__<width>__<theme>__<locale>.png`), plus
  interaction captures (`card-detail.png`, `board__mid-drag*.png`, `event-detail.png`,
  `project-page.png`, `structure-orgchart.png`, `personal-*.png`, `theme-mid.png`,
  `reduced__home.png`).
- **Locale note.** The earlier byte-identical uz/ru captures were a *harness* artefact, not a product
  bug: `apps/web/src/app.tsx`'s `LocaleReconciler` lets the user record win over the `devon_locale`
  localStorage seed the capture script wrote. Driving the locale menu instead produces a genuinely
  Russian UI, and the ru copy is complete and natural (`critique-shots/*__ru.png`). Any future
  capture script must switch locale through the UI, not through storage.
- **Analytics note.** `app.analytics_daily` was empty on the fresh seed (nightly pg-boss job, 02:00
  Asia/Tashkent; there is no manual trigger endpoint). The table was backfilled locally with the same
  aggregate `recomputeDay()` runs so the screen could be judged with real numbers —
  `critique-shots/analytics-with-data__1440__light__uz-Latn.png`. The *shape* of the series in that
  shot is an artefact of the backfill; only layout, tokens, states and copy are judged from it.
- Reduced motion was verified with a `reducedMotion: 'reduce'` context: the ambient drift resolves to
  `animation-name: none`, `IdleFloat` drops its class, `PageTransition`/`Stagger`/`Celebrate` all
  substitute a crossfade/ring. **The reduced-motion contract in `packages/ui/src/motion` is the
  strongest part of this pass** and is not faulted below.

## Verdict

The shell, the command palette, `Mening vazifalarim`, the event detail dialog and the motion
primitives are genuinely good. Everything else reads as *module-by-module admin template*: a raw
query-syntax filter box on every list, solid red/amber/green status pills instead of rails and
subtle chips, screens that skip `PageHeader`, empty states without an action, boards and tables that
let the document scroll instead of scrolling themselves, and — worst — the product's primary button
is unreadable and the default locale's most common letter renders broken in every serif heading.
Both of those are on the first screen a civil servant sees.

---

## SEV1 — broken layout, unreadable text, missing state

### 1. Every `lg`/`sm` primary and destructive button label is unreadable (~1.5:1)
`critique-shots/departments-new__1440__light__uz-Latn.png`, `after/login__1440__light.png`,
`critique-shots/projects__1440__light__uz-Latn.png`, `critique-shots/card-detail.png`,
`critique-shots/personal-pomodoro.png`

The login "Kirish" button computes `color: oklch(0.24 0.015 240)` (that is `--color-foreground`) on
`background: oklch(0.4 0.09 250)`. `--color-primary-foreground` never lands. Root cause is in
`packages/ui/src/primitives/button.tsx`: the base has `text-body`, `size.lg` has `text-lead`,
`size.sm` has `text-small`, and `variant.primary` has `text-primary-foreground`. `cn()` →
`twMerge` treats all four as the same `text-*` group and keeps the **last** one, which cva emits
after the variant. Size `md` survives by accident (no size `text-*`), which is why the top-bar
`+ Yangi` looks right and `Kirish`, `Yangi loyiha`, `Bo'lim qo'shish`, `Yangi sahifa`,
`Tadbir yaratish`, `Fokusni boshlash`, `Bajarildi deb belgilash` and `Keyingisi` do not.

**Fix.** Stop the collision. Either move the per-size font size out of the `text-` namespace
(`leading`/`[font-size:var(--text-lead)]`), or register the Devon type scale as its own
`font-size` class group in a shared `twMerge` config (`extend.classGroups['font-size']:
['text-caption','text-small','text-body','text-lead','text-h3','text-h2','text-h1','text-hero']`)
so colour and size never merge. Add a `Button` unit test asserting the rendered class list still
contains `text-primary-foreground` at every size, and a Storybook a11y contrast check on
`primary/lg` and `destructive/lg`.

### 2. `--font-display` renders the Uzbek modifier letter `ʻ` (U+02BB) with huge side bearings
`critique-shots/personal__1440__light__uz-Latn.png` (sprint goal), and every serif heading that
contains `oʻ`/`gʻ`

"Boʻlim hisobotlarini yakunlash va jamoa yigʻilishiga tayyorgarlik" renders as
`Bo ˋ lim … yig ˋ ilishiga` — a full space either side of the apostrophe. The sans stack is fine
(`Bo'limlar` in the sidebar is correct), so it is IBM Plex Serif / the `Devon Serif` subset missing
the Spacing Modifier Letters block and falling back per-glyph. DESIGN.md §2.3 names this exact risk
("fonts must not be subset below the Spacing Modifier Letters block") and it has regressed. In the
default locale this disfigures the greeting, every page title and every card title set in the
display face.

**Fix.** Re-subset the display face to include U+02B0–U+02FF (at minimum U+02BB and U+02BC) and add
the two letters to the Storybook glyph page as a visual regression. Until the subset ships, add
`font-feature-settings` is not enough — the fallback must be a serif that has the glyph, declared
*before* Georgia in `--font-display`.

### 3. `sr-only` `<table>` inside every chart card forces a horizontal scroll at 390
`critique-shots/analytics__390__light__uz-Latn.png` (the file is **568 px wide for a 390 viewport**)

`apps/web/src/features/analytics/chart-card.tsx:174` puts `sr-only` on a `<table>`. A table's used
width is at least its min-content width, so `width:1px` is ignored: the element computes 225×360 px,
sits at its static position with `position:absolute`, and grows `document.scrollWidth` to 567. The
whole analytics screen then scrolls sideways on a phone. Rule broken: the page body must never
scroll horizontally.

**Fix.** Wrap the table: `<div className="sr-only"><table>…</table></div>`. Add a lint rule or a
Playwright assertion that `document.scrollWidth <= innerWidth` on every route at 390 — this is the
kind of defect that only a check catches.

### 4. Inbox rows lack `min-w-0`; the row actions render outside the row card
`critique-shots/inbox__1440__light__uz-Latn.png`, `critique-shots/inbox-b__1440__light__uz-Latn.png`
(the 390 capture is **547 px wide for a 390 viewport**)

The row is `flex items-start gap-3` in a `minmax(0,420px)` grid track. The title column cannot
shrink, so the trailing `<span class="flex shrink-0 items-center gap-1">` is pushed to x≈454 while
the row's own box ends at x≈345 — the clock and archive buttons float in the gutter between the two
panes, and the notification title is sliced by the card border mid-quote.

**Fix.** `min-w-0` on the growing text column and `truncate`/`line-clamp-2` on the title; keep the
action cluster `shrink-0` inside the row. Same audit for any other `flex` row that pairs free text
with trailing actions (`work` list rows, `people` cards).

### 5. The card-detail overlay's scrim is a rectangle that stops mid-viewport
`critique-shots/card-detail.png`

The sidebar and the top half of the board are dimmed; everything below y≈900 (the panel's own
height) is at full brightness, so half the board competes with the panel for attention and the panel
reads as a floating box rather than a layer. §9.4 asks for a routed right-hand `Sheet` at
`--width-detail-panel`, full height, over the board.

**Fix.** The overlay must be `fixed inset-0` on the viewport (Radix/Vaul `Overlay` in a portal), not
sized to the panel's parent; the panel itself becomes a full-height right sheet flush to the viewport
edge. Verify the board keeps its scroll position on close (§9.4).

### 6. The board is not a board: columns are page-height and the 4th column is clipped
`critique-shots/work-board__1440__light__uz-Latn.png` (3,141 px tall),
`critique-shots/work-board__1440__light__ru.png`, `critique-shots/work-board__390__light__uz-Latn.png`

Three failures at once. (a) The columns stretch to the document height, so `+ Karta qo'shish` sits
~1,700 px below the last card with nothing between — the single ugliest empty region in the product.
(b) The document scrolls, not the columns, so the sticky column heads are sticky inside a 3,141 px
page and scroll away. (c) At 1440 the fourth person's column is sliced mid-word (`31.08.202`,
`03.09.`) with no horizontal scrollbar, no edge fade and no collapse used — a five-person department
already overflows. Trello/Plane/Linear all pin the board to the viewport and scroll each column.

**Fix.** Make the board region `h-[calc(100dvh-var(--height-topbar)-header)] overflow-x-auto`, each
column `flex flex-col min-h-0` with `overflow-y-auto` on the card list and the add-card row pinned
as the column footer. Add a right-edge mask/fade on the scroller and wire the existing column
collapse into a "show N of M" affordance.

### 7. `/account` renders ~90 raw User-Agent strings; the page is 8,213 px tall (13,857 at 390)
`critique-shots/account__1440__light__uz-Latn.png`, `critique-shots/account__390__light__uz-Latn.png`

"Qurilmalar va seanslar" prints every session as
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) … HeadlessChrome/143.0.0.0 Safari/537.36` with no device
parsing, no grouping, no paging and no "current session" marker. This is the worst screen in the
product and it is the one screen every user visits.

**Fix.** Parse the UA into `Chrome · Windows` + a location/IP line + a relative last-seen time,
mark the current session, show the 5 most recent with a "Show all" disclosure, and give the list its
own `SectionCard` per §9.5 with `Chiqish` as a row action.

---

## SEV2 — reads as default admin-template UI, or breaks the catalogue

### 8. Filters are a raw query-syntax text box on every list
`critique-shots/work-board__1440__light__uz-Latn.png`, `work-table`, `work-calendar`, `work-mine`,
`analytics`

Every filterable screen shows a bare input pre-filled with `assignee:@me due:<=friday label:urgent`
and an `Qo'llash` button, with `Ko'rinish sifatida saqlash` permanently greyed out. Nobody in this
department will type that. The Jakob map (§8, "Filters") is explicit: chips with type-ahead, a
`+ Filter` popover, saved views as tabs, the URL is the state.

**Fix.** Build `FilterBar` for real: render the parsed query as removable `FilterChip`s, add a
`+ Filtr` popover (field → operator → value, cmdk-driven), keep the raw text as an "advanced" toggle
for power users, and enable "save as view" the moment a filter is non-empty. Saved views become tabs
on the `PageHeader`.

### 9. Board drag has no pointer-following preview and no drop settle; it cannot drag at all on touch
`critique-shots/board__mid-drag.png`, `board__mid-drag-2.png`, `board__after-drop.png`

`@atlaskit/pragmatic-drag-and-drop` is wired through the **native HTML5** drag adapter
(`apps/web/src/features/work/components/card-tile.tsx:103`). The source card ghosts and the target
column highlights (both good), but nothing follows the pointer, the drop snaps with no
`spring.settle`, and native HTML5 DnD does not fire on touch — the flagship interaction is dead at
390. Catalogue row "Board drag: pointer-following spring; drop settle; column highlight; ghost 0.9"
is unmet.

**Fix.** Use pragmatic-dnd's `setCustomNativeDragPreview` + `preserveOffsetOnSource` to render a real
card preview, animate the drop with `spring.settle` on the landed card, and add the
`@atlaskit/pragmatic-drag-and-drop` **external/pointer** adapter (or `dnd-kit`) so touch drag works.
Keep the existing keyboard DnD live region.

### 10. The checkbox celebration never plays — the row is destroyed on the same tick
`critique-shots/personal__1440__light__uz-Latn.png` (verified live)

`today-view.tsx:287` passes `celebrate` to the Checkbox, but completing a task removes it from
"Bugungi vazifalar" immediately: the count goes 4→3 and the row vanishes. No check draws in, no
12-particle burst, no strike-through, no toast. The one designed moment of delight in the personal
workspace is unreachable.

**Fix.** Keep the completed row mounted for `--dur-celebration` (480 ms) with the strike-through
applied, then animate it out via `AnimatePresence`; fire `toastWithUndo` on the same action.

### 11. "Undo over confirm" is unmet — 13 undo toasts against 116 plain ones
`apps/web/src/features/**`

`toastWithUndo` appears in 6 files (inbox, personal notes/tasks/canvas, structure, card-detail).
Everything else — completing a today task, RSVP, archiving a project, deleting a milestone, bulk
actions — either confirms or does nothing.

**Fix.** Sweep every reversible mutation onto `toastWithUndo` and delete the confirm dialogs it
replaces. Keep full dialogs only for the destructive ceremonies §9.5 names.

### 12. The ambient gradient is invisible on auth — the "wow" screen is flat grey
`after/login__1440__light.png`, `after/setup__1440__light.png`

`AmbientGradient` renders correctly but sits at `-z-10` inside
`apps/web/src/shell/auth-shell.tsx`'s `<div className="relative … bg-background">`, so the parent's
own background paints over it. Forcing `z-index: 5` in the browser makes the wash appear
immediately. DESIGN.md §2.6 allows the gradient on exactly two kinds of screen and this is one of
them; right now sign-in is a bare form on flat paper, which is the whole first impression.

**Fix.** Drop `bg-background` from the ambient's parent (the body already paints it) or give the
gradient `z-0` and the `TopBar`/`main`/credit `relative z-10`. Add a Storybook/Playwright pixel check
so it cannot silently disappear again.

### 13. The Home ambient gradient is a visible rectangle with a hard bottom edge
`after/root__1440__light.png`, `after/root__1440__dark.png`, `critique-shots/theme-mid.png`

The wash covers the greeting band and stops on a straight horizontal line just under
"BUGUNGI HOLAT", and in dark mode it reads as a stray lighter panel. §2.6's whole point is that the
wash must never be perceivable as an edge.

**Fix.** Move the gradient to the page-level container (behind the whole content column, not just
the greeting block) and extend the radial stops past the clip box so the fade completes inside the
element; drop the opacity another step in dark.

### 14. Status is carried by solid destructive/amber fills everywhere; no row rail is used anywhere
`critique-shots/work-table__1440__light__uz-Latn.png` (a wall of solid red `Muddati o'tgan` pills),
`work-mine`, `work-board`, `work-calendar`, `work-archive`, `personal` (solid teal `Hafta` on every
row), `personal-pomodoro` (green `Yakunlangan` on every row)

§9.2 specifies `railClassName` as the unread/overdue signal, always paired with a text label, with
status as a `Badge`. Instead every priority and every overdue state is a filled pill, and because
most demo cards are overdue the table view is ~70 % saturated red. It looks alarming and it destroys
scannability — the opposite of Linear's restraint.

**Fix.** One tinted, low-chroma `Badge` variant per status (`bg-destructive/10 text-destructive` with
a leading glyph), solid fill reserved for a single "blocked" state; move overdue onto the 2 px left
rail on `DataRow`/`TaskCard` and keep the date chip plain. Same treatment for `Hafta` and the
pomodoro log.

### 15. Month labels print as `2026 M09`
`critique-shots/events__1440__light__uz-Latn.png` (group heads `2026 M08` / `2026 M09`),
`critique-shots/work-calendar__1440__light__uz-Latn.png` (the calendar title)

A machine month key is on screen in two places in the default locale.

**Fix.** `Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })` through the i18n layer, in
all four locales; the `Calendar` primitive already does this for weekday heads, so reuse it.

### 16. The analytics date range uses native date inputs in US M/D/Y
`critique-shots/analytics__1440__light__uz-Latn.png` (`06/15/2026`, `09/07/2026`)

DESIGN.md §5: dates are `DD.MM.YYYY`. Two raw `<input type="date">` controls also break the token
system (native chrome, native calendar, native focus ring) and are half the cause of the 390
overflow.

**Fix.** Replace with the existing `DatePicker` (react-day-picker, Monday start, `Intl` month names)
inside a single "date range" popover next to the `Oxirgi 7/30/90 kun` presets.

### 17. Chart cards stretch to the grid row; the chart inside does not
`critique-shots/analytics-with-data__1440__light__uz-Latn.png` ("Ochiq va muddati o'tgan
topshiriqlar" leaves ~170 px of empty card below the plot)

Grid `items-stretch` gives every card the height of the tallest sibling, but `ResponsiveContainer`
keeps its fixed height, so half the cards have a dead lower third.

**Fix.** `flex flex-col` on the card with `flex-1 min-h-0` on the chart wrapper and
`ResponsiveContainer height="100%"`; set a `min-h` so short cards do not collapse.

### 18. A chart with no series renders an empty plot area and no empty state
`critique-shots/analytics__1440__light__uz-Latn.png` (three cards, axes only, nothing said)

DESIGN.md §4 requires a designed empty state on every screen; a chart card is a screen region and
needs one too — this is exactly what a fresh department sees before the first nightly recompute.

**Fix.** When a series is empty, render an in-card `EmptyState` (small illustration, one line, no
button) instead of the axes; keep the card header and the owner question.

### 19. Green is used for things that are not success
`critique-shots/events__1440__light__uz-Latn.png` (`Ochiq` pill), `critique-shots/event-detail.png`,
`critique-shots/departments__1440__light__uz-Latn.png` (`Joriy bo'lim`),
`critique-shots/analytics-with-data__…png` ("Tadbirlarda ishtirok" bars),
`critique-shots/personal-pomodoro.png` (`Yakunlangan` rows)

DESIGN.md §2.1: green is "kept strictly as the meaning of success". "Open", "current department" and
"event participation" are not success.

**Fix.** `Ochiq` → neutral/`info`; `Joriy bo'lim` → `primary` outline chip; participation bars →
`--color-primary`; keep green only for done/approved/on-track.

### 20. Event "covers" are small centred clip-art on a band, not covers
`critique-shots/events__1440__light__uz-Latn.png`, `critique-shots/events__1440__light__ru.png`,
`critique-shots/event-detail.png`

The illustration is a fixed ~180 px image centred in a coloured strip with ~90 px of card background
on each side, the same two SVGs repeat across four events, and the status pill straddles the band
edge. Luma's whole identity is the full-bleed cover.

**Fix.** Full-bleed 16:9 cover (`object-cover w-full`), the illustration scaled to fill and
recoloured to the illustration tokens, a soft gradient scrim at the top so the status pill and the
date block always have contrast, and a deterministic per-event illustration pick so two events never
share one.

### 21. The departments hub is missing its two big cards, the invite link and the QR
`critique-shots/departments__1440__light__uz-Latn.png`

§8 "Departments hub": "Create or join as two big cards; invite link with copy + QR; pending request
with an illustration." What ships is two small header buttons and one 550 px row card floating in
850 px of empty space.

**Fix.** Build the hub as two large choice cards (illustration, title, one line, one button) above
the membership list; add the invite block (key, copy button, QR) to the department card for a head;
give the pending state the `EmptyState` treatment.

### 22. Three screens skip `PageHeader` entirely
`critique-shots/projects__1440__light__uz-Latn.png`, `critique-shots/project-page.png`,
`critique-shots/departments__1440__light__uz-Latn.png`

No eyebrow, no description, no breadcrumb back to the list on the project page. §9.1 says every
screen starts with `PageContainer` → `PageHeader`; these three invent their own header and the seam
is obvious the moment you navigate between them.

**Fix.** Move all three onto `PageHeader` (`eyebrow` = the area, `above` = breadcrumb on the project
page, `actions` = one primary plus at most two secondary).

### 23. Project cards are 78 px stubs
`critique-shots/projects__1440__light__uz-Latn.png`

Ring + dot + name + "44 % bajarildi", nothing else — no owner, no members, no next milestone, no due
date, no status; and the ring prints `44` while the text beside it prints `44 %`. Six of them end at
y=280 and the remaining 620 px is empty. Linear/Asana project cards carry the state of the project.

**Fix.** Rebuild `ProjectCard`: progress ring with the `%` inside, name + status badge, one-line
objective, next milestone with its date, member `AvatarStack`, task fraction. Drop the redundant
"44 % bajarildi" line.

### 24. The timeline is unreadable
`critique-shots/work-timeline__1440__light__uz-Latn.png`

Rows are per **person**, not per card/project (§8 says "Rows per card/project"); each row is a
stack of grey/amber/dark-red segments with no card titles, no legend, no tooltip affordance and no
zoom; grey is not a status token, and the palette reads muddy. Half the x-axis is empty. The tab is
also called "Grafik" (chart) for a Gantt.

**Fix.** One row per card (grouped by assignee with a sticky group head), a labelled bar per card
with its title inside, hover for detail, drag handles on the ends, a zoom control, the today line
kept, and status colour from the tokens. Rename the tab to `Muddatlar`/`Vaqt chizigʻi`.

### 25. Structure is unstyled; org-chart node text overflows its node
`critique-shots/structure__1440__light__uz-Latn.png`, `critique-shots/structure-orgchart.png`

The list tab is two unit names with a coloured dot and three inline text links, ragged-aligned (the
meta line starts *left* of the unit name), with a stray member pill that looks like a leaked form
control. On the chart tab "Boshligʻi hali tayinlanmagan" runs straight through the node's right
border. There is no root node, no connecting lines and no hierarchy — just two boxes in the corner of
a 620 px empty canvas.

**Fix.** List tab → `DataList`/`DataRow` (unit colour rail, name, head avatar, member count,
row actions in an overflow menu). Chart tab → real tree layout with the department as root and
orthogonal connectors; node text `truncate` with a tooltip, dashed border for vacancies.

### 26. The table view renders every row, unvirtualised, with no sticky header and no selection
`critique-shots/work-table__1440__light__uz-Latn.png` (5,735 px; 5,918 px at 390)

No `@tanstack/react-virtual`, no pagination, no sticky header, no row checkboxes, no bulk bar with
undo, no group-by, no visible sort affordances, and a repeated blue `Ochish` link column that
duplicates the row click. §8 "Table view" and §9.2 both go unmet.

**Fix.** Virtualise, make the header row sticky under the top bar, add leading checkboxes + the bulk
bar with undo, put sort on the column heads, drop the `Ochish` column (the row is the target), and
add zebra/hover from the tokens.

### 27. Card-detail label chips are pastel fills with near-white text
`critique-shots/card-detail.png` ("Hisobot", "Tashqi")

Two of the four label chips are effectively illegible.

**Fix.** Derive the chip foreground from the label hue at a fixed lightness delta (or use a tinted
`bg-*/12` + full-chroma text), and assert ≥ 4.5:1 in the label-chip story.

### 28. "Tadbirni bekor qilish" sits in the event's primary action row
`critique-shots/event-detail.png`

A solid destructive button one tab-stop from "Tahrirlash", with no confirmation ceremony. §9.5:
destructive actions live last, in a danger zone, behind a full dialog with a typed confirmation.

**Fix.** Move cancel into the dialog's overflow menu or a bottom danger section, and gate it behind a
`Dialog` that names the event and the number of people who will be notified.

### 29. The Pages empty state has no action
`critique-shots/pages__1440__light__uz-Latn.png`

Illustration, title, one line — and then nothing. §9.6: "exactly one action". The create button is
only in the header, so the state teaches nothing. It is also pinned near the top of the content area
with ~450 px of dead space below rather than centred, and the copy uses `--` for a dash.

**Fix.** Add the single `Yangi sahifa` button to the state, centre the state in the content area, and
give the screen the Notion page tree it is missing.

### 30. The inbox two-pane is 90 % empty and its detail placeholder is not a designed state
`critique-shots/inbox__1440__light__uz-Latn.png`

The right pane is an 80 px bordered box with one sentence and ~600 px of nothing under it; the list
pane is 418 px of a 1,144 px content column. There are no unread dots, no reason grouping by default
(it is a header action instead), and the three header actions are all ghost buttons with no primary.

**Fix.** `NoSelectionState` (illustration + one line) centred in the right pane; widen the list to
~440 px and let the detail take the rest; unread dot + reason chip on the row per §8; group by reason
by default with the toggle in a view menu; give the header one primary (`Hammasini o'qilgan deb
belgilash`).

### 31. Personal "Today" sacrifices the task title to the chips
`critique-shots/personal__1440__light__uz-Latn.png` and live at ≤ 900 px

The row truncates `Choraklik hisobotni tayyo…` while keeping a solid `Hafta` chip, `180'` and a
`Fokus` button at full width, and the sprint goal itself is ellipsized in the hero. Nothing in the
shell may be ellipsized (DESIGN.md §5) and in a task list the title is the content.

**Fix.** `min-w-0` + `truncate` on the *chips* side, title gets the remaining space and wraps to two
lines; sprint goal wraps rather than truncates; `180'` → `180 daq` through i18n.

### 32. The personal tab strip gets a native OS scrollbar
live at ~700–900 px wide

A grey scroll track with arrows sits under the tabs. A native scrollbar is not in the token system.

**Fix.** `overflow-x-auto scrollbar-none` with left/right mask fades, or collapse the overflow into a
`⋯` menu; the `Pomodoro` header action is also redundant with the `Pomodoro` tab — drop one.

### 33. Numbers are formatted with English separators
`critique-shots/ai__1440__light__uz-Latn.png` (`Bu oy 500,000 so'm dan 1 so'm sarflandi`)

DESIGN.md §5: "numbers with locale separators". Uzbek uses a space.

**Fix.** Route every number through `Intl.NumberFormat(locale)` — including the budget input's
display value — and fix the phrasing (`500 000 soʻmdan`).

### 34. Toasts collide with the fixed bottom tab bar at < 768
`packages/ui/src/primitives/toast.tsx`, live at 390

`Toaster` takes no `offset`, and the mobile position is `bottom-center` where the 60 px
`BottomTabBar` lives.

**Fix.** `offset={{ bottom: 'calc(var(--height-tabbar) + var(--space-3))' }}` on the mobile position,
and add the same bottom padding to the scroll container so the last row is never covered.

---

## SEV3 — polish

### 35. Home tiles bury their numbers in prose
`after/root__1440__light.png`

"11 ta ochiq, 3 tasi muddatidan oʻtgan" is a sentence where Linear's "My issues" gives you a number.
The two `KpiTile`s below sit on a different surface from the three tiles above, so the hero reads as
two unrelated card families. The pinned-charts block is a left-aligned paragraph with a link, not an
`EmptyState`.

**Fix.** Lead each tile with a `NumberFlow` count and put the qualifier underneath; unify the two
rows onto one surface treatment; make pinned-charts a real `EmptyState` with one button.

### 36. The onboarding checklist is not aligned to its own title
`after/root__1440__light.png`

The checklist items start at x≈325 while "Boshlash" starts at x≈445, and the progress bar runs
full-bleed to the card's right edge. Row rhythm is ~48 px, twice the list rhythm elsewhere.

**Fix.** One grid: illustration column, then a content column that both the title and the items share;
progress bar inset to the content column; rows at 36–40 px.

### 37. The theme change is a plain crossfade that double-exposes text
`critique-shots/theme-mid.png`

Mid-transition the greeting is visibly printed twice. Catalogue: "Icon morph; circular reveal from
the button where View Transitions exist."

**Fix.** Implement the circular `clip-path` reveal originated at the toggle's bounding box inside
`startViewTransition`; keep the crossfade as the no-support fallback and under reduced motion.

### 38. `--` used where an em dash belongs
`critique-shots/personal__…png` ("ko'rasiz -- bo'lim"), `pages__…png`, `event-detail.png`

Three user-facing strings carry a source-code double hyphen.

**Fix.** Sweep the message files for `--` in copy (not in comments) and replace with `—`; add it to
the i18n lint.

### 39. People directory repeats a null state 22 times and has no hover card
`critique-shots/people__1440__light__uz-Latn.png`

Every card in the group already titled "Boʻlimsiz" also says "Boʻlim belgilanmagan"; group headings
are plain 16 px sans instead of the eyebrow used everywhere else; cards are 122 px tall with no
contact affordance. §8 asks for Slack-members conventions: hover card with contact actions.

**Fix.** Suppress the unit line inside the "Boʻlimsiz" group, switch group heads to the eyebrow
style, tighten the card to ~88 px, and add a `HoverCard` with email/Telegram/"assign work".

### 40. Pomodoro session log has no dates and no grouping
`critique-shots/personal-pomodoro.png`

Thirteen rows of `09:00 – 09:30` with a repeated green `Yakunlangan` and no day separator, so the
same times appear to repeat. "Tanaffusni boshlash" is a bare text link under the primary button.

**Fix.** Group the log by day with a date sub-head, show only the last three days with a "show more",
drop the per-row status word to an icon + tooltip, and make "Tanaffusni boshlash" a secondary button.

---

## Not faulted (worth keeping)

The shell (sidebar groups, department switcher, user block, ministry credit), the command palette
(sheet at 390, sections, icons, `G H` hints, footer legend), `Mening vazifalarim` (grouped with
counts, right-aligned dates, eyebrow heads), the event detail dialog's information architecture, the
`/departments/new` stepper, the reduced-motion contract in `packages/ui/src/motion`, the four-locale
coverage and the naturalness of the Russian copy.
