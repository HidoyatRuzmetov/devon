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

## calendar — 39 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `calendar.title` | Kalendar | Taqvim |
| `calendar.eyebrow` | REJA VA ESLATMALAR | TAQVIM |
| `calendar.description` | Tadbirlar va kartochka muddatlari — bir joyda, telefoningizdagi kalendarda va eslatmalarda. | Tadbirlar va karta muddatlari bir joyda — telefoningizdagi taqvimda va eslatmalarda. |
| `calendar.actions.undo` | Qaytarish | Bekor qilish |
| `calendar.forbidden.body` | Kalendar obunalari shaxsiy. Hisobingizga kirganingizni tekshiring. | Taqvim obunalari shaxsiy. Oʻz hisobingizga kirganingizni tekshiring. |
| `calendar.offline.body` | Internet tiklanganda kun tartibi oʻzi yangilanadi. | Aloqa tiklangach kun tartibi oʻzi yangilanadi. |
| `calendar.agenda.description` | Sizning tadbirlaringiz va muddati kelayotgan kartochkalaringiz. | Tadbirlaringiz va muddati yaqinlashgan kartalaringiz. |
| `calendar.agenda.kind.card` | Kartochka | Karta |
| `calendar.agenda.empty.body` | Tadbir yarating yoki kartochkaga muddat qoʻying — bu yerda koʻrinadi. | Tadbir qoʻshing yoki kartaga muddat belgilang — shu yerda koʻrinadi. |
| `calendar.agenda.error.body` | Ulanishda muammo boʻldi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `calendar.feeds.title` | Kalendar obunalari | Taqvim obunalari |
| `calendar.feeds.description` | Maxfiy havola orqali WorkPortal kalendaringizni telefoningizga yoki Outlookka ulang. | Maxfiy havola orqali WorkPortal taqvimingizni telefoningizga yoki Outlookka ulang. |
| `calendar.feeds.secretWarning` | Bu havola — kalit. Havolaga ega har kim sizning tadbirlaringiz va muddatlaringizni koʻra oladi. Uni faqat oʻzingizning ilovangizga qoʻying. | Bu havola — kalit. Havolaga ega har kim tadbirlaringiz va muddatlaringizni koʻra oladi. Uni faqat oʻz ilovangizga kiriting. |
| `calendar.feeds.create.labelPlaceholder` | Masalan: iPhone kalendari | Masalan: iPhone taqvimi |
| `calendar.feeds.create.submit` | Obuna yaratish | Obuna qoʻshish |
| `calendar.feeds.create.creating` | Yaratilmoqda… | Qoʻshilmoqda… |
| `calendar.feeds.kind.tasks` | Faqat kartochka muddatlari | Faqat karta muddatlari |
| `calendar.feeds.kind.allHelp` | Tadbirlar ham, muddati bor kartochkalar ham. | Tadbirlar ham, muddati bor kartalar ham. |
| `calendar.feeds.kind.tasksHelp` | Faqat sizga biriktirilgan, muddati bor kartochkalar. | Faqat sizga biriktirilgan, muddati bor kartalar. |
| `calendar.feeds.url.webcalHelp` | iPhone, Apple Calendar va Outlook uchun — bosilganda kalendar ilovasi ochiladi. | iPhone, Apple Calendar va Outlook uchun — bosilganda taqvim ilovasi ochiladi. |
| `calendar.feeds.meta.created` | Yaratilgan {date} | Qoʻshilgan {date} |
| `calendar.feeds.rotate.confirmTitle` | Havolani yangilaymizmi? | Havola yangilansinmi? |
| `calendar.feeds.rotate.confirmBody` | Eski havola shu zahoti ishlamay qoladi. Yangi havolani kalendar ilovangizga qaytadan qoʻyishingiz kerak boʻladi. | Eski havola shu zahoti ishlamay qoladi. Yangi havolani taqvim ilovangizga qaytadan kiritishingiz kerak boʻladi. |
| `calendar.feeds.rotate.confirm` | Ha, yangilansin | Yangilash |
| `calendar.feeds.empty.body` | Obuna yarating — tadbirlaringiz telefoningizdagi kalendarda ham koʻrinadi. | Obuna qoʻshing — tadbirlaringiz telefoningizdagi taqvimda ham koʻrinadi. |
| `calendar.feeds.empty.action` | Obuna yaratish | Obuna qoʻshish |
| `calendar.feeds.error.body` | Ulanishda muammo boʻldi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `calendar.push.description` | Muddat yaqinlashganda yoki sizni eslatib oʻtishganda — WorkPortal ochiq boʻlmasa ham xabar keladi. | Muddat yaqinlashganda yoki sizni belgilashganda xabar keladi — WorkPortal ochiq boʻlmasa ham. |
| `calendar.push.what.mentioned` | Izohda sizni eslatib oʻtishsa | Izohda sizni belgilashsa |
| `calendar.push.what.assigned` | Sizga kartochka biriktirilsa | Sizga karta biriktirilsa |
| `calendar.push.what.due` | Kartochka muddati yaqinlashsa | Karta muddati yaqinlashsa |
| `calendar.push.quietHours.note` | Tinch soatlaringizda xabar kelmaydi — kirish qutisi sozlamalaridagi vaqtga boʻysunadi. | Tinch soatlaringizda xabar kelmaydi — bildirishnoma sozlamalaringizdagi vaqt qoʻllanadi. |
| `calendar.push.state.off` | Bu qurilmada oʻchirilgan | Bu qurilmada oʻchiq |
| `calendar.push.unsupported.body` | Chrome, Edge yoki Firefoxning yangi versiyasidan foydalaning. iPhoneʼda WorkPortalni avval «Bosh ekranga qoʻshish» kerak. | Chrome, Edge yoki Firefoxning yangi versiyasidan foydalaning. iPhoneʼda avval WorkPortalni bosh ekranga qoʻshing. |
| `calendar.push.denied.title` | Brauzer eslatmalarni bloklagan | Brauzer bildirishnomalarni toʻsib qoʻygan |
| `calendar.push.denied.body` | Manzil satridagi qulf belgisini bosing va bu sayt uchun bildirishnomalarga ruxsat bering, soʻng qaytadan urinib koʻring. | Manzil satridagi qulf belgisini bosing, bu sayt uchun bildirishnomalarga ruxsat bering va qayta urinib koʻring. |
| `calendar.push.error.body` | Ulanishda muammo boʻldi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `calendar.addTo.label` | Kalendarga qoʻshish | Taqvimga qoʻshish |
| `calendar.addTo.hint` | Tadbirni oʻz kalendaringizga koʻchiradi. | Tadbirni oʻz taqvimingizga koʻchiradi. |

