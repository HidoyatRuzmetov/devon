# v1.1 final verification — every kept issue, re-driven in the running product

**Date** 2026-09-13 · **Build** `master` @ `3faf1b7` (all v1.1 fix commits merged)
**Stack** `pnpm start --demo` — api `:3000`, web `:5173`, Mini App `:5199`, Postgres/Valkey/Centrifugo in Docker
**Method** the product was driven, not read. Chrome DevTools MCP in three isolated browser contexts
(`demo.boshliq` head · `demo.xodim` member · `admin.super`), 1440×900 and 390×844, uz-Latn and ru;
API-level probes with curl for every permission claim; SQL against the demo database for every data
claim. No product code was edited in this pass.

**Evidence**
- Full screenshot set — every route × persona × width × theme × locale, 480 files:
  `agentic/ledger/v11/2026-09-12T21-40-00-05-00/final/`
  (`node e2e/scripts/ui-blitz-shots.mjs --base http://127.0.0.1:5173 --out .../final` — exit 0, no
  missing routes, locale switch asserted by the script itself).
- Targeted verification captures, cited per issue below:
  `agentic/ledger/v11/2026-09-12T21-40-00-05-00/final/verify/`

---

## 0. For the CTO, in plain language

Thirty-three issues were kept from the design-lead critique and worked. **Twenty-six are genuinely
fixed and I reproduced each fix in the browser or through the API.** Six are partly fixed. One is not
fixed in a way that matters on the day of a demo. Nothing that was working before is broken — with one
exception, and it is the important sentence in this report:

**The head's AI briefing — the single most impressive thing in the product — now fails every time.**
The critique complained that it took 112, 129 and 276 seconds. The fix put a 75-second budget on it.
The briefing genuinely needs 80–280 seconds against the ministry's GLM server, so the budget now cuts
it off before it can answer. I ran it twice as the head this afternoon; both runs ended in
"AI did not answer in time. Try again." A hang became a guaranteed failure. The budget has to be
raised to match the measured latency (or the briefing has to stream partial results) before anyone
demonstrates it.

The second thing worth your attention is not a code defect but an operations one. **The demo database
on this machine cannot be reset.** The seed was improved — people are placed into boʻlimlar, job titles
use proper Uzbek letters, repeated card titles were made distinct — but none of that is visible,
because `seed:demo` does nothing on a database that already has a seed, and `seed:reset --demo` still
crashes on foreign keys (three more than the three that were fixed). Anyone who demos from this box
still sees 26 of 27 people in BOʻLIMSIZ and job titles with typewriter apostrophes. A brand-new
instance would look right. This box will not, until reset works.

Everything else is real progress. A rank-and-file employee can no longer read a colleague's education,
languages or certificates — I checked the endpoint by hand as `demo.xodim` and got 403 on every shape
of the query except "my own rows". The head's six management screens are all visible at his own window
size. The people table treats custom fields as real columns and can chase people to fill them from
three places. Goals read as targets. The rule log is grouped and filterable instead of 79 identical
rows. The refusal screens are one shape. The head gets a management bottom bar on a phone. The AI
console prices every helper and shows who ran what, in seconds rather than milliseconds.

**Gates:** `gate.mjs --profile fast` is green with nothing skipped (typecheck, lint, unit, i18n,
secrets). `pnpm --filter @devon/web build` succeeds.

---

## 1. Issue by issue

Legend: **fixed** = reproduced working · **partial** = the main symptom is gone, something in the
original finding is not · **not fixed** = still reproduces.

### SEV1

