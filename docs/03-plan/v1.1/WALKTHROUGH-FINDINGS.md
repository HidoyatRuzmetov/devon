# Devon (WorkPortal) — hands-on walkthrough findings

**Date:** 2026-09-12 · **Build:** `master` @ `21f8d86` (detached worktree `.claude/worktrees/recon-app`)
**Method:** the product was actually driven, not read. `pnpm start --demo` on `API_PORT=3200 / WEB_PORT=5200`,
Chrome DevTools MCP, three isolated browser profiles (one per persona), 1440×900 and 390×844,
uz-Latn and ru. Every screen in `apps/web/src/features/*/manifest.ts` was visited, plus the card sheet,
the event sheet, the command palette, the create menu and the admin drawer.
**Personas:** `demo.xodim` (Nodira Karimova, member) · `demo.boshliq` (Anvar Aliyev, head) · `admin.super`
(Alisher Administratorov, super admin).
**Evidence:** 67 screenshots under `docs/03-plan/v1.1/walkthrough/`. Every finding below cites one.

A note on honesty: the charts on `/analytics` **do** render. An early full-page capture showed them
empty; that was a lazy-SVG capture artifact on my side, not a product bug
(`walkthrough/31-analytics-chart-blank-bars.png` shows them drawing correctly). It is excluded from the
findings. Everything else below was reproduced deliberately.

---

## 0. The one-paragraph summary

Devon is much further along than "a prototype". Several screens — the event sheet with carpooling and
polls, the account-security page, the admin maintenance/wipe console, the hash-chained audit log, the
personal workspace, the preview-then-accept pattern on every AI affordance — are the work of people who
have thought carefully about a government deployment. But three things stop it being a product a ministry
department would enjoy using daily. **First, there is no head.** The department head's home page, board,
analytics and inbox are byte-identical to a rank-and-file employee's, down to the "add your photo"
onboarding checklist; nothing in the product tells the person accountable for 26 people what needs their
attention. **Second, "member" and "head" are almost the same permission.** A junior specialist can
reassign a colleague's work, delete an org unit, archive the annual-report project and delete a
department knowledge page, with no confirmation and no undo. **Third, the AI is a stub that reports
itself as real** — with `glm-5.2`, token counts and UZS costs on every call, while the admin console one
click away says "AI xizmati: Sozlanmagan". Fix those three and the rest is polish.

---

## 1. SEV1 — a member sees or does what only a head should

### 1.1 Any member can rename, nest and **delete** the department's org units
**Route** `/structure` · **Persona** member · **Shot** `27-SEV1-member-can-delete-unit.png`, `26-structure-member-1440-uz.png`

Nodira (Xodim) sees a primary-styled **"Boʻlim qoʻshish"** button and a ⋮ menu on every unit offering
*Nomini oʻzgartirish · Ichki boʻlim qoʻshish · Ushbu boʻlimga qoʻshilish · **Oʻchirish***.

This is not an oversight — it is a default. `apps/api/src/modules/structure/repo.ts:143-156`
(`assertCanEditStructure`) allows a member when `settings.allowStructureEdit` is true, and
`apps/api/src/modules/departments/repo.ts:313` defaults it to `true`. The API response for the seeded
department confirms `{"allowSelfAssign":true,"allowStructureEdit":true}`.

For a ministry the default is backwards. Ship `allowStructureEdit: false` by default and let a head opt
in. (`allowSelfAssign` is a reasonable default-on; structure editing is not.)

### 1.2 Any member can reassign anyone's work to anyone else — silently
**Route** `/work?card=<id>` · **Persona** member · **Shot** `05-card-detail-member-1440-uz.png`, `06-member-reassigned-card.png`

I opened a card that Jasur Qodirov had delegated to Nodira, opened **KIMGA**, and reassigned it to Anvar
Aliyev. It persisted (`PATCH /api/v1/cards/45a6d8ec…` → 200, `TARIX` went 2 → 3 → 4), the card vanished
from the board, and **no toast, no confirm, no undo** appeared. The **KIMDAN** (delegator) field is equally
editable by a member — a member can rewrite who asked for a piece of work.