## personal — 47 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `personal.eyebrow` | FAQAT SIZ UCHUN | FAQAT SIZGA |
| `personal.description` | Davrlar, vazifalar, qaydlar, doska va fokus vaqti uchun shaxsiy maydoningiz. | Davrlar, vazifalar, qaydlar, oq taxta va diqqat vaqti — faqat sizga koʻrinadigan maydon. |
| `personal.tabs.canvas` | Doska | Oq taxta |
| `personal.privacy.note` | Bu maydonni faqat siz koʻrasiz — boʻlim boshligʻi ham, boshqa hech kim ham emas. | Bu yerdagilarni faqat siz koʻrasiz — boshqarma boshligʻi ham, boshqa hech kim ham koʻrmaydi. |
| `personal.today.tasks.completedToast` | Bajarildi deb belgilandi | Bajarildi |
| `personal.today.empty.title` | Bugun uchun hech narsa rejalashtirilmagan | Bugunga reja yoʻq |
| `personal.today.empty.body` | Bu yerda koʻrish uchun vazifa qoʻshing yoki davr boshlang. | Vazifa qoʻshing yoki davr boshlang — shu yerda koʻrinadi. |
| `personal.today.allDone.title` | Hozircha barchasi bajarildi | Hozircha hammasi bajarildi |
| `personal.today.allDone.body` | Faol davrlar va kirish qutingizda boshqa hech narsa qolmadi. Osoyishtalikdan bahramand boʻling. | Faol davrlaringizda ham, yigʻmada ham boshqa vazifa qolmadi. |
| `personal.today.focus` | Fokus | Diqqat |
| `personal.today.period.progressAria` | Davr jarayoni | Davrning bajarilgan qismi |
| `personal.today.rollover.bannerGoal` | “{goal}” davri vaqti tugadi. Tugallanmagan vazifalarni yangi davrga koʻchirasizmi? | «{goal}» davri vaqti tugadi. Tugallanmagan vazifalarni yangi davrga koʻchirasizmi? |
| `personal.sprints.empty.title` | Hali davrlar yoʻq | Hali davr yoʻq |
| `personal.sprints.create.submit` | Davr yaratish | Davrni boshlash |
| `personal.sprints.complete.action` | Yakunlangan deb belgilash | Yakunlash |
| `personal.sprints.kind.custom` | Ixtiyoriy | Boshqa |
| `personal.tasks.inbox` | Kirish qutisi | Yigʻma |
| `personal.tasks.toggleDone` | Bajarilgan deb belgilash | Bajarildi deb belgilash |
| `personal.tasks.indent` | Ichkariga surish (quyi vazifa qilish) | Quyi vazifaga aylantirish |
| `personal.tasks.outdent` | Tashqariga chiqarish | Yuqoriga chiqarish |
| `personal.tasks.empty.section` | Bu yerda hali vazifalar yoʻq. | Bu yerda hali vazifa yoʻq. |
| `personal.notes.bodyPlaceholder` | Nimadir yozing... | Xohlagan narsangizni yozing |
| `personal.notes.unpin` | Mahkamlashni bekor qilish | Mahkamlashni olib tashlash |
| `personal.notes.empty.title` | Hali qaydlar yoʻq | Hali qayd yoʻq |
| `personal.canvas.create` | Yangi doska | Yangi oq taxta |
| `personal.canvas.newTitle` | Yangi doska | Yangi oq taxta |
| `personal.canvas.back` | Doskalarga qaytish | Oq taxtalarga qaytish |
| `personal.canvas.delete` | Doskani oʻchirish | Oq taxtani oʻchirish |
| `personal.canvas.deleted.toast` | Doska oʻchirildi | Oq taxta oʻchirildi |
| `personal.canvas.empty.title` | Hali doskalar yoʻq | Hali oq taxta yoʻq |
| `personal.canvas.empty.body` | Doska — eskiz va eslatma qogʻozlari uchun erkin joy. | Oq taxta — eskiz va eslatma qogʻozlari uchun erkin maydon. |
| `personal.canvas.addSticky` | Eslatma qogʻoz qoʻshish | Eslatma qogʻozi qoʻshish |
| `personal.pomodoro.phase.focus` | Fokus | Diqqat |
| `personal.pomodoro.action.startFocus` | Fokusni boshlash | Diqqat vaqtini boshlash |
| `personal.pomodoro.action.pause` | Pauza | Toʻxtatib turish |
| `personal.pomodoro.action.stop` | Toʻxtatish | Tugatish |
| `personal.pomodoro.notifications.off` | Bildirishnomalar oʻchirilgan | Bildirishnomalar oʻchiq |
| `personal.pomodoro.settings.focusMin` | Fokus (daqiqa) | Diqqat (daqiqa) |
| `personal.pomodoro.settings.cyclesBeforeLong` | Uzoq tanaffusdan oldingi fokus soni | Uzoq tanaffusgacha nechta diqqat vaqti |
| `personal.pomodoro.stats.todayFocus` | Bugungi fokus | Bugungi diqqat vaqti |
| `personal.pomodoro.stats.weekFocus` | Shu haftalik fokus | Bu haftadagi diqqat vaqti |
| `personal.pomodoro.stats.weekSessions` | Shu haftalik seanslar | Bu haftadagi seanslar |
| `personal.pomodoro.log.empty.title` | Hali seanslar yoʻq | Hali seans yoʻq |
| `personal.pomodoro.log.empty.body` | Bu yerda koʻrish uchun fokus seansini boshlang. | Diqqat vaqtini boshlang — shu yerda koʻrinadi. |
| `personal.ai.discard` | Rad etish | Kerak emas |
| `personal.ai.disclaimer` | AI takliflari xato boʻlishi mumkin — hech narsa tekshirmasdan qoʻshilmaydi. | AI takliflari xato boʻlishi mumkin — siz tasdiqlamaguningizcha hech narsa qoʻshilmaydi. |
| `personal.ai.catchUp.savedToast` | Xulosa qaydlarga saqlandi | Qaydlarga saqlandi |

