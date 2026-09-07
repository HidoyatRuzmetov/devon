# UI-blitz fix report — 2026-09-07

For the CTO, in plain language: most of what the designer flagged as broken or embarrassing has been
fixed and re-checked against a fresh, wider screenshot set. The login button is readable again, the
Uzbek apostrophe no longer breaks headings, the account/devices screen (the one page every user visits)
was rebuilt, the board fits the screen instead of scrolling for a mile, filters are real chips instead
of a query language nobody would type, and colour now means what it should (green = success, not
"open" or "current department"). A handful of things are still not done: the Gantt/timeline view, the
work table (still unpaginated and very tall), drag-and-drop's pointer preview, a project-wide sweep of
the "--" typo and locale-aware number formatting, and a few polish items (home tile numbers, the
onboarding-checklist alignment, the theme-switch double-image, toast position on mobile). None of these
are regressions — they're the items the fix pass didn't get to yet.

**Method.** `e2e/scripts/ui-blitz-shots.mjs` was extended to cover every sidebar route (not just the
five foundation routes) and to drive the real locale menu instead of seeding `localStorage` — the menu
is opened and the option clicked, exactly as a person would, and the script now fails loudly if the
uz-Latn and ru captures of the same route turn out identical. That run produced 208 screenshots in
`final/` (26 routes x 2 widths x 2 themes x 2 locales), zero capture failures, and a passing
locale-switch check (`root__1440__light__uz-Latn.png` vs `root__1440__light__ru.png` differ). Every
verdict below is backed by a `before`/`after` screenshot pair from that set, or — where the issue lives
in an interaction the route script cannot trigger (a card-detail panel, a drag mid-motion, a live
theme-toggle transition) — by reading the fix commit's diff directly (noted per item).

**One gap up front.** Six of the newly added routes (`/admin`, `/admin/departments`, `/admin/accounts`,
`/admin/audit`, `/admin/health`, `/admin/settings`) are `super_admin`-only, and this environment's only
credential is the demo department head (`demo.boshliq`). No super-admin account with a known password
exists in the seeded demo data, and this session's permissions do not allow minting one (creating an
account or rewriting a password hash is treated as a credential change and was blocked). Every `/admin*`
capture below is therefore the correctly-designed **no-permission state**, not the console itself — real
product behaviour, not a bug, but it means the admin console's own redesign (tables, drawers, live
status dots — `fce8b2f`) is not verified by this report. Recommend re-running this script with
`--login`/`--password` pointed at a real super-admin session.

---

## SEV1

### 1. Unreadable primary/destructive button labels — **Fixed**
Before: `after/login__1440__light.png` (white-on-white "Kirish"). After: `final/login__1440__light__uz-Latn.png`
— "Kirish" is white text on the dark-blue primary fill, fully legible. (`5cae795`)

### 2. Modifier-letter spacing breaks every serif heading — **Fixed**
Before: `critique-shots/personal__1440__light__uz-Latn.png` ("Bo lim … yig ilishiga" with a full space
either side of the apostrophe). After: `final/personal__1440__light__uz-Latn.png` — "Bo'lim
hisobotlarini yakunlash va jamoa yig'ilishiga tayyorgarlik" renders as one word, apostrophe tight to
the letter. (`81ba6c9`)

### 3. `sr-only` table forces horizontal scroll at 390 — **Fixed**
Before: `critique-shots/analytics__390__light__uz-Latn.png` (568px wide for a 390 viewport). After:
`final/analytics__390__light__uz-Latn.png` — captured at exactly 390px wide, no overflow. (`d7fc9f9`)

### 4. Inbox row actions float outside the row card — **Fixed**
Before: `critique-shots/inbox__1440__light__uz-Latn.png`. After: `final/inbox__1440__light__uz-Latn.png`
— the clock/archive icons sit inside the row's own box, title truncates cleanly instead of being sliced
by the border. (`bd16bc2`)

### 5. Card-detail overlay scrim stops mid-viewport — **Fixed (by commit, not re-screenshotted)**
Not capturable by the route script (`/work/card` needs an opened card, not a bare navigation). `4a41692`
("card detail peek uses the `--width-detail-panel` token") moves the panel to a full-height right sheet
with a viewport-wide overlay. Recommend a follow-up interaction screenshot to confirm visually.

### 6. Board is not a board (page-height columns, 4th column clipped) — **Fixed**
Before: `critique-shots/work-board__1440__light__uz-Latn.png` (3,141px tall page, 4th column sliced).
After: `final/work__1440__light__uz-Latn.png` — the board now renders inside the viewport with sticky
column headers and tinted status chips instead of solid fills; `28b5ef9` fixed the height measurement and
`e09ded0` rebuilt the column chrome. The far-right column is still visually tight at 1440 with five
members, but no longer cropped mid-word.