The cause is architectural, not a missing check: `packages/contracts/src/permissions.ts` rule P3 gates
only `{kind:'department'}` update/delete on `role === 'head'`. Every route in `work`, `projects`,
`events`, `structure`, `pages` and `analytics` uses `{kind:'department_child'}`, for which **any active
member is allowed every action including `delete`**. Verified: `grep "kind: 'department'"` across
`apps/api/src/modules/{work,projects,events,structure,pages,analytics}` returns nothing.

Consequences a head will discover the hard way: a member can archive the department's annual-report
project (`/projects/view` → "Loyihani arxivlash", `15-project-page-member-1440-uz.png`), delete a
department knowledge page (`/pages?page=<id>` → a large red **"Sahifani oʻchirish"** as the most
prominent control on the screen, `29-page-editor-member-1440-uz.png`), tick off another unit's project
milestones, and add tasks into other people's per-project task lists
(`16-project-personal-tasks-tab.png`).

**Minimum fix:** introduce object ownership (assignee / delegator / creator) as a `Subject` variant, gate
`archive`/`delete` on head-or-owner, and put undo on every mutation the way `DESIGN.md` already requires.

### 1.3 Turning on join approval bricks joining — so the safe default can never be used
**Route** `/department?id=…` → Taklif · **Persona** head · **Shot** `52-department-invite-head.png`

**"Qoʻshilishni tasdiqlash"** ships **off** (`packages/db/migrations/0100_accounts_departments.sql:13`,
`default false`). Anyone with the invite link + department password becomes a full member of a ministry
department instantly, with no head in the loop.

Worse, it cannot safely be turned on. `joinByKeyAndPassword` inserts the membership with
`status = 'pending_approval'` when the flag is set, but there is **no endpoint to approve it** — the
department route list is `/requests/:id/{approve,reject}` (new *departments*, super-admin only),
`/:id/members/:userId/{remove,transfer-headship}`, and nothing else. The UI matches: a pending member
renders only as a warning badge (`department-detail-screen.tsx:451`) with no approve/reject action. Anyone
who enables the toggle strands every new joiner permanently.

### 1.4 Department AI budget and the full AI spend log are visible to every member
**Route** `/ai` · **Persona** member · **Shot** `33-ai-settings-member-1440-uz.png`, `34-ai-usage-fabricated-cost.png`

Nodira sees "Bu oy 500 000 soʻm dan 245 soʻm sarflandi" and a complete per-call trace table with cost and
latency for the whole department. Whether that is intended ("analytics for everyone") is a policy call,
but budget figures in soʻm are management data. Note also that the trace table has **no "who ran it"
column** — so the one person who *should* see it (the head) cannot attribute spend to anyone.

### 1.5 `/departments` invites every employee to create a new department
**Route** `/departments` · **Persona** member · **Shot** `37-departments-member-1440-uz.png`

The top-right primary CTA for a rank-and-file employee already inside a department is **"Boʻlim
yaratish"**. Creating a department triggers a super-admin approval request. This should be reachable only
from the no-department state.

---

## 2. SEV1 — broken, dead or wrong

### 2.1 The board — the flagship screen — shows one column by default, for everyone including the head
**Route** `/work` · **Personas** member *and* head · **Shot** `04-work-board-member-1440-uz.png`, `49-work-board-head-1440-uz.png`, `50-work-board-head-all-26-columns.png`

The page subtitle reads *"Xodimlar doskasi: boshqarma aʼzosiga bitta ustundan"* — a column per member.
What loads is **your own column plus Biriktirilmagan**, with ~45 % of a 1440 px screen blank. 187 of the
department's 189 open cards are hidden behind a secondary pill labelled "Barcha xodimlar (26)".
(`board-screen.tsx:33-50, 236` — `showAllMembers` defaults to `false`, remembered in `localStorage`.)

The head opening the department board and seeing his own 7 tasks is the single most damaging first
impression in the product.

And when you do expand it, it does not scale: 3.5 columns fit at 1440, each with its own inner scrollbar,
7 screens of horizontal scrolling to see 26 people, no sort by load or overdue, no collapse-all, no
density that fits a department. The same project card ("Yagona portal 2.0 · 44") is repeated at the top of
every member's column, eating the first card slot 26 times.

**Fix:** default to all columns for a head; give members a "Mening ustunim / Hamma" segmented control that
is visible, not a pill; add sort-by-overdue and a compact density; render project chips once, not per
column.

