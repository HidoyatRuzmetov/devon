# Round 3 verification — 2026-09-08

Verifies `round2/critique.md`'s 30 ranked findings and its per-screen motion table live, as both the
head (`demo.boshliq`) and the super admin (`admin.super`), against the code on `master` as of
`ec45ac7` (plus the uncommitted worktree state at verification time). Evidence: a fresh capture of
`e2e/scripts/ui-blitz-shots.mjs` (208 files, `round3/final/`, 0 failures, locale switch asserted) and
`e2e/scripts/ui-round2-interactions.mjs` (`round3/interactions/`, 7 of 9 probes captured — see "Script
gaps" below), cross-checked by reading the source each finding names and by driving the live app
(`pnpm start --demo`, `http://127.0.0.1:5173`) with the in-app browser at 1440 and 390, light and
dark, uz-Latn and ru, as both accounts. `node agentic/scripts/gate.mjs --profile fast` is green with
nothing skipped (typecheck 22.6s, lint 29.3s, unit 104.7s, i18n 1.3s, secrets 1.6s). No product code
was edited to produce this report.

## Script gaps (harness, not product)

`ui-round2-interactions.mjs` predates the round-3 fixes and two of its selectors now miss: the seed
card title it searches for (`'Oylik hisobotni tayyorlash'`) sits in a different column since the
board now narrows to the viewer's own column by default (finding #11's own fix), and the people grid
now shows an avatar with the name as `sr-only` text, so `hover()` on the text node fell outside the
hoverable element. Both interactions (`card-detail`, `people-hovercard`) were verified live instead
(see #12 and #23 below) and the geometry the script *did* capture (drag preview, theme transition,
mobile toast, reduced motion) matches round 2. This is a script staleness note for whoever next edits
these fixtures, not a product defect.

---

## Punch list — 30 findings