## miniapp — 48 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `miniapp.devMode` | Namunaviy rejim — Telegram emas, brauzer seansi | Demo rejim — Telegram emas, brauzer oynasi |
| `miniapp.noDepartment` | Boʻlim tanlanmagan | Boshqarma tanlanmagan |
| `miniapp.tab.focus` | Fokus | Diqqat |
| `miniapp.tab.focusShort` | Fokus | Diqqat |
| `miniapp.error.title` | Nimadir xato ketdi | Yuklab boʻlmadi |
| `miniapp.error.body` | Maʼlumotni yuklab boʻlmadi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `miniapp.offline.body` | Internet aloqasi uzilgan. Ulanish tiklangach, qayta urinib koʻring. | Aloqa tiklangach qayta urinib koʻring. |
| `miniapp.forbidden.title` | Ruxsat yoʻq | Bu sahifa boshliq uchun |
| `miniapp.forbidden.body` | Bu sahifa boʻlim boshligʻi uchun. Agar bu xato boʻlsa, boshligʻingizga murojaat qiling. | Bu sahifani boshqarma boshligʻi koʻradi. Xato boʻlsa, boshligʻingizga ayting. |
| `miniapp.reason.mentioned` | Eslatildingiz | Sizni belgilashdi |
| `miniapp.reason.digest` | Kunlik xulosa | Xulosa |
| `miniapp.inbox.markedRead` | Oʻqildi deb belgilandi | Oʻqildi |
| `miniapp.inbox.markAllRead` | Hammasini oʻqildi deb belgilash | Hammasini oʻqilgan deb belgilash |
| `miniapp.inbox.snooze` | Ertaga | Kechiktirish |
| `miniapp.inbox.archive` | Arxivlash | Arxivga olish |
| `miniapp.board.team` | Boʻlim | Boshqarma |
| `miniapp.board.myCards` | Mening kartochkalarim | Kartalarim |
| `miniapp.board.openTotal` | Boʻlimda ochiq | Boshqarmada ochiq |
| `miniapp.board.overdueTotal` | Boʻlimda kechikkan | Boshqarmada kechikkan |
| `miniapp.board.empty.body` | Sizga hali kartochka biriktirilmagan. Biriktirilsa, shu yerda paydo boʻladi. | Sizga hali karta biriktirilmagan. Biriktirilsa, shu yerda paydo boʻladi. |
| `miniapp.board.emptyTeam.title` | Boʻlim doskasi boʻsh | Boshqarma doskasi boʻsh |
| `miniapp.board.emptyTeam.body` | Boʻlimda hali ochiq kartochka yoʻq. | Boshqarmada hali ochiq karta yoʻq. |
| `miniapp.card.title` | Kartochka | Karta |
| `miniapp.card.updateFailed` | Yangilab boʻlmadi | Kartani yangilab boʻlmadi |
| `miniapp.card.readOnly` | Bu kartochkani faqat oʻqiy olasiz. | Bu kartani faqat oʻqiy olasiz. |
| `miniapp.card.checklist` | Nazorat roʻyxati | Bajarish roʻyxati |
| `miniapp.card.commentPlaceholder` | Izoh yozing… | Izoh yozing |
| `miniapp.events.eyebrow` | Boʻlim tadbirlari | TADBIRLAR |
| `miniapp.events.going` | {count} ta boradi | {count} kishi boradi |
| `miniapp.events.capacity` | {used} / {total} joy | {used}/{total} joy |
| `miniapp.events.empty.body` | Boʻlimda yaqin kunlarda tadbir rejalashtirilmagan. | Boshqarmada yaqin kunlarda tadbir rejalashtirilmagan. |
| `miniapp.carpool.title` | Yoʻlovchi olish | Birga borish |
| `miniapp.carpool.seats` | {free} / {total} joy boʻsh | {free}/{total} joy boʻsh |
| `miniapp.carpool.empty` | Bu tadbirga mashina taklif qilinmagan. | Bu tadbirga hech kim mashina taklif qilmagan. |
| `miniapp.focus.title` | Fokus | Diqqat vaqti |
| `miniapp.focus.eyebrow` | Shaxsiy maydon | SHAXSIY |
| `miniapp.focus.reset` | Vaqtni tiklash | Qaytadan |
| `miniapp.focus.stats` | Fokus vaqti | Diqqat vaqti |
| `miniapp.focus.ringAria` | {phase} bosqichi qoldigʻi | {phase} bosqichida qolgan vaqt |
| `miniapp.focus.alertMuted` | Bildirishnomalar oʻchirilgan — xabar yuborilmadi. | Bildirishnomalar oʻchiq — xabar yuborilmadi. |
| `miniapp.focus.phase.focus` | Fokus | Diqqat |
| `miniapp.fields.title` | Mening maʼlumotlarim | Maʼlumotlarim |
| `miniapp.fields.eyebrow` | Boʻlim soʻragan maydonlar | SOʻRALGAN MAYDONLAR |
| `miniapp.fields.readOnly` | Bu maydonni boʻlim boshligʻi toʻldiradi. | Bu maydonni boshqarma boshligʻi toʻldiradi. |
| `miniapp.fields.numberInvalid` | Faqat raqam kiriting | Raqam kiriting. |
| `miniapp.fields.empty.body` | Boʻlim sizdan hech qanday maʼlumot soʻramagan. | Boshqarma sizdan hech narsa soʻramagan. |
| `miniapp.setup.title` | Telegram sozlamasi | Telegram sozlamalari |
| `miniapp.setup.step.group_connected.title` | Boʻlim guruhi ulangan | Boshqarma guruhi ulangan |

## events — 50 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `events.description` | Boʻlim birgalikda qiladigan har bir ishni rejalashtiring, ishtirokni belgilang. | Boshqarma birga qiladigan ishlarni rejalashtiring va ishtirokni belgilang. |
| `events.actions.create` | Tadbir yaratish | Tadbir qoʻshish |
| `events.actions.moreActions` | Qoʻshimcha amallar | Yana amallar |
| `events.empty.title` | Hozircha tadbirlar yoʻq | Hali tadbir yoʻq |
| `events.empty.body` | Jamoangiz uchun birinchi tadbirni shu yerda yarating. | Birinchi tadbirni qoʻshing — hamma shu yerda ishtirokini belgilaydi. |
| `events.empty.action` | Tadbir yaratish | Tadbir qoʻshish |
| `events.error.body` | Nimadir xato ketdi. Qayta urinib koʻring. | Aloqa uzildi. Qayta urinib koʻring. |
| `events.forbidden.title` | Ruxsat yoʻq | Tadbirlar boshqarma xodimlari uchun |
| `events.forbidden.body` | Tadbirlarni koʻrish uchun boʻlim aʼzosi boʻlishingiz kerak. | Tadbirlarni boshqarma xodimlari koʻradi. Kerak boʻlsa, boshqarma boshligʻiga murojaat qiling. |
| `events.offline.body` | Internet tiklanganda tadbirlar roʻyxati yangilanadi. | Aloqa tiklangach tadbirlar roʻyxati yangilanadi. |
| `events.category.team_building` | Jamoa qurish | Jamoani jipslashtirish |
| `events.card.capacity` | {going} / {capacity} joy | {going}/{capacity} joy |
| `events.card.deadline` | Roʻyxatdan oʻtish: {date} | Javob muddati: {date} |
| `events.form.stepBasics` | Asosiy maʼlumot | Asosiy |
| `events.form.aiIdeaLabel` | Bir qatorli ideya | Bir qatorli fikr |
| `events.form.aiDraftDiscard` | Rad etish | Kerak emas |
| `events.form.aiDraftFollowUp` | Roʻyxat, soʻrovnoma va birga borish rejasini tadbirni yaratgandan keyin uning sahifasida qoʻshing. | Roʻyxat, soʻrovnoma va birga borishni tadbir qoʻshilgandan keyin uning sahifasida sozlaysiz. |
| `events.form.placePlaceholder` | Masalan, boʻlim yigʻilishlar zali | Masalan, boshqarma yigʻilishlar zali |
| `events.form.rsvpDeadlineLabel` | Roʻyxatdan oʻtish muddati | Javob muddati |
| `events.form.costNotePlaceholder` | Masalan, transport boʻlim hisobidan | Masalan, transport boshqarma hisobidan |
| `events.form.submitCreate` | Tadbirni yaratish | Tadbirni qoʻshish |
| `events.form.validation.endsBeforeStarts` | Tugash vaqti boshlanish vaqtidan keyin boʻlishi kerak | Tugash vaqti boshlanish vaqtidan keyin boʻlsin. |
| `events.form.aiDraftCarpool` | Yoʻl-yoʻriq | Yoʻl |
| `events.cancelDialog.body` | "{title}" bekor qilinadi va roʻyxatdan oʻtgan {count} kishiga xabar boradi. Bu amalni ortga qaytarib boʻlmaydi. | «{title}» bekor qilinadi va ishtirokini belgilagan {count} kishiga xabar boradi. Buni ortga qaytarib boʻlmaydi. |
| `events.cancelDialog.reasonPlaceholder` | Xodimlarga tushuntiring | Xodimlarga nima boʻlganini tushuntiring |
| `events.cancelDialog.confirm` | Ha, bekor qilish | Tadbirni bekor qilish |
| `events.cancelDialog.keepEvent` | Yoʻq, saqlab qolish | Saqlab qolish |
| `events.rsvp.status.yes` | Ha, boraman | Boraman |
| `events.rsvp.status.maybe` | Ehtimol | Balki |
| `events.rsvp.deadlinePassed` | Roʻyxatdan oʻtish muddati tugagan | Javob muddati tugagan |
| `events.rsvp.eventFull` | Joylar toʻlgan, navbatga yozildingiz | Joylar toʻlgan — navbatga yozildingiz |
| `events.rsvp.myStatus` | Sizning javobingiz: {status} | Javobingiz: {status} |
| `events.comments.summarize` | Muhokamani qisqacha ifodalash | Qisqacha xulosa |
| `events.comments.summaryPending` | Qisqacha bayon tuzilmoqda… | Xulosa tayyorlanmoqda… |
| `events.comments.summaryFailed` | Muhokamani qisqacha bayon qilib boʻlmadi | Muhokamadan xulosa chiqarib boʻlmadi |
| `events.comments.summaryDiscard` | Rad etish | Kerak emas |
| `events.carpool.empty` | Hozircha birga borish takliflari yoʻq | Hali mashina taklif qilinmagan |
| `events.carpool.seatsTaken` | {claimed} / {seats} oʻrin band | {claimed}/{seats} oʻrin band |
| `events.items.empty` | Hozircha buyumlar roʻyxati boʻsh | Roʻyxat hali boʻsh |
| `events.polls.create` | Soʻrovnoma yaratish | Soʻrovnoma qoʻshish |
| `events.polls.yourVote` | Sizning ovozingiz | Ovozingiz |
| `events.polls.createdBy` | Yaratdi: {name} | Qoʻshdi: {name} |
| `events.photos.title` | Fotosuratlar | Suratlar |
| `events.photos.empty` | Hozircha fotosurat yoʻq | Hali surat yoʻq |
| `events.feedback.average` | Oʻrtacha baho: {rating} / 5 | Oʻrtacha baho: {rating}/5 |
| `events.feedback.yours` | Sizning bahoyingiz | Bahoyingiz |
| `events.ics.exportMine` | Mening tadbirlarim (.ics) | Tadbirlarim (.ics) |
| `events.tabs.photos` | Fotosuratlar | Suratlar |
| `events.filters.from` | Boshlanish | Qaysi sanadan |
| `events.filters.to` | Tugash | Qaysi sanagacha |