### 2.2 The global "+ Yangi → Yangi vazifa" does nothing
**Route** header create menu · **Persona** head · **Shot** `64-create-task-lands-on-board.png`

Clicking it navigates to `/work` and stops. No dialog (`document.querySelectorAll('[role=dialog]').length === 0`),
no focused input — `document.activeElement` is still the "Yangi yaratish" button. The user is dumped on the
board and left to find the quick-add field. The most prominent button in the app has a dead primary item.
(`Tadbir yaratish` correctly deep-links to `/events?new=1`.)

### 2.3 `Ctrl+K` does not "reach everything"
**Route** any · **Persona** member · **Shot** `41-command-palette-member.png`, `42-command-palette-search.png`

Searching `hisobot` returns **one** card, under a single "KARTALAR" heading. The department has several
"hisobot" cards, the projects "Yillik hisobot 2026", the page "Biz qanday ishlaymiz", the event list and
26 people — none are searchable. `CLAUDE.md` states *"Ctrl/⌘+K reaches everything"*; today it reaches
cards, and barely.

The default (empty-query) list is also visibly broken: **"Boʻlimlar" and "AI" each appear twice** — once
under YAQINDA, once under OʻTISH — and two rows render as highlighted simultaneously.

### 2.4 `/department` with no `?id` renders a generic failure instead of a screen
**Route** `/department` · **Persona** member · **Shot** `38-department-settings-member-1440-uz.png`

"Maʼlumotlarni yuklab boʻlmadi — Qayta urinib koʻring. Xatolik takrorlansa, soʻrov raqamini
administratorga yuboring." No request id is shown, and **no network request is made at all** (DevTools:
only `/me`, `/instance`, `/notifications`). `/api/v1/departments/mine` returns 200 when called by hand.
The route simply cannot render without a query param that the sidebar's own "Boʻlimlar" entry does not
supply.

### 2.5 The password-recovery loop does not exist
**Route** `/login` → "Parolni unutdingizmi?" · **Shot** `02-forgot-password-dead-end.png`

The screen says, honestly: *"boʻlim boshligʻiga yoki tizim administratoriga murojaat qiling — ular
parolingizni tiklab beradi"*. **The head cannot reset anyone's password.** `POST
/api/v1/accounts/:userId/reset-password` is `{kind:'instance'}` (super-admin only,
`apps/api/src/modules/accounts/index.ts:292-296`), and the UI gates the menu item on `isSuperAdmin`
(`department-detail-screen.tsx:424`). Confirmed in the product: the head's per-member menu offers only
*Boshliqlikni topshirish · Oʻchirish* (`54-department-members-head.png`), while the super admin's offers
*Bloklash · Parolni tiklash · 2FA ni bekor qilish · Oʻchirish*.

The other route the screen offers — a Telegram one-time code — has no button to request it, and the
Telegram integration is not connected (`36-telegram-member-1440-uz.png`). So every forgotten password in
every department escalates to the single ministry super admin.

### 2.6 The event sheet clips the RSVP buttons on a 1440×900 laptop
**Route** `/events?event=…` · **Persona** member · **Shot** `22-event-modal-clipped-1440.png`, `21-event-detail-member-1440-uz.png`

The hero illustration consumes ~450 px of the dialog; "Ishtirok etasizmi?" and its Ha / Balki / Yoʻq
buttons sit below the viewport edge with no visible scroll affordance. RSVP is the single most common
action in this module and it is off-screen on a standard laptop.

At 390 px it is worse: a full-width native horizontal scrollbar renders *inside* the dark sheet under the
tab strip, plus a vertical scroller widget (`67-event-modal-390.png`). The last tab label is truncated
mid-word — **"Fikr-mul"**.

---

## 3. SEV1/SEV2 — the AI

### 3.1 The AI is simulated and reports itself as real, with invented cost and latency
**Routes** every AI affordance · **Shot** `07-ai-summarize-result.png`, `08-ai-translate-noop.png`, `34-ai-usage-fabricated-cost.png`, `58-admin-health.png`

`POST /api/v1/ai/features/summarize_thread/run` returned:

```json
{"data":{"summary":"1 comment(s) on \"Hafta yakuni boʻyicha taqdimot tayyorlash\". Most recent: Nodira Karimova -- Yaxshi, boshlayapman.","citedCommentIds":["533cb…"]},
 "meta":{"model":"glm-5.2","promptTokens":49,"completionTokens":48,"totalTokens":97,"costUzs":2,"latencyMs":1}}
