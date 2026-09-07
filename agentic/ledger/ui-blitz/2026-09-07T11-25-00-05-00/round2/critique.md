# Designer critique — round 2, 2026-09-08

Judged against `docs/03-plan/UI-OVERHAUL.md` (§1 principles, §2 Jakob map, §3 motion catalogue, §6
definition of done), `DESIGN.md` v2 (§2 tokens, §4 states, §5 copy, §9 recipes, §10 motion catalogue)
and `docs/03-plan/FEATURE-PLAN.md`. Bar: Linear, Huly, Luma.

## How this was judged

- Every PNG in `round2/after/` (26 routes × 2 widths × 2 themes × 2 locales, 208 files) was read,
  including the `/admin/*` set — the seeded `admin.super` account (`4eb1140`) closed the "One gap up
  front" hole in `report.md`, so the admin console itself is judged this round, not its
  no-permission state.
- The live app (`pnpm start --demo`, `http://127.0.0.1:5173`) was walked for everything a route
  screenshot cannot reach. Those captures are in `round2/interactions/` beside this file, produced by
  two new scripts committed with this critique:
  - `e2e/scripts/ui-round2-interactions.mjs` — card-detail sheet, board drag, hover card, Pomodoro
    log, table selection, theme mid-transition, mobile toast, reduced motion.
  - `e2e/scripts/ui-round2-probe.mjs` — measured geometry and computed styles (chip contrast ratios,
    sticky-header position, board scroller/mask, Gantt today-label collision, super-admin nav).
- Where a verdict depends on a number rather than an eye, the number is quoted (contrast ratio,
  rectangle, `Intl` output, grep count). Three findings below are root-caused to a single line.

## Verdict

The fix round did real work. The board is a board, the table is a real virtualised table with
selection and a bulk bar, the Gantt is a Gantt, drag has a pointer-following preview *and* a touch
path, `/account` and the departments hub are rebuilt, the mobile toast clears the tab bar, the theme
change is a clean circular reveal, the em-dash sweep is complete, and the celebration on a completed
to-do actually plays. **No round-1 item regressed.**

What is left divides into three piles:

1. **Three defects in the new work that a person will see today** — the inbox group-head chip draws
   its icon on top of its own label, the Gantt's "Bugun" label sits on top of a date, and the work
   table turned every cell into a form control so long titles are clipped with no ellipsis.
2. **Two i18n root causes that make the default locale look machine-made** — Chrome's CLDR for `uz`
   groups thousands with a **comma** and has no relative-time data at all, so `Intl.NumberFormat` and
   `Intl.RelativeTimeFormat` return `500,000` and `now` / `-12 min` in Uzbek. Neither can be fixed by
   "route it through `Intl`"; both need a local table. On top of that, 327 of the 696 `oʻ`/`gʻ`
   sequences in the uz-Latn message files use an ASCII apostrophe, so the same letter renders two
   different ways on the same screen.
3. **Colour discipline is still half-done.** `Badge` has *only* solid tones. Every default `<Badge>`
   paints a saturated block: 25 green `Faol` pills on `/admin/accounts`, three on `/admin/health`,
   `Joriy qurilma`, `Boshliq`, and — measured in dark mode — the board's priority pills at
   `oklch(0.8 0.12 75)` on an `oklch(0.18)` page, the brightest thing on the screen. `railClassName`,
   the signal §9.2 actually specifies for overdue and unread, is used in exactly one file in the
   whole app.

Motion is now genuinely dense on the screens the sweep touched and genuinely **absent** on three it
did not: `/account` (zero motion primitives — the screen every user visits), `/work/calendar` and
`/work/timeline` (a `Skeleton` and nothing else). Scores below.

---

# Ranked findings

## SEV1 — a person sees this today and it reads as broken

### 1. The inbox group-head chip draws its icon on top of its own label
`round2/interactions/inbox-reason-chip__1440__light.png`,
`round2/after/inbox__1440__light__uz-Latn.png`, `round2/after/inbox__390__light__uz-Latn.png`
(both themes, both locales, both widths)

"Qaror" and "Tizim" render with the gavel/bell glyph printed over the first letter. Measured: the
chip box is `[296, 222, 52, 24]`, the label span is `[306, 220, 32, 28]` and the `<svg>` is
`[306, 220, 12, 12]` — the icon and the text start at the same `x`, and a 28 px label sits inside a
24 px chip.

**Root cause** — `packages/ui/src/primitives/chip.tsx:44` wraps *all* children in
`<span className="min-w-0 truncate">`. `inbox-screen.tsx:197-199` passes `<ReasonIcon/>` **and** the
label as children, so the icon lands inside a `overflow:hidden; white-space:nowrap` box with the
text.

**Fix.** Give `Chip` a `leading?: React.ReactNode` prop rendered `shrink-0` *before* the truncating
span (the existing `dotClassName` already sits in the right place — the icon belongs beside it), and
change the inbox call site to `<Chip leading={<ReasonIcon reason={reason} className="size-3" />}>`.
Add a Chip story with a leading icon plus a long label so this cannot come back.

