# Uzbek copy log — review pass (`uz/copy-review`)

`uz/copy-a` and `uz/copy-b` merged onto a branch cut from `master`, then reviewed. This log records
**only what the review changed on top of the two writer branches** — the writers' own 859 strings are
in `uzbek-copy-log-a.md` and `uzbek-copy-log-b.md`. The narrative, the twenty worst examples and the
remaining doubts are in `UZBEK-COPY-REVIEW.md`; this file is the exhaustive per-string record.

Every row below also changed its uz-Cyrl twin, produced from the corrected uz-Latn with
`latinToCyrillic()` and hand-checked per `packages/i18n/UZBEK-STYLE.md` §13.2 and §17.1. Reasons that
are not obvious from the pair itself:

- **admin, wipe switch** — `hisob` means *account* on that very page (`Hisoblar`, `Hisobni oʻchirish`);
  a countdown is `sanoq`.
- **admin, sessions** — `uz/copy-a` ruled `seans` → `qurilma` and rewrote the account screen to match;
  the audit log, owned by the other half, had not followed.
- **admin, `uploads_expired`** — `yuklama` is the product's word for a person's weekly load.
- **admin, `access.denied`** — `amalga urinmoq` is not an Uzbek construction.
- **admin, `unit_role_*`** — `rol` inside a unit was reassigned to `oʻrni` (§16); `lavozim` is the job
  title.
- **ai, `latency`** — `kechikish` is what an overdue card is called on every board.
- **ai, `provider_error`** — `provayder` reads as an internet provider; the provider here is a server.
- **automations, `skipped`** — `Oʻtkazildi` most naturally means "was held".
- **calendar/miniapp/admin, copy verbs** — §16 fixes the pair: button `Nusxa olish`, toast
  `Nusxa olindi`.
- **events, `Masalan,` → `Masalan:`** — 12 strings already used the colon, and so does §14's own
  example; these seven were the minority.
- **fields, `restore`** — `Qaytarish` is reserved for **redo** (§5); restore is `tiklash` everywhere else.
- **home, `givenOverdue.title`** — a heading is a noun (§4), and this one asserted a fact the tile's
  own zero contradicts.
- **home, `ofCap`** — rendered as `{pct}% ` + this string by `head-dashboard.tsx`.
- **miniapp, `reason.*`** — the web inbox's reason chips are all nouns; the Mini App's were a mix of
  nouns, verbs and a full sentence.
- **people, on-time** — analytics owns the metric and calls it `muddatida`; TERMS.md binds
  `deadline` = `muddat`.
- **realtime** — this module was in neither writer's list; it is reviewed here in full. `canvas` is
  `oq taxta` (§16), a project member is `ishtirokchi` (§16), and `realtime.presence.*` renders on both
  the board and the canvas so it may name neither.
- **work, `estimate.short*`** — `d` for *daqiqa* sits next to dates on the same chip; the product
  abbreviates it `daq` everywhere else.
- **work, `field.title`** — a card's title is its `nomi`; `sarlavha` is a page heading.
- **work, `chip.blocked`** — `Bloklangan` is what a locked account is called in the admin console.
- **structure, `settingsNotice.selfAssign` / `units.subtitle`** — both said `lavozim` for a unit role.
- **API, `templates.ts`** — the bot's RSVP buttons now match the app's `Boraman`/`Bormayman`; the
  label is echoed back verbatim in `action.rsvp_recorded`.

---

### admin (19)

