# Uzbek copy log — group B

Branch `uz/copy-b`. Every uz-Latn string rewritten under `packages/i18n/UZBEK-STYLE.md`, plus the
Telegram bot table in `apps/api/src/modules/telegram/templates.ts`. `uz-Cyrl` is **generated** from
the corrected `uz-Latn` with `latinToCyrillic()` (§13) and hand-checked for `ц`/`ё`/`ъ`/loanwords —
it is never written independently, so the two scripts always say the same thing.

**Group B modules** (everything under `packages/i18n/messages/modules/` that group A does not take):
`admin`, `ai`, `analytics`, `automations`, `calendar`, `events`, `home`, `inbox`, `miniapp`,
`pages`, `personal`, `telegram`. Group A holds `accounts`, `departments`, `fields`, `people`,
`projects`, `realtime`, `structure`, `work`. There is no `notifications`, `goals` or `workload`
module directory — notifications live in `inbox`, goals and workload in `analytics`/`home`; they are
covered where they actually are.

## Recurring decisions applied everywhere in this group

| # | Before | After | Why |
|---|---|---|---|
| 1 | `boʻlim` as the tenant | `boshqarma` | UZBEK-STYLE §12.2 binding ruling: the tenant is a *boshqarma*, an internal subdivision is a *boʻlim*. |
| 2 | `foydalanuvchi` | `xodim` (person) / `hisob` (account) | §11.3 — a ministry has *xodim*, not *foydalanuvchi*. |
| 3 | `mavjud emas`, `mavjud boʻlgan` | `yoʻq`, `bor` / dropped | §11.6, §11.18 — the commonest bookish trace. |
| 4 | `muvaffaqiyatli …`, `amalga oshirildi` | `Saqlandi`, `Bajarildi` | §5, §11.1, §11.5 — if there is no error, it succeeded. |
| 5 | `Xatolik yuz berdi`, `Nimadir xato ketdi` | `<narsa>ni yuklab boʻlmadi` + what to do | §6, §11.11–13. |
| 6 | `maʼlumotlar` as filler | the thing itself | §11.7. |
| 7 | `tizim` everywhere | dropped, or `Devon` / `ilova` | §11.8. |
| 8 | `ushbu`, `quyidagi`, `joriy`, `berilgan` | `bu`, dropped, `bu hafta`, `shu` | §11.19–23. |
| 9 | `Yaqinlashib kelayotgan tadbirlar` | `Yaqin tadbirlar` | §11.10. |
| 10 | `kartochka`, `shablon`, `prioritet`, `metrika`, `eksport` | `karta`, `andoza`, `muhimlik`, `koʻrsatkich`, `CSV yuklab olish` | §12.2. |
| 11 | `fokus` | `diqqat vaqti` (timer) / `diqqat markazi` (list) | §12.2 ruling. |
| 12 | `Roʻyxatdan oʻtish` for an event | `Ishtirokni belgilash` | §11.33. |
| 13 | Exclamation marks outside celebrations | removed | §2. |
| 14 | `{n} vazifalar` | `{n} ta vazifa` | §10 — a noun after a numeral takes no plural suffix. |
| 15 | `Boshlanishi` / `Tugashi` in a date filter | `Qaysi sanadan` / `Qaysi sanagacha` | §11.38. |

Per-module before → after tables follow. Anything non-obvious carries a note under its table.

## telegram — 11 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `telegram.phoneMock.replyMessage` | Ulandi! Endi WorkPortal bildirishnomalari shu yerga keladi. | Ulandi. Endi bildirishnomalar shu yerga keladi. |
| `telegram.phoneMock.connectedMessage` | Siz ulandingiz — WorkPortal bildirishnomalari shu chatga keladi. | Hisobingiz ulangan — bildirishnomalar shu yerga keladi. |
| `telegram.notConfigured.body` | Ushbu tizim uchun Telegram botini sozlashni administratordan soʻrang. | Telegram botini sozlashni administratordan soʻrang. |
| `telegram.personal.title` | Sizning Telegramingiz | Telegramingiz |
| `telegram.personal.codeExpires` | Kod {time} da eskiradi | Kod {time} gacha amal qiladi |
| `telegram.personal.mute.until` | {date} gacha oʻchirilgan | {date} gacha oʻchiq |
| `telegram.group.title` | Boʻlim guruhi | Boshqarma guruhi |
| `telegram.group.body` | Boʻlim tadbirlari, soʻrovnomalari va eʼlonlarini olish uchun Telegram guruhini ulang. | Tadbirlar, soʻrovnomalar va eʼlonlar guruhga tushishi uchun Telegram guruhini ulang. |
| `telegram.group.codeBody` | Guruhda ushbu kod bilan /connect buyrugʻini yuboring. | Guruhda shu kod bilan /connect yuboring. |
| `telegram.group.codeExpires` | Kod {time} da eskiradi | Kod {time} gacha amal qiladi |
| `telegram.group.empty.body` | Botni Telegram guruhiga qoʻshing, soʻng shu yerdan ulash kodidan foydalaning. | Botni Telegram guruhiga qoʻshing, soʻng shu yerdan ulash kodini oling. |