### 2. The Gantt's "Bugun" marker is printed on top of a date in the header
`round2/interactions/gantt-today__1440__light.png`,
`round2/after/worktimeline__1440__light__uz-Latn.png` (all four locale/theme combinations)

The today label reads "Bugun8" — the label box is `[697, 426, 45, 23]` and the day-number row sits at
the same `y`. The label element is `absolute top-0 flex h-full items-center px-1` on the today line,
so it starts at the very top of the grid, which is exactly where the day numbers are.

**Fix.** Lift the label into its own row above the day scale (a small pill anchored on the line, the
way Linear and Plane put "Today" in the header band), or shift the label `translate-x` clear of the
column and give it the page background with `px-1.5` so it never sits on a number. While there:
the bars run flush into the left edge of the grid with no "continues before this window" affordance —
add a fade or a chevron on any bar whose start is off-screen.

### 3. The work table made every cell a form control, so long titles are clipped with no ellipsis
`round2/after/worktable__1440__light__uz-Latn.png` ("Yangi loyiha uchun byudjet hisob-k"),
`round2/interactions/table-scrolled__1440__light.png` ("Portal uchun texnik topshiriqni yoz"),
`round2/interactions/table-bulkbar__1440__light.png`, `round2/after/worktable__1440__dark__uz-Latn.png`

The title column is an `<Input>` (`table-screen.tsx:529`), the assignee is a bordered `MemberPicker`
combobox, the priority is a **native `<select>`** and the due date is a bordered button — on every
one of ~100 rows. Three consequences: a long title is cut mid-word with no `text-overflow`, no
`title` attribute and no tooltip (an input cannot ellipsize); "Shahnoza Ne'matova" wraps inside its
picker and makes that row taller than its neighbours, which is visible jitter in a virtualised list;
and the screen reads as a spreadsheet of controls rather than a list of work. Linear's table is text
that becomes editable on hover/`Enter`.

**Fix.** Render each cell as text (`truncate` + `title`) and swap in the editor on hover, click or
`Enter` — the row already distinguishes clicks on controls from clicks on the row
(`table-screen.tsx:490-494`), so the plumbing exists. Replace the native `<select>` with the token
`Select`. Give the title column the space freed by dropping four borders per row (there is ~90 px of
unused width to the right of `HOLAT` today).

### 4. Numbers in the default locale use English separators — `Intl` alone cannot fix this
`round2/after/ai__1440__light__uz-Latn.png` ("Bu oy 500,000 soʻm dan 1 soʻm sarflandi"), every
`KpiTile`/`StatNumber` on `/`, `/analytics`, `/admin`

Measured in the running browser:
`new Intl.NumberFormat('uz-Latn').format(500000)` → `"500,000"`, `resolvedOptions().locale` → `"uz"`.
Chrome's CLDR data for `uz` (Latin) uses a comma group separator; `uz-Cyrl` and `ru` correctly give
`500 000`. So `packages/i18n/src/format.ts:56` (`formatNumber`) and `:162` (`formatUzs`) — 30 call
sites — plus `KpiTile`/`StatNumber`, which forward `locales: 'uz-Latn'` straight to NumberFlow, all
emit English grouping in the product's default locale. DESIGN.md §5 requires a space.

**Fix.** In `format.ts`, build the string with `formatToParts` and substitute the `group` part with
U+00A0 for `uz-Latn` (leave `uz-Cyrl`/`ru`/`en` to `Intl`). For NumberFlow, pass a `format` /
`locales` that produces the same grouping (`'uz-Cyrl'` numbering with uz-Latn copy is the cheapest
correct answer) or post-process its parts. Add a unit test asserting `formatNumber(500000,'uz-Latn')
=== '500 000'` — this is exactly the kind of defect only an assertion catches.

### 5. Relative times render in English on `/account` — `Intl.RelativeTimeFormat` has no `uz` data
`round2/after/account__1440__light__uz-Latn.png` ("Oxirgi faollik: now", "Oxirgi faollik: ~12 min"),
`round2/after/account__390__light__uz-Latn.png`

Measured: `new Intl.RelativeTimeFormat('uz-Latn',{numeric:'auto'})` resolves to `uz` and returns
`"now"`, `"-12 min"`, `"-3 h"`. The same call in `ru` returns `"12 минут назад"` and in `uz-Cyrl`
`"12 дақиқа олдин"`. `formatRelativeTime` (`format.ts`) is used by
`accounts/account-settings-screen.tsx:214`, so the one screen every user visits shows English on
every session row in the default locale.

**Fix.** Add a local uz-Latn relative-time table to `format.ts` (transliterate the uz-Cyrl forms:
`hozir`, `{n} daqiqa oldin`, `{n} soat oldin`, `{n} kun oldin`) and only delegate to
`Intl.RelativeTimeFormat` for the three locales that have data. Assert `formatRelativeTime` never
returns a string containing `min`/`h`/`now` for `uz-Latn`.

### 6. The admin console health screen prints raw English from the API
`round2/after/adminhealth__1440__light__uz-Latn.png` / `__ru.png`

