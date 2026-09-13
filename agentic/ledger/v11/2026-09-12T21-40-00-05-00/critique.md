# v1.1 design-lead critique — driven as all three personas

**Date** 2026-09-13 · **Build** `master` @ `46ec50b` (post-merge, post-delight)
**Method** the running demo stack (`web :5173`, `api :3000`) driven with the chrome-devtools MCP in three
isolated browser contexts, plus playwright for 390 px. Every claim below was reproduced in the product or
in source; API claims carry the status code and the response I got. Screenshots: `critique-shots/`.
**Personas** `demo.boshliq` (Anvar Aliyev, head) · `demo.xodim` (Nodira Karimova, member) ·
`admin.super` (Alisher Administratorov). **Matrix** 1440×900 and 390×844, light and dark, uz-Latn and ru.

---

## 0. The verdict in one paragraph

v1.1 did the hard thing: **the head's product and the member's product are now genuinely different
products.** Anvar opens WorkPortal and sees nine management tiles with real numbers and drill-downs;
Nodira opens it and sees her thirteen tasks and an onboarding checklist. The people table is a real
ClickUp-grade table with a 18-indicator registry, saved views, resize, filter, CSV and a bulk bar. The
person page has seven tabs and a risk list. Custom fields exist with fill progress and notify-to-fill.
The AI catalogue explains thirteen helpers in plain Uzbek with an example each, and the department
briefing came back in fifty seconds with grounded, cited, severity-ranked findings in the reader's
language. `/department` renders without `?id`, dates are `DD.MM.YYYY`, the login screen opens uz-Latn on
light, the head can issue a temporary password, the join-approval queue exists, `Ctrl+K` reaches cards,
projects, pages, events, people and actions, and `allowStructureEdit` ships off. That is a large,
real distance travelled from the walkthrough.

What stops it being finished is **three things, in this order.** First, a member can still read the
whole department's personal data: `GET /api/v1/fields/values?subjectType=person` returns every
colleague's education, languages and certificates to any xodim, because the service uses its `isHead`
flag only to write audit rows and never to filter — the CTO's headline complaint, alive, in the module
built to answer it. Second, **the head's own data contradicts itself on one screen**: the person page
says Nodira has filled nothing while the people table shows her three answers; the AI briefing says "not
one task was closed last week" next to a goal tile that says 82 of 120 were; the workload grid is 162
identical green cells for a department the dashboard calls seven-people-overdue. Third, the management
screens are the flattest, slowest, least finished surfaces in the app — Yuklama has literally zero
motion components, Qoidalar dumps 79 identical run rows, Maqsadlar can't be edited, and at 1440×900 the
head cannot see three of his six Boshqaruv nav entries without discovering that the sidebar scrolls.
Fix those and this is a product a boshqarma boshligʻi opens on Monday instead of Telegram.

---

## 1. SEV1 — a member still sees what only the head should

### 1.1 Every colleague's person-field answers are readable by any member
**Route** `GET /api/v1/fields/values` · **Persona** member · **Shot** `04-people-table-head-1440.png` (the data), `09-fields-head-1440.png` (the feature)

Signed in as `demo.xodim` I called
`GET /api/v1/fields/values?subjectType=person&subjectId=<Anvar's user id>` and received **200 with 11
rows covering 6 different employees** — `talim`, `tillar`, `sertifikatlar` values with each person's
`subjectUserId`. The `subjectId` I passed was ignored entirely. With no ids at all the endpoint returns
every row in the department.

The cause is exact. `apps/api/src/modules/fields/index.ts:358-364` gates `/values` with
`departmentChildSubject` — which `can()`'s P3 rule grants to **any active member** — and hands the
service an `isHead` boolean. `apps/api/src/modules/fields/service.ts:70-104` then uses `isHead` for
**one purpose only**: deciding whether to write `tx.privateRead(...)` audit rows. There is no filter
anywhere restricting a non-head to `subject_user_id === actorUserId`, and the definition's
`visible_to: head_only` flag is never consulted.