## inbox — 22 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `inbox.markAllRead` | Barchasini oʻqilgan deb belgilash | Hammasini oʻqilgan deb belgilash |
| `inbox.empty.inbox.title` | Hammasi tekshirildi | Hammasi koʻrib chiqilgan |
| `inbox.empty.inbox.body` | Hozircha eʼtibor talab qiladigan narsa yoʻq. Xotirjam boʻling. | Hozircha javobingizni kutayotgan bildirishnoma yoʻq. |
| `inbox.empty.unread.title` | Oʻqilmagan narsa yoʻq | Oʻqilmagan bildirishnoma yoʻq |
| `inbox.empty.unread.body` | Barcha bildirishnomalarni koʻrib chiqdingiz. | Hammasini oʻqib chiqdingiz. |
| `inbox.empty.archived.title` | Arxivlangan bildirishnoma yoʻq | Arxivda bildirishnoma yoʻq |
| `inbox.empty.archived.body` | Arxivlagan bildirishnomalaringiz shu yerda koʻrinadi. | Arxivga olgan bildirishnomalaringiz shu yerda turadi. |
| `inbox.reason.mentioned` | Eslatish | Belgilash |
| `inbox.channel.email` | Elektron pochta | E-pochta |
| `inbox.row.archive` | Arxivlash | Arxivga olish |
| `inbox.preferences.body` | Qanday bildirishnomalar va qayerga kelishini tanlang. | Qaysi bildirishnoma qayerga kelishini oʻzingiz tanlang. |
| `inbox.preferences.digestFrequency` | Xulosa chastotasi | Xulosa davriyligi |
| `inbox.preferences.digestMode.off` | Oʻchirilgan | Oʻchiq |
| `inbox.preferences.quietHours.usingDepartmentDefault` | Boʻlimning andozasi qoʻllanmoqda: {range} | Boshqarma sozlamasi qoʻllanmoqda: {range} |
| `inbox.preferences.quietHours.usingPersonal` | Shaxsiy vaqtingiz: {range} | Oʻzingiz belgilagan vaqt: {range} |
| `inbox.preferences.quietHours.start` | Boshlanishi | Qaysi soatdan |
| `inbox.preferences.quietHours.end` | Tugashi | Qaysi soatgacha |
| `inbox.preferences.quietHours.weekends` | Dam olish kunlarini ham qamrab olsin | Dam olish kunlari ham |
| `inbox.preferences.quietHours.tooLoud` | Bu oraliq boʻlim andozasidan kamida shuncha tinch boʻlishi kerak. | Bu oraliq boshqarma belgilagan tinch soatlarni toʻliq qamrab olishi kerak. |
| `inbox.preferences.quietHours.useDefault` | Boʻlim andozasidan foydalanish | Boshqarma sozlamasiga qaytish |
| `inbox.preferences.calendar.title` | Taqvim lentasi | Taqvim ulanishi |
| `inbox.preferences.saved` | Sozlamalar saqlandi | Saqlandi |