| kalit | oldin | keyin |
|---|---|---|
| `admin.console.dashboard.checkHealthDesc` | Baza, navbat, xotira va boshqa xizmatlar holatini kuzating | Maʼlumotlar bazasi, navbat, xotira va boshqa xizmatlar holatini kuzating |
| `admin.console.accounts.forceTwoFactorReset` | 2FA ni bekor qilish | Ikki bosqichli tekshiruvni bekor qilish |
| `admin.console.accounts.twoFactorResetToast` | Ikki bosqichli tasdiqlash bekor qilindi | Ikki bosqichli tekshiruv bekor qilindi |
| `admin.console.audit.verb.session.revoked` | seansni bekor qildi | qurilmani hisobdan chiqardi |
| `admin.console.audit.verb.accounts.session_revoked` | seansni bekor qildi | qurilmani hisobdan chiqardi |
| `admin.console.audit.verb.accounts.sessions_revoked_all` | barcha seanslarni bekor qildi | hamma qurilmadan chiqardi |
| `admin.console.audit.verb.structure.unit_role_assigned` | rolni tayinladi | boʻlimda oʻrin tayinladi |
| `admin.console.audit.verb.structure.unit_role_unassigned` | rolni bekor qildi | boʻlimdagi oʻrnini bekor qildi |
| `admin.console.audit.verb.access.denied` | ruxsatsiz amalga urindi | ruxsatsiz amal qilishga urindi |
| `admin.console.audit.verb.accounts.avatar_updated` | profil rasmini oʻzgartirdi | profil suratini oʻzgartirdi |
| `admin.console.audit.verb.accounts.avatar_removed` | profil rasmini oʻchirdi | profil suratini oʻchirdi |
| `admin.console.audit.verb.storage.uploads_expired` | muddati oʻtgan yuklamalar tozalandi | muddati oʻtgan yuklangan fayllar tozalandi |
| `admin.console.audit.subjectType.session` | Seans | Qurilma |
| `admin.console.settings.maintenancePreviewBadge` | Xizmat texnik xizmat uchun toʻxtatilgan | Texnik xizmat uchun vaqtincha toʻxtatilgan |
| `admin.console.settings.sentinelKeyCopiedToast` | Kalit nusxalandi | Kalitdan nusxa olindi |
| `admin.console.settings.wipeReviewBody` | Hisob nolga yetgach oʻchirishni toʻxtatib boʻlmaydi; hisob davom etayotganda esa bekor qilsangiz boʻladi. | Sanoq nolga yetgach oʻchirishni toʻxtatib boʻlmaydi; sanoq davom etayotganda esa bekor qilsangiz boʻladi. |
| `admin.console.settings.wipeConfirmCta` | 60 soniyalik hisobni boshlash | 60 soniyalik sanoqni boshlash |
| `admin.console.settings.wipeCountdownBody` | Hisob nolga yetgach oʻchirish buyrugʻi xost xizmatiga yuboriladi. Hozir bekor qilsangiz boʻladi. | Sanoq nolga yetgach oʻchirish buyrugʻi xost xizmatiga yuboriladi. Hozir bekor qilsangiz boʻladi. |
| `admin.console.settings.wipeFailed` | Boʻlmadi | Bajarilmadi |

### ai (4)

| kalit | oldin | keyin |
|---|---|---|
| `ai.usage.columns.latency` | Kechikish | Javob vaqti |
| `ai.usage.status.ok` | Yaxshi | Bajarildi |
| `ai.usage.status.provider_error` | Provayder xatosi | Server xatosi |
| `ai.features.boardRiskDigest.label` | Kim kechikayotgani | Kim kechikyapti |

### analytics (1)

| kalit | oldin | keyin |
|---|---|---|
| `analytics.actions.exportPng` | Rasm yuklab olish | PNG yuklab olish |

### automations (2)

| kalit | oldin | keyin |
|---|---|---|
| `automations.runsTitle` | Bajarilishlar tarixi | Ishga tushishlar tarixi |
| `automations.run.status.skipped` | Oʻtkazildi | Oʻtkazib yuborildi |

### calendar (1)

| kalit | oldin | keyin |
|---|---|---|
| `calendar.feeds.copyToast` | Havola nusxalandi | Havoladan nusxa olindi |

### events (9)