| # | Issue | Verdict | What I saw | Evidence |
|---|---|---|---|---|
| 1 | `fields/values` returned every colleague's answers to any member | **fixed** | As `demo.xodim`: `?subjectType=person` → **403**; a colleague's membership id → **403**; own membership id → **403**; `?userIds=<own>` → 200 with rows for exactly one `subjectUserId` (his own); own+colleague ids → **403**. The head still gets the department. | API probes, §3 |
| 2 | Person page said every custom field was empty | **fixed** | Head → Nodira Karimova → Maydonlar renders `magistr` / `ruscha` / `ISO 27001 Lead Auditor (2025), PMP (2024)`. No "Toʻldirilmagan", no required-missing banner. | `final/verify/05b-person-fields-tab-filled.png` |
| 3 | Yuklama: 162 green cells while half the work was invisible | **fixed** | Warning strip **above** the grid: "Bu jadval hamma ishni koʻrsatmayapti — 37 ta kartada muddat yoʻq · 92 ta karta baholanmagan", both counts linking to exactly those cards. Legend above the grid with its thresholds and a "Soat boʻyicha" mode badge. Current week column marked "Bu hafta". | `final/verify/06-workload-head-1440.png`, `final/workworkload__1440__light__uz-Latn.png` |
| 4 | AI briefing contradicted the tiles beside it | **partial** | The arithmetic half is fixed: the Kechikayotgan tile now carries the department total (**84**) instead of only the top-five sum, and `catch-up-grounding.test.ts` pins the headline against fixtures in four locales. **But the briefing itself could not be produced live** — two attempts, both `timeout` (see #23). End-to-end agreement is therefore unverified in the product. | `final/verify/01-head-home-sidebar-1440.png`, `final/verify/16-ai-briefing-timeout.png` |
| 5 | At 1440×900 the head could not see half his own nav group | **fixed** | ISH / JAMOA / BILIM ship folded with a count badge; BOSHQARUV open with **all six** entries (Xodimlar jadvali, Yuklama, Maqsadlar, Maydonlar, Qoidalar, Boʻlim sozlamalari) plus TIZIM, inside 900 px. Groups are buttons with `aria-expanded`. | `final/verify/01-head-home-sidebar-1440.png` |

### SEV2

| # | Issue | Verdict | What I saw | Evidence |
|---|---|---|---|---|
| 6 | Notify-to-fill unreachable from the table | **fixed** | Row overflow menu "1 ta maydonni toʻldirishni soʻrash" (absent for a person with nothing missing), bulk bar "Toʻldirishni soʻrash (1)", and the column-header filter popover — all three places SPEC §4.3/§5 ask for. | `final/verify/04-people-table-fields-bulk-notify.png` |
| 7 | Custom fields were second-class columns | **fixed** | Picker has a MAXSUS MAYDONLAR group; adding Taʼlim gives sort, filter, resize and reorder like any indicator, plus a footer fill figure "27 dan 6 ta". The Ustunlar badge counts rendered columns. | `final/verify/03-people-table-column-picker.png` |
| 8 | Goals: percent and cap rendered wrong, no edit | **partial** | Page is right ("98% (maqsad: 85%)", green cap bar at 78 of 100, edit/delete, click-through, wrapping titles). The head-dashboard tile still disagrees — see §1a. | `final/verify/07-goals-head-1440.png` |
| 9 | Qoidalar: 79 identical run rows, no rule edit | **partial** | Runs grouped, filtered by rule and outcome, paginated; Edit + Duplicate on every rule; the disabled rule explains its history. Group count contradicts the card count — see §1a. | `final/verify/08-automations-head-1440.png` |
| 10 | Events declared `department_child` on twenty routes | **fixed** | `events/guards.ts` answers ownership through `can()` with `{kind:'owned'}`; `role === 'head'` is gone from the module. Live: member PATCH of the head's event → 403. | API probe, §3 |
| 11 | Palette offered "Boʻlim yaratish" to a member | **fixed** | Ctrl+K as `demo.xodim`: gone from AMALLAR, "Tadbir yaratish" appears once, no head-only destination in OʻTISH (HANDOFFS #1 closed too). | §3 |
| 12 | The head's screens had the least motion | **fixed** | Workload 0 → 3 primitives, Qoidalar → 2, Maqsadlar → 3. Full table in §2. | §2 |
| 13 | Person page opened on two empty charts | **fixed** | Both charts render the designed empty state and the accessible table still carries all twelve weeks. | `final/verify/05-person-fields-tab-head.png` |
| 14 | Ambient gradient clipped to a hard-edged rectangle | **fixed** | Layers at `-inset 14%` outside the clip box; the composite carries a radial mask fading to transparent at 92%. No edge can be painted at any width or theme. | §3 |
| 15 | The member's directory was inert | **fixed** | Every colleague card is `role=button tabindex=0`, named "Anvar Aliyev — amallarni ochish", opening Vazifa berish / Doskadagi ustunini ochish / Havola. No Telegram button for a member rather than a 403. | §3 |
| 16 | Member saw "belgilang" over read-only toggles | **fixed** | "Bu sozlamalarni boʻlim boshligʻi boshqaradi. Siz ularni koʻrasiz, lekin oʻzgartira olmaysiz." on both cards; disabled switches visibly dimmer. | `final/verify/10-member-department-readonly.png` |
| 17 | Four shapes of no-permission | **fixed** | Two, as designed: the full lock with one alternative action on /goals, /automations, /people/table, /fields; the own-data ReadOnlyStrip on /work/workload and /department. | `final/goals__member__1440__light__uz-Latn.png` |
| 18 | Two Me/All controls, repeated project cards, three scroll regions | **fixed** | One "Hammasi 27 / Mening" control above the columns; project chips once per column header; one two-axis scroller with sticky column headers. | `final/verify/11-board-member-1440.png` |
| 19 | The table got 531 px of a 900 px screen | **fixed** | Table measures its own top; search in the header row; bulk bar floats; Ism column and checkbox sticky-left. | `final/verify/02-people-table-head-1440.png` |
| 20 | Member Home missing "Mening yuklamam" and the focus list | **partial** | Both present ("40 soatdan 7 soat", five focus cards). The "Mahkamlangan diagrammalar" card still contains no diagram. | `final/verify/09-member-home-1440.png` |
| 21 | Names read twice; 26 menus all called "Aʼzolar" | **fixed** | Tiles read the name once; /department → Aʼzolar has 26 unique per-member menu labels. | §3 |
| 22 | AI budget field was a broken spinbutton | **fixed** | `type=text`, `inputMode=numeric`, value "2 000 000" with the soʻm suffix inside the field. | §3 |
| 23 | `catch_up` ran 276 s with no cancel | **partial — feature now unusable** | Budget, `timeout` status, hint, Cancel and seconds all shipped; the budget is set below the real latency. See §1a and §3. | `final/verify/16-ai-briefing-timeout.png` |
| 24 | Demo seed: duplicates, apostrophes, everyone unassigned | **not fixed on this instance** | The seed source is right; the running database shows none of it, and cannot be reset. See §1a and §3. | `final/verify/02-people-table-head-1440.png` |
| 25 | Event tab strip clipped; 390 px scrollbar inside the sheet | **fixed** | 1440: seven tabs, last reads "Fikr". 390: strip scrolls with an edge fade, no injected scrollbar, RSVP visible without scrolling. | `final/verify/13-event-sheet-member-1440.png`, `final/verify/14-event-sheet-member-390.png` |
| 26 | `/admin` status by colour alone; backups a grey dot | **fixed** | Every check writes its state beside its dot; the unconfigured backup is a warning strip with a Sozlash action; the user total expands per department. | `final/verify/15-admin-super-1440.png` |
| 27 | Mini App unreachable from `pnpm start --demo` | **fixed** | Boot log prints `mini app http://localhost:5199/`; `GET /miniapp/` → 200. | §3 |
| 28 | The head's phone tab bar was the member's | **fixed** | Head at 390: Asosiy / Xodimlar / Yuklama / Vazifalar / Xabarlar. The member keeps his own five. | `final/verify/17-head-390-tabbar.png` |
| 29 | Yuklama sorted by given name, displayed surname-first | **fixed** | Rows read "Anvar Aliyev", "Bahodir Xolmatov" — display and sort use the same key. | `final/verify/06-workload-head-1440.png` |

### SEV3

| # | Issue | Verdict | What I saw | Evidence |
|---|---|---|---|---|
| 30 | Five of thirteen helpers showed no price | **fixed** | 14 helpers, 14 "~N soʻm / soʻrov" lines, with month-to-date spend on a separate labelled line. | §3 |
| 31 | "soʻm dan"; EGDI jargon | **partial** | "soʻmdan" is right in both Uzbek scripts. EGDI survives in the ru and uz-Cyrl quick-add placeholders — two of four locales. | `final/verify/11-board-member-1440.png` |
| 32 | Two member-Home tiles, identical link labels | **fixed** | "Menga topshirilganlar" and "Men bergan ishlar" link to their own destinations; the second reads "Men bergan ishlar kechikdi". | `final/verify/09-member-home-1440.png` |
| 33 | Trace table leaked "(eskirgan)", raw ms, no filters | **fixed** | Helper/outcome/date filters, paging, a who-ran-it column, latency in seconds, no deprecation marker. Person page reads "Telegram: Ulangan". | §3 |

**Tally — 26 fixed · 6 partial (#4, #8, #9, #20, #23, #31) · 1 not fixed on this instance (#24).**

### 1a. The six partials and the one miss, in detail

**#4 — the briefing's grounding.** Two of the three causes named in the critique are closed in code and
pinned by `catch-up-grounding.test.ts`: `doneLastPeriod`/`created` are no longer hard-coded zeroes, and
the department-wide overdue total is now rendered on the Kechikayotgan tile (84) rather than computed
and thrown away, so the head has a number to compare the briefing against. What I could not do is see
the briefing agree with the tiles, because the briefing did not complete — see #23.

**#8 — the goal tile still disagrees with the goal page.** On `/goals` the percent target reads
"98% (maqsad: 85%)". On the head dashboard the same goal reads "100%". The page shows the metric, the
tile shows progress-toward-target clamped at 100, and both are labelled with the goal's own title. The
cap goal is phrased two ways as well: "chegaraning 78%" on the page, "78% chegaradan" on the tile.

**#9 — the run log and the rule card count differently.** The rule card says "79 marta ishlagan".
The grouped log underneath says "1 ta guruh · 50 ta ishga tushish" and "50 ta karta". `app.automation_runs`
holds 79 rows for that rule, so the group is counting the fetched page rather than the batch.

**#20 — the diagrams card still has no diagram.** "Mahkamlangan diagrammalar" renders six numbers and an
accessible table; five of the six numbers are already on the tiles above it.

**#23 — the timeout budget is set below the feature's real latency.** `packages/ai/src/features.ts:156`
sets `catch_up: 75_000`. On this instance `catch_up` has never completed under 78 s. Both of my runs
today ended in `timeout` (107.8 s and 114 s of wall clock against a 75 s budget — the budget is checked
between provider calls, so the clock overruns it). The pending panel, the cancel button, the
"bir daqiqagacha" hint, the retryable message and the seconds-not-milliseconds latency are all correct;
the number is wrong.

**#31 — EGDI in two locales.** `packages/i18n/messages/modules/work/uz-Latn.json` and `en.json` were
rewritten to a sentence a clerk would type. `ru.json` and `uz-Cyrl.json` still carry the EGDI package
placeholder, so a Russian-reading civil servant sees the jargon the finding was about.

**#24 — the seed fix is real, the demo box does not have it.** The source now places 26 of 27 people in
a boʻlim, spells job titles with modifier letters and disambiguates repeated card titles. The running
database still shows BOʻLIMSIZ (26), ASCII apostrophes on two job titles and three identical
"API hujjatlarini yangilash" rows, because `seed:demo` is a no-op on an already-seeded database and
`seed:reset --demo` cannot run (§3). `seed:purge-leftovers` does work and did remove the agent-written
card; the blitz and test departments are already gone from `/admin/departments`.

---

## 2. Motion scores

Measured the way the critique measured them: which of DESIGN.md §10's five primitives
(Stagger, HoverLift, NumberFlow, Skeleton, celebration) the screen's own files import.

| Screen | Critique (before) | Now | Delta |
|---|---|---|---|
| Head Home | 4 (claimed) | 2 — Stagger, Skeleton | see note |
| Member Home | 3 | **4** — Stagger, NumberFlow, Skeleton, celebration | +1 |
| Board `/work` | 3 | 3 — Stagger, HoverLift, Skeleton | = |
| Person page | 3 | 2 — Stagger, Skeleton | see note |
| Events sheet | 3 | **4** | +1 |
| `/people` directory | 2 | 1 — Stagger | see note |
| `/people/table` | 2 | 2 — Stagger, Skeleton | = |
| `/fields` | 2 | **4** | +2 |
| `/ai` | 2 | 2 | = |
| `/goals` | 1 | **3** — Stagger, NumberFlow, Skeleton | +2 |
| `/automations` | 1 | **2** — Stagger, Skeleton | +1 |
| `/admin` | 1 | 1 — Stagger | = |
| **`/work/workload`** | **0** | **3** — Stagger, NumberFlow, Skeleton | **+3** |

The finding behind that table — "the six Boshqaruv screens were shipped flat" — is answered: Yuklama,
Maqsadlar and Qoidalar all gained a matching-shape skeleton, row stagger and, where there are figures,
NumberFlow. The three screens that now measure lower than the critique's number (Head Home, person
page, directory) do so because the critique counted things outside the five primitives (progress arcs,
chart draw-in, tab pills, card hover); `git log` over this range shows no motion deletions, so this is
a measurement difference, not a regression.

The remaining flat surfaces are `/people` (directory) and `/admin`.

---

## 3. Reproduction notes

**#1 — a member cannot read colleagues' field answers.** Logged in as `demo.xodim`, then:

```
GET /fields/values?subjectType=person                               -> 403
GET /fields/values?subjectType=person&subjectIds=<Anvar membership> -> 403
GET /fields/values?subjectType=person&subjectIds=<own membership>   -> 403
GET /fields/values?subjectType=person&userIds=<own user id>         -> 200, 3 rows, one subjectUserId
GET /fields/values?subjectType=person&userIds=<own>,<colleague>     -> 403
```

The head gets the whole department, as designed.

**#10 — events ownership.** As `demo.xodim`, PATCH of the head's event with a valid CSRF token -> 403.
DELETE is not a route on events (cancel is).

**#23 — the AI briefing.** `app.ai_traces` on this instance:

```
2026-09-13 11:37  catch_up  timeout  107 772 ms   <- my second attempt
2026-09-13 11:34  catch_up  timeout  114 044 ms   <- my first attempt
2026-09-13 08:11  catch_up  ok        78 837 ms
2026-09-13 05:58  catch_up  ok       112 123 ms
2026-09-13 05:55  catch_up  ok       275 962 ms
```

**#24 — the demo box cannot be reseeded.** `pnpm --filter @devon/db seed:reset -- --demo` (with
DATABASE_URL exported — the seed CLIs do not read `.env` themselves, which is its own papercut) failed
three times in a row, each on a different foreign key, each a table the application writes and no seed
module names:

1. `field_requests_user_id_fkey` — notify-to-fill requests created through the product.
2. `analytics_daily_department_id_fkey` — the rollup writes one row per department per day; the fix
   clears `analytics_daily` only for the ATI department, so "Axborot xavfsizligi boshqarmasi" blocked it.
3. `ai_search_documents_department_id_fkey`.

I stopped there rather than hand-delete application data. `seed:demo` on top of an existing seed is a
no-op ("checksum … — 0 rows written"), so the improved dataset never reaches a box that has one.

**#11 — command palette as a member.** AMALLAR = Tadbir yaratish, Yangi loyiha, Yangi vazifa, AI dan
soʻrash, Kalendar obunalari, Brauzer eslatmalari, Boʻlimga qoʻshilish, Mening maʼlumotlarim,
Bildirishnoma sozlamalari, Telegram, Mening profilim, Mening vazifalarim, Jadval, Andozalar. No
"Boʻlim yaratish", no duplicate entry. OʻTISH lists no head-only destination.

**#27 — Mini App.** `[start] mini app http://localhost:5199/` in the boot log; `GET /miniapp/` -> 200.

---

## 4. Regressions and new observations

Nothing in the kept set regressed. Four new things are worth a line, none blocking except the first:

1. **`catch_up` is now a guaranteed failure** rather than a slow success (#23). This is the one change
   that made the product worse than it was before the fix pass.
2. **Choice fields render their storage key, not their label.** The people table and the person page
   show `magistr`, `bakalavr`, `ilmiy_daraja`, `ruscha` — raw option ids with underscores — where the
   walkthrough's screenshots showed "Magistr". Introduced when custom fields became real columns (#7).
3. **The people table footer prints two different open-card totals** — "186 ta ochiq vazifa" in the
   label and "187" in the numeric cell — one from the live card list, the other from a cached indicator
   aggregate. Became visible after `seed:purge-leftovers` removed one card.
4. **A member's `/work/workload` own-data view still shows the department-wide honesty strip**
   ("37 ta kartada muddat yoʻq · 92 ta karta baholanmagan") on a page whose own text says the department
   workload is head-only. Small, but it is a department aggregate on a member's screen.

Two older findings the critique listed but which were not in the kept set remain; noted only so they are
not rediscovered as regressions: the event sheet still shows "1 / 30 joy" next to "Ishtirokchilar (2)",
and the goals cap copy differs between tile and page.

---

## 5. Gates

- `node agentic/scripts/gate.mjs --profile fast` -> `ok=true failed=[] skipped=[]`
  (typecheck PASS 22.0 s, lint PASS 27.2 s, unit PASS 126.5 s, i18n PASS 1.1 s, secrets PASS 1.4 s).
- `pnpm --filter @devon/web build` -> built, exit 0.
- `packages/db` was not touched in this pass, so `migrate:verify` was not required; the demo boot did
  apply migration `0811_ai_trace_timeout_status.sql` cleanly.

---

## 6. What I would do before the demo

1. Raise `DEFAULT_FEATURE_TIMEOUT_MS.catch_up` to at least 300 s (measured worst case 276 s), or stream
   the briefing; and check the budget against a wall clock rather than only between provider calls, so
   the printed budget and the real one agree. Until then, do not show the AI briefing.
2. Make `seed:reset --demo` survive a used instance — the three remaining foreign keys are named in §3 —
   then reseed this box so the demo shows the dataset that was actually written.
3. Translate the quick-add placeholder in ru and uz-Cyrl; the EGDI jargon is still there in two of the
   four locales.
4. Make the head-dashboard goal tile call the same two functions the goals page calls.
5. Render choice-field labels instead of storage keys.