## pages — 24 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `pages.eyebrow` | Bilim bazasi | BILIM |
| `pages.kind.brief` | Qisqacha maʼlumot | Qisqacha |
| `pages.empty.title` | Hali sahifalar yoʻq | Hali sahifa yoʻq |
| `pages.empty.body` | Boʻlimingiz uchun birinchi sahifani yarating — masalan, "Biz qanday ishlaymiz". | Birinchi sahifani qoʻshing — masalan, «Biz qanday ishlaymiz». |
| `pages.backToList` | Sahifalar roʻyxatiga qaytish | Sahifalarga qaytish |
| `pages.editor.autosaving` | Saqlanmoqda... | Saqlanmoqda… |
| `pages.editor.toolbar.italic` | Qiya | Kursiv |
| `pages.editor.toolbar.taskList` | Roʻyxat (belgilash mumkin) | Bajarish roʻyxati |
| `pages.editor.toolbar.mention` | Kishini eslatish | Xodimni belgilash |
| `pages.editor.toolbar.translate` | Belgilanganni tarjima qilish | Tanlangan matnni tarjima qilish |
| `pages.editor.contentPlaceholder` | Yozishni boshlang yoki buyruqlar uchun "/" bosing… | Matn yozing yoki amallar uchun «/» kiriting |
| `pages.editor.translate.selectFirst` | Avval matnni belgilang, keyin tarjima qiling | Avval tarjima qilinadigan matnni tanlang |
| `pages.editor.translate.title` | Belgilanganni tarjima qilish | Tanlangan matnni tarjima qilish |
| `pages.editor.translate.accept` | Belgilanganni almashtirish | Matnni almashtirish |
| `pages.editor.translate.errors.invalid` | Belgilangan matnni tekshirib, qayta urinib koʻring | Tanlangan matnni tekshirib, qayta urinib koʻring |
| `pages.versions.empty` | Hali versiyalar yoʻq | Hali saqlangan versiya yoʻq |
| `pages.versions.restore` | Ushbu versiyani tiklash | Shu versiyani tiklash |
| `pages.versions.current` | Joriy | Hozirgi |
| `pages.diff.noChanges` | Bu versiyalar orasida farq yoʻq | Bu ikki versiya orasida farq yoʻq |
| `pages.conflict.body` | Boshqa birov shu orada oʻzgartirish kiritdi. Sahifani qayta yuklab, oʻzgarishlaringizni qayta kiriting. | Shu orada boshqa xodim oʻzgartirdi. Sahifani qayta oching va yozganlaringizni qaytadan kiriting. |
| `pages.onboarding.subtitle` | Yangi xodim boʻlimga qoʻshilganda, quyidagi vazifalar avtomatik ravishda uning shaxsiy vazifalar roʻyxatiga qoʻshiladi. | Yangi xodim boshqarmaga qoʻshilganda, bu bandlar uning shaxsiy vazifalar roʻyxatiga oʻzi qoʻshiladi. |
| `pages.onboarding.ownerRole.head` | Boʻlim rahbari | Boshqarma boshligʻi |
| `pages.onboarding.empty` | Hali moslashuv roʻyxati yoʻq | Moslashuv roʻyxati hali tuzilmagan |
| `pages.undo` | Qaytarish | Bekor qilish |