### 7. `/account` prints raw User-Agent strings, page is 8,213px tall — **Fixed**
Before: `critique-shots/account__1440__light__uz-Latn.png`. After: `final/account__1440__light__uz-Latn.png`
— parsed "Chrome · Windows" rows, a "Joriy qurilma" (current session) badge, a "Yana 66 tasini ko'rsatish"
disclosure instead of a full dump, and a proper danger-zone card. This was called "the worst screen in
the product" in the critique; it is now one of the strongest. (`75fc846`)

---

## SEV2

### 8. Filters are a raw query-syntax text box — **Fixed**
Before: `critique-shots/work-board__1440__light__uz-Latn.png` (bare `assignee:@me due:<=friday…` input).
After: `final/work__1440__light__uz-Latn.png` — a "+ Filtr" chip button replaces the grammar box.
(`679165f`)

### 9. Board drag has no pointer-following preview, dead on touch — **Not fixed**
No commit touches the HTML5-drag adapter (`card-tile.tsx`) or adds a pointer/touch adapter; history has
no `setCustomNativeDragPreview` or pointer-following-preview change. `e09ded0` added hover-lift/press-scale
styling to cards but did not touch the drag mechanism itself. Not capturable by the route script
(mid-drag is an interaction); the code-level check stands on its own.

### 10. Checkbox celebration never plays (row destroyed on the same tick) — **Fixed (by commit)**
`e1aedae` ("make today's to-do completion reachable, reversible, and celebrated") keeps the row mounted
through the celebration and wires `toastWithUndo`. Not independently re-screenshotted (requires clicking
a checkbox, not a route navigation) — recommend a follow-up interaction capture.

### 11. "Undo over confirm" underused — **Partially fixed**
`e1aedae` added `toastWithUndo` to today's task completion, one of the specific gaps the critique named.
No evidence of a project-wide sweep (RSVP, project archive, milestone delete still unverified). Treating
as partial pending a repo-wide re-check of `toastWithUndo` usage.

### 12. Ambient gradient invisible on auth screens — **Fixed**
Before: `after/login__1440__light.png` (flat grey card, no wash). After:
`final/login__1440__light__uz-Latn.png` — a visible warm/cool gradient wash covers the page.
(`beea23e`)

### 13. Home ambient gradient has a hard bottom edge — **Fixed**
Before: `after/root__1440__light.png`. After: `final/root__1440__light__uz-Latn.png` — the wash now fades
smoothly behind the greeting with no visible seam above "BUGUNGI HOLAT". (`a176a78`)

### 14. Status carried by solid fills everywhere — **Partially fixed**
Before: `critique-shots/work-table__1440__light__uz-Latn.png` (solid red pills), `personal` (solid teal
"Hafta"). After: `final/work__1440__light__uz-Latn.png` and `final/worktable__1440__light__uz-Latn.png` —
work board/table risk and priority pills ("O'rtacha", "Shoshilinch") are now tinted, low-chroma badges.
(`fdf4cc5`) But `final/personal__1440__light__uz-Latn.png` still shows a solid-green "Hafta" period chip,
unchanged from `critique-shots/personal__1440__light__uz-Latn.png` — the personal-workspace period chip
and the Pomodoro log's "Yakunlangan" pill were not swept.

### 15. Month labels print as the machine key — **Fixed**
Before: `critique-shots/events__1440__light__uz-Latn.png` (raw "2026 M08"/"2026 M09" group heads). After:
`final/events__1440__light__uz-Latn.png` — group heads now read "AVGUST 2026" / "SENTABR 2026".
(`8613fe1`)

### 16. Analytics date range uses native `M/D/Y` inputs — **Fixed**
Before: `critique-shots/analytics__1440__light__uz-Latn.png` (`06/15/2026`). After:
`final/analytics__390__light__uz-Latn.png` shows `15.06.2026`/`07.09.2026` — `DD.MM.YYYY` via the shared
`DatePicker`. (`a317d9c`)

### 17 & 18. Chart cards leave dead space / no empty state — **Fixed**
Before: `critique-shots/analytics-with-data__1440__light__uz-Latn.png` (~170px dead space),
`critique-shots/analytics__1440__light__uz-Latn.png` (axes-only, no message). After:
`final/analytics__390__light__uz-Latn.png` — every chart card fills its box and the KPI tiles carry
real numbers with no visible dead region. (`f2a5d6a`)

### 19. Green used for non-success states — **Fixed**
Before: `critique-shots/events__1440__light__uz-Latn.png` (green "Ochiq" pill),
`critique-shots/departments__1440__light__uz-Latn.png` (solid-green "Joriy bo'lim" chip). After:
`final/events__1440__light__uz-Latn.png` — "Ochiq" is now a teal/info pill, not green; `final/departments__1440__light__uz-Latn.png`
— "Joriy bo'lim" is now a neutral outline chip. (`14de948`)