```

Three problems in one response:

1. **The output is a hard-coded English template** — `packages/ai/src/prompts/summarize-thread.ts:28-36`.
   The request carried `"locale":"uz-Latn"`. Every one of the ten `simulate()` functions
   (`translate`, `deadline-risk`, `weekly-summary`, `subtask-breakdown`, `nl-analytics`, …) emits English
   with `comment(s)` / `day(s)` plural hacks, straight into a four-locale government UI.
2. **The telemetry is fabricated.** `model: "glm-5.2"`, `costUzs: 2`, `latencyMs: 1` for a call that never
   left the process. Those rows populate `/ai` → Foydalanish and the department AI budget gauge a head
   would use to justify spend. `/admin/health` simultaneously reports **"AI xizmati — Sozlanmagan"**.
3. **Nothing in the UI says it is a simulation.** No badge, no banner, no degraded state.

This is the finding most likely to cost the product credibility in a demo, and it is the cheapest to fix:
when `MockProvider` is in use, stamp `meta.simulated = true`, drop `model`/`costUzs`/`latencyMs`, and
render an amber "AI kaliti sozlanmagan — namunaviy javob" strip on every AI panel.

### 3.2 `AI bilan tarjima qilish` returns the input unchanged and offers it for acceptance
**Route** card sheet · **Shot** `08-ai-translate-noop.png`

The "AI tarjimasi" panel shows text identical to the source, with **"67 token · 0 ms"** and a **"Qabul
qilish"** button. There is also no target-language picker anywhere — translate into what? The
preview-then-accept pattern is right; the content is empty.

### 3.3 The analytics AI fails on the app's own example query and leaks raw English
**Route** `/analytics` · **Shot** `32-analytics-nl-ask.png`

The field's placeholder is *"bu oy muddati oʻtgan kartochkalar"*. Typing exactly that produces:

> Buni filtrga aylantirib boʻlmadi — boshqacha soʻrab koʻring.
> **Could not confidently map this to a filter -- showing everything; refine the query.**

An untranslated English developer string rendered under a localised one, in a ministry UI. The cause is
apostrophe normalisation: `nl-analytics.ts`'s regex matches `muddati o'tgan` (ASCII `'`) while the
placeholder and the keyboard produce `oʻtgan` (U+02BB). `DESIGN.md` §2.3 mandates `normalizeForSearch()`
for exactly this; the AI matcher does not use it. Despite failing, the primary **"Filtrni qoʻllash"**
button stays enabled and highlighted.

### 3.4 Quick-add parse: right person, wrong title, no date
**Route** `/work` quick add · **Shot** `65-ai-quickadd-parse.png`

Input `Bahodir: byudjet hisobotini tayyorlash, payshanba` →
*Sarlavha*: `": byudjet hisobotini tayyorlash, payshanba"` (leading colon kept, date fragment kept),
*Kimga*: `Bahodir Xolmatov` ✅, *Muddat*: `—`.

The weekday is not parsed even though the field's own placeholder advertises the syntax
(`"Nodira: EGDI paketi, juma"`). Also: "EGDI paketi" is meaningless jargon for a civil servant — the
example should be a real sentence a clerk would type.

---

## 4. SEV2 — data that contradicts itself

| # | Where | What | Shot |
|---|---|---|---|
| 4.1 | `/analytics` | **Three different on-time rates on one screen**: KPI tile "OʻZ VAQTIDA BAJARISH DARAJASI **0 %**", chart subtitle "Umumiy: **67 %**", personal tile "Oʻz vaqtida bajarilish **100 %**". | `30-analytics-member-1440-uz.png` |
| 4.2 | `/` (home) | "13 ta ochiq, **4 tasi muddatidan oʻtgan**" sits directly above "OʻZ VAQTIDA BAJARILISH **100 %**". Defensible (completed-only) but reads as broken. Rename to "Bajarilganlarning oʻz vaqtidaligi". | `03-home-member-1440-uz.png` |
| 4.3 | `/personal` | Home says you have 4 overdue; Personal → Bugun says *"Hozircha barchasi bajarildi — osoyishtalikdan bahramand boʻling"*. Two dashboards, opposite verdicts, one user. | `17-personal-member-1440-uz.png` vs `03-…` |
| 4.4 | `/projects` | "Fuqarolar soʻrovnomasi" is **Yakunlangan** (completed) at **33 %** / 2-of-6 tasks. "Axborot xavfsizligi auditi" is **Toʻxtatilgan** (stopped) yet still advertises "Keyingi bosqich … 30.09.2026". | `14-projects-member-1440-uz.png` |
| 4.5 | `/projects/view` | Donut says **43**, the task section below says **50 % bajarildi**, the list card said **3/7**. Three progress numbers for one project. | `15-project-page-member-1440-uz.png` |
| 4.6 | `/events` | "0 / 30 joy" next to "Ishtirokchilar (2)". Seats taken and participants disagree. | `21-event-detail-member-1440-uz.png` |
| 4.7 | `/admin/health` vs `/inbox/telegram` | Admin: "Telegram — **Ishlayapti**, 0 ta guruh ulangan". Member: "Telegram **hali ulanmagan**". A green health chip for an unconfigured integration. | `58-…`, `36-…` |
| 4.8 | `/work` board card | The avatar on a card is the **KIMDAN** (delegator), not the assignee — so Nodira's column shows 12 different faces. Every Trello/Jira user will read it as the assignee. Nothing explains it. | `04-…`, `05-…` |

---

## 5. SEV2 — i18n and typography (four locales are a hard requirement here)

1. **US date format in an uz-Latn UI.** `/department` → Aʼzolar shows *"Qoʻshilgan sana: **9/6/2026**"*
   (`40-department-members-member-view.png`); `/personal` → Doska shows *"**9/6/2026, 11:15:54 PM**"*
   (`18-personal-canvas-member-1440-uz.png`). Everywhere else dates are `DD.MM.YYYY`. Root cause is six
   un-localised calls: `department-detail-screen.tsx:455`, `canvas-view.tsx:141`,
   `account-settings-screen.tsx:590`, `telegram-screen.tsx:175,221,374` — all
   `new Date(x).toLocaleDateString()` with no locale argument, so they follow the *browser*, not the app.
2. **Untranslated role on the board column in ru.** The sidebar correctly says "Сотрудник"; the board
   column header under the name still reads **"Xodim"** (`46-work-board-member-1440-ru.png`).
3. **Mixed apostrophes.** UI chrome uses U+02BB/U+02BC correctly (`Boʻlim`, `Aʼzo`), but seed data and
   several strings use ASCII `'`: "Mas'ul" on all six project cards, "Ne'matova", "G'aniyev", "Me'yorida",
   "Qisqacha ma'lumot", "A'zolar tuzilmani tahrirlashi mumkin". `DESIGN.md` §2.3 forbids this. It is also
   why the AI query matcher fails (§3.3).