| kalit | oldin | keyin |
|---|---|---|
| `events.form.aiIdeaPlaceholder` | Masalan, keyingi oyda bogʻda jamoaviy piknik | Masalan: keyingi oyda bogʻda jamoaviy piknik |
| `events.form.titlePlaceholder` | Masalan, kuzgi jamoaviy piknik | Masalan: kuzgi jamoaviy piknik |
| `events.form.placePlaceholder` | Masalan, boshqarma yigʻilishlar zali | Masalan: boshqarma yigʻilishlar zali |
| `events.form.costNotePlaceholder` | Masalan, transport boshqarma hisobidan | Masalan: transport boshqarma hisobidan |
| `events.rsvp.notePlaceholder` | Masalan, allergiya yoki boshqa eslatma | Masalan: allergiya yoki boshqa eslatma |
| `events.rsvp.eventFull` | Joylar toʻlgan — navbatga yozildingiz | Joylar toʻlgan — navbatga qoʻyildingiz |
| `events.items.labelPlaceholder` | Masalan, choy-poy | Masalan: choy-poy |
| `events.polls.questionPlaceholder` | Masalan, piknik uchun qaysi sana qulay? | Masalan: piknik uchun qaysi sana qulay? |
| `events.photos.urlLabel` | Rasm havolasi | Surat havolasi |

### fields (4)

| kalit | oldin | keyin |
|---|---|---|
| `fields.manager.restored` | Qaytarildi | Maydon tiklandi |
| `fields.manager.restoreFailed` | Qaytarib boʻlmadi. | Tiklab boʻlmadi. |
| `fields.manager.restore` | Qaytarish | Tiklash |
| `fields.error.cap_reached_detail` | {cap} ta maydon chegarasi toʻldi. Hech kim oʻqiy olmaydigan jadval jadval emas — avval keraksizini arxivga oling. | {cap} ta maydon chegarasi toʻldi. Yangisini qoʻshish uchun avval keraksizini arxivga oling. |

### home (6)

| kalit | oldin | keyin |
|---|---|---|
| `home.dashboard.onboarding.work` | Birinchi kartangizni oching | Birinchi kartangizni qoʻshing |
| `home.dashboard.kpi.onTimeQuestion` | Yakunlagan ishlaringizning qanchasi muddatida topshirilgan? | Ishlaringizning qanchasi muddatida bajarilgan? |
| `home.dashboard.givenOverdue.title` | Men bergan ishlar kechikdi | Kechikkan topshiriqlarim |
| `home.head.overdue.empty` | Kechikkan vazifa yoʻq. Boshqarma muddatlarga ulgurmoqda. | Kechikkan ish yoʻq. Boshqarma muddatlarga ulgurmoqda. |
| `home.head.load.empty` | Hozircha ochiq vazifa yoʻq. | Hozircha ochiq ish yoʻq. |
| `home.head.goals.ofCap` | chegaradan | chegaraga nisbatan |

### inbox (1)

| kalit | oldin | keyin |
|---|---|---|
| `inbox.eyebrow` | XABARLAR | BILDIRISHNOMALAR |

### miniapp (9)

| kalit | oldin | keyin |
|---|---|---|
| `miniapp.devMode` | Demo rejim — Telegram emas, brauzer oynasi | Namoyish rejimi — Telegram emas, brauzer oynasi |
| `miniapp.priority.medium` | Oʻrta | Oʻrtacha |
| `miniapp.reason.assigned` | Topshirildi | Topshiriq |
| `miniapp.reason.mentioned` | Sizni belgilashdi | Belgilash |
| `miniapp.reason.updated` | Yangilandi | Yangilanish |
| `miniapp.fields.eyebrow` | SOʻRALGAN MAYDONLAR | MAYDONLAR |
| `miniapp.setup.copy` | Nusxalash | Nusxa olish |
| `miniapp.setup.copied` | Nusxalandi | Nusxa olindi |
| `miniapp.setup.copyFailed` | Nusxalab boʻlmadi | Nusxa olinmadi |

### people (7)

| kalit | oldin | keyin |
|---|---|---|
| `people.table.density.label` | Qator balandligi | Zichlik |
| `people.table.density.compact` | Zich | Ixcham |
| `people.indicator.onTimeRate90d.label` | Oʻz vaqtida | Muddatida |
| `people.person.chart.onTimeRate` | Oʻz vaqtida, % | Muddatida, % |
| `people.person.chart.onTime.title` | Oʻz vaqtida bajarish | Muddatida bajarish |
| `people.person.chart.onTime.question` | Muddati bor ishlarning qanchasi vaqtida topshirildi? | Muddati bor ishlarning qanchasi muddatida bajarildi? |
| `people.person.events.rsvp.maybe` | Aniq emas | Balki |

