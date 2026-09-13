# Uzbek copy — merge and review

Branch `uz/copy-review`. Merges `uz/copy-a` and `uz/copy-b` into a branch cut from `master`, then
reviews the merged result: the whole corpus read once as a demanding native reader, and every screen
walked in the running app as `demo.xodim`, `demo.boshliq` and `admin.super`, in uz-Latn and uz-Cyrl,
at 1440 px and 390 px.

The CTO's complaint was that the Uzbek "clearly seems like merely a translation". The two writer
branches fixed that inside their own module sets. What they could not see is the thing a reviewer is
for: the product only reads as one voice if the *same* thing is called the *same* word on every
screen — and the two halves, working in parallel, disagreed with each other in a dozen places, each
half being perfectly natural on its own.

## What changed

| | strings |
|---|---|
| rewritten by `uz/copy-a` + `uz/copy-b` | 859 |
| changed again in this review | 106 |
| total keys, all four locales | 3 365 |

Per module (uz-Latn values; each has an identical uz-Cyrl twin produced from it):

| module | writers | review | module | writers | review |
|---|---|---|---|---|---|
| accounts | 35 | 0 | miniapp | 48 | 9 |
| admin | 132 | 19 | pages | 24 | 0 |
| ai | 71 | 4 | people | 43 | 7 |
| analytics | 47 | 1 | personal | 47 | 1 |
| automations | 10 | 2 | projects | 25 | 0 |
| calendar | 39 | 1 | **realtime** | **0** | **24** |
| departments | 86 | 0 | structure | 23 | 3 |
| events | 50 | 9 | telegram | 11 | 0 |
| fields | 23 | 4 | work | 83 | 15 |
| home | 40 | 6 | *(shared catalogue)* | 33 | 1 |
| inbox | 22 | 1 | *(API: bot templates)* | 36 | 2 |

**The `realtime` module was in neither writer's list.** 61 keys — the shared canvas, presence, the
live-connection pills — had never had a natural-Uzbek pass at all. It is the single largest gap this
review closed.

Gates: `node agentic/scripts/check-i18n.mjs` green (3 365 keys, 0 errors),
`pnpm --filter @devon/i18n test:unit` green (78 tests, transliteration included),
`node agentic/scripts/gate.mjs --profile fast` green (typecheck, lint, unit, i18n, secrets — nothing
skipped).

## The twenty worst, before → after

The ranking is by how badly the string misleads a ministry reader, not by how many characters moved.

**1. A countdown called "hisob" — the same word the console uses for an account.**
`admin.console.settings.wipeConfirmCta`
`60 soniyalik hisobni boshlash` → `60 soniyalik sanoqni boshlash`
On a page whose tabs read *Hisoblar*, *Hisobni oʻchirish*, "start the 60-second account" is what the
sentence says. Two neighbouring strings carried the same error (`wipeCountdownBody`, `wipeReviewBody`).

**2. The shared canvas was called the board, everywhere.**
`realtime.canvas.share.action` `Doskani ulashish` → `Oq taxtani ulashish`
The style guide had already ruled `canvas` = **oq taxta**, `board` = **doska**, and `personal` obeys
it. The whole `realtime.canvas.*` block — 13 strings — said *doska*, so the personal workspace and
the sharing dialog for the very same object used two different nouns.

**3. Presence text that names the wrong object.**
`realtime.presence.many`
`{name} va yana {count} kishi shu doskani koʻrib turibdi` → `{name} va yana {count} kishi hozir shu yerda`
`packages/ui/src/realtime/live-indicators.tsx` renders this on the work board *and* on the shared
canvas panel, so it cannot name either one. The neutral form also matches its own label,
`realtime.presence.label` = "Hozir bu yerda".

**4. A blocked card and a locked account shared a word.**
`work.chip.blocked` `Bloklangan` → `Toʻxtab turibdi`
`admin.console.accounts.status.locked` is also `Bloklangan`. A card is not disciplined; it is waiting.
The AI helper already proposed "Toʻxtab turibdi deb belgilash" for exactly this state.