## home — 40 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `home.dashboard.dueFromMe.body` | {open} ta ochiq, {overdue} tasi muddatidan oʻtgan | {open} ta ochiq, {overdue} tasi kechikkan |
| `home.dashboard.needsMyDecision.title` | Mening qarorim kerak | Qarorimni kutmoqda |
| `home.dashboard.needsMyDecision.body` | Men topshirgan {count} ta ish muddatidan oʻtib ketgan | Men topshirgan {count} ta ish kechikdi |
| `home.dashboard.needsMyDecision.empty` | Hozircha qaror kerak boʻlgan narsa yoʻq | Qaror kutayotgan ish yoʻq |
| `home.dashboard.aroundMe.body` | {count} ta tadbirga qatnashishni tasdiqlagansiz | {count} ta tadbirga boraman deb belgilagansiz |
| `home.dashboard.aroundMe.cta` | Tadbirlarni koʻrish | Tadbirlar |
| `home.dashboard.pinned.empty` | Hali hech narsa mahkamlanmagan | Mahkamlangan diagramma yoʻq |
| `home.dashboard.pinned.cta` | Tahlil sahifasini ochish | Tahlilni ochish |
| `home.dashboard.personal.onTimeRate` | Bajarilganlarning oʻz vaqtidaligi | Muddatida bajarilgani |
| `home.dashboard.personal.focusMinutes` | Bu hafta fokus daqiqalari | Bu haftadagi diqqat daqiqalari |
| `home.dashboard.onboarding.title` | Boshlash | Ilk qadamlar |
| `home.dashboard.onboarding.department` | Boʻlimga qoʻshiling | Boshqarmaga qoʻshiling |
| `home.dashboard.onboarding.work` | Birinchi ishingizni oching | Birinchi kartangizni oching |
| `home.dashboard.onboarding.event` | Tadbirga yoziling | Tadbirga ishtirokni belgilang |
| `home.dashboard.onboarding.focus` | Fokus seansini oʻtkazing | Diqqat vaqtini oʻtkazing |
| `home.dashboard.sectionTiles` | Bugungi holat | Bugun |
| `home.dashboard.givenOverdue.body` | Men topshirgan {count} ta ish muddatidan oʻtib ketgan | Men bergan {count} ta ish muddatidan oʻtdi |
| `home.dashboard.myLoad.title` | Mening yuklamam | Yuklamam |
| `home.dashboard.myLoad.hours` | {capacity} soatdan {hours} soat | {hours}/{capacity} soat |
| `home.dashboard.myLoad.meaning` | Bu haftaga muddati belgilangan ishlaringizning haftalik imkoniyatingizga nisbati. | Bu haftaga muddati belgilangan ishlaringiz haftalik sigʻimingizga nisbatan. |
| `home.dashboard.myLoad.meaningCards` | Boʻlimda ishlarning yarmidan kami baholangan, shuning uchun bu soat emas, karta soni. | Boshqarmada ishlarning yarmidan kami baholangan, shuning uchun bu yerda soat emas, karta sanaladi. |
| `home.head.decisions.meaning` | Siz bergan va muddati oʻtgan vazifalar — hal qilish sizdan. | Siz bergan va muddati oʻtgan kartalar — qaror sizdan. |
| `home.head.overdue.empty` | Kechikkan vazifa yoʻq. Boʻlim muddatlarga ulgurmoqda. | Kechikkan vazifa yoʻq. Boshqarma muddatlarga ulgurmoqda. |
| `home.head.load.meaning` | Ochiq vazifalarning haftalik imkoniyatga nisbati. | Har bir xodimning ochiq kartalari haftalik sigʻimiga nisbatan. |
| `home.head.load.cta` | Yuklamani koʻrish | Yuklama |
| `home.head.projects.meaning` | Eng orqada qolgan loyihalar birinchi turadi. | Eng orqada qolgan loyihalar yuqorida. |
| `home.head.events.meaning` | Yetti kun ichidagi tadbirlar va roziligini bildirganlar soni. | Yetti kun ichidagi tadbirlar va ishtirok etaman deganlar soni. |
| `home.head.events.empty` | Yaqin kunlarda tadbir rejalashtirilmagan. | Yetti kun ichida tadbir rejalashtirilmagan. |
| `home.head.indicatorsNote` | Jadval va sahifalar uchun {count} ta koʻrsatkich mavjud. | Jadval va xodim sahifalari uchun {count} ta koʻrsatkich bor. |
| `home.head.drillNote` | Har bir raqamni bosing — u sizni aynan shu odamga yoki shu ishga olib boradi. | Har bir raqam ortidagi xodim yoki karta ochiladi. |
| `home.head.arrange.heading` | Kartochkalarni joylashtiring | Kartalarni joylashtirish |
| `home.head.arrange.show` | «{name}» kartochkasini koʻrsatish | «{name}» kartasini koʻrsatish |
| `home.head.arrange.moveUp` | «{name}» kartochkasini yuqoriga surish | «{name}» kartasini yuqoriga surish |
| `home.head.arrange.moveDown` | «{name}» kartochkasini pastga surish | «{name}» kartasini pastga surish |
| `home.head.arrange.allHidden.title` | Barcha kartochkalar yashirilgan | Hamma kartalar yashirilgan |
| `home.head.arrange.allHidden.body` | Boshqaruv koʻrinishida hech narsa qolmadi. Dastlabki holatga qaytaring yoki kerakli kartochkalarni belgilang. | Boshqaruv koʻrinishida hech narsa qolmadi. Dastlabki holatga qaytaring yoki kerakli kartalarni belgilang. |
| `home.head.goals.meaning` | Eng orqada qolgan maqsadlar oldinda. Progress kartalardan oʻzi hisoblanadi. | Eng orqada qolgan maqsadlar yuqorida. Bajarilgani kartalardan oʻzi hisoblanadi. |
| `home.head.goals.empty` | Maqsad qoʻyilmagan. Birinchisini qoʻying — progress oʻzi hisoblanadi. | Maqsad qoʻyilmagan. Birinchisini qoʻying — bajarilgani oʻzi hisoblanadi. |
| `home.head.catchUp.meaning` | Boʻlimning haftasi: yutuqlar, xavflar va kim ortiqcha yuklangan. | Boshqarmaning haftasi: yutuqlar, xavflar va kim ortiqcha yuklangan. |
| `home.head.catchUp.idle` | Bir haftalik ish boʻyicha qisqa xulosa tayyorlaymi? Har bir fikr aniq kartaga tayanadi. | Hafta boʻyicha qisqa xulosa tayyorlansinmi? Har bir fikr aniq kartaga tayanadi. |