## ai — 69 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `ai.description` | Boʻlimning AI yordamchilari: har biri nima qilishi, qayerda turishi, qancha turishi va foydalanish tarixi. | Boshqarmaning AI yordamchilari: har biri nima qiladi, qayerda turadi, qancha turadi va kim ishlatgan. |
| `ai.command.ask` | AI dan soʻrash | AIdan soʻrash |
| `ai.command.search` | Boʻlim boʻyicha qidirish | Boshqarma boʻyicha qidirish |
| `ai.budget.editLabel` | Oylik byudjet (UZS) | Oylik byudjet (soʻm) |
| `ai.budget.invalidAmount` | Toʻgʻri miqdor kiriting | Summani toʻgʻri kiriting. |
| `ai.flags.description` | Har bir yordamchi nima qilishini oʻqing va boʻlimga keraklisini yoqing. Yoqmaguningizcha oʻchirilgan boʻladi. | Har bir yordamchi nima qilishini oʻqing va boshqarmaga keraklisini yoqing. Yoqmaguningizcha hammasi oʻchiq turadi. |
| `ai.flags.headOnly` | Bularni faqat boʻlim boshligʻi oʻzgartira oladi. | Bularni faqat boshqarma boshligʻi oʻzgartiradi. |
| `ai.usage.empty.body` | Boʻlimdan kimdir AI yordamchisini ishlatgach, foydalanish shu yerda koʻrinadi. | Boshqarmadan kimdir yordamchini ishlatgach, foydalanish shu yerda koʻrinadi. |
| `ai.usage.unknownUser` | Boʻlimdan chiqqan xodim | Boshqarmadan chiqqan xodim |
| `ai.usage.page.of` | {pages} sahifadan {page} chisi | {pages} sahifadan {page}-si |
| `ai.ask.label` | Boʻlim maʼlumotidan soʻrang | Boshqarma yozuvlaridan soʻrang |
| `ai.ask.hint` | Javob faqat shu boʻlimning kartochkalari, izohlari, sahifalari va tadbirlaridan olinadi. Har bir javobda manba havolasi boʻladi. | Javob faqat shu boshqarmaning kartalari, izohlari, sahifalari va tadbirlaridan olinadi. Har bir javobda manba havolasi boʻladi. |
| `ai.search.rebuildHint` | Kartochkalar, izohlar, sahifalar va tadbirlarni qaytadan oʻqiydi. | Kartalar, izohlar, sahifalar va tadbirlarni qaytadan oʻqiydi. |
| `ai.search.kind.card` | Kartochka | Karta |
| `ai.errors.headOnly` | Bu yordamchi faqat boʻlim boshligʻi uchun | Bu yordamchi faqat boshqarma boshligʻi uchun |
| `ai.errors.featureDisabled` | Bu yordamchi boʻlim sozlamalarida oʻchirilgan. AI sahifasida yoqing. | Bu yordamchi boshqarma sozlamalarida oʻchirilgan. AI sahifasidan yoqing. |
| `ai.preview.unknownCard` | Nomaʼlum kartochka | Nomaʼlum karta |
| `ai.preview.openCard` | Kartochkani ochish | Kartani ochish |
| `ai.preview.quickAdd.ambiguous` | Bir nechta mos keldi | Bir nechta xodim mos keldi |
| `ai.preview.subtasks.insufficient` | Kartochkada boʻlish uchun yetarli maʼlumot yoʻq. Tavsif qoʻshib, qayta urinib koʻring. | Kartani boʻlish uchun matn yetarli emas. Tavsif qoʻshib, qayta urinib koʻring. |
| `ai.preview.event.attendees` | Taxminiy ishtirokchi | Taxminiy ishtirokchilar soni |
| `ai.preview.event.carpool` | Yoʻl-yoʻriq | Yoʻl |
| `ai.preview.analytics.chart.burnup` | Oʻsish egri chizigʻi | Oʻsish chizigʻi |
| `ai.preview.reply.stillNeeded` | Siz hali aytishingiz kerak: | Hali aytishingiz kerak: |
| `ai.preview.riskAction.mark_blocked` | Toʻsiq deb belgilash | Toʻxtab turibdi deb belgilash |
| `ai.preview.ask.notFound` | Boʻlim maʼlumotlarida bu savolga javob topilmadi. | Boshqarma yozuvlarida bu savolga javob topilmadi. |
| `ai.features.quickAddParse.description` | Bir gapda yozilgan vazifani nom, masʼul, muddat, muhimlik va yorliqlarga ajratadi. Bugungi sana beriladi, shuning uchun “ertaga” yoki “jumagacha” toʻgʻri kunga tushadi. | Bir gapda yozilgan ishni nom, masʼul, muddat, muhimlik va yorliqlarga ajratadi. Bugungi sana beriladi, shuning uchun «ertaga» yoki «jumagacha» toʻgʻri kunga tushadi. |
| `ai.features.quickAddParse.example` | “Nodiraga choraklik hisobotni jumagacha tayinla, shoshilinch” → nom, masʼul Nodira Karimova, muddat 19-sentabr, shoshilinch. | «Nodiraga choraklik hisobotni jumagacha tayinla, shoshilinch» → nom, masʼul Nodira Karimova, muddat 19-sentabr, shoshilinch. |
| `ai.features.subtaskBreakdown.description` | Bitta kartochkani bajarilishi mumkin boʻlgan qadamlarga boʻladi va har biriga taxminiy vaqt qoʻyadi. | Bitta kartani bajarsa boʻladigan qadamlarga boʻladi va har biriga taxminiy vaqt qoʻyadi. |
| `ai.features.subtaskBreakdown.where` | Kartochka ichidagi roʻyxat boʻlimi va shaxsiy ish joyidagi vazifa qatori. | Karta ichidagi bajarish roʻyxati va shaxsiy maydondagi vazifa qatori. |
| `ai.features.subtaskBreakdown.example` | “Oylik hisobotni tayyorlash” → maʼlumot yigʻish, jadval tuzish, boʻlim bilan kelishish, yakuniy nusxa. | «Oylik hisobotni tayyorlash» → maʼlumot yigʻish, jadval tuzish, boʻlim bilan kelishish, yakuniy nusxa. |
| `ai.features.planSprint.where` | Shaxsiy ish joyidagi davrlar va loyiha sahifasi. | Shaxsiy maydondagi davrlar va loyiha sahifasi. |
| `ai.features.planSprint.example` | Uch soat va yettita ish → tartiblangan reja, birinchi ish belgilangan, ikkitasi “sigʻmaydi”. | Uch soat va yettita ish → tartiblangan reja, birinchi ish belgilangan, ikkitasi «sigʻmaydi». |
| `ai.features.deadlineRisk.label` | Bu xavfni tushuntir | Xavfni tushuntirish |
| `ai.features.deadlineRisk.description` | Kartochkadagi xavf belgisi nega qoʻyilganini oddiy tilda tushuntiradi va bitta aniq chorani taklif qiladi. Xavf darajasini qaytadan hisoblamaydi. | Kartadagi xavf belgisi nega qoʻyilganini oddiy tilda tushuntiradi va bitta aniq chorani taklif qiladi. Xavf darajasini qaytadan hisoblamaydi. |
| `ai.features.deadlineRisk.where` | Kartochkadagi xavf belgisi yonida. | Kartadagi xavf belgisi yonida. |
| `ai.features.deadlineRisk.example` | “Muddat kecha oʻtdi, roʻyxatning yarmi bajarilgan” → sababi va “muddatni 22-sentabrga koʻchirish” taklifi. | «Muddat kecha oʻtdi, roʻyxatning yarmi bajarilgan» → sababi va «muddatni 22-sentabrga koʻchirish» taklifi. |
| `ai.features.catchUp.description` | Siz yoʻq vaqtingizda yoki oʻtgan haftada nima boʻlganini yigʻadi: bajarilganlar, xavflar, sizdan kutilayotgan ishlar. Boʻlim boshligʻi uchun butun boʻlim boʻyicha dushanba xulosasini beradi. | Siz yoʻq vaqtingizda yoki oʻtgan haftada nima boʻlganini yigʻadi: bajarilganlar, xavflar, sizdan kutilayotgan ishlar. Boshqarma boshligʻiga butun boshqarma boʻyicha dushanba xulosasini beradi. |
| `ai.features.catchUp.where` | Bosh sahifa, shaxsiy ish joyi va loyiha sahifasi. | Bosh sahifa, shaxsiy maydon va loyiha sahifasi. |
| `ai.features.catchUp.example` | “Jumadan beri: 4 ta ish bajarildi, 2 tasining muddati oʻtgan, Anvarda 11 ta ochiq ish.” | «Jumadan beri: 4 ta ish bajarildi, 2 tasining muddati oʻtgan, Anvarda 11 ta ochiq ish.» |
| `ai.features.draftEvent.label` | Tadbir loyihasi | Tadbir qoralamasi |
| `ai.features.draftEvent.description` | Bir qatorli gʻoyani toʻliq tadbirga aylantiradi: tavsif, sana variantlari, tayyorgarlik roʻyxati va yoʻl-yoʻriq rejasi. | Bir qatorli fikrni toʻliq tadbirga aylantiradi: tavsif, sana variantlari, tayyorgarlik roʻyxati va yoʻl rejasi. |
| `ai.features.draftEvent.where` | Tadbir yaratish oynasi. | Tadbir qoʻshish oynasi. |
| `ai.features.draftEvent.example` | “Chorvoqda kuz sayli” → tavsif, uchta sana varianti, sakkiz bandli roʻyxat, avtomobil rejasi. | «Chorvoqda kuz sayli» → tavsif, uchta sana varianti, sakkiz bandli roʻyxat, yoʻl rejasi. |
| `ai.features.summarizeThread.where` | Kartochka va tadbir izohlari. | Karta va tadbir izohlari. |
| `ai.features.summarizeThread.example` | 24 ta izoh → 3 ta qaror, 2 ta ochiq savol, “Anvar PDF-ni payshanbagacha yuboradi”. | 24 ta izoh → 3 ta qaror, 2 ta ochiq savol, «Anvar PDF-ni payshanbagacha yuboradi». |
| `ai.features.nlAnalytics.label` | Tahlildan soʻrash | Tahlilga savol berish |
| `ai.features.nlAnalytics.example` | “Bu oy Data boʻlimining muddati oʻtgan ishlari” → 7 ta, filtr va diagramma bilan. | «Bu oy Data boʻlimining muddati oʻtgan ishlari» → 7 ta, filtr va diagramma bilan. |
| `ai.features.translate.description` | Matnni siz tanlagan tilga tarjima qiladi, boʻlim atamalarini oʻzgartirmay. Lotin va kirill oʻrtasida model ishlatilmaydi, oʻgirish shu yerda bajariladi. | Matnni siz tanlagan tilga tarjima qiladi, boshqarma atamalariga tegmaydi. Lotin va kirill oʻrtasida model ishlatilmaydi — oʻgirish shu yerda bajariladi. |
| `ai.features.translate.where` | Kartochka tavsifi, sahifa muharriri va shaxsiy qaydlar. | Karta tavsifi, sahifa muharriri va shaxsiy qaydlar. |
| `ai.features.translate.example` | Oʻzbekcha tavsif → ruscha tarjima, “muddat” va “boʻlim” atamalari saqlangan holda. | Oʻzbekcha tavsif → ruscha tarjima, «muddat» va «boʻlim» atamalari saqlangan holda. |
| `ai.features.draftReply.label` | Javob loyihasi | Javob qoralamasi |
| `ai.features.draftReply.where` | Kartochka izoh maydoni va kiruvchi xabardagi eslatma. | Karta izoh maydoni va bildirishnomadagi belgilash. |
| `ai.features.draftReply.example` | “Muddatni suraymi?” → tayyor javob va “hali aytishingiz kerak: yangi sana”. | «Muddatni suraymi?» → tayyor javob va «hali aytishingiz kerak: yangi sana». |
| `ai.features.boardRiskDigest.label` | Kim kechiktiryapti | Kim kechikayotgani |
| `ai.features.boardRiskDigest.description` | Doskadagi eng xavfli ishlarni bitta soʻrov bilan tartiblaydi, har biriga sabab va bitta chora bilan. Faqat boʻlim boshligʻi uchun. | Doskadagi eng xavfli ishlarni bitta soʻrov bilan tartiblaydi, har biriga sabab va bitta chora qoʻshadi. Faqat boshqarma boshligʻi uchun. |
| `ai.features.boardRiskDigest.example` | Beshta ish, har biriga sabab, hamda “Anvarda 11 ta ochiq ish” degan bosim nuqtasi. | Beshta ish, har biriga sabab, hamda «Anvarda 11 ta ochiq ish» degan bosim nuqtasi. |
| `ai.features.suggestAssignee.label` | Kimga topshiray | Kimga topshirish |
| `ai.features.suggestAssignee.description` | Ish yuki va tajribasiga qarab uchta nomzod taklif qiladi. Sababi faqat yuk va tajriba boʻladi, hech qachon baho emas. Tanlovni boʻlim boshligʻi qiladi. | Ish yuki va tajribasiga qarab uchta nomzod taklif qiladi. Sababi faqat yuk va tajriba boʻladi, hech qachon baho emas. Tanlovni boshqarma boshligʻi qiladi. |
| `ai.features.suggestAssignee.where` | Kartochkadagi masʼul maydoni. | Kartadagi masʼul maydoni. |
| `ai.features.suggestAssignee.example` | “Oylik hisobot” → Nodira (shu mavzuda 4 ta ish), Anvar (yuki koʻp), Dilnoza. | «Oylik hisobot» → Nodira (shu mavzuda 4 ta ish), Anvar (yuki koʻp), Dilnoza. |
| `ai.features.duplicateCheck.where` | Kartochka yaratish va tezkor qoʻshish oldindan koʻrishi. | Karta qoʻshish va tezkor qoʻshish oynasi. |
| `ai.features.duplicateCheck.example` | “Hisobotni tayyorlash” → “Choraklik hisobotni tayyorlash” allaqachon ochiq. | «Hisobotni tayyorlash» → «Choraklik hisobotni tayyorlash» allaqachon ochiq. |
| `ai.features.semanticAsk.label` | Boʻlim maʼlumotidan soʻrash | Boshqarma yozuvlaridan soʻrash |
| `ai.features.semanticAsk.description` | Savolingizga faqat boʻlimning oʻz kartochkalari, izohlari, sahifalari va tadbirlaridan javob beradi, har bir javobga havola qoʻyib. Topilmasa, “topilmadi” deydi. | Savolingizga faqat boshqarmaning oʻz kartalari, izohlari, sahifalari va tadbirlaridan javob beradi va har bir javobga havola qoʻyadi. Topilmasa, «topilmadi» deydi. |
| `ai.features.semanticAsk.where` | AI sahifasidagi “Soʻrash” boʻlimi va Ctrl+K. | AI sahifasidagi «Soʻrash» boʻlimi va Ctrl+K. |
| `ai.features.semanticAsk.example` | “Oylik hisobotni kim tayyorlayapti?” → “Nodira Karimova, muddat 18-sentabr”, kartochkaga havola bilan. | «Oylik hisobotni kim tayyorlayapti?» → «Nodira Karimova, muddat 18-sentabr», kartaga havola bilan. |
| `ai.features.weeklySummary.description` | Endi “Nimani oʻtkazib yubordim” yordamchisining bir qismi. Eski yozuvlar shu nom bilan qolgan. | Endi «Nimani oʻtkazib yubordim» yordamchisining bir qismi. Eski yozuvlar shu nom bilan qolgan. |
| `ai.features.whatDidIMiss.description` | Endi “Nimani oʻtkazib yubordim” yordamchisining bir qismi. Eski yozuvlar shu nom bilan qolgan. | Endi «Nimani oʻtkazib yubordim» yordamchisining bir qismi. Eski yozuvlar shu nom bilan qolgan. |