"0 pending event(s)" and "0 group(s) connected" — English, with the programmer's `(s)` plural, in an
Uzbek and in a Russian UI. Source: `apps/api/src/modules/admin/repo.ts:807` and `:849` build the
`detail` string on the server. Latency prints as `5ms` with no space.

**Fix.** Return `{ code: 'queue.pending', params: { count } }` from the API and translate in the web
layer through the four message files; format the latency with the number formatter and a
non-breaking space. Add the two new keys in all four locales.

---

## SEV2 — reads as a template, or breaks the design system

### 7. `Badge` has no tinted variant, so status is still carried by solid saturated fills
`round2/after/adminaccounts__1440__light__uz-Latn.png` (25 solid green `Faol` pills),
`adminhealth__…` (`Ishlayapti` ×3), `admindepartments__…` (`Faol` ×8),
`adminsettings__…` (`Sozlangan`), `account__…` (`Joriy qurilma`), `departments__…` (`Boshliq`),
`workcalendar__1440__light__uz-Latn.png` (every event chip a solid navy or solid red),
`work__1440__dark__uz-Latn.png`

`packages/ui/src/primitives/badge.tsx:22-28` defines six tones and every one of them is a solid fill
(`bg-success text-success-foreground`, …). Screens that look tinted are overriding it with a
`className`. Measured in dark mode on the board: `Oʻrtacha` is `oklch(0.8 0.12 75)` and `Yuqori`
`oklch(0.8 0.11 72)` on a body of `oklch(0.18 0.015 250)` — three of the brightest blocks on the
screen, on every card. §9.2's actual signal, `railClassName`, is used in **one** file in the whole
app (`structure/unit-tree.tsx:376`); the overdue rail on `DataRow`/`TaskCard` is still not used
anywhere.

**Fix.** Add `variant: 'subtle' | 'solid'` to `badgeVariants`, with `subtle` = `bg-<tone>/12
text-<tone>` (theme-aware because the alpha composites over the current surface) and make it the
**default**; keep `solid` for exactly one blocked/critical state. Then delete the per-screen
`className` overrides and sweep the admin console, `/account`, `/departments` and the work calendar
onto the default. Separately, put overdue on the 2 px left rail via `railClassName` on the work
rows and the personal task rows, and leave the date chip plain.

### 8. Green still means "active", "configured", "current" and "head"
`adminaccounts__…` (`Faol`), `adminhealth__…` (`Ishlayapti`), `adminsettings__…` (`Sozlangan`),
`account__…` (`Joriy qurilma`), `departments__…` (`Boshliq`)

DESIGN.md §2.1 keeps green strictly for success. Events' `Ochiq` was correctly moved to neutral in
round 1; the same sweep never reached the admin console, the account screen or the departments hub.

**Fix.** `Faol`/`Ishlayapti`/`Sozlangan` → `info` subtle; `Joriy qurilma`/`Boshliq` → `primary`
outline chip. Keep green for done/approved/on-track only. A one-line lint over `tone="success"` call
sites would keep this honest.

### 9. `/analytics` still ships the raw query-syntax filter box round 1 rejected
`round2/after/analytics__1440__light__uz-Latn.png`, `analytics__390__light__uz-Latn.png`

A bare input pre-filled with `assignee:@me status:active due:<today`, a `Qo'llash` button and
`Filtrni saqlash`. The work views got real `FilterChip`s + `+ Filtr` (`679165f`); analytics was
listed in the same finding and was never touched. Nobody in this department will type that grammar.

**Fix.** Reuse the work views' `FilterBar` verbatim — chips, `+ Filtr` popover, the raw text behind
the existing "Kengaytirilgan" toggle, URL as state, save-as-view enabled the moment a filter is
non-empty.

### 10. Project cards are still the 78 px stubs round 1 rejected
`round2/after/projects__1440__light__uz-Latn.png` (six cards end at y=325, 570 px of empty page
below), also visible as the project header cards inside `work__1440__light__uz-Latn.png`

Ring + coloured dot + name + "44% bajarildi" — no owner, no members, no next milestone, no due date,
no status. And the ring prints `44` while the line beside it prints `44% bajarildi`, which is the
same number twice. `report.md` marked this "Fixed (by commit) `e09ded0`" — that commit rebuilt the
project *page*, not the list.

**Fix.** Rebuild `ProjectTile`: `%` inside the ring (drop the duplicate line), name + status badge,
one-line objective, next milestone with its date, member `AvatarStack`, task fraction. Fill the grid
or drop to two columns so six cards do not leave two thirds of the page empty.

### 11. The people board opens with 27 columns and no way to narrow it
`round2/after/work__1440__light__uz-Latn.png` (4th column cut mid-word at the viewport edge),
`work__1440__light__ru.png`, `work__390__light__uz-Latn.png`

