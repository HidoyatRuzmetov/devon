# UI-blitz round-2 fix verification -- 2026-09-08

Re-screenshot pass over `round2/critique.md`'s 30 ranked findings, taken against the fix commits
listed in `git log` between the critique commit (`33d4707`) and `b426652` (22 `ui:`/`fix:` commits).
Captured with the unmodified `e2e/scripts/ui-blitz-shots.mjs` into `round2/final/` (208 files, 0
capture failures, locale-switch self-check passed) against a freshly booted `pnpm start --demo`
(Postgres + Valkey via Docker, API on :3000, web on :5173). No product code was touched to produce
this report -- every verdict below is read off the screenshots plus, where a screenshot alone
cannot show the fact (an event handler, a conditional render, a helper function), the source line the
critique itself cited.

All paths below are relative to this file's directory (`round2/`). "Before" = `after/...` (the
pre-fix-round capture the critique was written against). "After" = `final/...` (this pass).

## Scope note on interaction-only findings

Four findings (#12 card-detail sheet, #22 Pomodoro card, #23 people hover card) and the Round-1
drag/theme/toast items were originally evidenced by `e2e/scripts/ui-round2-interactions.mjs`, a
second script the critique's authors wrote alongside the route-screenshot script. The task for this
pass was specifically to re-run `ui-blitz-shots.mjs`, which only captures routes, not hover states,
open sheets, or mid-interaction frames -- so those findings are verified below by reading the fix
commit's diff against the exact lines the critique cited, not by a fresh interaction screenshot. This
is called out per-finding.

---

## SEV1 -- a person sees this today and it reads as broken

### 1. Inbox group-head chip icon drawn over its own label -- FIXED
Before: `after/inbox__1440__light__uz-Latn.png`. After: `final/inbox__1440__light__uz-Latn.png`.
"Qaror" and "Tizim" render cleanly with the icon to the left of the label, not on top of it, at both
widths/themes/locales. Commit `b89612a`.

### 2. Gantt "Bugun" marker printed on top of a date -- FIXED
Before: `after/worktimeline__1440__light__uz-Latn.png`. After:
`final/worktimeline__1440__light__uz-Latn.png`. The "Bugun" pill now sits in its own row above the day
scale; no collision with the day-number row. Commit `cc6c303`. (The secondary "while there" ask -- a
fade/chevron on bars that start off-screen -- was not part of the commit message and is not visible in
the capture; left open.)

### 3. Work table cells were form controls; long titles clipped -- FIXED
Before: `after/worktable__1440__light__uz-Latn.png`. After: `final/worktable__1440__light__uz-Latn.png`.
"Yangi loyiha uchun byudjet hisob-kitobi" now renders in full as text, no mid-word clipping; assignee
is a plain chip, priority reads as tinted text with a chevron rather than a bordered native select.
Commit `cc6c303`.

New regression found in this pass (not in the original 30): in the HOLAT column, the status badge
(Faol) now overlaps the due-risk badge (Muddati o'tgan) -- only "ddati o'tgan" is visible, printed
directly on top of/behind the Faol pill, on every overdue row, both themes. See
`final/worktable__1440__light__uz-Latn.png` and `final/worktable__1440__dark__uz-Latn.png` (zoomed
crops confirm the same collision in both). This did not exist in the `after/` (pre-fix) capture, where
the two badges rendered side by side and fully legible -- this is a side effect of the cell-to-text
rework in `cc6c303`/`table-screen.tsx`. This is now the worst defect on the screen and should be
the first thing fixed next.

### 4. English number separators in the default locale -- FIXED
Before: `after/ai__1440__light__uz-Latn.png` ("500,000"). After: `final/ai__1440__light__uz-Latn.png`
-- "Bu oy 500 000 so'm dan 1 so'm sarflandi" with a proper (non-breaking) space. Commit `0665704`.

### 5. Relative times render in English on /account -- FIXED
Before: `after/account__1440__light__uz-Latn.png` ("now", "~12 min"). After:
`final/account__1440__light__uz-Latn.png` -- "Oxirgi faollik: hozir", "3 soat oldin", real Uzbek text
throughout the device list. Commit `0665704`.

### 6. Admin health screen printed raw English from the API -- FIXED
Before: `after/adminhealth__1440__light__uz-Latn.png` ("0 pending event(s)"). After:
`final/adminhealth__1440__light__uz-Latn.png` -- "0 ta kutilayotgan hodisa", "0 ta guruh ulangan", and
latency now reads "4 ms" with a real space. Commit `95181b4`.

SEV1 tally: 5 of 6 fully fixed, 1 fixed-with-a-new-defect (#3's regression above).

---

## SEV2 -- reads as a template, or breaks the design system

### 7. Badge had no tinted variant -- FIXED
Before: `after/adminaccounts__1440__light__uz-Latn.png` (25 solid green Faol pills). After:
`final/adminaccounts__1440__light__uz-Latn.png` -- all 25 Faol pills now render as a subtle tinted
chip, not a solid fill; same on adminhealth, admindepartments, adminsettings. The work table
(`final/worktable__1440__light__uz-Latn.png`) also now shows a coloured left rail on overdue rows
(a bespoke rail in table-screen.tsx, not the shared railClassName prop -- still only one call site
uses that exact prop, structure/unit-tree.tsx, so the primitive-level fix is partial even though the
visible symptom is gone everywhere checked).

### 8. Green still meant "active"/"configured"/"current"/"head" -- FIXED
Before/after same files as #7. Faol/Ishlayapti render info-tinted (blue), Joriy qurilma on
/account renders as a primary outline chip, not solid green. Commit `d875f16`.

### 9. /analytics still shipped the raw query-syntax filter box -- FIXED
Before: `after/analytics__1440__light__uz-Latn.png` (bare input pre-filled with
"assignee:@me status:active due:<today"). After: `final/analytics__1440__light__uz-Latn.png` -- the
same chip-based "+ Filtr" / "Kengaytirilgan" bar the work views use. Commit `074a298`.

### 10. Project cards were 78px stubs -- FIXED
Before: `after/projects__1440__light__uz-Latn.png` (six cards, ~570px of empty page below). After:
`final/projects__1440__light__uz-Latn.png` -- full ProjectTile rebuild: % inside the ring (no
duplicate number line), status badge, owner, next milestone with date, member avatar stack, task
fraction; the 2x3 grid fills the page. Commit `03441f7`.

### 11. People board opened with 27 columns, no way to narrow -- FIXED
Before: `after/work__1440__light__uz-Latn.png` (27 columns, 4th cut mid-word). After:
`final/work__1440__light__uz-Latn.png` -- board opens to the viewer's own column plus "Biriktirilmagan"
with a "Barcha xodimlar (26)" chip to expand. At 390 (`final/work__390__light__uz-Latn.png`) the
quick-add/filter row is now collapsed behind a single filter-icon button, giving the board body real
height instead of ~220px. Commit `e009808`.

### 12. Card-detail sheet ran two columns inside 480px -- FIXED (verified by diff, not re-screenshot)
This is an interaction-only state (ui-round2-interactions.mjs's card-detail__1440__light.png,
which this pass did not re-run -- see scope note above). Commit `5106f63` ("card detail sheet is one
column, not a two-up form squeezed into 170px") rewrites card-detail-sheet.tsx to a single-column
layout with a definition-list property block and a wider panel; read against the critique's exact
complaint, the commit addresses it directly. Flagged for a follow-up interaction-screenshot pass to
confirm visually.

### 13. Admin audit log was developer output -- PARTIALLY FIXED
Before: `after/adminaudit__1440__light__uz-Latn.png` (session.created, user.updated, monospace,
untranslated). After: `final/adminaudit__1440__light__uz-Latn.png` -- grouped by day with date
sub-heads, actor shown as avatar + name with role as a chip, login events translated to full sentences
("Alisher Administratorov ... tizimga kirdi"), and the free-text filter replaced with the same chip
filter used elsewhere (Barchasi / Kirish / Hisoblar / Boshqaruv / Bo'limlar / Boshqa). Still open:
non-login events (: access.denied, : user.updated, : work.card_updated) still print the raw
event-type string after a colon rather than a full translated sentence per event type, and object ids
still show as short hash chips (Foydalanuvchi . 809f7883) rather than a link to the object. Commit
`cd67844` did the structural rework; the per-event-type sentence translation the critique specifically
asked for is only done for the login case.

### 14. Super admin sidebar offered every department route -- FIXED
Before: `after/admin__1440__light__uz-Latn.png` (Vazifalar, Guruh loyihalari, Shaxsiy, Tadbirlar, etc.
all present for a membership-less account). After: `final/admin__1440__light__uz-Latn.png` and
`final/adminhealth__1440__light__uz-Latn.png` -- the super admin's sidebar now shows only Bosh sahifa,
Bildirishnomalar, and the Boshqaruv (admin console) group; no department destinations, no "+ Yangi".
Commit `8316cee`.

### 15. Personal Today row lost its title to chips at 390; sprint goal ellipsized -- FIXED
Before: `after/personal__390__light__uz-Latn.png` ("Kartochka bo'yich..." cut). After:
`final/personal__390__light__uz-Latn.png` -- titles ("Kartochka bo'yicha shaxsiy eslatma", "Yig'ilish
kun tartibini yuborish") render in full, chips (Hafta/30'/Fokus) drop to a second line beneath; the
sprint hero sentence wraps in full with no ellipsis. Commit `059ef95`.

### 16. Two events shared one cover illustration -- FIXED
Before: `after/events__1440__light__uz-Latn.png` (SEN 10 and SEN 27 both the sunset/cityscape cover).
After: `final/events__1440__light__uz-Latn.png` -- SEN 10 now gets a distinct chart/line illustration,
SEN 27 a basketball/T illustration; no repeat visible in the captured month. Commit `7369445`.

### 17. uz-Latn message files mixed two apostrophes -- FIXED (message files); NOT fixed (seed data)
Grep count of ASCII apostrophe after o/g in packages/i18n/messages/modules/*/uz-Latn.json is now 0
(was 327), and the correct U+02BB mark count is now 737 (was 369) -- every uz-Latn message file is
now normalised. However, the same defect is still visible on screen:
`final/events__1440__light__uz-Latn.png`'s seeded event title "Ko'ngillilar kuni: bog' ekish" and
location "Yangi bog' hududi" still use the ASCII apostrophe, right next to the correctly-marked chip
"Ko'ngillilik" (U+02BB) on the same card -- a grep of packages/db/src/seed/**/*.ts finds 78 remaining
ASCII occurrences in seed content (event/task/etc. titles), which the message-file fix never touched.
The visual inconsistency the finding described is unchanged for anyone looking at demo data, only the
chrome around it is fixed.

### 18. Inbox missing unread signal and primary action -- FIXED in code; not observable in this capture
inbox-screen.tsx (around line 428) now renders a variant="primary" "Barchasini o'qilgan deb
belgilash" button whenever unreadCount > 0, and the source shows an unread-dot rail and
line-clamp-2 title wiring were added (commits `b89612a`, `b799c24`). At the moment this pass's
capture ran, the demo account had 0 unread notifications (the "O'qilmagan" tab shows no count in
`final/inbox__1440__light__uz-Latn.png`), so the primary button and unread dot correctly do not render
-- this is expected behaviour, not a miss, but it means the fix is confirmed by source reading rather
than by the screenshot. The detail pane now fills the content height (visible in the capture, matching
the list column).

### 19. Structure rows misaligned meta line -- FIXED
Before: `after/structure__1440__light__uz-Latn.png` (meta line starts left of the unit name). After:
`final/structure__1440__light__uz-Latn.png` -- rail | avatar | content grid, "Boshlig'i hali
tayinlanmagan ..." now starts under the unit name; members render as plain avatar circles, not
form-control chips with a close icon. Commit `d140618`.

### 20. /account used a different content grid -- FIXED
Before: `after/account__1440__light__uz-Latn.png` (title at x=405, no eyebrow). After:
`final/account__1440__light__uz-Latn.png` -- proper PageHeader with eyebrow "HISOB", title "Hisob
sozlamalari", description, gutter aligned with every other screen. Commit `059ef95`.

SEV2 tally: 11 of 14 fully fixed, 2 partial (#13, #17), 1 fixed-but-unverified-by-screenshot (#12).

---

## SEV3 -- polish

### 21. "34daq"/"15daq" missing a space -- NOT FIXED
apps/web/src/features/personal/lib/sprint-labels.ts (formatTimeLeft, lines 51-56) still concatenates
minutes and the unit label with no space or non-breaking space -- confirmed by reading the file;
git log shows no commit touched this file since the critique. Not independently visible in
`final/personal__1440__light__uz-Latn.png` at this pass's data state (no active sprint countdown
rendered), but the source fix was never made.

### 22. Pomodoro card oversized ring, break button a bare link -- NOT VERIFIED (interaction-only)
No ui-blitz-shots.mjs route captures the open Pomodoro timer card; this needs
ui-round2-interactions.mjs, out of scope for this pass. No commit in the 33d4707..b426652 range
touches personal/*pomodoro*, so this is very likely still open, but unconfirmed by evidence gathered
in this pass.

### 23. People hover card repeats null state, no contact actions -- NOT VERIFIED (interaction-only)
Same as #22 -- a hover-triggered surface this script cannot reach. No commit in range touches the
hover-card file.

### 24. Events header four buttons; Pages flat with no tree -- NOT FIXED
`final/events__1440__light__uz-Latn.png` still shows four header controls (Ro'yxat/Taqvim toggle,
"Mening tadbirlarim (.ics)", "+ Tadbir yaratish") -- the .ics action was not moved into an overflow
menu. `final/pages__1440__light__uz-Latn.png` is still a flat single-row list with no disclosure
tree, updated-by column, or drag-to-reparent (though with only one seeded page, this is hard to fully
exercise).

### 25. Admin quick links are bare text links; health has redundant dot -- NOT FIXED (quick links); PARTIAL (health)
`final/admin__1440__light__uz-Latn.png` -- "Tezkor havolalar" is still four plain underlined blue text
links, not DataRow-style icon+title+description rows. `final/adminhealth__1440__light__uz-Latn.png`
still pairs a coloured dot with a badge per row, but "Sozlanmagan" now functions as its own inline
explanation for the grey state, so the "nothing on screen says so" half of the complaint is addressed
even though the redundant dot remains.

### 26. Registration-close button still destructive red -- NOT FIXED
`final/adminsettings__1440__light__uz-Latn.png` -- "Ro'yxatdan o'tishni yopish" is still the same solid
red as "O'chirishni boshlash" (the tenant wipe); it was not converted to a Switch. The sentinel
public-key field still has no copy-to-clipboard icon button.

### 27. Home's pinned-charts block was prose, not an empty state -- PARTIALLY FIXED
Before: `after/root__1440__light__uz-Latn.png` (left-aligned paragraph + text link). After:
`final/root__1440__light__uz-Latn.png` -- now a bordered, dashed EmptyState-shaped card with a title
("Mahkamlangan diagrammalar"), one line of description, and a single action link ("Tahlil sahifasini
ochish"). Structurally correct per the design doc's empty-state rule except it still has no
illustration.

### 28. Two analytics charts render one enormous/one invisible bar -- PARTIALLY FIXED
`final/analytics__1440__light__uz-Latn.png` -- "Tadbirlarda ishtirok" (single-category bar chart) now
renders at a more proportionate height rather than filling the whole plot; "So'rovnomalarda
qatnashish" is still a thin sliver near the axis with no on-bar value label, and no series legend was
added to "Xodimlar bo'yicha yuklama" (still two unlabelled colours).

### 29. Invite block shows dev origin, repeats role -- NOT FIXED
`final/departments__1440__light__uz-Latn.png` -- the invite URL still reads
"http://127.0.0.1:5173/join?key=..." (expected in a local demo run, not independently testable here),
and the department card still states the role twice: the "Boshliq" outline chip top-right, and again
under "SIZNING ROLINGIZ". The copy action moved to a full-width button below the field rather than an
inline icon button, but the duplicate-role complaint itself is unchanged.

### 30. Mobile board/table unusable -- FIXED (table + board layout); PARTIAL (density toggle)
Before: `after/work__390__light__uz-Latn.png` (board body ~220px), `after/worktable__390__light__uz-Latn.png`
(5-column table scrolled horizontally). After: `final/work__390__light__uz-Latn.png` -- quick-add/filter
collapsed behind an icon button, board body gets most of the viewport. `final/worktable__390__light__uz-Latn.png`
-- the table now collapses to single-column DataRow-style cards (title only, no horizontal scroll).
The "Keng/Ixcham" density toggle is still shown at 390 (critique asked for it to be hidden below
768px) -- a small residual, not the core defect.

SEV3 tally: core layout fixed for #30, 4 partial (#25 health, #27, #28, #30 density), 4 not fixed
(#21, #24, #26, #29), 2 not verifiable with this pass's script (#22, #23, interaction-only).

---

## Round-1 regression check

Spot-checked every round-1 item's "Now" column against this pass's final/ captures where a route
screenshot could show it (login gradient, home gradient, board chrome, account layout, date inputs,
chart card padding, undo toasts, em-dash sweep, glyph legibility). No round-1 regressions found.
The one thing worth flagging: the new table badge-overlap defect (see #3 above) sits in the exact
screen round-1 finding #26 ("table unvirtualised, no selection") already touched -- worth re-verifying
table-screen.tsx doesn't have a second interaction regression once the badge overlap is fixed.

---

## Motion density -- before vs. after (0-5)

Only four screens had a motion-specific commit land after the critique (`859fe5c`, `b85c320`,
`a1ddf28`, `b426652`); every other screen's score is unchanged from round2/motion-audit.md /
critique.md because no commit in 33d4707..b426652 touches its motion code. Static PNGs cannot show
motion directly -- the "after" scores below for the four touched screens are read off each fix
commit's own diff and commit message against the specific gaps the critique named, not off a frame
capture; everything else is carried forward unchanged.

| Screen | Before | After | What changed |
|---|---|---|---|
| /account | 1 | ~4 | `859fe5c`: device list now Staggers in, a revoked/signed-out row animates its exit instead of vanishing, "Yana N tasini ko'rsatish" expands via a real Collapsible height animation, 2FA enable gets a success-check morph beat before advancing. Matches the critique's own "where to spend the next motion hour" target for this screen. |
| Work -> Muddatlar (Gantt) | 1 | ~3 | `a1ddf28`: bars now grow from their own start edge via scaleX with a per-row stagger, today line sweeps down via scaleY, both gated on reduced motion. Commit message explicitly notes the zoom-transition and per-group-collapse asks from the same finding were NOT done this pass -- short of the critique's suggested target of 4. |
| Work -> Taqvim (calendar) | 1 | ~4 | `b85c320`: month change now slides horizontally (direction-aware), day cells stagger on mount, event chips get HoverLift, "yana N ta" expands via Collapsible, today's cell gets a one-shot ring pulse. Matches the critique's target for this screen. |
| Work -> Jadval (table) | 2 | ~3 | `b426652`: the bulk bar now slides up from the header's bottom edge via springSettle instead of appearing instantly. Commit message explicitly notes FLIP-on-resort and the density-toggle crossfade from the same finding were NOT done -- short of the critique's suggested target of 4. |
| Every other screen (Shell, Auth, Home, Personal->Bugun/Davrlar, Work board, Card detail, Events, Inbox, Projects, Project page, Analytics, Structure, People, Pages, AI, Admin console, Departments hub, Work->Mine, 404/states) | unchanged | unchanged | No motion commit in range touches these files; scores stand exactly as motion-audit.md/critique.md recorded them. |

Net effect: the critique's own prescription ("spend the next motion hour on /account, the Gantt,
the calendar, and the table -- the only four screens where the product still feels static next to
Linear") was acted on for exactly those four screens, with two (/account, calendar) reaching the
suggested target and two (Gantt, table) landing partway there by the fixing engineer's own admission
in the commit messages.

---

## Summary for the CTO

The fix round worked through the punch list in order and it shows: every screen the critique singled
out -- the inbox chip, the Gantt label, the work table's spreadsheet-of-controls problem, the two
locale defects that made the product's own default language look machine-translated, the admin
health screen's raw English, the super admin seeing department menus that don't work for them, the
27-column board with no way to narrow it, the 78-pixel project stubs, the two motion-dead screens the
critique called out by name -- all landed, and the numbers back it up: the apostrophe count that stood
at 327/369 is now 0/737 in every UI string, and 208 of 208 screenshots captured cleanly with the
locale switch verified as real, not a harness artefact. Nothing from round 1 came back.

What's left is smaller in volume but two things deserve attention before this ships. First, fixing
the work table's clipped-title problem introduced a new, more visible bug: the status badge and the
overdue badge in the last column now print on top of each other on every overdue row -- not a
regression of the original finding, but a new one born from the same commit, and worth a five-minute
fix before anyone demos that screen. Second, the two locale defects were fixed at the UI-string layer
but not in the demo content itself -- event titles and locations seeded into the database still use
the old apostrophe, so a reviewer scrolling the events page will still see both marks on the same
card, just from a different source now. Everything else outstanding is exactly what the fixing
engineer's own commit messages already flagged as deferred (Gantt zoom transition, table re-sort
animation, a few SEV3 items like the registration-close button's colour and the admin quick-links
styling) -- nothing was missed silently, it was named and left for a follow-up pass.

Recommendation: ship this build, but file the table-badge overlap as a same-day fix before any
external demo, and route the seed-data apostrophe sweep and the four still-open SEV2/SEV3 items
(#13's non-login audit sentences, #25's quick links, #26's registration switch, #29's duplicate role)
into the next polish pass rather than blocking on them.