So the head's lawful reads are audited and a member's unlawful read of everyone is not. SPEC §2.1 says
in terms: "Remove every hand-rolled `isHead` check in modules in favour of these kinds"; §5 says
"Head-only person values are never in list endpoints and every head read is audited." Both are violated
in the one module the CTO asked for by name. In a ministry this is a personal-data disclosure, not a
UX bug.

**Fix** `/values` takes `{kind:'department_managed'}` when the query asks for anyone but the caller, and
`{kind:'owned', ownerUserIds:[actor.userId]}` otherwise; `listValues` filters rows to
`subject_user_id === actorUserId` unless the actor is head, and drops `visible_to: head_only` defs for
everyone else. Add the cross-role integration test SPEC §2.1 already requires (member → 403 / own rows
only).

### 1.2 The events module never adopted `owned` — twenty routes still say `department_child`
**Files** `apps/api/src/modules/events/index.ts` (lines 188, 214, 332, 412, 465, 486 …)

Every event route, including `action: 'delete'`, declares `{kind:'department_child'}`, for which `can()`
allows any active member every action. The actual protection lives in hand-rolled checks inside
`events/service.ts` (`:49`, `:560`, `:1049` — `if (organizer_user_id !== actor.userId && !actor.isHead)`).
The outcome is currently correct, so this is not a live leak — but it is the identical pattern that made
§1.1 a live leak, in the busiest module in the product, and it defeats I-7 ("nothing else in the codebase
is allowed to hand-roll a permission check"). One refactor of the service's guard into a bad shape and
event deletion opens up with no test failing.

**Fix** thread the organizer/author ids into `{kind:'owned', ownerUserIds}` at the route, delete the
service-level `isHead` branches, and let `can()` decide.

### 1.3 "Boʻlim yaratish" is offered to a member from the command palette
**Route** `Ctrl+K` · **Persona** member

The palette's AMALLAR section offers **"Boʻlim yaratish"** to a xodim who is already a member of a
department. SPEC §2.2: the create-department CTA "appears only in the no-department state; a member
already in a department finds it under the hub's overflow, not as the primary action." The `/departments`
page was fixed; the palette was not. Creating a department raises a super-admin approval request, so this
is a real mis-trigger, not just clutter. ("Tadbir yaratish" is also listed **twice** in the same section.)

---

## 2. SEV1 — the head's own numbers contradict each other

### 2.1 The person page says every custom field is empty; the people table says otherwise
**Routes** `/people?person=…` → Maydonlar vs `/people/table` · **Persona** head
**Shots** `08-person-fields-tab.png` vs `04-people-table-head-1440.png`

The people table shows Nodira Karimova with **Taʼlim = Magistr, Chet tillari = Ruscha, Sertifikatlar =
"ISO 27001 Lead Auditor (2025), PMP (2024)"**. Her person page's Maydonlar tab shows all three as
**"Toʻldirilmagan"** and raises an amber banner: **"1 ta majburiy maydon toʻldirilmagan."** The API is on
the table's side: `/api/v1/fields/values` returns `{key:"talim", subjectId:"1b69f28d…",
subjectUserId:"9e01f74f…", value:"magistr"}` for her.

The tab is matching values on `subjectId` (the membership id) against the **user** id. So the CTO's
flagship feature reports every employee as non-compliant on the page built to show compliance, and the
"ask to fill" buttons next to each row would fire pointless Telegram requests at people who already
answered.

**Fix** match on `subjectUserId` (or pass the membership id through the person-page query), and add a
golden test that a person with a value never renders "Toʻldirilmagan".

### 2.2 The AI briefing contradicts the tile three inches to its left
**Route** `/` → AI xulosa · **Persona** head · **Shot** `30-ai-briefing-after-50s.png`

The briefing returned: *"За прошедшую неделю не закрыто ни одной задачи — без изменений по сравнению с
предыдущей неделей. В управлении 77 просроченных задач."* On the same screen, the Maqsadlar tile reads
**"Sentabrda 120 ta vazifa yakunlansin — 82/120 — 68%"**, and Nodira's person page shows 3 completed in
the week of 08-31 and 1 in 09-07. The "77 overdue" does not reconcile with the Kechikayotgan tile (top
five sum to 31) or the goals page's 271-card denominator either.

The briefing is otherwise the best AI work in the product — grounded, cited, severity-chipped, in the
reader's language. That is exactly why this matters: an assistant that disagrees with the dashboard it
lives in is worse than no assistant. The catch-up aggregate needs the same week window and the same
`computeRisk`/`done` definitions the tiles use, and the prompt should be fed those numbers rather than
recomputing them.

### 2.3 Yuklama is 162 green cells for a department the dashboard calls overloaded
**Route** `/work/workload` · **Persona** head · **Shots** `11-workload-head-1440.png`, `12-workload-bottom-legend.png`

27 rows × 6 weeks, **every single cell green**, four of the six week columns entirely `0 / 0 ta`. The
three-step colour tokens are wired (green/amber/red all exist in the stylesheet) but nothing ever
crosses a threshold, because — as the page itself admits at the very bottom, below all 27 rows —
**"37 ta kartada muddat yoʻq"** and **"93 ta karta baholanmagan"**. Half the department's work is
invisible to the view whose job is to show load. The head reads "everyone has room" three clicks after
reading "Farrux Saidov: 7 kechikkan".

Three compounding problems: the "Hisobga olinmagan" panel and the colour legend are both *after* the
grid instead of above it; neither is actionable (no "show the 93 unestimated"); and there is no marker
for the current week.

**Fix** put the unestimated/undated counts in the header as a warning strip with a link that filters the
table to them; move the legend above the grid with its thresholds stated; fall back to open-card count
colouring when estimates cover less than half the work, and say so.

---

## 3. SEV2 — the head's console is unfinished where the member's is finished

### 3.1 At 1440×900 the head cannot see half his own nav group
**Every route** · **Persona** head · **Shots** `03-home-head-1440-viewport.png`, `27-home-head-1440-dark-ru.png`

The sidebar's nav scroller is 968 px of content in 683 px of space. At the CTO's own window size the
BOSHQARUV group is cut at **Maqsadlar** — Maydonlar, Qoidalar and Boʻlim sozlamalari are below the fold,
behind the user card, with **no fade, no chevron, no affordance**. In Russian, where labels are longer,
it is cut at Цели. The only hint is a raw light-grey OS scrollbar on the near-black sidebar, which is
itself off-token and ugly in dark. The head's three newest management screens are the three he cannot see.

**Fix** collapse ISH/JAMOA/BILIM to their active item for a head, or give the nav a sticky footer with a
gradient mask and keyboard-reachable overflow; and style the scrollbar with tokens.

### 3.2 Notify-to-fill is unreachable from the table where the gap is visible
**Route** `/people/table` · **Shots** `04-…`, `05-people-table-column-picker.png`, `06-people-table-bulk-bar.png`

The head is looking at a column of 24 em-dashes under "Sertifikatlar". There is no way to act on it from
there. Row actions are only *vazifa berish / doskadagi ustuni / Telegram*; the bulk bar is only *Vazifa
berish (2) / Tanlanganlarni yuklab olish / Tanlovni bekor qilish*; the column header for a custom field
is inert text with no menu. SPEC §4.3 asks for an "ask to fill" in the row actions **and** the bulk bar;
§5 puts the trigger "from the field manager **or a table column header**". Today it lives only on
`/fields` and on the person page (where §2.1 makes it lie).

### 3.3 Custom-field columns are second-class citizens in the table
**Route** `/people/table` · **Shot** `05-people-table-column-picker.png`

The column picker lists all 18 registry indicators in six labelled groups with descriptions — and **not
one custom field**. Taʼlim, Chet tillari and Sertifikatlar appear as columns that cannot be hidden,
reordered, sorted, filtered or resized, while Boʻlim/Ochiq vazifalar/Yuklama have sort + filter + a
resize handle each. The footer row calculates `27 / 187 / 26%` for the indicators and **nothing** for the
custom fields, so the fill progress the head cares about (6/27) exists on `/fields` but not in the table.
The "Ustunlar 4" badge matches neither the 3 selected indicators nor the 6 visible columns.

### 3.4 The Yuklama column speaks two languages in one column
**Route** `/people/table`

Rows with work read **"19,5 soat · 49%"**; rows without read **"0 / 8"**. Two formats, one column,
no header unit. (The Uzbek decimal comma is right — keep it.) The picker offers *Yuklama (soat)* and
*Yuklama* as separate indicators; the single rendered column tries to be both.

### 3.5 Goals cannot be edited, and cap-goals render as failures
**Route** `/goals` · **Shot** `13-goals-head-1440.png`

- **"Muddatida bajarish 85% dan past tushmasin"** renders its progress as **"98 / 85"** — a percentage
  shown as a fraction of a percentage. It should read "98% (maqsad: 85%)".
- **"Ochiq «Muhim» ishlar 100 tadan oshmasin — 100 dan 78 ta — 22%"** draws a **red** bar at 22%. 78 of a
  100 cap is compliance; the colour and the number both say failure. Inverted goals need their own
  rendering: fill toward the cap, amber near it, red only past it.
- The only control on a goal card is a **trash icon**. No edit, no click-through to the cards that count,
  no owner, no history. A goal you cannot adjust is a poster, not a target.
- Titles truncate mid-word ("…dan past tus…") in cards with an empty row beneath them.

### 3.6 Qoidalar is a rule builder attached to a 4 000-pixel wall
**Route** `/automations` · **Shot** `14-automations-head-1440.png`

"Bajarilishlar tarixi" renders **79 consecutive identical rows** — same rule, same minute (13.09.2026
11:00), different card — unpaginated, ungrouped, unfilterable. The rule that produced them is **switched
off**, and the head's inbox shows 4 items, so the log and the inbox tell different stories about the same
event. Rules themselves have a toggle and a delete icon and **no edit** — you cannot change a rule you
wrote, only delete and retype it. (The kill switch "Hammasini toʻxtatish" is good and should stay.)

**Fix** group runs by trigger batch ("79 ta karta · 13.09 11:00 · koʻrsatish"), paginate, filter by rule
and outcome, and add edit + duplicate to each rule.

### 3.7 The person page opens on two empty charts
**Route** `/people?person=…` → Umumiy · **Shot** `07-person-page-head-1440.png`

"Haftalik natija" has data in 4 of 12 weeks (the accessible table confirms: eight weeks of `0 / 0`).
"Oʻz vaqtida bajarish" plots two points at the far right of an otherwise empty axis, and its x-axis skips
the `08-31` label it has data for. "Diqqat vaqti" is `0 daq` for everyone. A head clicking through from
"Kechikayotgan ishlar" lands on what looks like a broken page. This is a seed problem — the demo dataset
carries about four weeks of history — but the chart should say "yetarli maʼlumot yoʻq" rather than draw
an empty 12-week axis.

### 3.8 The head's product has the least motion in the app
**Measured** across `apps/web/src/features/**`

Motion density per screen, 0–5 (stagger / hover lift / NumberFlow / skeleton / celebration, as
DESIGN.md §10 defines them):

| Screen | Density | What is there |
|---|---|---|
| Login | 2 | BlurFade card, ambient drift |
| Head Home | 4 | tile stagger, NumberFlow counters, progress arcs, AI shimmer |
| Member Home | 3 | stagger, NumberFlow, onboarding check |
| Board `/work` | 3 | hover lift, drag spring, live pill, collapse |
| Person page | 3 | chart draw-in, NumberFlow KPIs, tab pill |
| Events sheet | 3 | sheet spring, RSVP celebration |
| `/people` directory | 2 | card stagger, hover lift |
| `/people/table` | 2 | row stagger, hover lift |
| `/fields` | 2 | stagger, progress bars |
| `/ai` | 2 | preview shimmer, budget ring |
| `/goals` | 1 | progress bars only |
| `/automations` | 1 | rule-card stagger; the 79-row log has none |
| `/admin` | 1 | list stagger |
| **`/work/workload`** | **0** | `workload-screen.tsx` imports **no** motion component at all |

The pattern is unmistakable: everything the *member* touches was polished, and the six Boshqaruv screens
were shipped functional and left flat. Yuklama — the head's signature view — has no skeleton, no stagger,
no NumberFlow, no cell transition when you change week. It reads as a spreadsheet someone pasted in.

---

## 4. SEV2 — things the walkthrough asked for that did not land

| # | Walkthrough item | State today | Evidence |
|---|---|---|---|
| a | "+ + Filtr" double plus | **fixed** | `10-board-head-1440.png` |
| b | `/department` without `?id` | **fixed** | `15-department-head-1440.png` |
| c | head can reset a password | **fixed** — "Vaqtinchalik parol berish" in the member ⋮ | §1.4 probe |
| d | join-approval queue | **fixed**, with a proper empty state | `16-department-members-head.png` |
| e | `Ctrl+K` reaches everything | **fixed** — 6 sections | §1.3 |
| f | login defaults uz-Latn + light | **fixed** | `01-login-1440-default.png` |
| g | `DD.MM.YYYY` everywhere | **fixed** | all shots |
| h | event RSVP clipped at 1440 | **fixed** (hero ~200 px) | `23-event-sheet-member-1440.png` |
| i | **event tab strip still clips "Fikr-mul"** | **not fixed** | `23-…` |
| j | **"soʻm dan" → "soʻmdan"** | **not fixed** — `/ai` reads "2 000 000 soʻm dan 2 003 soʻm sarflandi" | `17-ai-head-1440.png` |
| k | **both Home KPI cards labelled "Ishlarimni koʻrish"** | **not fixed** | `20-home-member-1440.png` |
| l | **`/admin` status by colour alone, no labels, no legend** | **not fixed** — six bare dots | `28-admin-super-1440.png` |
| m | **"Zaxira nusxalar" not a warning** | **not fixed** — neutral grey dot | `28-…` |
| n | **no pending badge on "Boʻlim soʻrovlari"** | **not fixed** | `28-…` |
| o | **`/admin` user count with no department breakdown** | **not fixed** — "62" | `28-…` |
| p | **ASCII apostrophes in seed job titles** | **not fixed** — `Bo'lim boshlig'i o'rinbosari` on Yulduz Mirzayeva and Timur Sultonov | DOM scan of `/people/table` |
| q | **"EGDI paketi" jargon** | **not fixed** — still the quick-add placeholder and two AI examples | `10-…`, `17-…` |
| r | **duplicate/test cards in the demo data** | **worse** — the board now carries **"v1.1 bildirishnoma zanjirini tekshirish"**, a build-agent test card, and "Yangi loyiha uchun byudjet hisob-kitobi" appears twice on the head's own dashboard under two ids | `10-…`, §2.2 snapshot |
| s | **26 of 27 people in "BOʻLIMSIZ"** | **not fixed** — directory, table and board all show one giant unassigned group | `22-…`, `04-…` |

---

## 5. SEV2/SEV3 — craft

1. **The Home greeting sits on a hard-edged grey rectangle.** `.devon-ambient-drift` is 354 px wide inside
   a 343 px parent with `overflow:hidden`, so it clips to a box that stops 31 px short of the content edge.
   Visible at 1440, obvious at 390, and glaring in dark where it reads as a misplaced panel. DESIGN.md §2.6
   restricts the ambient gradient to auth and the hub anyway. `25-home-head-390.png`, `27-…dark-ru.png`.
2. **Two identical "Hammasi | Mening" segmented controls on `/work`** — one on the tab strip, one above the
   columns. Pick one. `10-…`
3. **The board still nests three scroll regions** (page, horizontal board, per-column) and still repeats a
   project card in the first slot of every column. Only ~3.5 of 27 columns fit at 1440. `10-…`
4. **`/people/table` gives the table 531 px of a 900 px screen** (`max-h-[calc(100vh-22rem)]`) — four and a
   half rows — because the header, the view tabs and a full-width search bar eat 22 rem above it. The
   bulk bar then pushes it down another 90 px. The **Ism column is not sticky**, so scrolling right loses
   the one thing a row needs. `04-…`, `06-…`
5. **The member's directory cards are inert.** Only your own card is a link (`/people/me`); the other 26
   are plain divs — no hover card, no Telegram action, no "assign a task", no "open board column". SPEC
   §4.1 asks for all four. `22-…`
6. **`/department` shows a member the Ruxsatlar card with the imperative "belgilang" and no explanation**
   that the toggles are read-only, while the Imkoniyatlar card right below it correctly says "Ularni
   boʻlim boshligʻi boshqaradi". The disabled toggles are only marginally dimmer than enabled ones.
   `21-department-member-1440.png`
7. **Four shapes of no-permission remain** — full lock (`/people/table`, `/fields`, both excellent, with a
   useful alternative CTA), header + inline body (`/goals`, `/automations`), own-data variant
   (`/work/workload`, a good idea), and a settings page with dimmed controls (`/department`). One shape,
   please, plus the deliberate own-data exception.
8. **Every person's name is in the DOM twice** on the head dashboard tiles and the members list
   ("Farrux Saidov Farrux Saidov 7"). Screen readers read it twice on every row of every tile.
9. **Every per-member ⋮ button on `/department` → Aʼzolar is labelled "Aʼzolar"** — 26 identical accessible
   names. A screen-reader user cannot tell whose menu they are opening.
10. **The AI budget field is `<input type=number>` with `aria-valuemin=0 aria-valuemax=0`** holding
    `2000000`, unformatted, while the line above it reads "2 000 000 soʻm". Broken ARIA plus a locale-
    separator inconsistency in one card. `17-…`
11. **Five of thirteen AI helpers show no price** ("Javob loyihasi", "Kim kechiktiryapti", "Kimga
    topshiray", "Takroriy ishni topish", "Boʻlim maʼlumotidan soʻrash") under a page header that promises
    "qancha turishi". `17-…`
12. **`catch_up` is slow and unreliable against the real GLM.** The trace table shows latencies of
    **112 123 ms, 129 203 ms and 275 962 ms** and three failures ("Provayder xatosi" ×2, "Boʻsh javob") in
    seven calls. Latency is printed as raw milliseconds. The pending panel offers only a primary-styled
    **"Yopish"** over a shimmer — no cancel, no "this can take a minute", no partial. A 276-second call
    also means the outbound timeout is ≥ 300 s, against CLAUDE.md's "timeouts on every outbound call".
    `19-ai-traces-head.png`, `29-ai-briefing-pending.png`
13. **"Nimani oʻtkazib yubordim (eskirgan)"** — an internal deprecation marker rendered to the head in the
    trace table. `19-…`
14. **Four name orders coexist**: "Nodira Karimova" (sidebar, directory, board), "Karimova Nodira" (person-
    page "Toʻliq ism", AI traces, palette KISHILAR), "Tosheva M." (workload rows), "Madina Tosheva"
    (dashboard). DESIGN.md §5 allows two, in defined contexts; the workload surname-initial form is a fifth
    invention and its rows are sorted by *given* name while displaying surname first.
15. **The empty "Qoʻshilish soʻrovlari" card eats 400 px** at the top of the members tab forever, and the
    member list below it is a third, searchless, sortless people list. `16-…`
16. **The head's 390 px bottom tab bar is the member's** — Asosiy / Vazifalar / Shaxsiy / Tadbirlar /
    Xabarlar. Nothing managerial is one tap away on a phone, and "Shaxsiy" outranks "Xodimlar jadvali" for
    a department head. `25-home-head-390.png`
17. **"Mening yuklamam" and the focus list are missing from the member's Home**, both required by SPEC
    §3.2. What is there instead is a "Mahkamlangan diagrammalar" card called *diagrams* that contains no
    diagram — six numbers, five of which are already on the tiles above it. `20-…`
18. **"Mening qarorim kerak" holds work I delegated that is overdue** — the title promises a decision
    queue, the body delivers a chase list. Rename or re-scope. `20-…`
19. **The Telegram Mini App is not reachable from `pnpm start --demo`.** `scripts/start.mjs:208-209` starts
    `@devon/api` and `@devon/web` only; `apps/miniapp` is never launched, and `/miniapp/` on :5173 returns
    the 404 page. An entire shipped epic is invisible to anyone demoing the product.
20. **"Telegram Ha"** as a person-page field value; "Ulangan" is the word.
21. **Yuklama's "Hisobga olinmagan" counts and the colour legend sit below 27 rows of grid**, and the
    counts are not links.
22. **The head's "Yangi xodimlar" tile is four zero-percent bars** with no bar drawn — four names, "0%",
    four times. Either seed onboarding progress or teach the next action in the tile.
23. **`/admin`'s sidebar gives a super admin with no membership a "Bosh sahifa", "Bildirishnomalar" and
    "Kalendar"** that can only ever be empty.

---

## 6. What is genuinely good — do not refactor it away

- **The head dashboard's information design.** Nine tiles, each with a number, a one-line meaning in
  natural Uzbek, and a drill-down that lands somewhere useful; "Har bir raqamni bosing — u sizni aynan shu
  odamga yoki shu ishga olib boradi" is the right closing line. The arrangeable layout is a real feature.
- **The AI catalogue** (`/ai` → Yordamchilar). Thirteen helpers, each with what it does, where it lives,
  a concrete Uzbek example, a price and a head-only badge, plus honest search-backend disclosure ("Bu GLM
  serveri embeddings modelini taklif qilmaydi"). This is the answer to "AI feels random and gray."
- **`/fields`.** Fill progress per field, `field:talim` filter grammar shown inline, cap counter
  ("3 / 10 ta maydon"), reorder, archive, and two correctly distinguished CTAs ("Toʻldirishni soʻrash" vs
  "Yana eslatish").
- **The indicator registry's Uzbek.** "Soʻnggi yetti kundagi jamlangan fokus daqiqalari. Shaxsiy ish
  maydoni mazmuni hech qachon koʻrinmaydi." — a privacy promise written for the person reading it.
- **The no-permission states on `/people/table` and `/fields`**, which do not just refuse but offer the
  thing the member *can* do ("Maʼlumotnomani ochish", "Hisob sozlamalariga oʻtish").
- **Charts ship an accessible data table** behind every `application` region. Rare and correct.
- **The Russian translation**, again. Chrome, empty states, tile captions and AI output all read naturally.
- **Workload capacity overrides** (16 and 20 soat/hafta rows) and the `Keng | Zich` density control.
- **The board's live pill, presence, estimate chips and per-column overdue counts.**

---

## 7. The ten I would fix before showing this to anyone

1. `fields/values` — filter by actor, gate with `department_managed`, test it. (§1.1)
2. Person page Maydonlar — match on `subjectUserId`; kill the false "majburiy maydon toʻldirilmagan". (§2.1)
3. Workload — warning strip on top with the 93 unestimated / 37 undated, legend above the grid, count
   fallback colouring. (§2.3)
4. Sidebar overflow at 900 px — the head must see all six Boshqaruv entries. (§3.1)
5. "Ask to fill" in the table row menu, the bulk bar and the column header. (§3.2)
6. Custom fields into the column picker, with sort/filter/resize and a footer fill count. (§3.3)
7. Catch-up: reconcile its numbers with the tiles; add a cancel + "bir daqiqagacha" hint; cap the outbound
   timeout and show latency in seconds. (§2.2, §5.12)
8. Goals: edit, click-through, and correct rendering for percent and cap targets. (§3.5)
9. Automations run log: group, paginate, filter; add rule edit. (§3.6)
10. Reseed the demo: no `v1.1 bildirishnoma zanjirini tekshirish`, no duplicate titles, ASCII apostrophes
    out of job titles, people into boʻlims, a few months of completed history so the charts draw. (§4 r/s)