## admin — 132 ta satr oʻzgardi

| kalit | oldin | keyin |
|---|---|---|
| `admin.console.eyebrow` | Boshqaruv | BOSHQARUV |
| `admin.console.tabs.label` | Administrator boʻlimlari | Administrator sahifalari |
| `admin.console.tabs.departments` | Boʻlimlar | Boshqarmalar |
| `admin.console.viewAsBanner.message` | Siz hozir bir boʻlimni koʻrinish sifatida (faqat oʻqish) koʻrmoqdasiz. | Siz hozir bir boshqarmani faqat oʻqish uchun koʻrmoqdasiz. |
| `admin.console.viewAsBanner.exit` | Koʻrinishni yopish | Koʻrishni tugatish |
| `admin.console.dashboard.userCount` | Foydalanuvchilar soni | Xodimlar soni |
| `admin.console.dashboard.maintenanceActive` | Texnik xizmat rejimi yoqilgan — foydalanuvchilar tizimga kira olmaydi. | Texnik xizmat rejimi yoqilgan — super administratordan boshqa hech kim kira olmaydi. |
| `admin.console.dashboard.reviewRequests` | Boʻlim soʻrovlarini koʻrib chiqish | Boshqarma soʻrovlarini koʻrib chiqish |
| `admin.console.dashboard.reviewRequestsDesc` | Yangi boʻlim tashkil etish soʻrovlarini tasdiqlang yoki rad eting | Yangi boshqarma ochish soʻrovlarini tasdiqlang yoki rad eting |
| `admin.console.dashboard.manageDepartments` | Boʻlimlarni boshqarish | Boshqarmalarni boshqarish |
| `admin.console.dashboard.manageDepartmentsDesc` | Boʻlimlarni koʻring, toʻxtating yoki arxivlang | Boshqarmalarni koʻring, toʻxtating yoki arxivlang |
| `admin.console.dashboard.manageAccountsDesc` | Foydalanuvchi hisoblarini bloklang, tiklang yoki oʻchiring | Hisoblarni bloklang, tiklang yoki oʻchiring |
| `admin.console.dashboard.healthUnavailable` | Hozircha tizim holati mavjud emas. | Tizim holati hali kelmadi. |
| `admin.console.dashboard.backupsUnconfigured` | Zaxira nusxalar sozlanmagan — bu instansiyada hech qanday zaxira olinmayapti. | Zaxira nusxalar sozlanmagan — bu serverda hech narsa zaxiralanmayapti. |
| `admin.console.dashboard.userCountBreakdown` | Boʻlimlar kesimida | Boshqarmalar kesimida |
| `admin.console.departments.searchPlaceholder` | Boʻlim nomi boʻyicha qidirish | Boshqarma nomi boʻyicha qidirish |
| `admin.console.departments.empty.title` | Boʻlimlar topilmadi | Boshqarma topilmadi |
| `admin.console.departments.memberCount` | {count} ta aʼzo | {count} ta xodim |
| `admin.console.departments.viewAs` | Koʻrinish sifatida ochish | Ichini koʻrish |
| `admin.console.departments.archive` | Arxivlash | Arxivga olish |
| `admin.console.departments.stopViewingAs` | Koʻrinishni yopish | Koʻrishni tugatish |
| `admin.console.departments.pauseDialogTitle` | Boʻlimni toʻxtatish | Boshqarmani toʻxtatish |
| `admin.console.departments.pausedToast` | Boʻlim toʻxtatildi | Boshqarma toʻxtatildi |
| `admin.console.departments.resumedToast` | Boʻlim qayta faollashtirildi | Boshqarma qayta ishga tushdi |
| `admin.console.departments.archivedToast` | Boʻlim arxivlandi | Boshqarma arxivlandi |
| `admin.console.departments.restoredToast` | Boʻlim tiklandi | Boshqarma tiklandi |
| `admin.console.departments.viewAsStartedToast` | Koʻrinish sifatida rejim yoqildi | Koʻrish rejimi yoqildi |
| `admin.console.departments.viewAsStoppedToast` | Koʻrinish sifatida rejim yopildi | Koʻrish rejimi yopildi |
| `admin.console.departments.columnName` | Boʻlim | Boshqarma |
| `admin.console.departments.columnMembers` | Aʼzolar | Xodimlar |
| `admin.console.departments.columnCreated` | Yaratilgan | Ochilgan |
| `admin.console.departments.drawerTitle` | Boʻlim tafsilotlari | Boshqarma haqida |
| `admin.console.departments.memberCountLabel` | Aʼzolar | Xodimlar |
| `admin.console.departments.createdLabel` | Yaratilgan | Ochilgan |
| `admin.console.departments.localeLabel` | Standart til | Asosiy til |
| `admin.console.accounts.empty.title` | Hisoblar topilmadi | Hisob topilmadi |
| `admin.console.accounts.role.member` | Aʼzo | Xodim |
| `admin.console.accounts.temporaryPasswordBody` | Ushbu parolni foydalanuvchiga xavfsiz usulda yetkazing. Birinchi kirishda u yangi parol oʻrnatishi soʻraladi. | Bu parolni xodimga xavfsiz yoʻl bilan yetkazing. Birinchi kirishda undan yangi parol soʻraladi. |
| `admin.console.accounts.anonymizeDialogBody` | Foydalanuvchi maʼlumotlari anonimlashtiriladi va hisob doimiy ravishda oʻchiriladi. Bu amalni bekor qilib boʻlmaydi. | Xodimning maʼlumotlari anonimlashtiriladi va hisob butunlay oʻchiriladi. Buni ortga qaytarib boʻlmaydi. |
| `admin.console.analytics.totalDepartments` | Jami boʻlimlar | Jami boshqarmalar |
| `admin.console.analytics.totalPeople` | Jami foydalanuvchilar | Jami xodimlar |
| `admin.console.analytics.cardsCreated30d` | Kartochkalar (30 kun) | Kartalar (30 kun) |
| `admin.console.analytics.departmentsTitle` | Boʻlimlar holati | Boshqarmalar holati |
| `admin.console.analytics.peopleTitle` | Foydalanuvchilar tarkibi | Xodimlar tarkibi |
| `admin.console.analytics.members` | Aʼzolar | Xodimlar |
| `admin.console.analytics.noActivity` | Hozircha faollik maʼlumotlari yoʻq | Hozircha faollik qayd etilmagan |
| `admin.console.analytics.notAvailable` | Mavjud emas | Yoʻq |
| `admin.console.analytics.tokensThisMonth` | Ushbu oydagi tokenlar | Bu oydagi tokenlar |
| `admin.console.analytics.costThisMonth` | Ushbu oydagi xarajat | Bu oydagi xarajat |
| `admin.console.audit.empty.title` | Voqealar topilmadi | Yozuv topilmadi |
| `admin.console.audit.columnSubject` | Obʼekt | Obyekt |
| `admin.console.audit.filter.departments` | Boʻlimlar | Boshqarmalar |
| `admin.console.audit.verb.admin.view_as.started` | koʻrinish sifatida rejimni boshladi | boshqarma ichini koʻra boshladi |
| `admin.console.audit.verb.admin.view_as.stopped` | koʻrinish sifatida rejimni yakunladi | boshqarma ichini koʻrishni tugatdi |
| `admin.console.audit.verb.admin.audit.exported` | audit jurnalini yukladi | audit jurnalini yuklab oldi |
| `admin.console.audit.verb.departments.request_created` | boʻlim soʻrovini yubordi | boshqarma soʻrovini yubordi |
| `admin.console.audit.verb.departments.request_approved` | boʻlim soʻrovini tasdiqladi | boshqarma soʻrovini tasdiqladi |
| `admin.console.audit.verb.departments.request_rejected` | boʻlim soʻrovini rad etdi | boshqarma soʻrovini rad etdi |
| `admin.console.audit.verb.departments.joined` | boʻlimga qoʻshildi | boshqarmaga qoʻshildi |
| `admin.console.audit.verb.departments.left` | boʻlimni tark etdi | boshqarmani tark etdi |
| `admin.console.audit.verb.structure.unit_created` | boʻlinma yaratdi | boʻlim ochdi |
| `admin.console.audit.verb.structure.unit_deleted` | boʻlinmani oʻchirdi | boʻlimni oʻchirdi |
| `admin.console.audit.verb.setup.completed` | tizimni sozlashni yakunladi | dastlabki sozlashni yakunladi |
| `admin.console.audit.verb.accounts.2fa_challenge_failed` | ikki bosqichli tekshiruvda xatolik qildi | ikki bosqichli tekshiruvdan oʻta olmadi |
| `admin.console.audit.verb.admin.wipe.failed` | tizimni oʻchirishda xatolikka uchradi | tizimni oʻchira olmadi |
| `admin.console.audit.verb.analytics.chart.unpinned` | diagrammani yechdi | diagrammani mahkamdan oldi |
| `admin.console.audit.verb.analytics.saved_filter.created` | saqlangan filtr yaratdi | filtrni saqladi |
| `admin.console.audit.verb.departments.deletion_requested` | boʻlimni oʻchirishni soʻradi | boshqarmani oʻchirishni soʻradi |
| `admin.console.audit.verb.departments.join_failed` | boʻlimga qoʻshilishda xatolikka uchradi | boshqarmaga qoʻshila olmadi |
| `admin.console.audit.verb.departments.settings_updated` | boʻlim sozlamalarini oʻzgartirdi | boshqarma sozlamalarini oʻzgartirdi |
| `admin.console.audit.verb.events.carpool_created` | hamroh safarini yaratdi | birga borishni taklif qildi |
| `admin.console.audit.verb.events.carpool_seat_claimed` | hamroh safaridan joy oldi | birga borishdan joy oldi |
| `admin.console.audit.verb.events.carpool_seat_released` | hamroh safaridagi joyni boʻshatdi | birga borishdagi joyni boʻshatdi |
| `admin.console.audit.verb.events.event_created` | tadbir yaratdi | tadbir qoʻshdi |
| `admin.console.audit.verb.events.item_added` | olib kelinadigan narsani qoʻshdi | olib keliladigan narsani qoʻshdi |
| `admin.console.audit.verb.events.item_claimed` | olib kelinadigan narsani oʻz zimmasiga oldi | olib keliladigan narsani oʻz zimmasiga oldi |
| `admin.console.audit.verb.events.item_unclaimed` | olib kelinadigan narsadan voz kechdi | olib keliladigan narsadan voz kechdi |
| `admin.console.audit.verb.events.poll_created` | soʻrovnoma yaratdi | soʻrovnoma qoʻshdi |
| `admin.console.audit.verb.events.rsvp_changed` | tadbirga qatnashish holatini oʻzgartirdi | tadbirdagi ishtirokini oʻzgartirdi |
| `admin.console.audit.verb.notifications.created` | bildirishnoma yaratdi | bildirishnoma yubordi |
| `admin.console.audit.verb.notifications.department_settings_updated` | boʻlim bildirishnoma sozlamalarini oʻzgartirdi | boshqarma bildirishnoma sozlamalarini oʻzgartirdi |
| `admin.console.audit.verb.notifications.snoozed` | bildirishnomani keyinga qoldirdi | bildirishnomani kechiktirdi |
| `admin.console.audit.verb.pages.onboarding_template.applied` | moslashuv shablonini qoʻlladi | moslashuv andozaini qoʻlladi |
| `admin.console.audit.verb.pages.onboarding_template.created` | moslashuv shablonini yaratdi | moslashuv andozaini yaratdi |
| `admin.console.audit.verb.pages.onboarding_template.deleted` | moslashuv shablonini oʻchirdi | moslashuv andozaini oʻchirdi |
| `admin.console.audit.verb.pages.onboarding_template.updated` | moslashuv shablonini oʻzgartirdi | moslashuv andozaini oʻzgartirdi |
| `admin.console.audit.verb.pages.page.created` | sahifa yaratdi | sahifa qoʻshdi |
| `admin.console.audit.verb.personal.canvas.created` | shaxsiy taxtachani yaratdi | shaxsiy oq taxta qoʻshdi |
| `admin.console.audit.verb.personal.canvas.deleted` | shaxsiy taxtachani oʻchirdi | shaxsiy oq taxtani oʻchirdi |
| `admin.console.audit.verb.personal.canvas.updated` | shaxsiy taxtachani oʻzgartirdi | shaxsiy oq taxtani oʻzgartirdi |
| `admin.console.audit.verb.personal.note.created` | shaxsiy eslatma yaratdi | shaxsiy qayd qoʻshdi |
| `admin.console.audit.verb.personal.note.deleted` | shaxsiy eslatmani oʻchirdi | shaxsiy qaydni oʻchirdi |
| `admin.console.audit.verb.personal.note.updated` | shaxsiy eslatmani oʻzgartirdi | shaxsiy qaydni oʻzgartirdi |
| `admin.console.audit.verb.personal.cycle.created` | davr yaratdi | davr boshladi |
| `admin.console.audit.verb.personal.item.created` | shaxsiy vazifa yaratdi | shaxsiy vazifa qoʻshdi |
| `admin.console.audit.verb.projects.project_created` | loyiha yaratdi | loyiha ochdi |
| `admin.console.audit.verb.setup.token_issued` | sozlash tokenini oldi | sozlash kalitini oldi |
| `admin.console.audit.verb.storage.upload_rejected` | yuklangan fayl rad etildi | yuklagan fayli rad etildi |
| `admin.console.audit.verb.storage.upload_infected` | yuklangan faylda virus topildi | yuklagan faylida virus topildi |
| `admin.console.audit.verb.storage.upload_scan_failed` | yuklangan faylni tekshirib boʻlmadi | yuklagan faylini tekshirib boʻlmadi |
| `admin.console.audit.verb.structure.unit_restored` | boʻlinmani tikladi | boʻlimni tikladi |
| `admin.console.audit.verb.structure.unit_updated` | boʻlinmani oʻzgartirdi | boʻlimni oʻzgartirdi |
| `admin.console.audit.verb.structure.units_reordered` | boʻlinmalar tartibini oʻzgartirdi | boʻlimlar tartibini oʻzgartirdi |
| `admin.console.audit.verb.work.card_created` | kartochka yaratdi | karta qoʻshdi |
| `admin.console.audit.verb.work.card_restored` | kartochkani tikladi | kartani tikladi |
| `admin.console.audit.verb.work.card_updated` | kartochkani oʻzgartirdi | kartani oʻzgartirdi |
| `admin.console.audit.verb.work.checklist_item_added` | tekshiruv roʻyxatiga band qoʻshdi | bajarish roʻyxatiga band qoʻshdi |
| `admin.console.audit.verb.work.comment_added` | kartochkaga izoh qoldirdi | kartaga izoh qoldirdi |
| `admin.console.audit.verb.work.label_created` | yorliq yaratdi | yorliq qoʻshdi |
| `admin.console.audit.subjectType.user` | Foydalanuvchi | Xodim |
| `admin.console.audit.subjectType.department` | Boʻlim | Boshqarma |
| `admin.console.audit.subjectType.department_request` | Boʻlim soʻrovi | Boshqarma soʻrovi |
| `admin.console.audit.subjectType.unit` | Boʻlinma | Boʻlim |
| `admin.console.audit.subjectType.audit_export` | Audit eksporti | Audit nusxasi |
| `admin.console.health.detail.queue.pending` | {count} ta kutilayotgan hodisa | {count} ta hodisa navbatda |
| `admin.console.health.detail.queue.pendingOldest` | {count} ta kutilayotgan hodisa, eng eskisi {seconds} soniya oldin | {count} ta hodisa navbatda, eng eskisi {seconds} soniya oldin |
| `admin.console.settings.registrationBody` | Yangi foydalanuvchilar roʻyxatdan oʻtishi mumkinligini boshqaring. | Yangi xodimlar hisob ochishi mumkinmi — shuni belgilaysiz. |
| `admin.console.settings.registrationSwitchLabel` | Yangi hisoblar roʻyxatdan oʻtishi mumkin | Yangi hisob ochish mumkin |
| `admin.console.settings.maintenanceBody` | Yoqilganda barcha foydalanuvchilar (super administratordan tashqari) ushbu xabarni koʻradi. | Yoqilganda super administratordan boshqa hamma shu xabarni koʻradi. |
| `admin.console.settings.maintenanceMessagePlaceholder` | Xabar matnini kiriting | Xabar matni |
| `admin.console.settings.maintenancePreviewEmpty` | Hali xabar kiritilmagan — foydalanuvchilar standart bildirishnomani koʻradi. | Hali xabar yozilmagan — xodimlar odatdagi bildirishnomani koʻradi. |
| `admin.console.settings.sentinelBody` | Oʻchirish tugmasini xost xizmatiga yuborish uchun ishlatiladigan maxfiy kalit. | Xost xizmatiga yuboriladigan oʻchirish buyrugʻini imzolaydigan maxfiy kalit. |
| `admin.console.settings.wipeBody` | Ushbu tugma butun tizimni serverdan butunlay oʻchiradi. Amalni ortga qaytarib boʻlmaydi. | Bu tugma butun tizimni serverdan butunlay oʻchiradi. Buni ortga qaytarib boʻlmaydi. |
| `admin.console.settings.wipeDialogBody` | Bu butun tizimni serverdan qaytarib boʻlmaydigan tarzda oʻchiradi: barcha boʻlimlar, hisoblar, sahifalar, kartochkalar va fayllar. Amalni ortga qaytarib boʻlmaydi. Keyingi qadamlarda tasdiqlash iborasini kiritib, hisob maʼlumotlaringizni qayta kiritasiz. | Bu butun tizimni serverdan qaytarib boʻlmaydigan tarzda oʻchiradi: hamma boshqarma, hisob, sahifa, karta va fayl. Keyingi qadamlarda tasdiqlash iborasini yozasiz va parolingizni qayta kiritasiz. |
| `admin.console.settings.wipeStepOf` | {total} dan {step}-qadam | {total} qadamdan {step}-si |
| `admin.console.settings.wipeReviewBody` | Hisoblash nolga yetgach uni bekor qilib boʻlmaydi, lekin hisoblash davom etayotganda hali ham bekor qilish mumkin. | Hisob nolga yetgach oʻchirishni toʻxtatib boʻlmaydi; hisob davom etayotganda esa bekor qilsangiz boʻladi. |
| `admin.console.settings.wipeConfirmCta` | 60 soniyalik hisoblashni boshlash | 60 soniyalik hisobni boshlash |
| `admin.console.settings.wipeStartFailedToast` | Tasdiqlash muvaffaqiyatsiz tugadi | Tasdiqlab boʻlmadi |
| `admin.console.settings.wipeCountdownBody` | Hisoblash tugagach oʻchirish buyrugʻi xost xizmatiga yuboriladi. Hozir bekor qilishingiz mumkin. | Hisob nolga yetgach oʻchirish buyrugʻi xost xizmatiga yuboriladi. Hozir bekor qilsangiz boʻladi. |
| `admin.console.settings.wipeExecuting` | Oʻchirish buyrugʻi yuborilmoqda... | Oʻchirish buyrugʻi yuborilmoqda… |
| `admin.console.settings.wipeFailed` | Muvaffaqiyatsiz | Boʻlmadi |
| `admin.console.settings.sentinelPublicKeyHint` | Buni xost mashinadagi infra/sentinel/sentinel.conf fayliga public_key=... sifatida joylashtiring. Bu maxfiy emas, istalgan vaqtda shu yerda koʻrsatilishi mumkin. | Buni xost mashinadagi infra/sentinel/sentinel.conf fayliga public_key=… koʻrinishida yozing. Bu maxfiy emas, istalgan vaqtda shu yerda koʻrsatiladi. |