## analytics — 47 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `analytics.eyebrow` | Hisobotlar | HISOBOTLAR |
| `analytics.kpi.throughput` | Oʻtgan hafta bajarilgan kartochkalar | Oʻtgan hafta bajarilgan kartalar |
| `analytics.kpi.open` | Ochiq kartochkalar | Ochiq kartalar |
| `analytics.kpi.overdue` | Muddati oʻtgan kartochkalar | Muddati oʻtgan kartalar |
| `analytics.kpi.onTimeRate` | Oʻtgan hafta oʻz vaqtida | Oʻtgan hafta muddatida |
| `analytics.ask.title` | Tahlildan soʻrash | Savol bering |
| `analytics.ask.placeholder` | Savol bering, masalan "bu oy muddati oʻtgan kartochkalar" | Masalan: bu oy muddati oʻtgan kartalar |
| `analytics.ask.errors.forbidden` | Bu funksiya oʻchirilgan yoki AI byudjeti tugagan | Savol berish oʻchirilgan yoki AI byudjeti tugagan |
| `analytics.filterBar.since` | Boshlanishi | Qaysi sanadan |
| `analytics.filterBar.until` | Tugashi | Qaysi sanagacha |
| `analytics.filterBar.removeTerm` | "{term}" filtrini olib tashlash | «{term}» filtrini olib tashlash |
| `analytics.filterBar.showAdvanced` | Kengaytirilgan | Qoʻshimcha |
| `analytics.filterBar.hideAdvanced` | Kengaytirilganni yashirish | Qoʻshimchani yashirish |
| `analytics.savedFilters.shared` | Boʻlim bilan boʻlishilgan | Butun boshqarmaga ochiq |
| `analytics.actions.export` | Eksport | Yuklab olish |
| `analytics.actions.exportCsv` | CSV formatida yuklab olish | CSV yuklab olish |
| `analytics.actions.exportPng` | Rasm sifatida yuklab olish | Rasm yuklab olish |
| `analytics.actions.unpin` | Mahkamlashni bekor qilish | Mahkamlashni olib tashlash |
| `analytics.actions.viewAsTable` | Jadval koʻrinishida koʻrish | Jadval koʻrinishi |
| `analytics.actions.viewAsChart` | Diagramma koʻrinishida koʻrish | Diagramma koʻrinishi |
| `analytics.legend.yes` | Kelaman | Boraman |
| `analytics.legend.no` | Kelmayman | Bormayman |
| `analytics.legend.waitlist` | Kutish roʻyxatida | Navbatda |
| `analytics.sections.throughput.title` | Haftalik bajarilgan topshiriqlar | Haftada bajarilgan kartalar |
| `analytics.sections.throughput.question` | Har hafta nechta topshiriq yakunlandi? | Har hafta nechta karta yakunlandi? |
| `analytics.sections.throughput.empty` | Hali yakunlangan topshiriqlar yoʻq | Hali yakunlangan karta yoʻq |
| `analytics.sections.onTimeRate.title` | Oʻz vaqtida bajarilish darajasi | Muddatida bajarilish ulushi |
| `analytics.sections.onTimeRate.question` | Topshiriqlar muddatida bajarilyaptimi? | Kartalar muddatida bajarilyaptimi? |
| `analytics.sections.onTimeRate.empty` | Baholash uchun yetarli maʼlumot yoʻq | Baholash uchun hali yetarli raqam yoʻq |
| `analytics.sections.openVsOverdue.title` | Ochiq va muddati oʻtgan topshiriqlar | Ochiq va muddati oʻtgan kartalar |
| `analytics.sections.openVsOverdue.question` | Ochiq ishlarning qanchasi muddatidan chiqib ketgan? | Ochiq ishlarning qanchasi kechikkan? |
| `analytics.sections.openVsOverdue.empty` | Hozircha ochiq topshiriqlar yoʻq | Ochiq karta yoʻq |
| `analytics.sections.loadPerPerson.empty` | Hozircha hech kimga topshiriq biriktirilmagan | Hech kimga karta biriktirilmagan |
| `analytics.sections.loadPerUnit.empty` | Hozircha boʻlimlar boʻyicha maʼlumot yoʻq | Boʻlimlarga biriktirilgan karta yoʻq |
| `analytics.sections.projectProgress.title` | Loyihalar boʻyicha jarayon | Loyihalarning bajarilishi |
| `analytics.sections.projectProgress.empty` | Hali loyihalar yoʻq | Hali loyiha yoʻq |
| `analytics.sections.eventsParticipation.question` | Tadbirlarga qanday javob berishmoqda? | Tadbirlarga qanday javob berilyapti? |
| `analytics.sections.eventsParticipation.empty` | Bu davrda tadbirlar yoʻq | Bu davrda tadbir boʻlmagan |
| `analytics.sections.pollTurnout.question` | Soʻrovnomalarga qancha kishi ovoz berdi? | Har bir soʻrovnomada nechta xodim ovoz berdi? |
| `analytics.sections.pollTurnout.empty` | Hali soʻrovnomalar yoʻq | Hali soʻrovnoma yoʻq |
| `analytics.sections.personal.title` | Shaxsiy koʻrsatkichlarim | Koʻrsatkichlarim |
| `analytics.sections.personal.empty` | Hozircha shaxsiy koʻrsatkichlar yoʻq | Hozircha koʻrsatkich yigʻilmagan |
| `analytics.personal.onTimeRate` | Bajarilganlarning oʻz vaqtidaligi | Muddatida bajarilgani |
| `analytics.personal.focusMinutes` | Fokus daqiqalari | Diqqat daqiqalari |
| `analytics.personal.upcomingEvents` | Yaqinlashib kelayotgan tadbirlar | Yaqin tadbirlar |
| `analytics.empty.body` | Topshiriqlar va tadbirlar paydo boʻlgach, bu yerda hisobotlar koʻrinadi. | Kartalar va tadbirlar paydo boʻlgach, hisobotlar shu yerda koʻrinadi. |
| `analytics.chartEmpty` | Hozircha maʼlumot yoʻq | Bu davr uchun raqam yoʻq |