**5. Uploads called workload.**
`admin.console.audit.verb.storage.uploads_expired`
`muddati oʻtgan yuklamalar tozalandi` → `muddati oʻtgan yuklangan fayllar tozalandi`
*Yuklama* is the product's word for a person's weekly load (`work.workload.*`, `home.myLoad`). In the
audit log it silently meant "uploads".

**6. Sessions vs devices, split across two modules.**
`admin.console.audit.subjectType.session` `Seans` → `Qurilma`;
`…verb.session.revoked` `seansni bekor qildi` → `qurilmani hisobdan chiqardi`
`uz/copy-a` had already ruled *seans* → *qurilma* and rewritten the whole account screen
("Kirilgan qurilmalar", "Qurilmadan chiqildi"). The audit log, owned by the other half, kept *seans*.

**7. A skipped automation run that reads as a held meeting.**
`automations.run.status.skipped` `Oʻtkazildi` → `Oʻtkazib yuborildi`
*Oʻtkazildi* most naturally means "was held / was conducted" — the opposite of skipped. Its own
neighbour `run.reason.other` already said `Oʻtkazib yuborildi`.

**8. An error message that lectures.**
`fields.error.cap_reached_detail`
`… Hech kim oʻqiy olmaydigan jadval jadval emas — avval keraksizini arxivga oling.`
→ `… Yangisini qoʻshish uchun avval keraksizini arxivga oling.`
A faithful rendering of the English aphorism. In Uzbek it reads as a reprimand, and the rule is that
an error says what happened and what to do.

**9. A tile heading that states a fact contradicting its own number.**
`home.dashboard.givenOverdue.title` `Men bergan ishlar kechikdi` → `Kechikkan topshiriqlarim`
The tile renders a 0 and the body "Men bergan ishlarning hammasi muddatida" directly underneath. A
heading is a noun; it does not announce news the card then denies.

**10. "73% chegaradan".**
`home.head.goals.ofCap` `chegaradan` → `chegaraga nisbatan`
`head-dashboard.tsx` renders `{pct}%` + this string. "73% from the limit" is not a sentence in Uzbek;
"73% chegaraga nisbatan" is.

**11. Two words for on-time, one metric.**
`people.indicator.onTimeRate90d.label` `Oʻz vaqtida` → `Muddatida` (+3 sibling strings)
Analytics — where the metric lives — says *muddatida*, and TERMS.md binds `deadline` = **muddat**.
The person page had invented a parallel vocabulary for the same number.

**12. Restore, three ways.**
`fields.manager.restore` `Qaytarish` → `Tiklash` (+`restored`, `restoreFailed`)
`Qaytarish` is already taken: the style guide assigns it to **redo**, opposite **Bekor qilish**
(undo). Every other module restores with *tiklash* (`work.card.restore`, `admin…departments.restore`).

**13. Copy verbs, three ways.**
`miniapp.setup.copy` `Nusxalash` → `Nusxa olish`; `Nusxalandi` → `Nusxa olindi`;
`calendar.feeds.copyToast` `Havola nusxalandi` → `Havoladan nusxa olindi`;
`admin…sentinelKeyCopiedToast` `Kalit nusxalandi` → `Kalitdan nusxa olindi`
The rule was already written down (button `Nusxa olish`, toast always `Nusxa olindi`); three modules
had not read it.

**14. "Xizmat texnik xizmat uchun toʻxtatilgan".**
`admin.console.settings.maintenancePreviewBadge` → `Texnik xizmat uchun vaqtincha toʻxtatilgan`
The word *xizmat* twice in six words, meaning two different things.

**15. Latency called lateness.**
`ai.usage.columns.latency` `Kechikish` → `Javob vaqti`
In a product where *kechikkan* means "overdue" on every board, a column of milliseconds headed
"Kechikish" reads as a list of late work.