4. **`--` instead of an em dash** throughout the seed copy: *"Transport boʻlim hisobidan, ovqat --
   ishtirokchilardan"*, *"Yoʻlda bitta toʻxtash boʻladi -- yoqilgʻi quyish uchun"*
   (`21-…`, `23-event-carpool-tab.png`).
5. **The login screen defaults to English + dark**, not uz-Latn (`01-login-1440-en-default.png`). A
   ministry employee's first screen should be uz-Latn on the warm-paper light theme `DESIGN.md` §1
   describes, regardless of `Accept-Language`.
6. **Product name inconsistency.** The UI says "WorkPortal" everywhere; `/account` says *"**Devon**'da
   ismingiz yonida koʻrsatiladi"* (`43-account-member-1440-uz.png`) — the internal codename leaking into
   user copy, with an ASCII apostrophe.
7. **`СЕГОДНЯ` / `BUGUN` appears twice in a row** on home — hero eyebrow and section header
   (`47-home-member-1440-ru.png`).
8. **The maintenance message has four locale tabs and only uz-Latn is filled**, with no warning that three
   locales will go live empty (`57-admin-settings-pause-wipe.png`).

---

## 6. SEV2/SEV3 — polish, empty states, and things obviously missing

**`/people` (`25-people-member-1440-uz.png`)** — the most disappointing screen.
- **Person cards are not clickable at all.** There is no profile page. No phone, no email, no Telegram,
  no room number, no "what they're working on". A staff directory with no way to contact anyone.