### personal (1)

| kalit | oldin | keyin |
|---|---|---|
| `personal.pomodoro.log.title` | Seanslar jurnali | Seanslar tarixi |

### realtime (24)

| kalit | oldin | keyin |
|---|---|---|
| `realtime.presence.one` | {name} ham shu doskani koʻrib turibdi | {name} ham hozir shu yerda |
| `realtime.presence.many` | {name} va yana {count} kishi shu doskani koʻrib turibdi | {name} va yana {count} kishi hozir shu yerda |
| `realtime.canvas.share.action` | Doskani ulashish | Oq taxtani ulashish |
| `realtime.canvas.share.title` | Doskani ulashish | Oq taxtani ulashish |
| `realtime.canvas.share.description` | Shaxsiy doskangizning nusxasi loyiha yoki tadbir sahifasida koʻrinadi. Asl doskangiz shaxsiyligicha qoladi. | Shaxsiy oq taxtangizning nusxasi loyiha yoki tadbir sahifasida koʻrinadi. Aslisi shaxsiyligicha qoladi. |
| `realtime.canvas.share.privacyNote` | Ulashilganda doskangizning nusxasi olinadi. Keyingi oʻzgarishlaringiz nusxaga oʻtmaydi — nusxani shu yerdan tahrirlaysiz. Ulashuvni istalgan vaqtda qaytarib olasiz. | Ulashilganda oq taxtangizning nusxasi olinadi. Keyingi oʻzgarishlaringiz nusxaga oʻtmaydi — nusxani shu yerdan tahrirlaysiz. Ulashuvni istalgan vaqtda qaytarib olasiz. |
| `realtime.canvas.share.target` | Tanlang | Qaysi biri |
| `realtime.canvas.share.allowEdit` | Qatnashchilar tahrirlay olsin | Ishtirokchilar tahrirlay olsin |
| `realtime.canvas.share.allowEditHelp` | Oʻchirilsa — faqat koʻradilar, kursorlari koʻrinmaydi. | Oʻchirilsa — faqat koʻrishadi, kursorlari ham koʻrinmaydi. |
| `realtime.canvas.share.toast` | Doska ulashildi | Oq taxta ulashildi |
| `realtime.canvas.share.failed.generic` | Doskani ulashib boʻlmadi. Qayta urinib koʻring. | Oq taxtani ulashib boʻlmadi. Qayta urinib koʻring. |
| `realtime.canvas.revoke.confirmBody` | Nusxa hamma uchun yopiladi. Shaxsiy doskangizga hech narsa boʻlmaydi. | Nusxa hamma uchun yopiladi. Shaxsiy oq taxtangizga hech narsa boʻlmaydi. |
| `realtime.canvas.revoke.confirm` | Ha, yopilsin | Qaytarib olish |
| `realtime.canvas.shared.editable` | Qatnashchilar tahrirlay oladi | Ishtirokchilar tahrirlay oladi |
| `realtime.canvas.shared.openOriginal` | Shaxsiy doskani ochish | Shaxsiy oq taxtani ochish |
| `realtime.canvas.cursors.nobody` | Hozir bu doskada boshqa hech kim yoʻq | Hozir bu oq taxtada boshqa hech kim yoʻq |
| `realtime.canvas.conflict.title` | Doskani kimdir sizdan oldin oʻzgartirdi | Oq taxtani kimdir sizdan oldin oʻzgartirdi |
| `realtime.canvas.empty.title` | Bu doska hali ulashilmagan | Bu oq taxta hali ulashilmagan |
| `realtime.canvas.empty.body` | Ulashsangiz — loyiha yoki tadbir qatnashchilari uni birga koʻradi va tahrirlaydi. | Ulashsangiz — loyiha yoki tadbir ishtirokchilari uni birga koʻradi va tahrirlaydi. |
| `realtime.canvas.loading.title` | Doska yuklanmoqda | Oq taxta yuklanmoqda |
| `realtime.canvas.error.title` | Doskani ochib boʻlmadi | Oq taxtani ochib boʻlmadi |
| `realtime.canvas.error.body` | Ulanishda muammo boʻldi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `realtime.canvas.forbidden.title` | Bu doska sizga ochiq emas | Bu oq taxta sizga ochiq emas |
| `realtime.canvas.forbidden.body` | Uni faqat ulashilgan loyiha yoki tadbir qatnashchilari koʻradi. | Uni faqat ulashilgan loyiha yoki tadbir ishtirokchilari koʻradi. |