## automations — 10 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `automations.description` | «Shunday boʻlsa — shuni qil». Takrorlanuvchi qoʻl mehnatini qoidaga aylantiring. | «Shunday boʻlsa — shunday qilinsin». Takrorlanuvchi qoʻl mehnatini qoidaga aylantiring. |
| `automations.rule.suppressed` | Qoida hozir oʻchirilgan — quyidagi {count} ta ishga tushish u yoqilgan paytda boʻlgan, yangi kartalar uchun hech narsa bajarilmaydi. | Qoida hozir oʻchirilgan — bu {count} ta ishga tushish u yoqilgan paytda boʻlgan; yangi kartalar uchun hech narsa bajarilmaydi. |
| `automations.trigger.cardCreated` | Karta yaratilganda | Karta qoʻshilganda |
| `automations.action.addChecklist` | tekshirish roʻyxatini qoʻshish | bajarish roʻyxatini qoʻshish |
| `automations.action.createFollowup` | davomi uchun karta yaratish | davomi uchun karta qoʻshish |
| `automations.builder.daysAheadHint` | 1 dan 14 kungacha. | 1 kundan 14 kungacha. |
| `automations.builder.checklistLabel` | Tekshirish roʻyxati | Bajarish roʻyxati |
| `automations.builder.followupDueInDays` | Necha kunda | Necha kundan keyin |
| `automations.runsPage.of` | {pages} sahifadan {page} chisi | {pages} sahifadan {page}-si |
| `automations.forbiddenAction` | Ishlarni koʻrish | Doskani ochish |