- Name order flips: cards read "Karimova Nodira" (surname first); everywhere else it's "Nodira Karimova".
- 25 of 26 people sit in **"BOʻLIMSIZ (25)"** — the structure feature is visibly unused, which makes it
  look broken rather than empty.
- You cannot tell who the head is: "Boʻlim boshligʻi" next to Anvar is a free-text job title, not the role.

**`/work/timeline` (`10-work-timeline-member-1440-uz.png`)** — bars are truncated to a single character
("O…", "F…", "M…"), almost everything renders dark-red overdue, and bars are clipped at the left edge. It
is not readable as a timeline.

**`/work/table` (`09-…`)** — the MUHIMLIK cell clips to "Muhimlik yoʻc"; one column has an icon and no
header; eight consecutive rows share the same due date.

**`/work/calendar` (`11-…`)** — all content is crammed into the first two weeks, weeks 3–5 are empty, a
stray grey band renders across the second row, "yana 6 ta" overflow with no legend for blue vs red.

**`/work/mine` (`13-…`)** — the best member screen. But the third bucket "QOLGANLARI (14)" mixes completed
(struck-through) cards with not-yet-due ones; completed work deserves its own group.

**`/work/archive` (`12-…`)** — no search, no filter, no "archived by / archived on", no bulk restore.

**`/inbox` (`35-…`)** — the right 55 % of the screen is a permanent "Oʻqish uchun bildirishnomani tanlang"
placeholder on load; preselect the first item. Five groups of one item each. Three unlabelled icon
actions per row. One notification references a "Jamoaviy sayr" event that does not exist in `/events`.

**`/pages` (`28-…`)** — **"Nomsiz sahifa"** ships in the demo seed. No search on a knowledge base. No
author column, no nesting. In the editor (`29-…`) the title renders twice (field + H1) and the largest,
reddest control on the screen is **"Sahifani oʻchirish"**.

**`/personal` canvas (`19-…`)** — sticky notes are raw saturated yellow/pink, entirely outside the Palette
B tokens; the canvas ground is grey, not paper; no save indicator; delete has no confirm.

**`/admin` (`56-…`)** — "Tizim holati" conveys status by **colour alone** (grey dots for Xotira, AI
xizmati, Zaxira nusxalar) with no label or legend, which `DESIGN.md` §2.1 explicitly forbids. "Zaxira
nusxalar: Sozlanmagan" — no backups on a government system — renders as a neutral grey chip, not a
warning. No pending-count badge on "Boʻlim soʻrovlari", the super admin's main job. "Foydalanuvchilar
soni 66" with no breakdown by department.

**`/admin/accounts` (`62-…`)** — no department column, so the super admin cannot tell which department an
account belongs to. Logins carry collision suffixes (`@kamola.rahimov11`, `@yulduz.mirzayev27`).

**`/admin/audit` (`59-…`)** — genuinely strong (hash-chain verify, CSV export). But rows say only
"kartochkani oʻzgartirdi" with no before/after summary, so my reassignment of a colleague's card is
recorded but not *readable*; the subject chips truncate mid-word ("ai_trace · summariz"); no date-range
filter or free-text search; no timezone on the times.

**`/admin/departments` (`60-…`, `61-…`)** — the demo instance is polluted with automation leftovers
visible to the ministry: *"Blitz sinov boshqarmasi"* ×2 (heads "Test Blitzov", "Sardorbek Test-Blitzov"),
*"Sifat nazorati boshqarmasi"* (head "Kamron Testov"), accounts `@test.blitzov`, `@malika.fototestova`.
The detail drawer is ~800 px wide holding four facts.

**Seed quality generally** — a card literally titled **"Test kartochkasi"** sits in the demo board
(`04-…`); "API hujjatlarini yangilash" appears three times in one column; a volleyball tournament has
**1 seat**; a picnic has 0 of 30 seats taken but 2 participants.

**Empty/no-permission states are inconsistent.** `/departments/requests` renders a proper padlock
no-permission card (`63-join-requests-head.png`) — but its copy tells the **department head** to *"boʻlim
boshligʻiga murojaat qiling"*. `/department` renders a generic error instead (§2.4). `/department?id=…`
renders disabled toggles for a member with **no explanation at all**. `/ai` renders disabled toggles with
the explanation as a tiny grey footnote **below all ten** (`33-…`). Four different treatments of the same
situation.