### structure (3)

| kalit | oldin | keyin |
|---|---|---|
| `structure.units.subtitle` | {departmentName} boʻlimlari va lavozimlari | {departmentName} boʻlimlari va ulardagi oʻrinlar |
| `structure.units.settingsNotice.selfAssign` | Hozircha lavozimlarni faqat boshqarma boshligʻi belgilay oladi | Hozircha boʻlimdagi oʻrinlarni faqat boshqarma boshligʻi belgilay oladi |
| `structure.roles.assignDialog.role` | Lavozim | Boʻlimdagi oʻrni |

### work (15)

| kalit | oldin | keyin |
|---|---|---|
| `work.quickAdd.dialogHint` | Sarlavhani yozing. Istasangiz: «Nodira: hisobot, juma» — kimga va qachonligi ham tushuniladi. | Nomini yozing. Istasangiz: «Nodira: hisobot, juma» — kimga va qachonligi ham tushuniladi. |
| `work.field.title` | Sarlavha | Nomi |
| `work.card.reassigned` | Vazifa {name}ga oʻtkazildi | Karta {name}ga oʻtkazildi |
| `work.priority.none` | Muhimlik yoʻq | Belgilanmagan |
| `work.timeline.zoomLabel` | Masshtab | Miqyos |
| `work.ai.suggestAssignee` | Kimga berish kerak | Kimga topshirish |
| `work.actions.create` | Yangi vazifa | Yangi karta |
| `work.estimate.hint` | Masalan: 2, 1,5 soat, 3 kun yoki 90 daqiqa. | Masalan: 2 soat, 1,5 soat, 3 kun yoki 90 daqiqa. |
| `work.estimate.shortHour` | {count}s | {count} soat |
| `work.estimate.shortMinute` | {count}d | {count} daq |
| `work.chip.blocked` | Bloklangan | Toʻxtab turibdi |
| `work.workload.legendFreeHours` | Sigʻimning 80% idan kam | Sigʻimning 80%idan kam |
| `work.workload.legendOverHours` | 100% dan ortiq | 100%dan ortiq |
| `work.workload.modeCountWhy` | Ochiq ishning atigi {pct}% i baholangan, shuning uchun ranglar soat emas, karta soni boʻyicha. | Ochiq ishning atigi {pct}%i baholangan, shuning uchun ranglar soat emas, karta soni boʻyicha. |
| `work.goals.capUsed` | chegaraning {pct}% i | chegaraning {pct}%i |
### uz-Cyrl only (2)

Values whose uz-Latn twin was already correct; only the Cyrillic was wrong. Neither could be caught by
the machine-transliteration diff, because the machine produces the same wrong output.

| kalit | oldin | keyin | sabab |
|---|---|---|---|
| `accounts.twoFactor.title` | Икки босқичли текширув (2ФА) | Икки босқичли текширув (2FA) | qisqartma lotincha qoladi (§17.1) |
| `admin.console.settings.wipeTotpLabel` · `wipeReviewTotp` | 2ФА коди | 2FA коди | shu sabab |
| `calendar.addTo.outlook` | Outlook.cом | Outlook.com | domen nomi butunlay lotincha |
| `work.goals.fieldFilterPlaceholder` | label:murojaat | label:мурожаат | filtr kaliti lotincha, qiymati kirillcha (§17.1) |

### API (`apps/api`, 2)

| fayl | oldin | keyin |
|---|---|---|
| `modules/telegram/templates.ts` `button.rsvp_yes` | Ishtirok etaman / Иштирок этаман | Boraman / Бораман |
| `modules/telegram/templates.ts` `button.rsvp_no` | Ishtirok etmayman / Иштирок этмайман | Bormayman / Бормайман |