Measured: 27 `[data-dnd-column]` elements at 288 px each; the scroller is `scrollWidth: 8192`,
`clientWidth: 1112`. The scroller and its 40 px right-edge mask are correctly in place (that half of
round 1's finding is fixed), but a 26-person department means the board opens showing 3.8 columns of
27 with no member filter, no "show N of M", no collapse-all and no saved default. At 390 the column
body gets ~220 px of an 844 px viewport because the page chrome above it (title, six tabs, quick-add,
filter row, "Kengaytirilgan") eats 500 px.

**Fix.** Default the board to the viewer plus their direct reports with a "Barcha xodimlar (27)"
chip to expand, wire the existing per-column collapse into a "show N of M" control, and remember the
choice per user. At ≤768 px collapse the quick-add and the filter row into the `PageHeader` overflow
so the board itself gets the viewport.

### 12. The card-detail sheet runs a two-column layout inside 480 px
`round2/interactions/card-detail__1440__light.png`

The overlay is correct now (`fixed inset-0`, measured `[0,0,1440,900]`, panel `[960,0,480,900]` —
round 1's finding is fixed). Inside it, the left column is ~170 px: the description textarea breaks
after four words, every checklist item wraps to two lines, the comment bubble takes four lines for
three words, and two labels are clipped by their own inputs — "Havola manzi" (…li) and "Izoh yoz"
(…ing). `MUHIMLIK` is a native `<select>`. The status row puts a solid destructive `Muddati oʻtgan`
badge one tab-stop from the primary action.

**Fix.** One column inside the sheet: title, status row, description, then a definition-list of
properties (`KIMGA`, `MUHIMLIK`, `MUDDAT`, …) as label-above-value rows at full sheet width, then
links, checklist and comments. Widen `--width-detail-panel` to 560–600 px. Replace the native select
with the token `Select`. Never truncate a field label.

### 13. The admin audit log is developer output
`round2/after/adminaudit__1440__light__uz-Latn.png` / `__ru.png`

Fifty rows of `session.created`, `user.updated`, `super_admin`, `head`, `session · f8dda908`,
`user · 809f7883` — every column a machine key, in monospace, untranslated in both locales. The
filter placeholder ("masalan: admin.user.lock") teaches the same grammar §8 rejected for filters.

**Fix.** Translate the action into a sentence per event type ("Alisher Administratorov tizimga
kirdi"), show the actor as an avatar + name (the role is a chip, not the identity), turn the object
id into a short chip that links to the object, group by day with a date sub-head, and replace the
free-text action filter with the same chip filter the rest of the app uses.

### 14. The super admin's sidebar offers every department route
`round2/after/admin__1440__light__uz-Latn.png`, `round2/interactions/superadmin-on-work__1440__light.png`

`admin.super` has no department membership, yet the sidebar renders Vazifalar, Guruh loyihalari,
Shaxsiy, Tadbirlar, Xodimlar, Tuzilma, Sahifalar, Tahlil and AI — nine destinations that cannot
work — plus the department-scoped `+ Yangi` and command palette in the top bar. Confirmed live by
navigating there as that account.

**Fix.** Render the department nav groups only when the session has a department membership; for a
membership-less super admin the sidebar is the console's own sections plus `Hisob sozlamalari`.
Drop `+ Yangi` and the department entries from the palette on the same condition.

### 15. The personal Today row still loses the title to the chips at 390, and the sprint goal is ellipsized
`round2/after/personal__390__light__uz-Latn.png`

"Kartochka boʻyich…" and "Yigʻilish kun tartibi…" are cut while `Hafta`, `30′` and `Fokus` keep their
full width beside them; the sprint hero reads "Boʻlim hisobotlarini yakunlash va jam…". DESIGN.md §5
forbids ellipsizing this element and in a task list the title *is* the content. `81056b2` fixed the
1440 case only.

**Fix.** At ≤768 px put the chips on a second line under the title (or collapse `30′` + `Fokus` into
one icon button) and let the title wrap to two lines. The sprint goal wraps, never clamps —
`line-clamp` is what is producing the ellipsis.

### 16. Two of five events share one cover illustration
`round2/after/events__1440__light__uz-Latn.png` (SEN 10 and SEN 27), `events__390__light__ru.png`

Round 1 asked for "a deterministic per-event illustration pick so two events never share one". The
covers are full-bleed now (the main half of the finding is fixed) but the pick still collides.

**Fix.** Hash the event id across the full illustration set and, when a month group has fewer events
than illustrations, pick without replacement inside the group so a repeat is never adjacent. Add a
soft top scrim so the status chip always has contrast whatever the artwork.

### 17. The uz-Latn message files mix two different apostrophes for the same letter
`round2/after/departments__1440__light__uz-Latn.png` ("Bo'limlar", ASCII) next to
`events__1440__light__uz-Latn.png` ("Koʻngillilar", U+02BB) — and both glyphs appear on `/` at once

Counted across `packages/i18n/messages/modules/*/uz-Latn.json`: **327** `oʻ`/`gʻ` written with an
ASCII `'` versus **369** written with the correct modifier letter U+02BB. Worst offenders:
`departments` 106/0, `admin` 88/3, `accounts` 56/2, `analytics` 40/13, `pages` 28/2. Round 1's
finding #2 was about the *font* dropping U+02BB; that is fixed, but half the copy never uses it, so
the letter renders as a typewriter quote on some screens and as a turned comma on others.

**Fix.** Normalise every uz-Latn message to U+02BB (a scripted replace of `([og])'` → `$1ʻ`,
reviewed for the handful of genuine quotation marks), and add a rule to the i18n gate that rejects
`[ogOG]'` in any `uz-Latn.json`.

### 18. The inbox is still missing its unread signal and its primary action
`round2/after/inbox__1440__light__uz-Latn.png`, `inbox__390__light__uz-Latn.png`

The no-selection state and the reason grouping landed (round 1's main complaint is fixed), but there
is no unread dot on a row, the header's three actions are all ghost buttons with no primary
("Hammasini oʻqilgan deb belgilash" was named in round 1 and is still absent), the row repeats the
reason chip that its own group head already states, and the title truncates at ~190 px
(`Yangi qaror qayd etildi: "M…`) where a second line would fit. The detail pane is a fixed 410 px box
with 280 px of empty page beneath it while the list column has no panel at all.

**Fix.** Unread dot on the row rail; drop the per-row reason chip while grouped; `line-clamp-2` on
the title; one primary header action; make the detail pane fill the content height so the two panes
are the same box.

### 19. Structure rows still start their meta line left of the name they belong to
`round2/after/structure__1440__light__uz-Latn.png`

The rail, avatar, member count and overflow menu all landed. But "Boshligʻi hali tayinlanmagan
+ Ushbu boʻlimga qoʻshish · Tayinlash" starts at x=332 while the unit name starts at x=390 — the same
ragged alignment round 1 flagged — and the member token still renders as a form-control chip with an
`×` inside a read-only list.

**Fix.** One grid: rail | avatar | content column, and the meta line starts in the content column.
Move `+ Ushbu boʻlimga qoʻshish` / `Tayinlash` into the row's overflow menu (it already exists) and
render members as a plain `AvatarStack`, with removal living in the row menu.

### 20. `/account` uses a different content grid from every other screen
`round2/after/account__1440__light__uz-Latn.png`

Title starts at x=405 with no eyebrow, while every other screen's `PageHeader` starts at x=296 with
one. Navigating from `/personal` to `/account` visibly shifts the whole page 110 px right and drops
the eyebrow line.

**Fix.** `PageContainer` → `PageHeader` (eyebrow `HISOB`, title, description, no actions) with the
section nav as a sticky left rail *inside* the container, aligned to the shared gutter.

---

## SEV3 — polish

### 21. `34daq` / `15daq` — no space between number and unit
`round2/after/personal__1440__light__uz-Latn.png`, `personal__390__light__uz-Latn.png`,
`round2/interactions/toast-mobile__390__light.png`

`apps/web/src/features/personal/lib/sprint-labels.ts:51-56` concatenates
`` `${minutes}${t('personal.duration.minutesShort')}` ``. The Pomodoro stats get this right
("17 daq"), the sprint chip does not.

**Fix.** Insert U+00A0 in all three branches of `formatTimeLeft`, and use the same helper for the
task estimate so `30′` becomes `30 daq` — the prime symbol is neither localised nor in the copy rules.

### 22. The Pomodoro timer card is 490 px tall for a 200 px ring, and "Tanaffusni boshlash" is a bare link
`round2/interactions/personal-pomodoro__1440__light.png`

The day-grouped session log with durations and tinted pills is a genuine fix. Above it the timer
card leaves ~250 px of empty space around the ring, and the secondary action is still an underlined
text link under the primary rather than a `secondary` button (round 1 named this).

**Fix.** Ring to 260 px, card padding to `--space-8`, cycle dots directly under the ring, and
`Tanaffusni boshlash` as a `secondary` button beside `Fokusni boshlash`.

### 23. The people hover card repeats the null state and offers no way to contact anyone
`round2/interactions/people-hovercard__1440__light.png`

It works and it is quick (round 1's finding is fixed). Its content is: the name twice, the job title,
`Aʼzolik: Aʼzo`, `Boʻlim: Boʻlim belgilanmagan`, and one action. §8 asks for the Slack-members
convention: contact actions.

**Fix.** Drop the `Boʻlim:` line when there is no unit (the card already says the person's role),
render the two facts as eyebrow/value rather than `Label: value` prose, and add e-mail / Telegram /
"ish biriktirish" alongside "Doskadagi ustunini ochish".

### 24. The events header carries four buttons; `/pages` is a flat list with no tree
`round2/after/events__1440__light__uz-Latn.png` (two view toggles + `.ics` + primary; at 390 they
stack into three rows and eat 130 px), `pages__1440__light__uz-Latn.png` (one row, 900 px of empty
page, no nesting, no description column, and no `PageHeader` description line)

**Fix.** Events: view toggle stays, `.ics` moves into a `⋯` menu (§9.1 allows one primary plus two
secondary). Pages: build the nested tree with disclosure triangles, an updated-by column and drag to
re-parent, or say plainly in the header that pages are flat.

### 25. Admin quick links are four blue text links; health has no legend and a redundant dot
`round2/after/admin__1440__light__uz-Latn.png`, `adminhealth__1440__light__uz-Latn.png`

"Tezkor havolalar" is a bare list of underlined links in a card, and the health rows carry both a
coloured dot *and* a badge that say the same thing, with grey meaning "not configured" and nothing on
screen saying so.

**Fix.** Quick links become icon + title + one-line description rows (`DataRow`). Health: keep the
badge, drop the dot, and add a one-line legend or a "Sozlanmagan" explanation under the card title.

### 26. `Roʻyxatdan oʻtishni yopish` is a destructive-red button for a routine setting
`round2/after/adminsettings__1440__light__uz-Latn.png`

Closing registration is reversible and is not a destruction; painting it the same red as
`Oʻchirishni boshlash` (the wipe) flattens the severity scale the danger card is trying to establish.
The sentinel public key also has no copy button.

**Fix.** Registration becomes a `Switch` with the state as a subtle badge; keep red for the wipe
alone. Add a copy-to-clipboard icon button on the sentinel key field.

### 27. Home's pinned-charts block is a paragraph with a link, not an empty state
`round2/after/root__1440__light__uz-Latn.png`

Every tile above it now leads with a `NumberFlow` number (round 1's finding is fixed) and the
onboarding checklist is aligned to its own title. The last block is still left-aligned prose plus a
text link where §9.6 asks for an illustration, one line and exactly one action.

**Fix.** `EmptyState` with the small chart illustration and a single `Tahlilga oʻtish` button.

### 28. Two charts on `/analytics` render one enormous bar and one invisible one
`round2/after/analytics__1440__light__uz-Latn.png` ("Tadbirlarda ishtirok" is a single 110 px-tall
bar; "Soʻrovnomalarda qatnashish" is a 3 % sliver on a 0–100 % axis), `analytics__390__…`

Neither is wrong, both look broken. There is also no legend anywhere explaining what the blue and the
red series mean in "Xodimlar boʻyicha yuklama".

**Fix.** Cap bar thickness (`maxBarSize`) so a one-category chart does not fill its plot; for a
percentage chart show the value as a label on the bar so a 3 % sliver still reads. Add a compact
legend to every multi-series chart card.

### 29. The invite block shows the dev origin and repeats the viewer's role
`round2/after/departments__1440__light__uz-Latn.png`

`http://127.0.0.1:5173/join?key=…` is correct behaviour (it is the current origin) but will be the
first thing a reviewer notices; and the card says `Boshliq` twice — once as a badge, once as
`SIZNING ROLINGIZ`.

**Fix.** Build the invite URL from the configured public base URL, not `location.origin`; drop the
duplicate role badge; put the copy button inside the field as an icon button, matching the sentinel
key field once that gets one.

### 30. The mobile board and table are unusable as laid out
`round2/after/work__390__light__uz-Latn.png` (board body ~220 px tall, cards cut mid-line),
`worktable__390__light__uz-Latn.png` (a five-column table scrolled horizontally on a phone, four rows
visible, and a `Keng/Ixcham` density toggle that means nothing at 390)

**Fix.** Below 768 px the table collapses to `DataRow` cards (title, assignee avatar, due chip,
status) and the density toggle is hidden; the board hides the quick-add and filter row behind the
header overflow so the columns get the viewport; the tab strip scrolls with mask fades instead of
wrapping to two rows.

---

# Motion density — per screen, 0–5

Scored on "feels alive and purposeful" against DESIGN.md §10's 19-row catalogue. The round-2 sweep
(`510a3df`, `02dfbb9`, `c0dff90`) genuinely raised the floor; the gaps below are what is still
missing, verified by grepping each screen for motion primitives and by watching the live app.

| Screen | Score | What ships | What is missing |
|---|---|---|---|
| Shell (sidebar, top bar, palette, `PageTransition`) | **4.5** | Route crossfade, sidebar `layoutId`, tab underline spring, `InboxBell` pop-on-increment, palette sheet at 390 | Nothing material. The department switcher opens with no transform; the palette's result list does not stagger. |
| Auth (`/login`, `/setup`) | **4** | `AmbientGradient` drift, `BlurFade` entrance, button loading→check morph | The card itself does not rise in; an auth error shakes nothing; the locale/theme controls are static. |
| Home (`/`) | **4** | Stagger, `NumberFlow` on all five tiles, `Reveal`, ambient drift, onboarding-complete `Celebrate` with a once-per-browser flag | The greeting never reveals (it is the first thing you read); the pinned-charts block has no entrance; tile hover has no lift. |
| Personal → Bugun | **5** | Stagger, `ProgressRing`, `Reveal`, `AnimatePresence` on completion, `Celebrate` + undo toast — verified live at 390 | Nothing. This is the best screen in the product. |
| Personal → Davrlar | **4.5** | Stagger, `ProgressRing`, `Reveal`, per-row `Celebrate` on sprint complete | Sprint progress ring does not animate from 0 on mount. |
| Work board | **4.5** | Per-column stagger, `HoverLift` + `PressScale`, custom drag preview with `preserveOffsetOnSource`, touch long-press lift, FLIP drop settle on `spring.settle`, column highlight | Column collapse/expand is instant; the drag preview shows only the title, not the card; no cross-column count animation on drop. |
| Card detail sheet | **4** | Vaul sheet spring, overlay fade + blur, `Skeleton`, `Collapsible`, `Celebrate` on done and on checklist completion | Property edits commit with no feedback; the comment list does not animate a new comment in. |
| Events | **4** | List stagger, `HoverLift` on cards, `Celebrate` on RSVP and carpool, `Skeleton`, `Reveal` in the dialog | Cover has no hover scale (Luma's signature); month group heads do not reveal; the capacity bar does not fill on mount. |
| Inbox | **4** | Row stagger, `Celebrate` on the >0→0 transition, bell pop | Archiving a row removes it instantly (no exit); switching selection swaps the detail pane with no crossfade; no unread-dot fade on read. |
| Projects (list) | **4** | Grid stagger, tile `HoverLift`, `ProgressRing` | The ring does not sweep from 0; tiles have no press feedback. |
| Project page | **4** | Stagger, `Skeleton`, `ProgressRing`, milestone dot timeline | Milestone completion has no celebration; tab change is instant. |
| Analytics | **4** | Recharts draw-in gated on `useChartAnimation`, `NumberFlow` KPI tiles, `KpiTile` | Charts do not re-animate when the date range changes (the one moment a re-draw would explain itself); pin/unpin is instant; no skeleton→chart crossfade. |
| Structure | **3.5** | Tree stagger, `Collapsible`, `HoverCard`, `Reveal`, `IdleFloat` on the empty illustration | The org-chart tab has no motion at all — nodes appear, connectors do not draw; adding a unit does not animate in. |
| People | **3.5** | Grid stagger, `HoverCard` | No re-stagger when the search or the unit chip narrows the grid (the list just swaps); cards have no lift. |
| Pages | **3** | Stagger per kind-group, `HoverLift`, `AnimatedCheck` | Opening a page is a hard route change; no tree disclosure animation (there is no tree yet); creating a page does not animate the new row in. |
| AI | **3** | Flag-list stagger, usage-table stagger, `ProgressRing` | The budget ring does not draw in on mount; toggling a flag gives only the `Switch`'s own motion, no row acknowledgement; no celebration when the budget resets. |
| Admin console | **3** | Table-body stagger keyed to filters, bar/donut draw-in via the one-frame mount trick, `KpiTile` | Health polls every 30 s and nothing moves (a live console should breathe — a subtle dot pulse or a refresh sweep); maintenance-mode toggle is instant; the wipe/danger flow has no ceremony motion. |
| Departments hub | **3** | `Stagger`, `HoverLift`, `Skeleton`, `Reveal`, `BlurFade`, `IdleFloat` on the pending state | Copying the invite gives no inline confirmation animation (only a toast); the QR does not fade in; switching department does not transition. |
| Work → Mine | **3.5** | Group stagger keyed to the query, `HoverLift`, `PressScale` | Completing from this list has no celebration; groups do not collapse; no re-stagger on group change. |
| Work → Jadval (table) | **2** | CSS `devon-rise-in` per virtualised row (correctly chosen over `Stagger` for scroll perf) | The bulk bar appears instantly instead of sliding up; selection has no tick animation; re-sorting swaps rows with no FLIP (Linear animates the re-order — it is what tells you the sort happened); density toggle is instant. |
| Work → Taqvim | **1** | `Skeleton` only | Nothing: month change is a hard swap where a slide belongs, day cells never stagger, chips have no hover, "yana N ta" expands instantly, today's cell is not marked by motion. |
| Work → Muddatlar (Gantt) | **1** | `Skeleton` only | Nothing: bars do not draw in from their start date, zoom (Kun/Hafta/Oy) is a hard re-layout where a scale transition belongs, the today line does not sweep in, group heads do not collapse, bars have no hover lift. |
| `/account` | **1** | Nothing — zero motion primitives in the file | The screen every user visits: the device list never staggers, "Yana 97 tasini koʻrsatish" expands instantly, signing a device out removes the row with no exit, 2FA enable has no success morph, the danger zone has no ceremony. |
| 404 / states | **3.5** | `StateShell` gives every `StateView` an `IdleFloat` illustration + `Reveal` | Fine as is. |

**Where to spend the next motion hour**, in order: `/account` (1 → 4: stagger the device list,
`AnimatePresence` on sign-out, animate the disclosure), the Gantt (1 → 4: bar draw-in from the start
edge, a scale transition on zoom), the calendar (1 → 4: month slide, day-cell stagger), and the table
(2 → 4: bulk-bar slide-up and a FLIP on re-sort). Those four screens are the only places left where
the product feels static next to Linear.

---

# Round-1 items — verdict on all 40

**No regressions.** Legend: ✅ fixed · ◐ partial · ✗ still open.

| # | Round-1 finding | Now | Evidence |
|---|---|---|---|
| 1 | Unreadable primary/destructive labels | ✅ | `login__1440__light__uz-Latn.png` |
| 2 | `ʻ` U+02BB broken in the serif face | ✅ (see new #17 for the *copy* side) | `personal__1440__light__uz-Latn.png` |
| 3 | `sr-only` table forces 390 overflow | ✅ | `analytics__390__…` is exactly 390 wide |
| 4 | Inbox row actions outside the row | ✅ | `inbox__1440__…` |
| 5 | Card-detail scrim stops mid-viewport | ✅ | overlay measured `fixed [0,0,1440,900]`, panel `[960,0,480,900]` |
| 6 | Board is not a board | ✅ (chrome) / ◐ (27 columns — new #11) | `work__1440__…`, scroller `sw 8192`, mask present |
| 7 | `/account` raw User-Agent dump | ✅ | `account__1440__…` |
| 8 | Query-syntax filter box | ◐ — fixed on `/work/*`, **not** on `/analytics` (#9) | `analytics__1440__…` |
| 9 | No drag preview, dead on touch | ✅ | `card-tile.tsx:144-162` + touch lift path; `board-drag__1440__light.png` |
| 10 | Checkbox celebration never plays | ✅ | `toast-mobile__390__light.png` — row still mounted, undo toast |
| 11 | Undo over confirm | ◐ — 6 → 14 files (RSVP, carpool, polls, projects, table, timeline) | grep |
| 12 | Auth ambient gradient invisible | ✅ | `login__1440__light__uz-Latn.png` |
| 13 | Home gradient hard bottom edge | ✅ | gradient now `[296,88,1099,641]`; pixel column sampling finds no step |
| 14 | Solid status fills, no rail | ◐ — work views tinted; `Badge` primitive and admin/account/departments/calendar not (#7) | dark board measured `oklch(0.8 0.12 75)` |
| 15 | `2026 M09` month key | ✅ | `events__…`, `workcalendar__…` |
| 16 | Native `M/D/Y` date inputs | ✅ | `analytics__…` shows `15.06.2026` |
| 17 | Chart cards leave dead space | ✅ | `analytics__1440__…` |
| 18 | Chart with no series has no empty state | — not re-testable (the demo now has data) | — |
| 19 | Green used for non-success | ◐ — events fixed, admin/account/departments not (#8) | `adminaccounts__…` |
| 20 | Event covers are clip-art on a band | ◐ — full-bleed now, two events share art (#16) | `events__1440__…` |
| 21 | Departments hub missing cards/invite/QR | ✅ | `departments__1440__…` |
| 22 | Screens skip `PageHeader` | ◐ — projects/structure/departments fixed, `/account` not (#20) | `account__1440__…` |
| 23 | Project cards are 78 px stubs | ✗ (#10) | `projects__1440__…` |
| 24 | Timeline unreadable | ✅ rebuilt / new defects (#2) | `worktimeline__1440__…` |
| 25 | Structure unstyled | ◐ — rails/avatars/menu landed, alignment and member pill not (#19) | `structure__1440__…` |
| 26 | Table unvirtualised, no selection | ✅ / new defect (#3) | `table-bulkbar__1440__light.png`, `table-scrolled__…` |
| 27 | Label chips illegible | ✅ — measured 5.45–12.78:1 | probe output |
| 28 | Destructive "cancel event" in the primary row | ✅ (`fa0df36`) | commit |
| 29 | Pages empty state has no action | ✅ / tree still flat (#24) | `pages__1440__…` |
| 30 | Inbox two-pane empty | ✅ / new chip defect (#1) and gaps (#18) | `inbox__1440__…` |
| 31 | Today row title vs chips | ◐ — 1440 fixed, 390 not (#15) | `personal__390__…` |
| 32 | Native scrollbar on the tab strip | ✅ / no mask fade at 390 (#30) | `personal__390__…` |
| 33 | English number separators | ✗ — root-caused to CLDR `uz` (#4) | live `Intl` output |
| 34 | Toasts collide with the tab bar | ✅ — toaster `bottom: 72px`, bar `[0,784,390,60]` | `toast-mobile__390__light.png` |
| 35 | Home tiles bury their numbers | ✅ / pinned-charts block (#27) | `root__1440__…` |
| 36 | Onboarding checklist misaligned | ✅ | `root__1440__…` |
| 37 | Theme change double-exposes text | ✅ | `theme-mid__1440.png` at 120 ms is clean |
| 38 | `--` where an em dash belongs | ✅ — 0 occurrences repo-wide | grep |
| 39 | People repeats a null state, no hover card | ✅ / hover-card content (#23) | `people-hovercard__1440__light.png` |
| 40 | Pomodoro log has no dates | ✅ / break button still a link (#22) | `personal-pomodoro__1440__light.png` |

---

## Not faulted (worth keeping)

The reduced-motion contract in `packages/ui/src/motion` (still the strongest engineering in this
pass — every primitive added this round gates on `useReducedMotion()`); the decision to use a plain
CSS keyframe rather than `Stagger` for the virtualised table rows, and the reasoning written down for
it; the drag implementation, which solved both the desktop preview and the touch path properly rather
than shipping one and claiming both; the celebration triggers, every one of which is guarded against
re-firing on an already-complete state; `/account`'s rebuild; the departments hub; the Pomodoro
day-grouped log; and the four-locale coverage, which held through a very large sweep.