**16. An audit verb that is not Uzbek grammar.**
`admin.console.audit.verb.access.denied` `ruxsatsiz amalga urindi` → `ruxsatsiz amal qilishga urindi`
*Amalga urinmoq* is not a construction; *amal qilishga urinmoq* is.

**17. Two names for one AI helper.**
`ai.features.boardRiskDigest.label` `Kim kechikayotgani` → `Kim kechikyapti`
The catalogue named the helper one way, the button that runs it (`work.ai.boardDigest`) another.

**18. A "d" that reads as a day.**
`work.estimate.shortMinute` `{count}d` → `{count} daq` (and `{count}s` → `{count} soat`)
The card chip rendered `4s 30d` next to dates like `02.10.2026`. Everywhere else in the product a
minute is `daq` (`personal.duration.minutesShort`, `people.indicator.value.minutes`). Verified to fit
a 390 px board card.

**19. `2FA` transliterated into Cyrillic.**
`accounts.twoFactor.title` `Икки босқичли текширув (2ФА)` → `… (2FA)` (+2 in admin)
The machine transliterator has no reason to know this is an abbreviation, so the drift check could
not flag it — it only showed on the running uz-Cyrl screen.

**20. `Outlook.cом` and `label:murojaat`.**
`calendar.addTo.outlook` uz-Cyrl `Outlook.cом` → `Outlook.com`;
`work.goals.fieldFilterPlaceholder` uz-Cyrl `label:murojaat` → `label:мурожаат`
A domain half-converted, and one filter example left wholly Latin while its two twins
(`automations.builder.filterPlaceholder`, `fields.filter.hint`) correctly keep only the *key* Latin.

Runners-up, all fixed: `XABARLAR` as the inbox eyebrow while the nav says *Bildirishnomalar*;
`Demo rejim` against the shell's `Namoyish rejimi`; `rasm`/`surat` mixed inside the photo feature;
`Masalan,` vs `Masalan:` (7 : 12 split); `lavozim` used for a unit role in three places the style
guide had already reassigned to *oʻrni*; `Seanslar jurnali` → `Seanslar tarixi`; `Aniq emas` where
every other RSVP surface says `Balki`; `80% idan` / `{pct}% i` spacing; `Bajarilishlar tarixi` →
`Ishga tushishlar tarixi`; `Provayder xatosi` → `Server xatosi`; the Telegram bot's RSVP buttons now
say `Boraman`/`Bormayman` like the app instead of `Ishtirok etaman`.

## Method

- uz-Cyrl was never written by hand. Every corrected uz-Latn value went through
  `packages/i18n/src/transliterate.ts`'s `latinToCyrillic()` with placeholders, product names, filter
  syntax, bot commands and env-var names masked out, then the §17.1 hand-check list applied
  (`тайё`, `меню`, `бюджет`, `объект`, `муддатсиз`, `ғ`, `-яп-`). A full-corpus diff of every
  uz-Cyrl value against a fresh machine transliteration leaves 473 of 3 365 differing, and every one
  of those 473 falls into the documented keep-Latin or hand-check buckets — no free-hand Cyrillic.
- Every screen read in the running app, not from the JSON alone, so wording was judged in its slot:
  chip, toast, heading, form hint, Telegram message. The board, inbox, events, personal, analytics,
  calendar, account, people table, structure, departments, AI and the whole `/admin` console were
  walked in both scripts; the mobile pass at 390 px found no Uzbek string clipped (the bottom bar
  uses `shell.nav.short.*`, and `BILDIRISHNOMALAR` — the longest eyebrow this review introduced —
  fits with room to spare).

## Remaining doubts

Four things I did not change, and why.

1. **`work.title` is "Vazifalar" while the board calls its objects "karta".** The section is named
   for what a person has to do; the board is named for the thing you drag. That is a deliberate
   product decision (nav: *Vazifalar*; board button: *Karta qoʻshish*), and both readings are natural
   — but a reader who notices will ask. Worth one CTO sentence to confirm.