**Mobile (390)** — the bottom tab bar is good. The board is not: three nested scroll regions (page,
horizontal board, per-column vertical), chips clipped mid-date ("06.09.20…"), the view tab strip wrapping
to two rows with "Arxiv" alone (`44-work-board-member-390-uz.png`). The event sheet is covered in §2.6.

**Microcopy and controls**
- The filter button literally renders **"+ + Filtr"** (icon plus + text plus) on `/work`, `/analytics`.
- **"Kengaytirilgan"** floats top-right as bare text with no visible control; `/work/table` has a second,
  different density control. Two density concepts, one screen.
- The theme button is a three-state cycle with no indication of the current state.
- Both home KPI cards link with the identical label "Ishlarimni koʻrish" to different destinations.
- "Bu oy 500 000 soʻm dan 245 soʻm sarflandi" — should be "soʻmdan".
- The create menu mixes grammars: "Tadbir yaratish" vs "Yangi loyiha" vs "Yangi vazifa"; it is missing
  "Yangi sahifa" and "Xodim taklif qilish".
- The 26-person **KIMGA** menu has no search field; `DESIGN.md` §2.3's `normalizeForSearch()` combobox is
  not used here.
- `/departments` → "Sozlamalarni ochish" leads a member to the broken `/department` route (§2.4).
- The invite link reads `http://localhost:5200/join?key=…` — it renders `DEVON_PUBLIC_URL` verbatim, so a
  misconfigured deployment hands heads an unusable link with no warning. The QR code has no print/download.
- `/work` board performance: opening the board fires **`GET /api/v1/board` 20+ times** in a row (DevTools
  network panel). Worth a look before a 200-person department.

---

## 7. What is genuinely good (so it does not get refactored away)

- The **event sheet**: carpooling with seat counts, item sign-up, polls with results, discussion, photos,
  feedback — the most complete module in the product (`23-…`, `24-…`).
- **Preview-then-accept on every AI affordance** (Bekor qilish / Tahrirlash / Qabul qilish). Exactly right.
- **`/account`**: device sessions, 2FA, password change, 30-day reversible deletion in a visually separated
  danger zone (`43-…`).
- **`/admin/settings`**: maintenance mode with a four-locale message and a live preview, sentinel key, wipe
  (`57-…`). Production-grade.
- **`/admin/audit`**: hash-chain verification and CSV export (`59-…`).
- **`/work/mine`**: overdue / due-soon / rest bucketing is the right shape for a member's day (`13-…`).
- **`/personal`**: the privacy banner, the sprint-rollover prompt and the calm empty state are thoughtful
  (`17-…`).
- **The Russian translation** is genuinely good — proper « » quotes, natural phrasing (`47-…`).
- **Login error handling**, the skip-link, the live regions and the general keyboard/a11y hygiene are solid
  throughout.

---

## 8. Top 30 things to fix first

Ranked by (damage to a ministry deployment) × (visibility on day one).