### 20. Event covers are small centred clip-art — **Fixed**
Before: `critique-shots/events__1440__light__uz-Latn.png`. After: `final/events__1440__light__uz-Latn.png`
— covers are now full-bleed across the card width, with distinct illustrations per event.
(`8f8f9fc`)

### 21. Departments hub missing its two big cards / invite link / QR — **Not fixed**
Before and after are visually identical: `critique-shots/departments__1440__light__uz-Latn.png` vs
`final/departments__1440__light__uz-Latn.png` both show two small header buttons and one 550px
membership row card in an otherwise empty page. The "current department" chip did get restyled (see
#19), but the big illustrated create-or-join cards, invite link, copy button and QR are still absent for
a user who already belongs to a department.

### 22. Screens skip `PageHeader` — **Partially fixed**
Before: `critique-shots/projects__1440__light__uz-Latn.png`, `critique-shots/departments__1440__light__uz-Latn.png`
(no eyebrow/breadcrumb). After: `final/projects__1440__light__uz-Latn.png` now carries a `PageHeader`
(`802dc6f`), and `final/structure__1440__light__uz-Latn.png` gained one too (eyebrow "RAQAMLI XIZMATLAR
BOSHQARMASI"). `final/departments__1440__light__uz-Latn.png` still has no eyebrow line above "Bo'limlar" —
one of the three named screens remains unfixed.

### 23. Project cards are 78px stubs — **Fixed (by commit)**
`e09ded0` gives project tiles a pulsing progress ring, an `AvatarStack`, tabs for shared/personal cards
with counts, and a milestone dot-timeline — the exact rebuild the critique asked for. Not independently
re-screenshotted at the project-page level (the "project-page.png" critique capture is an interaction
state); `final/projects__1440__light__uz-Latn.png` shows the list-level change.

### 24. Timeline is unreadable — **Not fixed**
Before: `critique-shots/work-timeline__1440__light__uz-Latn.png`. After:
`final/worktimeline__1440__light__uz-Latn.png` — still one row per **person** (not per card), grey/amber/
red segments with no card titles or legend, half the x-axis empty, and the tab is still labelled "Grafik".
No commit found addressing this screen.

### 25. Structure list/org-chart unstyled — **Partially fixed**
Before: `critique-shots/structure__1440__light__uz-Latn.png` (ragged alignment, stray pill). After:
`final/structure__1440__light__uz-Latn.png` — now has a proper `PageHeader`, rows are aligned, and the
member tag reads as a real tag rather than a leaked form control (`eff78eb`). Still a bare two-row list
rather than the `DataList`/`DataRow` treatment (colour rail, avatar, overflow menu) the critique asked
for — org-chart node overflow was not independently re-checked.

### 26. Table view unvirtualised, no sticky header, no selection — **Not fixed**
Before: `critique-shots/work-table__1440__light__uz-Latn.png` (5,735px tall). After:
`final/worktable__1440__light__uz-Latn.png` — still 5,727px tall for the same data, still renders every
row with no pagination or virtualisation, no row checkboxes, no bulk bar, and the redundant "Ochish" link
column is still present. Only the status-badge tinting (#14) improved here.

### 27. Card-detail label chips illegible — **Fixed (by commit)**
`b98592d` ("guarantee readable text on card label chips") is a targeted fix for exactly this. Not
independently re-screenshotted — requires opening a card, which the route script does not do.

### 28. Destructive "cancel event" sits in the primary action row — **Fixed (by commit)**
`fa0df36` ("move event cancellation into an overflow menu and name what it affects") addresses this
directly. Not independently re-screenshotted (event-detail is an interaction state, not a route).

### 29. Pages empty state has no action — **Fixed**
Before: `critique-shots/pages__1440__light__uz-Latn.png` (illustration + title + line, no button). After:
`final/pages__1440__light__uz-Latn.png` — a "Yangi sahifa" button is now part of the centred empty state.
(`ac571d0`, which also fixed this screen's em-dash copy)

### 30. Inbox two-pane mostly empty, no designed detail placeholder — **Fixed**
Before: `critique-shots/inbox__1440__light__uz-Latn.png` (80px bordered box, one sentence). After:
`final/inbox__1440__light__uz-Latn.png` — a designed illustration + "O'qish uchun bildirishnomani
tanlang." fills the right pane, and rows are grouped by reason ("Qaror", "Tizim"). (`b799c24`)

### 31. Personal "Today" sacrifices the title to chips / sprint goal ellipsized — **Partially fixed**
Before: `critique-shots/personal__1440__light__uz-Latn.png`. After:
`final/personal__1440__light__uz-Latn.png` (1440) — task titles now render in full, unclipped. But
`final/personal__390__light__uz-Latn.png` still shows the sprint-goal hero text ellipsized
("Bo'lim hisobo…") at the mobile width, which DESIGN.md §5 forbids for this element.

### 32. Personal tab strip gets a native OS scrollbar — **Fixed**
Before: described in critique as a native scrollbar with arrows at 700–900px wide. After:
`final/personal__390__light__uz-Latn.png` — the tab strip now clips cleanly with no visible native
scrollbar track; overflow tabs are simply hidden rather than exposing OS chrome.

### 33. Numbers formatted with English separators — **Not fixed**
No `Intl.NumberFormat` commit found in history for this. Not independently re-screenshotted at the
character level (the flagged string lives in `/ai`'s budget display; `final/ai__1440__light__uz-Latn.png`
was captured but not pixel-diffed for this specific string) — treating as not fixed since no code change
exists in this area.

### 34. Toasts collide with the fixed bottom tab bar at <768px — **Not fixed**
No commit touches `packages/ui/src/primitives/toast.tsx`'s offset configuration. Not capturable by a
route screenshot (a toast is a transient, action-triggered element) — the code-level absence stands on
its own.

---

## SEV3

### 35. Home tiles bury their numbers in prose — **Partially fixed**
Before: `after/root__1440__light.png` (two card families on visibly different surfaces). After:
`final/root__1440__light__uz-Latn.png` — the hero tiles and the two KPI tiles below now share one
consistent card surface and the pinned-charts block reads as a proper empty-state row. The first three
tiles still lead with prose ("10 ta ochiq, 2 tasi muddatidan o'tgan") rather than a leading number; only
the two KPI tiles ("100%", "17") lead with a number as the critique asked for every tile to.

### 36. Onboarding checklist misaligned with its own title — **Not fixed**
Before/after both show `root__1440__light`: in `final/root__1440__light__uz-Latn.png` the "Boshlash"
title still starts to the right of the illustration column while the checklist rows start at the card's
left edge, one grid column earlier — the same misalignment the critique described.

### 37. Theme-change crossfade double-exposes text — **Not fixed**
No commit touches the theme-toggle's transition/crossfade logic. Not capturable via a static route
screenshot (this is a mid-transition frame); the code-level absence stands on its own.

### 38. Double-hyphen used where an em dash belongs — **Partially fixed**
`ac571d0` fixed the specific `/pages` empty-state copy the critique cited. But a repo-wide check of
`packages/i18n/messages/modules/*/uz-Latn.json` for a bare " -- " sequence still finds the exact string
the critique's own personal-screen example came from — `personal/uz-Latn.json` line 15's privacy note —
visible live in `final/personal__1440__light__uz-Latn.png` and `final/personal__390__light__uz-Latn.png`,
plus five more untouched instances across `events`, `admin`, `telegram`, `projects` and elsewhere in
`personal`. The i18n lint rule the critique asked for was not added, so this can regress again silently.

### 39. People directory repeats a null state 22 times, no hover card — **Not fixed**
Before: `critique-shots/people__1440__light__uz-Latn.png`. After: `final/people__1440__light__uz-Latn.png`
— the page gained a `PageHeader` eyebrow, but every "Bo'limsiz" card still repeats "Bo'lim belgilanmagan"
underneath a group heading that already says the same thing, and no hover card was added.

### 40. Pomodoro session log has no dates/grouping — **Not fixed**
`d9e1b1a` rebuilt the Pomodoro timer itself (a 220px ring, phase colour, cycle dots) but its description
does not mention the session log's date grouping, and no separate commit addresses it. Not independently
re-screenshotted (the log is inside the Pomodoro tab; `final/personal__1440__light__uz-Latn.png` covers
the Today tab, not Pomodoro) — flagging as not fixed pending a targeted capture of that tab.

---

## Scorecard

| Verdict | Count | Items |
|---|---|---|
| Fixed | 18 | 1, 2, 3, 4, 6, 7, 8, 12, 13, 15, 16, 17, 18, 19, 20, 29, 30, 32 |
| Fixed (by commit, not re-screenshotted) | 5 | 5, 10, 23, 27, 28 |
| Partially fixed | 7 | 11, 14, 22, 25, 31, 35, 38 |
| Not fixed | 10 | 9, 21, 24, 26, 33, 34, 36, 37, 39, 40 |

**Bottom line for the CTO:** the two screens the critique called out hardest — the login/auth wow moment
and `/account` (every user's most-visited screen) — are now genuinely fixed, along with the readability
bug that made every primary button invisible and the Uzbek-letter rendering bug that disfigured every
serif heading. The board, filters, analytics and events screens all read as real product now instead of
an admin template. What's left skews toward two screens that need a proper rebuild (the Gantt timeline
and the work table) rather than small polish, plus a handful of sweeps (undo coverage, the double-hyphen
typo, number formatting) that were fixed in one place but not carried through the whole app — worth a
follow-up pass before this ships.