2. **`personal.tasks.inbox` = "Yigʻma"** for the unsorted to-do pile. Defensible, and *Bildirishnomalar*
   is taken, but no ministry employee would reach for that word unprompted. No better candidate found
   that does not collide.
3. **"Davr" for a reporting range** (`analytics.filterBar.dateRange`, `calendar.agenda.range.label`,
   `ai.usage.filter.range`) while *davr* is also the personal workspace's sprint. Left alone: the two
   never appear on the same screen, and *davr* is the ordinary Uzbek word for a reporting period.
4. **Uzbek Latin runs 15–25 % longer than English** across the corpus. Nothing clipped today at
   390 px, but two strings sit close to the edge on a narrow card —
   `work.focus.emptyBody` and `departments.settings.readOnlyNotice`. If a future design tightens the
   card, those are the first to break.

## Found, not fixed — outside a copy branch's mandate

These are real defects a reader sees in Uzbek, but fixing them means touching code or adding message
keys, which this branch is not allowed to do. Routing them is the orchestrator's call.

1. **`apps/web/src/features/analytics/sections.tsx:185,252,327,404`** reuses
   `analytics.filterBar.since` — the filter label *"Qaysi sanadan"* — as the **date column header of
   four chart tables**. On `/analytics` the reader sees a table headed `Qaysi sanadan | Bajarilgan`.
   No value can be right in both slots; it needs its own key (e.g. `analytics.table.weekColumn` =
   "Hafta").
2. **`/admin/audit` prints raw English machine keys.** Rows render as `: seed.demo_applied`,
   `: admin.department.archived`, `: admin.department.paused`, `: departments.demo_seeded` — the
   `admin.console.audit.genericAction` fallback, because `admin.console.audit.verb.*` has no entry
   for those four actions. Needs four new keys.
3. **Demo seed data, three Uzbek defects** (owned by `st/demo-story`, visible on every demo screen):
   - `packages/db/src/seed/modules/personal.ts:160` — `'Kartochka boʻyicha shaxsiy eslatma'`.
     *Kartochka* is on the style guide's banned list; the product says **karta**.
   - `packages/db/src/seed/modules/fields.ts:130` — uz-Cyrl `'Турқча'` for *Turkcha*. The correct
     Cyrillic is **Туркча**; `қ` belongs to Latin `q`, and there is no `q` in *Turkcha*.
   - `packages/db/src/seed/modules/notifications.ts:112,314` — `'… sizni eslatdi'` for a mention,
     while the chip above it now reads **Belgilash** (`inbox.reason.mentioned`). Should be
     `'… sizni izohda belgiladi'`.
     A fourth, cosmetic: the same file's uz-Cyrl carries `20-сентябрь` with a Russian soft sign where
     the app's own date formatter writes `сентябр`.
4. **`work-fixtures.ts:250`** — `'Yuklama sinovini oʻtkazish (1 000 foydalanuvchi)'` uses
   *foydalanuvchi*, banned by §11 (the product says **xodim**), and *yuklama* here means "load test",
   colliding with the workload feature.
5. **`calendar.agenda.noPlace` = "Joyi koʻrsatilmagan" renders on every card row** in *Yaqin kunlar*,
   where a card can never have a place. The string is correct; the screen should not ask for it.

## Handover

Branch: **`uz/copy-review`** (4 commits on top of `master`: two merges, two review commits).
Do **not** merge from here — `master` is being changed by another agent.

```bash
git checkout master
git merge --no-ff uz/copy-review -m "uz: natural Uzbek across the product (copy-a + copy-b + review)"
```

If `master` has moved onto the same strings, keep **master's key set** and **this branch's values**;
for a string `master` added after the branch point, rewrite it against `packages/i18n/UZBEK-STYLE.md`
(§16 and §17 hold every terminology ruling made in this work) before committing. Then re-run:

```bash
pnpm --filter @devon/i18n messages:merge
node agentic/scripts/check-i18n.mjs
pnpm --filter @devon/i18n test:unit
node agentic/scripts/gate.mjs --profile fast
```