| # | Fix | Route / file | Sev |
|---|---|---|---|
| 1 | Give the head a head's home: department open/overdue, who is blocked, what needs a decision, pending joins — instead of the member's page and the "add your photo" checklist | `/` (`48-home-head-1440.png`) | SEV1 |
| 2 | Stop the AI reporting simulated answers as real: `meta.simulated`, drop fake `model`/`costUzs`/`latencyMs`, amber "namunaviy javob" strip | `packages/ai/*`, `/ai` | SEV1 |
| 3 | Localise every `simulate()` output — ten English templates with `comment(s)` plural hacks in a 4-locale UI | `packages/ai/src/prompts/*.ts` | SEV1 |
| 4 | Default the board to all columns for a head; make the me/everyone switch a visible segmented control | `board-screen.tsx:33-50,236` | SEV1 |
| 5 | Add ownership to the permission model: gate `archive`/`delete`/reassign on head-or-owner, not bare `department_child` | `packages/contracts/src/permissions.ts` P3 | SEV1 |
| 6 | Ship `allowStructureEdit: false` by default; hide "Boʻlim qoʻshish"/"Oʻchirish" from members | `departments/repo.ts:313`, `/structure` | SEV1 |
| 7 | Build the join-approval queue (approve/reject endpoint + UI), then default `joinRequiresApproval` to **true** | `departments/index.ts`, `department-detail-screen.tsx:451` | SEV1 |
| 8 | Let the head reset a member's password — or change the forgot-password copy to tell the truth | `accounts/index.ts:292`, `/login` | SEV1 |
| 9 | Fix `+ Yangi → Yangi vazifa`: open the card composer, don't just navigate | header create menu | SEV1 |
| 10 | Make `Ctrl+K` search projects, pages, events and people, not one card | command palette | SEV1 |
| 11 | Un-clip the event RSVP buttons at 1440×900; shrink the hero; make the sheet scroll visibly | `/events?event=…` | SEV1 |
| 12 | Fix `/department` with no `?id` — render the user's own department, not a generic error | `/department` | SEV1 |
| 13 | Pass the app locale to all six `toLocaleDateString()/toLocaleString()` calls | 6 files listed in §5.1 | SEV2 |
| 14 | Reconcile the three on-time percentages on `/analytics`; label each metric's denominator | `/analytics` | SEV2 |
| 15 | Undo (not confirm) on reassign, archive, delete card / page / project / unit; a toast on every mutation | global | SEV2 |
| 16 | Make `/people` cards open a profile with contact details, unit, and current work | `/people` | SEV2 |
| 17 | Fix the AI query matcher to use `normalizeForSearch()`; never render the English fallback string | `nl-analytics.ts`, `/analytics` | SEV2 |
| 18 | Demote "Sahifani oʻchirish" from the loudest control on the page editor to a menu item | `/pages?page=…` | SEV2 |
| 19 | Make the board card avatar unambiguous — show the assignee, or label the delegator | `/work` | SEV2 |
| 20 | Scrub the demo seed: "Test kartochkasi", "Nomsiz sahifa", triplicate cards, 1-seat volleyball, `--` dashes, ASCII apostrophes | `packages/db/src/seed/*` | SEV2 |
| 21 | Purge blitz/test departments and accounts from the demo instance | `/admin/departments`, `/admin/accounts` | SEV2 |
| 22 | Make the board usable at 26 columns: sort by load/overdue, collapse-all, compact density, project chips once | `/work` | SEV2 |
| 23 | Fix `"+ + Filtr"`, the duplicate palette entries, and the double-highlighted rows | `/work`, `/analytics`, palette | SEV2 |
| 24 | One consistent no-permission state; fix "contact the department head" shown *to* the head | `/departments/requests`, `/department`, `/ai` | SEV2 |
| 25 | Give `/admin` status dots labels and a legend; make "Zaxira nusxalar: Sozlanmagan" a warning | `/admin`, `/admin/health` | SEV2 |
| 26 | Put before/after in audit rows, a "who ran it" column in the AI trace, and a department column in `/admin/accounts` | admin console | SEV2 |
| 27 | Fix the timeline: readable bar labels, correct zero-length bars, no left-edge clipping | `/work/timeline` | SEV2 |
| 28 | Fix the mobile event sheet: kill the injected horizontal scrollbar, shrink the hero, make tabs swipeable | `/events` @ 390 | SEV2 |
| 29 | Default the login screen to uz-Latn and the light theme; make the ministry credit line non-link-coloured | `/login` | SEV2 |
| 30 | Settle the product name — "WorkPortal" vs "Devon" — and remove ASCII apostrophes from user copy | `/account` + i18n | SEV3 |

---

## 9. Honest verdict

Devon is roughly two focused sprints away from something a ministry department would tolerate, and
perhaps four from something they would enjoy. The engineering underneath is better than the experience on
top: RLS, audit chains, CSRF, four locales, a real design system, a maintenance/wipe console and an event
module with carpooling and polls are not things half-finished products have. What is missing is the last
translation step from *capability* to *someone's working day* — the head has no head's view, the board
hides the department by default, the AI is theatre with invoices attached, a junior specialist can delete
the org chart, and the password-recovery path the login screen promises does not exist anywhere in the
product. None of those are deep rewrites: items 1–12 above are a few days of work each, and they are
almost entirely about defaults, gating and one dashboard. Do them and the demo stops being a tour of
screens and starts being a Monday morning. Leave them and a boshqarma boshligʻi will open it once, see a
column with his own seven tasks and an invitation to upload a photo, and go back to Telegram and Excel.