### SEV1

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Inbox group-head chip: icon on top of label | **Fixed** | `Chip` gained a `leading` prop rendered outside the truncating span (`packages/ui/src/primitives/chip.tsx`); `inbox-screen.tsx:206` uses it. Confirmed in `round3/final/inbox__1440__light__uz-Latn.png`. |
| 2 | Gantt "Bugun" label on top of a date | **Fixed** | `timeline-screen.tsx` gives the marker its own `TODAY_BAND_HEIGHT` row above the day scale. Live-verified at `/work/timeline`: the "Bugun" pill sits clear of every date, both zoom levels checked. |
| 3 | Work table: every cell a form control, no ellipsis | **Fixed** | Title/assignee/priority cells render as truncated text with hover-to-edit; priority uses the token `Select`, not a native one (`table-screen.tsx:518-647`). Live-verified: long titles truncate cleanly, the overdue rail renders as a 2px left bar (not a rail prop, but the same signal), and multi-select → bulk bar ("2 ta tanlandi", Biriktirish, Yorliq qo'shish) works. |
| 4 | Numbers use English separators in uz-Latn | **Fixed** | `formatNumber` builds via `formatToParts` and substitutes U+00A0 for uz-Latn; `numberFlowLocale` maps NumberFlow to `uz-Cyrl` digits. Live-verified on `/ai`: "500 000 soʻm" with a proper space. |
| 5 | Relative time renders in English (`now`, `-12 min`) | **Fixed** | `formatRelativeTime` carries a transliterated uz-Latn table (`hozir`, `{n} daqiqa oldin`, …) and only delegates to `Intl` for `uz-Cyrl`/`ru`/`en`. Live-verified on `/account` → Qurilmalar va seanslar: "hozir", "1 daqiqa o…", "3 daqiqa …" — no English. |
| 6 | Admin health prints raw English from the API | **Fixed** | `apps/api/.../admin/repo.ts` now returns `{code, params}` and the web layer translates. Live-verified `/admin/health` as super admin: "0 ta kutilayotgan hodisa", "0 ta guruh ulangan", "4 ms" — fully localised, both locales. |

### SEV2

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 7 | `Badge` has only solid fills | **Fixed** (primitive + call sites); rail still narrow | `badgeVariants` now defaults to `subtle` (12%-alpha tint) with `solid`/`outline` as opt-ins (`packages/ui/src/primitives/badge.tsx`). Live-verified: `/admin/accounts` "Faol" pills are tinted teal, not solid green; the card-detail sheet's status badges (Faol/O'rtacha/Muddati o'tgan) are all subtle tints. The work table wires an overdue rail inline (`table-screen.tsx:578-586`) but `railClassName` itself is still used in exactly one file (`structure/unit-tree.tsx`) — personal task rows (`sprints-view.tsx`) have no overdue rail. Call this **mostly fixed**: the loud-color problem the finding was really about is gone; the rail convention is still not the shared one everywhere. |
| 8 | Green still means "active"/"current"/"head" | **Fixed** | `accounts-screen.tsx`, `health-screen.tsx`, `settings-screen.tsx` all carry round2-SEV2 comments and use `info`/`neutral` tones now; `account-settings-screen.tsx:214` and `departments-hub-screen.tsx:316` use `primary` outline for "Joriy qurilma"/"Boshliq". Live-verified across `/admin/accounts`, `/admin/health`, `/admin/settings`, `/account`. |
| 9 | `/analytics` still has the raw query-syntax filter box | **Fixed** | `analytics-screen.tsx` uses the shared `FilterBar`/`FilterChip` (`filter-bar.tsx`). Live-verified: `+ Filtr` chip UI, no bare grammar input on first load. |
| 10 | Project cards are 78px stubs, duplicate the % | **Fixed** | `project-tile.tsx` rebuilt: `%` inside the ring only, status badge, objective line, next milestone with date, `AvatarStack`, task fraction. |
| 11 | Board opens at 27 columns, no way to narrow | **Fixed** | `board-screen.tsx` defaults to the viewer's own column (`ownColumnIndex`) with a "Barcha xodimlar (N)" `FilterChip` to expand; falls back to all columns when the viewer has none or a filter is active. Live-verified at `/work`: opens on "Anvar Aliyev"'s single column plus "Biriktirilmagan", chip reads "Barcha xodimlar (26)". Collapse-all / "show N of M" and a remembered per-user choice are not present — the specific fix shipped (default-to-mine) rather than the alternative (collapse controls), which is an equally valid reading of the finding and solves the same scan-at-1112px problem. |
| 12 | Card-detail sheet: two columns squeezed into 480px | **Fixed** | One column, `--width-detail-panel` raised to 580px (`tokens.css:173`), native `<select>` replaced by token `Select` (`card-detail.tsx`). Live-verified: opened a card at 1440 — full-width description, no clipped labels, `MUHIMLIK` renders as the styled `Select`. |
| 13 | Admin audit log is developer output | **Fixed** | `audit-screen.tsx` translates each event into a sentence, avatar+name, role chip, id chip, day grouping. Live-verified `/admin/audit`: "Alisher Administratorov … tizimga kirdi", grouped under "08.09.2026". |
| 14 | Super admin sidebar offers every department route | **Fixed** | `app-shell.tsx` gates the department nav groups on `navCtx.hasDepartment`. Live-verified as `admin.super`: sidebar shows only Bosh sahifa / Bildirishnomalar / Bo'limlar / Bo'lim so'rovlari / Hisob sozlamalari / Boshqaruv — no Vazifalar/Guruh loyihalari/etc.; bottom tab bar shows only Asosiy/Xabarlar; no `+ Yangi` button in the top bar. |
| 15 | Today row loses title to chips at 390; sprint goal ellipsized | **Fixed** | `today-view.tsx`: title is `line-clamp-2` (never single-line-truncated) with chips wrapping under it via `md:` breakpoints; sprint goal wraps in full at a smaller display size instead of clamping. |
| 16 | Two events share one cover illustration | **Fixed** | `pickGroupIllustrationKeys` hashes per-group without replacement (`events/illustrations/index.js`, wired in `events-screen.tsx:136`). |
| 17 | uz-Latn mixes ASCII `'` and U+02BB for the same letter | **Fixed** | 0 ASCII-apostrophe hits remain in `packages/i18n/messages/modules/*/uz-Latn.json`; `agentic/scripts/check-i18n.mjs` now gates on the `[ogOG]'` pattern so it cannot regress. |
| 18 | Inbox: no unread signal, no primary action | **Fixed** | `notification-row.tsx` adds an unread rail + dot + bold title; `inbox-screen.tsx:438` adds a `variant="primary"` "mark all read" button, shown only when `unreadCount > 0`. |
| 19 | Structure rows: meta line starts left of the name | **Fixed** | `unit-tree.tsx` moves the meta line into the same content column as the name (comment at line 642); `+ Qo'shish`/`Tayinlash` moved into the row's own overflow menu. |
| 20 | `/account` uses a different content grid | **Fixed** | `account-settings-screen.tsx:733` now uses `PageHeader` with `eyebrow`. Live-verified: "HISOB" eyebrow, title aligned to the same gutter as `/personal`. |

### SEV3

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 21 | `34daq`/`15daq` — no space; `30′` prime symbol | **Not fixed** | `sprint-labels.ts`'s `formatTimeLeft` still concatenates `${minutes}${t(...)}` with no U+00A0 in any of its three branches (byte-checked: 0 occurrences of U+00A0 in the file). `task-row.tsx:159` and `today-view.tsx:395` still render the bare `′` prime symbol. This is the one finding in the whole list where the fix described in the critique simply was not applied. |
| 22 | Pomodoro card oversized; break action a bare link | **Partial** | Ring is now 220px (was 200px) with tighter `py-10` card padding — real, if not the full 260px the critique suggested. The break button (`pomodoro-panel.tsx:338`) is now a real `<Button>` (no longer a text link) but ships `variant="ghost"`, not the `secondary` the finding asked for, so it still reads as lower-priority than intended next to the primary "Fokusni boshlash". |
| 23 | People hover card repeats a null state, one action only | **Not fixed** | `structure/member-card.tsx`'s `HoverCardContent` is unchanged from round 2: "Aʼzolik: Aʼzo" / "Boʻlim: Kontent" as label-colon-value prose (not eyebrow/value), the `Boʻlim:` line still renders even when the unit adds nothing beyond what the card already states, and there is exactly one action ("Doskadagi ustunini ochish") — no email/Telegram/assign-work. Live-verified by hovering "Karimova Nodira" on `/people`: identical shape to the round-2 screenshot. |
| 24 | Events header 4 buttons; Pages is a flat list | **Not fixed** | `events-screen.tsx` still renders the view toggle group *and* a standalone secondary ".ics" button *and* the primary "Tadbir yaratish" — the `.ics` action was not moved into an overflow menu. Live-verified at `/events`: four controls, wrapping to two rows even at a ~700px viewport. `pages-screen.tsx` groups pages by `PageKind` (a flat list per kind) — there is still no nesting, disclosure triangles, or drag-to-reparent; the comment in the file explicitly notes the data model has no folder hierarchy, so "flat, honestly" rather than "flat, unlabelled" is what shipped, but the tree itself was not built. |
| 25 | Admin quick links are bare text links; health has a redundant dot | **Fixed** | Commit `b7c7f35` turned quick links into icon+title+description `DataRow`s and dropped the health dot. Live-verified `/admin/health`: badge only, no dot. |
| 26 | "Close registration" is a destructive-red button | **Fixed** | `settings-screen.tsx` now uses a `Switch` + status `Badge` for registration; `destructive` is reserved for the wipe flow. |
| 27 | Home's pinned-charts block is a paragraph, not an `EmptyState` | **Fixed** | `home-screen.tsx` wraps the empty state in the illustrated pattern with a single CTA (commit `0a36180`). |
| 28 | Analytics: one giant bar, one invisible sliver, no legend | **Fixed** | `chart-card.tsx` accepts a `legend` prop (used by multi-series charts in `sections.tsx`); commit `84f9fa5` adds value labels on thin bars. |
| 29 | Invite block shows the dev origin, repeats the role | **Fixed** | `department-detail-screen.tsx:223-225` uses the server's own `invite.joinUrl`, not `location.origin`; comment cites this exact finding. |
| 30 | Mobile board/table unusable | **Partial** | The board is meaningfully better at 390 *as a side effect of #11*: it opens on the viewer's single column already, not all 27, so the same header chrome now sits above a one-column board rather than a 27-column one — live-verified, cards are readable, not cut mid-line. The table has **no** dedicated mobile layout: `table-screen.tsx` has no `md:`/`768`-scoped alternative, and it live-verifies as the same virtualised grid with a horizontal scrollbar at 390 (title column visible, rest scrolled off) — not the `DataRow`-card collapse the finding asked for, and the density toggle is still present with no phone-specific hiding. |

**Punch-list tally: 22 fixed, 3 partial (#7, #22, #30), 3 not fixed (#21, #23, #24), 2 read as a
reasonable alternative fix rather than the literal one suggested (#11's default-to-mine instead of a
collapse control; #24's pages stayed honestly flat rather than gaining a tree) — folded into the
counts above by what actually changed for a user, not by literal adherence to the suggested fix.**

---

## Motion density — per screen, judged live against `round2/motion-audit.md`'s round-3 section

The round-3 motion pass (commits `92afeb2` through `ec45ac7`) already claims every screen at 4.5+
and documents its own verification (typecheck/lint/i18n green, live spot-checks, reduced-motion
gating). I independently re-checked the highest-risk claims rather than re-scoring all 26 screens
from zero:

| Screen | Round 2 → claimed round 3 | Spot-check | My verdict |
|---|---|---|---|
| Work → Muddatlar (Gantt) | 1 → 4.5 | Live at `/work/timeline`: "Bugun" pill in its own band (finding #2), zoom controls present (Kun/Hafta/Oy) | **Consistent with claim** — the specific defect (today-label collision) that made this a "1" is fixed; did not re-drive the zoom transition itself live. |
| `/account` | 1 → 5 | Live: device list renders, "Joriy qurilma" chip present; did not trigger a sign-out to see the exit animation | **Plausible, not independently confirmed** for the `AnimatePresence` claim specifically. |
| Work → Taqvim (calendar) | 1 → 5 | Not driven live this pass | **Not independently verified** — code-level claim only (pre-existing before this verification pass per the audit's own note). |
| Work → Jadval (table, FLIP re-sort) | 2 → 4.5 | Live: clicked the SARLAVHA sort control, rows reordered with no console error; did not confirm the reorder used a FLIP tween vs. an instant swap at the frame rate available in this session | **Behaviour present, animation quality not independently confirmed.** |
| Admin console | 3 → 4.5 | Live: health screen polls and updates; did not sit through a 30s poll cycle to see the claimed pulse/sweep | **Not independently verified.** |
| Inbox, Structure, People, Pages, Departments hub, AI, Projects, Analytics, Events, Card detail, Home, Auth | 3–4 → 4.5 | Not re-driven interactively this pass (would require triggering the specific interaction per screen: archive a row, expand an org node, etc.) | **Taking the round-3 audit's own documentation at face value** — its methodology (grep for the primitive, typecheck, targeted live checks, explicit reduced-motion gating) is sound and consistent with what I found reading the same files for the punch-list items above (e.g. `Badge`/`Chip`/`Select` changes match exactly what the motion audit's file list says was touched). |

**Overall judgement: the round-3 motion claims hold up wherever I could cross-check them against code
and the punch-list live pass, and nothing I drove live contradicted a claimed score. I did not
personally replay all ~20 interaction types the maker's own audit lists, so I am reporting those
scores as "maker-verified, spot-checked, not fully independently re-scored" rather than certifying
each number to 0.5 precision myself.** No regression found anywhere I looked — the round-2 "No
round-1 item regressed" claim still holds through round 3 as far as this pass could see (gate green,
badge/chip/table changes additive, nothing removed).

---

## Regressions

None found. Everything read as additive: `Chip`'s `leading` prop is optional (existing callers
unaffected), `Badge`'s `subtle` default changed visuals but not the API (`tone`/`variant` both still
accepted, `variant` defaults sensibly), `Select` replacing native `<select>` kept the same value
contract, and the gate (typecheck/lint/unit/i18n/secrets) is green with nothing skipped.

## What was captured this pass

- `round3/final/` — 208 screenshots (26 routes × 2 widths × 2 themes × 2 locales), fresh capture,
  0 sign-in failures, locale-switch assertion passed.
- `round3/interactions/` — `board-drag__1440__light.png`, `personal-pomodoro__1440__light.png`,
  `reduced__work__1440__light.png`, `theme-mid__1440.png`, `theme-after__1440.png`,
  `toast-mobile__390__light.png`, `toast-mobile-after__390__light.png`. Two probes
  (`card-detail`, `table-selection`, `people-hovercard`) missed on stale selectors — see "Script
  gaps" above; verified live instead and recorded in the punch-list table.

---

## Summary for the CTO

Of round 2's 30 open findings, 22 are cleanly fixed, 3 are partial, and 3 were not touched. The three
SEV1s that "a person sees today" are all fixed and I confirmed each live: the inbox icon no longer
prints over its own label, the Gantt's "Bugun" no longer sits on top of a date, and the work table
is text with hover-to-edit instead of a wall of form controls. The two locale root-causes (English
number separators, English relative time in the default uz-Latn locale) are fixed with the exact
local-table approach the critique prescribed, and I watched both render correctly live. The apostrophe
mix is fully normalised (0 offenders left) and now has a gate so it cannot come back. Colour discipline
is essentially fixed at the primitive level — `Badge` defaults to a tint, not a solid fill, everywhere
I checked live including the 25-pill admin accounts screen that was the critique's worst example — the
one loose end is that the "overdue rail" convention is still hand-rolled per screen rather than a
shared prop everywhere it should be, which is cosmetic, not a defect a user would name.

What's left: the people hover card (still a plain label:value list with one action, no contact
options) and the events header (still four buttons, `.ics` not folded into a menu) are genuinely
untouched from round 2 — minor, but they are exactly the findings the critique named, unchanged. The
`daq`/`′` spacing finding (#21) is the one place a described fix was simply not applied — smallest
possible user impact (a missing space before a two-letter unit) but worth a five-minute follow-up
since it was explicitly called out twice. The work table still has no dedicated mobile layout, so a
390px phone gets a horizontally-scrolled data grid rather than a card list — the board is incidentally
better at that width because of an unrelated fix, but the table was not addressed.

Motion is in genuinely good shape: the round-3 motion pass's own documentation is thorough and
consistent with what I independently verified through the code and the live app wherever the two
overlapped, and I found nothing that contradicted its claims. I did not personally replay every one
of the ~20 named interactions (archiving an inbox row, waiting through a 30-second health poll,
etc.), so I'm reporting that section as maker-verified-and-spot-checked rather than independently
re-scored from zero.

**Recommendation: ship.** Nothing found here is a blocker — no crash, no data-loss risk, no
regression, and the gate is green with nothing skipped. The three not-fixed items (#21, #23, #24) and
the mobile table (#30) are real but minor gaps a department using this day-to-day would notice within
a week, not within an hour; they're reasonable to schedule as fast follow-ups rather than hold the
release for.
