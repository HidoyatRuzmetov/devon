# Oʻzbekcha matn tahriri — A qismi (uz/copy-a)

CTO hukmi: *"it clearly seems like merely a translation — it doesn't read or sound natural, it reads
awkward."* Bu jurnal shu hukmga javoban qilingan **har bir** oʻzgarishni qayd etadi.

**Qamrov (A qismi):** umumiy katalog `packages/i18n/messages/uz-Latn.json` (qobiq, kirish, umumiy
holatlar, xatolar) va modullar: `accounts`, `departments`, `structure`, `people`, `work`,
`projects`, `fields`.

**Qoida:** `packages/i18n/UZBEK-STYLE.md` (§ raqamlari shunga ishora qiladi) va
`packages/i18n/TERMS.md`. Faqat qiymatlar tahrirlandi — kalitlar, ICU placeholderlar, teglar va
qator uzilishlari teginilmadi.

**uz-Cyrl** hech qayerda qoʻlda yozilmadi: tuzatilgan uz-Latn dan `latinToCyrillic()` bilan hosil
qilindi — har bir qiymat soʻzma-soʻz, placeholder va teglarga tegmasdan — soʻng §13.2 boʻyicha qoʻlda oʻqib chiqildi — `ts`/`ц` tuzogʻi,
`ё`/`е`, `ъ`, `ngʻ → нғ`, lotinchaligicha qoladigan nomlar.

**Har bir moduldan keyin:** `node agentic/scripts/check-i18n.mjs` va
`pnpm --filter @devon/i18n test:unit` — ikkalasi ham yashil.

## Umumiy katalog — qobiq, kirish, holatlar (`packages/i18n/messages/uz-Latn.json`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `shell.nav.aria` | Asosiy boʻlimlar | Asosiy sahifalar | «boʻlim» tashkiliy boʻlinma nomi — nav yoʻnalishlari uchun «sahifalar» |
| `shell.demo.chip.label` | Demo maʼlumotlar | Namoyish maʼlumotlari | «Demo maʼlumotlar» → popover bilan bir xil soʻz: «Namoyish» |
| `shell.demo.popover` | Namoyish rejimi. Bu tizimdagi barcha maʼlumotlar sinov uchun yaratilgan. | Namoyish rejimi. Bu yerdagi hamma narsa sinov uchun kiritilgan. | §11/7 `maʼlumotlar` toʻldiruvchi, §11/8 `tizim` ortiqcha |
| `shell.department.aria` | Boʻlimni almashtirish | Boshqarmani almashtirish | §12.2 ijara birligi — boshqarma, boʻlim emas |
| `shell.department.heading` | Boʻlimlaringiz | Boshqarmalaringiz | §12.2 ijara birligi — boshqarma |
| `shell.department.empty` | Boʻlim tanlanmagan | Boshqarma tanlanmagan | §12.2 ijara birligi — boshqarma |
| `shell.department.add` | Boʻlim yaratish yoki qoʻshilish | Boshqarma yaratish yoki qoʻshilish | §12.2 ijara birligi — boshqarma |
| `shell.quickAdd.aria` | Yangi yaratish | Yangi qoʻshish | §11/4 karta va tadbir «qoʻshiladi», «yaratilmaydi» |
| `shell.inbox.aria` | Xabarlar | Bildirishnomalar | Aria toʻliq nom beradi; qisqartma «Xabarlar» faqat menyuda |
| `cmd.group.people` | Kishilar | Xodimlar | TERMS: xodim (`kishilar` — betaraf, vazirlikda ishlatilmaydi) |
| `cmd.item.signout` | Tizimdan chiqish | Chiqish | §11/8 «Tizimdan chiqish» → «Chiqish» |
| `home.empty.member.title` | Bu yerda sizning ishlaringiz koʻrinadi | Ishlaringiz shu yerda koʻrinadi | §2 `sizning` ortiqcha |
| `home.empty.member.body` | Hozircha hech narsa yoʻq. Istalgan sahifani qidiruv orqali topishingiz mumkin. | Hozircha ish yoʻq. Istalgan sahifani qidiruvdan topasiz. | §11/7 «hech narsa yoʻq» oʻrniga nima yoʻqligini ayting |
| `home.empty.action` | Qidirishni ochish | Qidiruvni ochish |  |
| `home.empty.admin.title` | Tizim ishga tushdi | WorkPortal ishga tushdi | §11/8 «Tizim» oʻrniga mahsulot nomi |
| `home.empty.admin.body` | Boʻlimlar hali yaratilmagan. Tizim holatini boshqaruv sahifasida koʻrishingiz mumkin. | Hali birorta boshqarma yaratilmagan. Tizim holatini boshqaruv sahifasida koʻrasiz. | §12.2 boshqarma; «koʻrishingiz mumkin» → «koʻrasiz» |
| `home.empty.demo.title` | Namoyish boʻlimi tayyor | Namoyish boshqarmasi tayyor | §12.2 boshqarma |
| `state.error.title` | Maʼlumotlarni yuklab boʻlmadi | Yuklab boʻlmadi | §11/7 `maʼlumotlar` toʻldiruvchi — umumiy holatda feʼlning oʻzi yetadi |
| `state.denied.body` | Bu sahifa faqat tizim administratori uchun. Kirish kerak boʻlsa, boʻlim boshligʻiga murojaat qiling. | Bu sahifa faqat tizim administratori uchun. Kerak boʻlsa, boshqarma boshligʻiga murojaat qiling. | §12.2 boshqarma boshligʻi |
| `login.title` | Tizimga kirish | Hisobga kirish | §11/8 «Tizimga kirish» → odam hisobiga kiradi |
| `login.locked` | Hisob vaqtincha bloklandi. 15 daqiqadan soʻng qayta urinib koʻring. | Hisob vaqtincha yopildi. 15 daqiqadan keyin qayta urinib koʻring. | «bloklandi» chipdan tashqarida ishlatilmaydi; §9 «keyin» |
| `login.signedOut` | Siz tizimdan chiqdingiz | Hisobdan chiqdingiz | §11/8 tizim emas, hisob |
| `login.forgot.body` | Parolni oʻzingiz tiklay olmaysiz — boʻlim boshligʻingiz sizga vaqtinchalik parol beradi. | Parolni oʻzingiz tiklay olmaysiz — vaqtinchalik parolni boshqarma boshligʻi beradi. | §12.2 boshqarma boshligʻi; «sizga» ortiqcha |
| `login.forgot.askHead` | Parolni tiklashni soʻrash | Boshliqdan soʻrash | §3 tugma ikki soʻzdan oshmaydi |
| `login.forgot.sent` | Soʻrovingiz yuborildi. Boʻlim boshligʻingiz sizga vaqtinchalik parol beradi — undan keyin darhol yangi parol oʻrnating. | Soʻrov yuborildi. Boshqarma boshligʻi vaqtinchalik parol beradi — kirganingizdan keyin darhol yangisini qoʻying. | §11/32 «Soʻrovingiz muvaffaqiyatli yuborildi» → «Soʻrov yuborildi» |
| `login.forgot.admin` | Agar siz boʻlim boshligʻi boʻlsangiz, tizim administratoriga murojaat qiling. | Oʻzingiz boshqarma boshligʻi boʻlsangiz, tizim administratoriga murojaat qiling. | §11/22 «Agar siz … boʻlsangiz» → «Oʻzingiz … boʻlsangiz» |
| `setup.eyebrow` | BIRINCHI ISHGA TUSHIRISH | ILK SOZLASH | §4 eyebrow bir-ikki soʻz |
| `setup.title` | Tizim administratorini yarating | Tizim administratorini yaratish | §4 sarlavha buyruq emas, ish nomi |
| `setup.done.action` | Tizimga kirish | Kirish | §11/8 «Tizimga kirish» → «Kirish» |
| `setup.used.title` | Bu havola allaqachon ishlatilgan | Havola allaqachon ishlatilgan | Odam «havola ishlatilgan» deydi |
| `setup.used.body` | Tizim administratori allaqachon yaratilgan. | Tizim administratori yaratib boʻlingan. | Sarlavhada `allaqachon` bor — takrorlanmaydi |
| `auth.tagline` | Boʻlimingiz ishini bir joyda olib boring | Boshqarma ishini bir joydan olib boring | §12.2 boshqarma; «bir joyda olib boring» → «bir joydan» |


## Modul: accounts (`packages/i18n/messages/modules/accounts/`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `accounts.login2fa.body` | Autentifikatsiya ilovasidagi 6 xonali kodni yoki tiklash kodlaringizdan birini kiriting. | Autentifikatsiya ilovasidagi 6 xonali kodni yoki zaxira kodlaringizdan birini kiriting. | «tiklash kodi» / «zaxira kod» bitta ekranda ikki xil atalgan edi |
| `accounts.register.loginHint` | Kichik lotin harflar, raqamlar, nuqta, tire | Kichik lotin harflari, raqamlar, nuqta, tire | izofa: «lotin harflar» → «lotin harflari» |
| `accounts.register.email` | Elektron pochta (ixtiyoriy) | E-pochta (ixtiyoriy) | qobiq bilan bir xil soʻz (`login.identifier` — «e-pochta») |
| `accounts.register.patronymic` | Sharif (ixtiyoriy) | Otasining ismi (ixtiyoriy) | «Sharif» yolgʻiz — rasmiy formada «Otasining ismi»; `setup.patronymic` bilan bir xil |
| `accounts.register.error.generic` | Roʻyxatdan oʻtib boʻlmadi. Maʼlumotlarni tekshirib, qayta urinib koʻring. | Roʻyxatdan oʻtib boʻlmadi. Maydonlarni tekshirib, qayta urinib koʻring. | §11/7 `maʼlumotlar` toʻldiruvchi — gap maydonlar haqida |
| `accounts.sessions.title` | Qurilmalar va seanslar | Kirilgan qurilmalar | «seans» — ruscha kalka; odam qurilmani koʻradi |
| `accounts.sessions.subtitle` | Hisobingizga kirilgan barcha qurilmalar roʻyxati. | Hisobingizga hozir kirib turgan qurilmalar. | «roʻyxati» ortiqcha; ekranning oʻzi roʻyxat |
| `accounts.sessions.empty.title` | Faol seanslar yoʻq | Kirilgan qurilma yoʻq | «seans» olib tashlandi |
| `accounts.sessions.current` | Joriy qurilma | Shu qurilma | §11/21 `joriy` → `shu` |
| `accounts.sessions.revokeAllConfirm` | Barcha qurilmalardan, jumladan joriy qurilmadan ham chiqasiz. Davom etasizmi? | Hamma qurilmadan chiqasiz — shu qurilmadan ham. Davom etasizmi? | §11/21 `joriy`; «jumladan» — rasmiy hujjat uslubi |
| `accounts.twoFactor.subtitle` | Autentifikatsiya ilovasi orqali hisobingizni qoʻshimcha himoya qiling. | Autentifikatsiya ilovasi bilan hisobingizni qoʻshimcha himoyalang. | «qoʻshimcha himoya qiling» → bitta feʼl |
| `accounts.twoFactor.enroll.step1` | 1-qadam: QR yoki kodni skanerlang | 1-qadam: QR kodni skanerlang yoki kalitni kiriting | inglizchada ikki yoʻl bor edi, tarjimada bittasi yoʻqolgan |
| `accounts.twoFactor.enroll.error` | Kod notoʻgʻri. Ilovadagi vaqt toʻgʻriligini tekshiring. | Kod notoʻgʻri. Qurilmangizdagi vaqtni tekshiring. | xato ilovada emas, qurilma soatida |
| `accounts.twoFactor.enroll.recoveryBody` | Bu kodlar faqat bir marta koʻrsatiladi. Telefoningiz yoʻqolsa, ulardan foydalanib kirishingiz mumkin. | Bu kodlar faqat shu yerda koʻrsatiladi. Telefoningiz yoʻqolsa, shulardan biri bilan kirasiz. | «bir marta koʻrsatiladi» → aslida faqat shu ekranda |
| `accounts.twoFactor.enroll.recoveryCopied` | Kodlar nusxalandi | Kodlardan nusxa olindi | §5 nusxa toasti hamma joyda «Nusxa olindi» |
| `accounts.twoFactor.disableDialog.title` | 2FAʼni oʻchirish | Ikki bosqichli tekshiruvni oʻchirish | «2FAʼni» — kirillchada «2ФАъни» boʻlib chiqadi; toʻliq nom tabiiyroq |
| `accounts.twoFactor.disableDialog.passwordLabel` | Parolingizni tasdiqlang | Parolingiz | §4 maydon yozuvi — ot, buyruq emas |
| `accounts.password.title` | Parolni almashtirish | Parolni oʻzgartirish | «almashtirish» — narsa almashtiriladi; parol oʻzgartiriladi |
| `accounts.password.current` | Joriy parol | Hozirgi parol | §11/21 `joriy` → `hozirgi` |
| `accounts.password.success` | Parol yangilandi | Parol oʻzgartirildi | toast sarlavhadagi feʼlni takrorlaydi |
| `accounts.password.error` | Joriy parol notoʻgʻri | Hozirgi parol notoʻgʻri | §11/21 `joriy` |
| `accounts.delete.warning` | Hisobingiz 30 kundan soʻng butunlay oʻchiriladi va shaxsiy maʼlumotlaringiz anonimlashtiriladi. Bu muddat ichida bekor qilishingiz mumkin. | Hisobingiz 30 kundan keyin butunlay oʻchadi, shaxsiy maʼlumotlaringiz esa anonimlashtiriladi. Shu muddat ichida bekor qila olasiz. | «oʻchiriladi va … anonimlashtiriladi» — ikki ish bitta zanjirda; «mumkin» → «ola siz» |
| `accounts.delete.scheduled` | Hisobingiz {date} sanasida oʻchiriladi. | Hisobingiz {date} kuni oʻchiriladi. | §9 «{date} sanasida» → «{date} kuni» |
| `accounts.admin.resetPassword.confirm` | Bu foydalanuvchi uchun vaqtinchalik parol yaratilsin va barcha seanslari yopilsinmi? | Bu xodimga vaqtinchalik parol berilsinmi? Hamma qurilmasidan chiqariladi. | §11/3 `foydalanuvchi` → `xodim`; «seans» → qurilma |
| `accounts.admin.resetPassword.success` | Vaqtinchalik parol yaratildi | Vaqtinchalik parol berildi | tugma «berish» deydi — toast ham shunday desin |
| `accounts.admin.resetPassword.copy` | Nusxalash | Nusxa olish | qobiq bilan bir xil: «Nusxa olish» |
| `accounts.admin.resetPassword.copied` | Nusxalandi | Nusxa olindi | §5 «Nusxa olindi» |
| `accounts.settings.subtitle` | Profil, seanslar, ikki bosqichli tekshiruv va parol shu yerda boshqariladi. | Profil, qurilmalar, ikki bosqichli tekshiruv va parol — hammasi shu yerda. | «shu yerda boshqariladi» — majhul va sovuq |
| `accounts.settings.dangerZone` | Xavfli hudud | Xavfli amallar | «Xavfli hudud» — *danger zone* soʻzma-soʻz; bu yerda amallar turadi |
| `accounts.photo.hint` | JPEG, PNG yoki WebP, 5 MB gacha. Surat koʻrsatilishidan oldin zararli dasturlarga tekshiriladi va oʻlchami moslanadi. | JPEG, PNG yoki WebP, 5 MB gacha. Surat zararli dasturga tekshiriladi va oʻlchamga keltiriladi. | «zararli dasturlarga tekshiriladi» kelishik xatosi; «koʻrsatilishidan oldin» ortiqcha |
| `accounts.photo.registerFailedToast` | Hisobingiz yaratildi, lekin suratni yuklab boʻlmadi. Uni Hisob sozlamalarida qoʻshishingiz mumkin. | Hisob yaratildi, lekin surat yuklanmadi. Uni «Hisob sozlamalari»dan qoʻshasiz. | §14 obyekt nomi qoʻshtirnoqda; «mumkin» → aniq feʼl |
| `accounts.photo.error.type` | JPEG, PNG yoki WebP formatidagi rasm tanlang. | JPEG, PNG yoki WebP suratini tanlang. | «rasm»/«surat» bitta ekranda ikki xil edi |
| `accounts.photo.error.tooLarge` | Fayl hajmi 5 MB dan katta. | Fayl 5 MB dan katta. Kichikrogʻini tanlang. | §6 xato nima qilishni ham aytadi |
| `accounts.photo.error.invalidImage` | Bu fayl yaroqli rasm emas. | Bu fayl surat emas. Boshqa fayl tanlang. | §6 nima qilishni ayting; «yaroqli rasm emas» — texnik |
| `accounts.photo.error.unavailable` | Surat yuklash hozircha ishlamayapti. Bir necha daqiqadan soʻng qayta urinib koʻring. | Surat yuklash hozircha ishlamayapti. Bir necha daqiqadan keyin qayta urinib koʻring. | §9 «soʻng» → «keyin» |

## Modul: departments (`packages/i18n/messages/modules/departments/`)

**Asosiy qaror:** ijara birligi hamma joyda `boshqarma`, ichki boʻlinma `boʻlim` (UZBEK-STYLE.md §12.2). Fayl ilgari ikkisini ham `boʻlim`/`boʻlinma` degan edi; `member` esa `aʼzo` deb atalib, qobiqdagi `xodim` bilan toʻqnashardi.

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `departments.title` | Boʻlimlar | Boshqarmalar | §12.2 binding ruling: ijara birligi — boshqarma, ichki boʻlinma — boʻlim (fayl ikkisini aralashtirgan edi) |
| `departments.subtitle` | Sizning boʻlimlaringiz va ularga qoʻshilish yoʻllari | Boshqarmalaringiz va yangisiga qoʻshilish yoʻllari | §2 `sizning` ortiqcha |
| `departments.landing.eyebrow` | Boʻlimlar | Boshqarmalar |  |
| `departments.landing.title` | Boshlash uchun boʻlim tanlang | Boshqarma yaratish yoki qoʻshilish | Sarlavha inglizchadagi maʼnoni yoʻqotgan edi («boʻlim tanlang») |
| `departments.landing.body` | Hozircha hech qanday boʻlimga aʼzo emassiz. Yangi boʻlim yarating yoki mavjud boʻlimga qoʻshiling. | Hozircha birorta boshqarmaga aʼzo emassiz. Yangi boshqarma yarating yoki boriga qoʻshiling. | §11/18 `mavjud` |
| `departments.landing.createCta` | Boʻlim yaratish | Boshqarma yaratish |  |
| `departments.landing.createTitle` | Boʻlim yaratish | Boshqarma yaratish |  |
| `departments.landing.createBody` | Boʻlimingizni tuzing, boʻlinmalarni belgilang. Soʻrovingiz super administrator tomonidan tasdiqlanadi. | Boshqarmangizni tuzing, boʻlimlarini belgilang. Soʻrovni tizim administratori koʻrib chiqadi. | §11/14 «super administrator tomonidan tasdiqlanadi» → ega oldinda; §12.2 «tizim administratori» |
| `departments.landing.joinCta` | Boʻlimga qoʻshilish | Boshqarmaga qoʻshilish |  |
| `departments.landing.joinTitle` | Boʻlimga qoʻshilish | Boshqarmaga qoʻshilish |  |
| `departments.landing.joinBody` | Taklif havolasi yoki kalit va parol bilan mavjud boʻlimga qoʻshiling. | Taklif havolasi bilan yoki kalit va parol orqali qoʻshiling. |  |
| `departments.create.title` | Yangi boʻlim soʻrovi | Yangi boshqarma soʻrovi |  |
| `departments.create.subtitle` | Soʻrovingiz super administratorga yuboriladi va tasdiqlangach boʻlim yaratiladi. | Soʻrov tizim administratoriga boradi; tasdiqlangach boshqarma yaratiladi. | §11/14 majhul qurilma; «super administrator» → «tizim administratori» |
| `departments.create.name` | Boʻlim nomi | Boshqarma nomi |  |
| `departments.create.unitsTitle` | Boʻlinmalar (ixtiyoriy) | Boʻlimlar (ixtiyoriy) |  |
| `departments.create.unitsHint` | Boʻlinmalarni hozir qoʻshing yoki keyinroq tuzilma sahifasidan qoʻshing. | Bilganlaringizni hozir qoʻshing, qolganini keyin tuzilma sahifasidan qoʻshasiz. | bitta jumlada «qoʻshing» ikki marta |
| `departments.create.unitName` | Boʻlinma nomi | Boʻlim nomi |  |
| `departments.create.addUnit` | Boʻlinma qoʻshish | Boʻlim qoʻshish |  |
| `departments.create.submitted` | Soʻrovingiz yuborildi | Soʻrov yuborildi | §11/32 «Soʻrovingiz yuborildi» → «Soʻrov yuborildi» |
| `departments.create.steps.units` | Boʻlinmalar | Boʻlimlar |  |
| `departments.create.noUnitsYet` | Boʻlinmalar keyinroq qoʻshiladi | Boʻlimlarni keyin ham qoʻshasiz | majhul «qoʻshiladi» → odamga qaratilgan |
| `departments.pending.body` | Super administrator soʻrovingizni tez orada koʻrib chiqadi. | Tizim administratori soʻrovingizni tez orada koʻrib chiqadi. | §12.2 «tizim administratori» |
| `departments.approvalQueue.title` | Boʻlim soʻrovlari | Boshqarma soʻrovlari |  |
| `departments.approvalQueue.empty.title` | Koʻrib chiqilmagan soʻrovlar yoʻq | Yangi soʻrov yoʻq | §10 nol sanoqda koʻplik yoʻq; nima yoʻqligini aniq aytadi |
| `departments.approvalQueue.unitsCount` | {count} ta boʻlinma | {count} ta boʻlim |  |
| `departments.approvalQueue.approvedToast` | Boʻlim yaratildi | Boshqarma yaratildi |  |
| `departments.invite.copiedInvite` | Taklif matni nusxalandi | Taklif matnidan nusxa olindi | §5 nusxa toasti — «nusxa olindi» |
| `departments.invite.copiedLink` | Havola nusxalandi | Havoladan nusxa olindi | §5 nusxa toasti — «nusxa olindi» |
| `departments.invite.inviteText` | Bizning boʻlimga qoʻshiling: {link}, parol: {password} | Boshqarmamizga qoʻshiling: {link}, parol: {password} |  |
| `departments.invite.approvalToggleBody` | Yoqilgan boʻlsa, yangi aʼzolar boshliq tasdiqlashini kutadi. | Yoqilgan boʻlsa, yangi xodimlar boshliq tasdigʻini kutadi. | §12.2 Member = xodim; «tasdiqlashini kutadi» → «tasdigʻini kutadi» |
| `departments.invite.passwordHiddenNotice` | Xavfsizlik uchun parol faqat yaratilgan/yangilangan paytda koʻrsatiladi. | Xavfsizlik uchun parol faqat yaratilgan yoki yangilangan paytda koʻrsatiladi. | «yaratilgan/yangilangan» — qiyalik chizigʻi UI matnida oʻqilmaydi |
| `departments.invite.linkDescription` | Ushbu havola orqali kelgan har bir kishi boʻlimingizga qoʻshilishni soʻraydi. | Bu havolani ochgan har kim boshqarmangizga qoʻshilishni soʻray oladi. | §11/19 `ushbu`; «har bir kishi … soʻraydi» → «har kim … soʻray oladi» |
| `departments.join.title` | Boʻlimga qoʻshilish | Boshqarmaga qoʻshilish |  |
| `departments.join.byLink.title` | Siz taklif qilinyapsiz | Sizni taklif qilishdi | «taklif qilinyapsiz» — imlo va gʻalati majhul; odam «sizni taklif qilishdi» deydi |
| `departments.join.byLink.body` | {name} boʻlimiga qoʻshilish uchun parolni kiriting. | {name} boshqarmasiga qoʻshilish uchun parolni kiriting. |  |
| `departments.join.success` | Boʻlimga qoʻshildingiz | Boshqarmaga qoʻshildingiz |  |
| `departments.join.pendingApproval` | Soʻrovingiz boshliq tomonidan tasdiqlanishi kerak | Soʻrovingizni boshliq tasdiqlashi kerak | §11/14 «boshliq tomonidan tasdiqlanishi» → «boshliq tasdiqlashi» |
| `departments.join.rateLimited` | Juda koʻp urinish. Birozdan soʻng qayta urinib koʻring. | Juda koʻp urinish boʻldi. Birozdan keyin qayta urinib koʻring. | §9 «soʻng» → «keyin»; «Juda koʻp urinish» — gap tugamagan edi |
| `departments.join.pendingApprovalBody` | Boʻlim boshligʻiga xabar yuborildi. U tasdiqlagach, bildirishnoma olasiz va ish boshlashingiz mumkin. | Boshqarma boshligʻiga xabar bordi. U tasdiqlagach bildirishnoma keladi va ishga kirishasiz. |  |
| `departments.join.approvalNotice` | Bu boʻlimga qoʻshilish boshliq tasdigʻini talab qiladi. | Bu boshqarmaga qoʻshilish uchun boshliq tasdigʻi kerak. | «talab qiladi» — hujjat uslubi |
| `departments.join.successBody` | Endi boʻlim ishlariga kirishingiz mumkin. | Endi boshqarma ishiga kirishasiz. | «ishlariga kirishingiz mumkin» → §11/17 aniq feʼl |
| `departments.members.title` | Aʼzolar | Xodimlar | §12.2 Member = xodim (fayl «aʼzo», qobiq «xodim» degan edi) |
| `departments.members.empty.title` | Aʼzolar yoʻq | Hali xodim yoʻq |  |
| `departments.members.roleMember` | Aʼzo | Xodim |  |
| `departments.members.statusPending` | Tasdiqlanishi kutilmoqda | Tasdiq kutilmoqda | chip qisqaroq |
| `departments.members.joinedAt` | Qoʻshilgan sana: {date} | Qoʻshilgan: {date} | «Qoʻshilgan sana:» — «sana» ortiqcha |
| `departments.members.remove` | Oʻchirish | Chiqarish | odam «oʻchirilmaydi» — boshqarmadan chiqariladi |
| `departments.members.removeConfirm` | {name}ni boʻlimdan chiqarasizmi? | {name}ni boshqarmadan chiqarasizmi? |  |
| `departments.members.removedToast` | Aʼzo oʻchirildi | Xodim boshqarmadan chiqarildi | nima boʻlganini aytadi |
| `departments.members.leave` | Boʻlimdan chiqish | Boshqarmadan chiqish |  |
| `departments.members.leaveConfirm` | Rostdan ham boʻlimdan chiqmoqchimisiz? | Rostdan ham boshqarmadan chiqmoqchimisiz? |  |
| `departments.members.leaveBlockedHead` | Boshliq sifatida avval boshqa aʼzoga vakolatni topshiring. | Avval boshliqlikni boshqa xodimga topshiring. | «vakolatni topshiring» → sahifadagi tugma nomi bilan bir xil: boshliqlik |
| `departments.members.leftToast` | Boʻlimdan chiqdingiz | Boshqarmadan chiqdingiz |  |
| `departments.members.removeDialogTitle` | Aʼzoni boʻlimdan chiqarish | Xodimni boshqarmadan chiqarish |  |
| `departments.members.leaveDialogTitle` | Boʻlimdan chiqish | Boshqarmadan chiqish |  |
| `departments.settings.title` | Boʻlim sozlamalari | Boshqarma sozlamalari |  |
| `departments.settings.permissionsDescription` | Aʼzolar nimani oʻzi bajara olishini belgilang. | Xodimlar nimani oʻzi qila olishini belgilang. |  |
| `departments.settings.allowSelfAssign` | Aʼzolar oʻzini boʻlinmaga tayinlashi mumkin | Xodimlar oʻzini boʻlimga biriktira oladi | §11/17 «mumkin» → «-a oladi» |
| `departments.settings.allowStructureEdit` | Aʼzolar tuzilmani tahrirlashi mumkin | Xodimlar tuzilmani tahrirlay oladi | §11/17 «mumkin» → «-a oladi» |
| `departments.settings.telegramGroupLabel` | Telegram guruhini kim ulashi mumkin | Telegram guruhini kim ulay oladi |  |
| `departments.settings.telegramEveryone` | Barcha aʼzolar | Barcha xodimlar |  |
| `departments.settings.saved` | Sozlamalar saqlandi | Saqlandi | §5 toast qisqa: «Saqlandi» |
| `departments.settings.dangerZone` | Xavfli hudud | Xavfli amallar | «Xavfli hudud» — *danger zone* soʻzma-soʻz |
| `departments.settings.dangerZoneDescription` | Bu boʻlimga tegishli, orqaga qaytarib boʻlmaydigan amallar. | Butun boshqarmaga taʼsir qiladigan, qaytarib boʻlmaydigan amallar. | «bu boʻlimga tegishli» maʼnoni yoʻqotgan — gap butun boshqarma haqida |
| `departments.settings.requestDeletion` | Boʻlimni oʻchirishni soʻrash | Boshqarmani oʻchirishni soʻrash |  |
| `departments.settings.requestDeletionConfirm` | Super administrator soʻrovni koʻrib chiqadi. Bu amalni orqaga qaytarib boʻlmaydi. | Soʻrovni tizim administratori koʻrib chiqadi. Buni orqaga qaytarib boʻlmaydi. |  |
| `departments.settings.typedConfirmLabel` | Tasdiqlash uchun "{name}" deb yozing | Tasdiqlash uchun «{name}» deb yozing | §14 obyekt nomi «…» da, ASCII qoʻshtirnoqda emas |
| `departments.settings.permissionsReadOnlyDescription` | Boshqarmangizda aʼzolar oʻzi bajara oladigan ishlar. Ularni boʻlim boshligʻi boshqaradi. | Boshqarmangizda xodimlar oʻzi qila oladigan ishlar. Ularni boshqarma boshligʻi belgilaydi. |  |
| `departments.settings.readOnlyNotice` | Bu sozlamalarni boʻlim boshligʻi boshqaradi. Siz ularni koʻrasiz, lekin oʻzgartira olmaysiz. | Bu sozlamalarni boshqarma boshligʻi belgilaydi. Koʻrishingiz mumkin, lekin oʻzgartira olmaysiz. | «Siz ularni koʻrasiz» — §2 ortiqcha olmosh |
| `departments.switcher.label` | Boʻlimni almashtirish | Boshqarmani almashtirish |  |
| `departments.switcher.current` | Joriy boʻlim | Hozirgi boshqarma | §11/21 `joriy` → `hozirgi` |
| `departments.hub.statMembers` | Aʼzolar | Xodimlar |  |
| `departments.hub.otherMemberships` | Boshqa aʼzoliklaringiz | Boshqa boshqarmalaringiz | «aʼzoliklaringiz» — kitobiy; odam boshqarmani nomlaydi |
| `departments.detail.noDepartment.title` | Siz hali boshqarmaga aʼzo emassiz | Hali birorta boshqarmaga aʼzo emassiz | §2 `Siz` ortiqcha |
| `departments.joinRequests.requestedAt` | Soʻragan sana: {date} | Soʻralgan: {date} | «Soʻragan sana:» — «sana» ortiqcha |
| `departments.features.readOnlyDescription` | Boshqarmangizda yoqilgan imkoniyatlar. Ularni boʻlim boshligʻi boshqaradi. | Boshqarmangizda yoqilgan imkoniyatlar. Ularni boshqarma boshligʻi belgilaydi. |  |
| `departments.features.custom_fields.label` | Maxsus maydonlar | Karta maydonlari | «Maxsus maydonlar» qoʻshni «Xodim maydonlari» bilan qarama-qarshi turmaydi |
| `departments.features.custom_fields.description` | Vazifalarga oʻz maydonlaringizni qoʻshing — masalan, hujjat raqami yoki manba. | Kartalarga oʻz maydonlaringizni qoʻshing — masalan, hujjat raqami yoki manba. |  |
| `departments.features.estimates.label` | Vaqt baholari | Taxminiy vaqt | TERMS: estimate — `taxminiy vaqt` |
| `departments.features.estimates.description` | Har bir vazifaga taxminiy vaqt yozib qoʻyiladi va yuklamada hisobga olinadi. | Ishga qancha vaqt ketishini yozib qoʻyasiz — yuklamada hisobga olinadi. | majhul «yozib qoʻyiladi» → odamga qaratilgan |
| `departments.features.workload.description` | Kim qancha band — hafta boʻyicha koʻrinish (faqat boʻlim boshligʻi uchun). | Kim qancha band — haftalar kesimida (faqat boshqarma boshligʻiga). |  |
| `departments.features.dependencies.description` | Bir vazifa boshqasini kutayotganini belgilash va toʻsilganlarni koʻrish. | Bir ish boshqasini kutayotganini belgilaysiz va toʻxtab turganlarini koʻrasiz. | §12.2 blocked = `toʻxtab turibdi`, `toʻsilgan` emas |
| `departments.features.templates.label` | Namunalar | Andozalar | §12.2 `shablon`/`namuna` → **andoza** |
| `departments.features.templates.description` | Tayyor vazifa va loyiha namunalari — bir xil ishni har safar qaytadan yozmaslik uchun. | Tayyor karta va loyiha andozalari — bir xil ishni har safar qaytadan yozmaslik uchun. |  |
| `departments.features.focus_list.description` | Har kim uchun beshtagacha asosiy vazifa roʻyxati. | Har bir xodimda beshtagacha asosiy ish. | «Har kim uchun … roʻyxati» — uzun; §10 `beshtagacha` |
| `departments.features.reminders.description` | Vazifa boʻyicha oʻzingizga belgilangan vaqtda eslatma olish. | Karta boʻyicha oʻzingiz tanlagan vaqtda eslatma keladi. | TERMS: karta; «eslatma olish» → «eslatma keladi» (§2 tizim oʻzi haqida gapirmaydi) |

## Modul: structure (`packages/i18n/messages/modules/structure/`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `structure.units.empty.body` | Boʻlimni tuzganingizdan keyin xodimlarni unga taqsimlashingiz mumkin. | Birinchi boʻlimni qoʻshing, keyin xodimlarni unga joylashtirasiz. | §7 boʻsh holat keyingi qadamni oʻrgatadi; «mumkin» → aniq feʼl |
| `structure.units.deleteConfirm.body` | Aʼzolar boʻlimsiz qoladi. Bir muddat «Bekor qilish» bilan qaytarish mumkin. | Xodimlar boʻlimsiz qoladi. Bir muddat «Bekor qilish» bilan qaytarasiz. | §12.2 Member = xodim |
| `structure.units.settingsNotice.structureEdit` | Hozircha tuzilmani faqat boʻlim boshligʻi tahrirlay oladi | Hozircha tuzilmani faqat boshqarma boshligʻi tahrirlay oladi | §12.2 tuzilmani boshqarma boshligʻi boshqaradi, boʻlim boshligʻi emas |
| `structure.units.settingsNotice.selfAssign` | Hozircha lavozimlarni faqat boʻlim boshligʻi belgilay oladi | Hozircha lavozimlarni faqat boshqarma boshligʻi belgilay oladi | §12.2 boshqarma boshligʻi |
| `structure.units.chart.exportPng` | PNG sifatida saqlash | PNG yuklab olish | §11/29 «Eksport»/«sifatida saqlash» → «yuklab olish» |
| `structure.units.chart.headBadge` | Boshligʻi | Boshliq | belgida egalik qoʻshimchasi keraksiz |
| `structure.units.chart.deputyBadge` | Oʻrinbosari | Oʻrinbosar | belgida egalik qoʻshimchasi keraksiz |
| `structure.units.chart.keyboardHint` | Boʻlimlar orasida oʻtish uchun strelka tugmalaridan foydalaning | Boʻlimlar orasida oʻq tugmalari bilan yuring | «strelka» — ruscha; «foydalaning» — uzun |
| `structure.units.validation.nameRequired` | Nomini kiriting | Nomini yozing. | §6 tekshiruv nuqta bilan; §11/26 matn «yoziladi» |
| `structure.units.addDialog.namePlaceholder` | Masalan, Monitoring guruhi | Masalan: Monitoring guruhi | §14 namuna shakli «Masalan: …» |
| `structure.units.addDialog.rootOption` | Yoʻq — asosiy boʻlim | Yoʻq — eng yuqori daraja | «asosiy boʻlim» quyidagi «Yuqori boʻlim» bilan chalkashadi |
| `structure.units.addDialog.create` | Yaratish | Qoʻshish | §11/4 boʻlim «qoʻshiladi»; dialog sarlavhasi obyektni aytib turibdi |
| `structure.roles.roleLabel.member` | Aʼzo | Xodim | §12.2 Member = xodim |
| `structure.roles.join` | Ushbu boʻlimga qoʻshilish | Bu boʻlimga qoʻshilish | §11/19 `ushbu` → `bu` |
| `structure.people.empty.title` | Hali aʼzo yoʻq | Hali xodim yoʻq | §12.2 Member = xodim |
| `structure.people.hoverCard.membership` | Aʼzolik | Boshqarmada | «Aʼzolik» — ostidagi belgida boshqarmadagi oʻrni turadi |
| `structure.people.hoverCard.linkCopied` | Havola nusxalandi | Havoladan nusxa olindi | §5 nusxa toasti bir xil shaklda |
| `structure.people.layout.cards` | Kartochkalar | Kartalar | §11/9 `kartochka` → `karta` |
| `structure.people.table.caption` | Boʻlim xodimlari roʻyxati | Boshqarma xodimlari roʻyxati | §12.2 roster — butun boshqarma |
| `structure.people.table.unitRole` | Boʻlimdagi roli | Boʻlimdagi oʻrni | «roli» — oʻzlashmasi shart emas |
| `structure.common.head` | Boshligʻi | Boshliq | belgida egalik qoʻshimchasi keraksiz |
| `structure.common.member` | Aʼzo | Xodim | §12.2 Member = xodim |

## Modul: people (`packages/i18n/messages/modules/people/`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `people.table.description` | Boʻlim xodimlari va ularning koʻrsatkichlari bitta jadvalda. | Boshqarma xodimlari va siz tanlagan koʻrsatkichlar — bitta jadvalda. | §12.2 boshqarma; «ularning koʻrsatkichlari» — kim tanlashini aytmaydi |
| `people.table.columns.heading` | Koʻrsatkichlarni tanlang | Koʻrsatkichlar | §4 menyu sarlavhasi — ot |
| `people.table.columns.group.field` | Maxsus maydonlar | Maydonlar | TERMS §12.2: Custom fields = `maydonlar` |
| `people.table.empty.body` | Boʻlimga birinchi xodim qoʻshilganda jadval shu yerda toʻlib boradi. | Boshqarmaga birinchi xodim qoʻshilishi bilan jadval toʻla boshlaydi. | §12.2 boshqarma; «shu yerda toʻlib boradi» — «shu yerda» ortiqcha |
| `people.table.groupBy.unitRole` | Roli boʻyicha | Oʻrni boʻyicha | «rol» oʻrniga `oʻrni` — structure moduli bilan bir xil |
| `people.table.filter.valuePlaceholder` | Qiymat kiriting | Qiymat yozing | §11/26 matn «yoziladi» |
| `people.table.filter.op.contains` | Ichida bor | Soʻz bor | §11/39 «Ichida bor» — hech kim aytmaydi |
| `people.table.calc.filledOf` | {total} dan {filled} ta | {total} tadan {filled} tasi | §10 maxraj «{total} tadan {filled} tasi» |
| `people.table.bulk.clear` | Tanlovni bekor qilish | Tanlovni tozalash | §5 «Bekor qilish» — undo yozuvi; tanlov tozalanadi |
| `people.table.action.board` | {name}ning doskadagi ustuni | {name}ning doskadagi ustunini ochish | §3 aria-label toʻliq amalni aytadi |
| `people.table.views.isDefault` | Boʻlim uchun standart | Boshqarma uchun standart | §12.2 boshqarma |
| `people.table.views.makeDefault` | Boʻlim uchun standart qilish | Boshqarma uchun standart qilish | §12.2 boshqarma |
| `people.table.views.defaultLabel` | Boʻlim uchun standart boʻlsin | Boshqarma uchun standart boʻlsin | §12.2 boshqarma |
| `people.table.views.dirty` | Oʻzgartirildi | Oʻzgardi | chip qisqaroq |
| `people.table.views.revert` | Qaytarish | Asliga qaytarish | §5 `Qaytarish` — redo; bu yerda saqlangan holatga qaytiladi |
| `people.indicator.workloadHours.description` | Shu haftaga rejalashtirilgan soatlar — vaqt baholari yoqilganda | Shu haftaga rejalashtirilgan soatlar — taxminiy vaqt yoqilganda | TERMS: estimate = `taxminiy vaqt` |
| `people.indicator.workloadPct.description` | Ochiq vazifalarning haftalik imkoniyatga nisbati | Ochiq vazifalarning haftalik sigʻimga nisbati | §12.2 weekly capacity = `haftalik sigʻim` (`imkoniyat` — feature toggle) |
| `people.indicator.projectsOwned.label` | Rahbarlik qilmoqda | Rahbar loyihalari | ustun sarlavhasi — ot birikma, feʼl emas |
| `people.indicator.projectsOwned.description` | Egasi sifatida yuritayotgan loyihalari | Oʻzi rahbarlik qilayotgan loyihalar | «egasi sifatida yuritayotgan» — kitobiy |
| `people.indicator.focusMinutes7d.description` | Soʻnggi yetti kundagi jamlangan fokus daqiqalari. Shaxsiy ish maydoni mazmuni hech qachon koʻrinmaydi. | Soʻnggi yetti kundagi jamlangan diqqat daqiqalari. Shaxsiy ish maydonining mazmuni hech qachon koʻrinmaydi. | §12.2 `fokus` → `diqqat` |
| `people.indicator.lastActiveAt.description` | Tizimda oxirgi marta koʻringan vaqti | Oxirgi marta qachon kirgani | §11/8 `tizim` |
| `people.indicator.unitRole.label` | Boʻlimdagi roli | Boʻlimdagi oʻrni | «roli» → `oʻrni` |
| `people.indicator.unitRole.description` | Boʻlim ichidagi lavozim belgisi | Boʻlim ichidagi oʻrni | «lavozim belgisi» — lavozim boshqa maydon |
| `people.indicator.joinedAt.description` | Boʻlimga qoʻshilgan sana | Boshqarmaga qoʻshilgan sana | §12.2 boshqarma |
| `people.assign.subtitle` | Vazifa shu xodimga biriktiriladi, beruvchi esa siz boʻlasiz. | Vazifani shu xodimga siz berasiz. | §11/14 majhul «biriktiriladi, beruvchi esa siz boʻlasiz» → bitta aniq gap |
| `people.assign.field.titleRequired` | Vazifa nomini kiriting. | Vazifa nomini yozing. | §11/26 matn «yoziladi» |
| `people.person.own.description` | Ish boʻyicha koʻrsatkichlaringiz, vazifalaringiz va maʼlumotlaringiz. | Ish koʻrsatkichlaringiz, vazifalaringiz va qayd etilgan maʼlumotlaringiz. | «Ish boʻyicha koʻrsatkichlar» — ortiqcha yuklama |
| `people.person.meta.unitRole` | Boʻlimdagi roli | Boʻlimdagi oʻrni | «roli» → `oʻrni` |
| `people.person.chart.created` | Berilgan | Olingan | *Received* — xodim vazifani oladi, bermaydi |
| `people.person.tasks.empty.body` | Bu tanlov boʻyicha hech qanday vazifa topilmadi. | Bu tanlovga mos vazifa yoʻq. | §7 filtr natijasi boʻsh: nima yoʻqligini ayting |
| `people.person.projects.progress` | {done} / {total} vazifa bajarilgan | {done}/{total} vazifa bajarilgan | §10 nisbat chiziqchasi atrofida probel yoʻq |
| `people.person.events.pollsValue` | {voted} / {total} | {voted}/{total} | §10 nisbat chiziqchasi atrofida probel yoʻq |
| `people.person.onboarding.note` | Bu qadamlar boʻlimga koʻrinadigan belgilardan olinadi. Shaxsiy ish maydoni mazmuni hech qachon koʻrinmaydi. | Bu qadamlar boshqarmaga koʻrinadigan belgilardan olinadi. Shaxsiy ish maydonining mazmuni hech qachon koʻrinmaydi. | §12.2 boshqarma |
| `people.person.fields.askFailed` | Soʻrovni yuborib boʻlmadi. Birozdan soʻng qayta urinib koʻring. | Soʻrovni yuborib boʻlmadi. Birozdan keyin qayta urinib koʻring. | §9 «soʻng» → «keyin» |
| `people.person.fields.empty.title` | Maydonlar yaratilmagan | Hali maydon yoʻq | §7 boʻsh holat nima yoʻqligini aytadi |
| `people.person.fields.empty.body` | Boshqarma boshligʻi «Maydonlar» boʻlimida xodimlar uchun maydon yaratishi mumkin. | Boshqarma boshligʻi «Maydonlar» sahifasida xodimlar uchun maydon qoʻshadi. | «boʻlimida» — bu sahifa; §11/4 maydon «qoʻshiladi» |
| `people.person.fields.unavailable.body` | Bu boʻlimda xodim maydonlari hozircha yoqilmagan. | Bu boshqarmada xodim maydonlari hozircha yoqilmagan. | §12.2 boshqarma |
| `people.person.activity.kind.created` | Vazifa yaratdi | Vazifa qoʻshdi | §11/4 karta «qoʻshiladi» |
| `people.person.activity.kind.assigned` | Vazifani biriktirdi | Vazifani berdi | modul boʻylab bitta feʼl: vazifa «beriladi» |
| `people.person.activity.kind.checklist` | Nazorat roʻyxatini yangiladi | Bajarish roʻyxatini yangiladi | §12.2 checklist = `bajarish roʻyxati` |
| `people.person.missing.body` | Bu xodim boʻlimda faol emas yoki havola eskirgan. | Bu xodim boshqarmada faol emas yoki havola eskirgan. | §12.2 boshqarma |

## Modul: work (`packages/i18n/messages/modules/work/`)

**Asosiy qaror:** doskadagi obyekt — `karta` (UZBEK-STYLE.md §12.2, §5 toast jadvali), odamga topshirilgan ish esa `vazifa` (sahifa nomi, «Mening vazifalarim», «Vazifa berish»). Fayl ikkisini bir ekranda aralashtirib yuborgan edi.

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `work.description` | Xodimlar doskasi: boshqarma aʼzosiga bitta ustundan. | Xodimlar doskasi: har bir xodimga bitta ustun. | «boshqarma aʼzosiga bitta ustundan» — sanoq qurilmasi gʻalati |
| `work.board.department` | Boʻlim | Boshqarma | §12.2 ijara birligi — boshqarma |
| `work.board.columnEmpty` | Vazifalar yoʻq | Karta yoʻq | §10 nol sanoqda koʻplik yoʻq; §12.2 doskadagi obyekt — karta |
| `work.board.emptyTitle` | Boshqarma aʼzolari topilmadi | Boshqarmada hali xodim yoʻq | §12.2 Member = xodim; «topilmadi» — qidiruv natijasi emas |
| `work.board.emptyBody` | Doska koʻrinishi uchun avval boshqarmaga aʼzolar qoʻshilishi kerak. | Doska koʻrinishi uchun boshqarmaga xodim qoʻshing. | §7 boʻsh holat bitta amalni oʻrgatadi |
| `work.board.moved` | "{title}" {target} ustuniga koʻchirildi | «{title}» {target} ustuniga koʻchirildi | §14 obyekt nomi «…» da (§5 toast jadvalidagi shakl) |
| `work.board.columnsShowing` | {shown} / {total} ustun koʻrsatilmoqda | {shown}/{total} ustun koʻrsatilmoqda | §10 nisbat chiziqchasi atrofida probel yoʻq |
| `work.board.scopeMine` | Mening | Meniki | «Mening» — yolgʻiz turolmaydi |
| `work.board.densityCompact` | Ixcham koʻrinish | Ixcham | jadvaldagi «Ixcham» bilan bir xil |
| `work.board.densityRoomy` | Keng koʻrinish | Keng | jadvaldagi «Keng» bilan bir xil |
| `work.quickAdd.placeholder` | Tez qoʻshish: "Nodira: oylik hisobotni juma kuniga tayyorla" | Tez qoʻshish: «Nodira: oylik hisobot, juma kuni» | «tayyorla» — «sen» shakli (§2 hamma joyda «siz»); §14 «…» |
| `work.quickAdd.created` | "{title}" yaratildi | «{title}» qoʻshildi | §11/4 karta «qoʻshiladi»; §14 «…» |
| `work.quickAdd.error` | Vazifani yaratib boʻlmadi | Kartani qoʻshib boʻlmadi | §12.2 obyekt — karta; §11/4 |
| `work.quickAdd.unknownAssignee` | "{name}" nomli xodim topilmadi | «{name}» degan xodim topilmadi | «nomli xodim» — rasmiy; §14 «…» |
| `work.quickAdd.aiError` | Matnni aniqlab boʻlmadi | Matn tushunarsiz boʻldi | §2 tizim oʻzi haqida gapirmaydi («aniqlab boʻlmadi» → matn tushunarsiz) |
| `work.filter.saved` | Koʻrinish saqlandi | Saqlandi | §5 toast qisqa |
| `work.filter.noSavedViews` | Saqlangan koʻrinishlar yoʻq | Saqlangan koʻrinish yoʻq | §10 nol sanoqda koʻplik yoʻq |
| `work.filter.removeChip` | "{chip}" filtrini olib tashlash | «{chip}» filtrini olib tashlash | §14 «…» |
| `work.filter.hideAdvanced` | Kengaytirilganni yashirish | Yashirish | «Kengaytirilganni yashirish» — ogʻizga sigʻmaydi |
| `work.card.peekTitle` | Vazifa tafsilotlari | Karta tafsilotlari | §12.2 obyekt — karta |
| `work.card.archive` | Arxivlash | Arxivga olish | §12.2 archive (v.) = `arxivga olish` |
| `work.card.archived` | Vazifa arxivlandi | Arxivga olindi | §5 toast jadvalidagi shakl |
| `work.card.done` | Vazifa bajarildi | Bajarildi | §5 toast qisqa |
| `work.card.addLinkPlaceholder` | Havola manzilini kiriting | Havolani qoʻying | §11/26 havola «qoʻyiladi» (paste), «manzili kiritilmaydi» |
| `work.card.noIdTitle` | Vazifa koʻrsatilmagan | Karta tanlanmagan | §12.2 obyekt — karta |
| `work.card.noIdBody` | Havolada vazifa identifikatori yoʻq. | Havolada karta raqami yoʻq. | §11/25 `identifikator` → `raqam` |
| `work.card.readOnly` | Bu vazifa siznikimas — faqat oʻqish uchun. Uni bergan, bajarayotgan yoki yaratgan xodim, hamda boʻlim boshligʻi tahrirlashi mumkin. | Bu kartani siz oʻzgartira olmaysiz — faqat oʻqish uchun. Uni bergan, bajarayotgan va qoʻshgan xodim hamda boshqarma boshligʻi tahrirlaydi. | «siznikimas» — imlo va ohang; §12.2 boshqarma boshligʻi |
| `work.card.undo` | Qaytarish | Bekor qilish | §5 binding: undo = `Bekor qilish`, `Qaytarish` — redo |
| `work.risk.atRisk` | Muddat yaqinlashmoqda | Muddat yaqin | chip qisqaroq; `work.mine.atRisk` bilan bir xil |
| `work.activity.created` | vazifani yaratdi | kartani qoʻshdi | §11/4 karta «qoʻshiladi» |
| `work.activity.assigned` | biriktirmani oʻzgartirdi | masʼulni oʻzgartirdi | «biriktirma» — soʻz yoʻq; TERMS: assignee = `masʼul` |
| `work.activity.checklist` | roʻyxatga band qoʻshdi | bajarish roʻyxatiga band qoʻshdi | §12.2 checklist = `bajarish roʻyxati` |
| `work.table.emptyTitle` | Vazifalar topilmadi | Karta topilmadi | §12.2 obyekt — karta; §10 koʻplik yoʻq |
| `work.table.emptyBody` | Filtrni oʻzgartiring yoki yangi vazifa qoʻshing. | Filtrni oʻzgartiring yoki yangi karta qoʻshing. | §12.2 obyekt — karta |
| `work.table.bulk.archived` | {count} ta vazifa arxivlandi | {count} ta karta arxivlandi | §5 toast jadvalidagi aynan shakl |
| `work.table.bulk.clear` | Bekor qilish | Tanlovni tozalash | §5 `Bekor qilish` — undo yozuvi |
| `work.timeline.emptyTitle` | Muddati belgilangan vazifalar yoʻq | Muddati belgilangan karta yoʻq | §12.2 obyekt — karta |
| `work.timeline.emptyBody` | Bu yerda faqat muddati bor faol vazifalar koʻrinadi. | Bu yerda faqat muddati bor faol kartalar koʻrinadi. | §12.2 obyekt — karta |
| `work.timeline.dateChanged` | "{title}" sanasi yangilandi | «{title}» sanasi oʻzgardi | §14 «…»; «yangilandi» → «oʻzgardi» |
| `work.timeline.dependencyArrows` | Bogʻliqlik strelkalari: {count} ta | {count} ta bogʻliqlik chizigʻi | «strelka» — ruscha |
| `work.mine.emptyTitle` | Sizga biriktirilgan vazifalar yoʻq | Sizga hali vazifa berilmagan | «biriktirilgan vazifalar yoʻq» → odam «vazifa berilmagan» deydi |
| `work.mine.emptyBody` | Sizga biriktirilgan vazifalar shu yerda koʻrinadi. | Sizga berilgan vazifalar shu yerda koʻrinadi. | modul boʻylab bitta feʼl: vazifa «beriladi» |
| `work.archive.emptyBody` | Bajarilgan va arxivlangan vazifalar shu yerda koʻrinadi. | Bajarilgan va arxivga olingan kartalar shu yerda koʻrinadi. | §12.2 archive (v.) = `arxivga olish` |
| `work.ai.draftReply` | Javob loyihasini yozish | Qoralama tuzish | «loyiha» — bu mahsulotda project; qoralama boshqa soʻz |
| `work.ai.draftReplyPreviewTitle` | Javob loyihasi | Javob qoralamasi | «Javob loyihasi» — project bilan toʻqnashadi |
| `work.ai.explainRisk` | Bu xavfni tushuntir | Xavfni tushuntirish | «tushuntir» — «sen» shakli |
| `work.ai.suggestAssignee` | Kimga topshiray | Kimga berish kerak | «topshiray» — birinchi shaxs, tugmada gʻalati |
| `work.ai.boardDigest` | Kim kechiktiryapti | Kim kechikyapti | «kechiktiryapti» — birovni kechiktirish; odam «kechikyapti» |
| `work.estimate.unreadable` | Bu vaqtni oʻqiy olmadim. Masalan: 2 soat 30 daqiqa. | Bu vaqt tushunarsiz. Masalan: 2 soat 30 daqiqa. | §2 «oʻqiy olmadim» — tizim oʻzi haqida gapiryapti |
| `work.section.timeSummary` | {logged} / {estimate} | {logged}/{estimate} | §10 nisbat chiziqchasi atrofida probel yoʻq |
| `work.chip.blockedBy` | {count} ta tugallanmagan ish kutilmoqda | {count} ta kartani kutmoqda | §12.2 obyekt — karta |
| `work.timeLog.unreadable` | Bu vaqtni oʻqiy olmadim. Masalan: 45 daqiqa. | Bu vaqt tushunarsiz. Masalan: 45 daqiqa. | §2 «oʻqiy olmadim» — tizim oʻzi haqida gapiryapti |
| `work.dependencies.wouldLoop` | Bu halqa hosil qiladi | Bunda halqa hosil boʻladi | «Bu halqa hosil qiladi» — ega noaniq |
| `work.recurrence.mode.scheduleHint` | Joriy karta bajarilgan-bajarilmaganidan qat'i nazar. | Bu karta bajarilgan yoki bajarilmaganidan qatʼi nazar. | §14 ASCII apostrof `qat'i` → `qatʼi`; §11/21 `joriy` |
| `work.recurrence.mode.afterDone` | Joriysi bajarilgach | Shu karta bajarilgach | §11/21 `joriysi` → `shu karta` |
| `work.recurrence.freqLabel` | Davr | Oraligʻi | §12.2 `davr` — shaxsiy ish maydonidagi sprint nomi, toʻqnashmasin |
| `work.recurrence.dayOfMonthHint` | Qisqa oyda oxirgi kunga surliadi. | Qisqa oyda oxirgi kunga suriladi. | imlo xatosi: `surliadi` → `suriladi` |
| `work.recurrence.countLabel` | Nechta marta | Necha marta | grammatika: `nechta marta` → `necha marta` |
| `work.bulk.clear` | Tanlovni bekor qilish | Tanlovni tozalash | §5 `Bekor qilish` — undo yozuvi |
| `work.bulk.noneApplied` | Hech bir kartaga oʻzgartirish kiritilmadi | Hech bir karta oʻzgarmadi | «oʻzgartirish kiritilmadi» — hujjat uslubi |
| `work.focus.moveUp` | «{title}» ni yuqoriga | «{title}»ni yuqoriga surish | oʻzbekchada qoʻshimcha probelsiz yoziladi; amal nomlansin |
| `work.focus.moveDown` | «{title}» ni pastga | «{title}»ni pastga surish | oʻzbekchada qoʻshimcha probelsiz yoziladi; amal nomlansin |
| `work.focus.unpinCard` | «{title}» ni diqqat markazidan olish | «{title}»ni diqqat markazidan olish | oʻzbekchada qoʻshimcha probelsiz yoziladi |
| `work.templates.createCard` | Karta yaratish | Karta qoʻshish | §11/4 karta «qoʻshiladi» |
| `work.templates.createProject` | Loyiha yaratish | Loyiha ochish | §11/4 loyiha «ochiladi» |
| `work.templates.created` | «{name}» andozasidan karta yaratildi | «{name}» andozasidan karta qoʻshildi | §11/4 karta «qoʻshiladi» |
| `work.templates.dueInDays` | {count} kunda | {count} kundan keyin | «{count} kunda» — maʼnosi noaniq |
| `work.templates.emptyBodyHead` | Kartani ochib, uni andoza sifatida saqlashingiz mumkin. | Kartani ochib, «Andoza sifatida saqlash»ni tanlang. | §7 boʻsh holat aniq amal koʻrsatadi |
| `work.workload.emptyTitle` | Yuklama hisoblanmadi | Yuklama hali yoʻq | «hisoblanmadi» — xatodek eshitiladi, aslida hali ish yoʻq |
| `work.workload.capacityEdit` | Haftalik imkoniyatni oʻzgartirish | Haftalik sigʻimni oʻzgartirish | §12.2 weekly capacity = `haftalik sigʻim` (`imkoniyat` — feature toggle) |
| `work.workload.capacityLabel` | Haftalik imkoniyat (soat) | Haftalik sigʻim (soat) | §12.2 `haftalik sigʻim` |
| `work.workload.capacitySaved` | Imkoniyat saqlandi | Saqlandi | §5 toast qisqa |
| `work.workload.capacityFailed` | Imkoniyatni saqlab boʻlmadi | Sigʻimni saqlab boʻlmadi | §12.2 `sigʻim` |
| `work.workload.capacityInvalid` | 0 dan 168 gacha soat kiriting | 0 dan 168 gacha son yozing. | §6 tekshiruv nuqta bilan; §11/26 |
| `work.workload.legendFreeHours` | Imkoniyatning 80% idan kam | Sigʻimning 80% idan kam | §12.2 `sigʻim` |
| `work.goals.value` | {current} / {target} | {current}/{target} | §10 nisbat chiziqchasi atrofida probel yoʻq |
| `work.goals.ceilingValue` | {target} dan {current} ta | {target} tadan {current} tasi | §10 maxraj «{total} tadan {current} tasi» |
| `work.goals.progressLabel` | «{title}» boʻyicha progress | «{title}» boʻyicha bajarilishi | `progress` — oʻzlashmagan |
| `work.goals.fieldDescription` | Izoh | Tavsif | `Izoh` — comment; description = `Tavsif` |
| `work.goals.emptyBodyHead` | Birinchi maqsadni qoʻying — progress kartalardan oʻzi hisoblanadi. | Birinchi maqsadni qoʻying — bajarilishi kartalardan oʻzi hisoblanadi. | `progress` — oʻzlashmagan |
| `work.goals.edit` | {title} maqsadini tahrirlash | «{title}» maqsadini tahrirlash | §14 «…» |
| `work.goals.forbiddenAction` | Ishlarni koʻrish | Doskani ochish | tugma qayerga olib borishini aytsin |

## Modul: projects (`packages/i18n/messages/modules/projects/`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `projects.description` | Boʻlim yuritayotgan barcha guruh loyihalari, taraqqiyoti bilan. | Boshqarma olib borayotgan guruh loyihalari va ularning bajarilishi. | §12.2 boshqarma; «taraqqiyoti» — siyosiy tusli soʻz |
| `projects.emptyTitle` | Hali loyihalar yoʻq | Hali loyiha yoʻq | §10 nol sanoqda koʻplik yoʻq |
| `projects.emptyBody` | Birinchi guruh loyihasini yarating — shablondan yoki boshidan. | Birinchi guruh loyihasini oching — andozadan yoki noldan. | §12.2 `shablon` → `andoza`; §11/4 loyiha «ochiladi»; «boshidan» → «noldan» |
| `projects.noIdTitle` | Loyiha koʻrsatilmagan | Loyiha tanlanmagan | «koʻrsatilmagan» → odam tanlaydi |
| `projects.noIdBody` | Havolada loyiha identifikatori yoʻq. | Havolada loyiha raqami yoʻq. | §11/25 `identifikator` → `raqam` |
| `projects.field.titlePlaceholder` | Loyiha nomini kiriting | Loyiha nomini yozing | §11/26 matn «yoziladi» |
| `projects.field.members` | Aʼzolar | Ishtirokchilar | loyihada `aʼzo` emas, `ishtirokchi` (people moduli ham shunday) |
| `projects.field.template` | Shablon | Andoza | §12.2 `shablon` → `andoza`; fayl ikkisini aralashtirgan edi |
| `projects.field.objective` | Umumiy vazifalar | Boshqarma vazifalari | §11/36 binding: objective/subjective — egalik haqida |
| `projects.field.subjective` | Shaxsiy vazifalar | Oʻz vazifalarim | §11/36 binding: objective/subjective — egalik haqida |
| `projects.field.galleryTemplateHint` | Bosqichlar va boshlangʻich kartalar avtomatik yaratiladi. | Bosqichlar va dastlabki kartalar oʻzi qoʻshiladi. | §11/4 karta «qoʻshiladi»; «avtomatik» ortiqcha |
| `projects.status.planning` | Rejalashtirilmoqda | Rejada | chip qisqaroq |
| `projects.create.title` | Guruh loyihasini yaratish | Guruh loyihasini ochish | §11/4 loyiha «ochiladi» |
| `projects.create.fromTemplate` | Shablondan | Andozadan | §12.2 `andoza` |
| `projects.create.fromScratch` | Boshidan | Noldan | «boshidan» — odam «noldan» deydi |
| `projects.create.submit` | Yaratish | Ochish | §11/4 loyiha «ochiladi» |
| `projects.create.success` | Loyiha yaratildi | Loyiha ochildi | §11/4 loyiha «ochiladi» |
| `projects.create.error` | Loyihani yaratib boʻlmadi | Loyihani ochib boʻlmadi | §11/4 loyiha «ochiladi» |
| `projects.create.fromGallery` | Andozalar galereyasidan | Andozalar toʻplamidan | `galereya` — rasmlar uchun |
| `projects.milestone.addPlaceholder` | Bosqich nomini kiriting | Bosqich nomini yozing | §11/26 matn «yoziladi» |
| `projects.card.addObjectivePlaceholder` | Umumiy vazifa qoʻshish | Boshqarma vazifasini qoʻshish | §11/36 |
| `projects.card.addSubjectivePlaceholder` | Shaxsiy vazifa qoʻshish | Oʻz vazifangizni qoʻshish | §11/36 |
| `projects.action.archive` | Loyihani arxivlash | Loyihani arxivga olish | §12.2 archive (v.) = `arxivga olish` |
| `projects.action.archived` | "{title}" arxivlandi | «{title}» arxivga olindi | §14 «…»; §12.2 `arxivga olindi` |
| `projects.ai.planPreviewTitle` | AI reja koʻrinishi | AI tayyorlagan reja | «reja koʻrinishi» — *preview* soʻzma-soʻz |

## Modul: fields (`packages/i18n/messages/modules/fields/`)

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `fields.manager.subtitle` | Boshqarma xodimlari va vazifalari uchun oʻz ustunlaringizni belgilang. | Boshqarma xodimlari va kartalari uchun oʻz ustunlaringizni belgilang. | §12.2 doskadagi obyekt — karta |
| `fields.manager.createFailed` | Maydonni qoʻshib boʻlmadi. Qaytadan urinib koʻring. | Maydonni qoʻshib boʻlmadi. Qayta urinib koʻring. | «Qaytadan urinib koʻring» → mahsulot boʻylab bitta shakl: «Qayta urinib koʻring» |
| `fields.manager.saved` | Oʻzgarishlar saqlandi. | Saqlandi | §5 toast qisqa: «Oʻzgarishlar saqlandi» → «Saqlandi» |
| `fields.manager.saveFailed` | Saqlab boʻlmadi. Qaytadan urinib koʻring. | Saqlab boʻlmadi. Qayta urinib koʻring. | bitta shakl: «Qayta urinib koʻring» |
| `fields.manager.restored` | Maydon qaytarildi. | Qaytarildi | §5 toast qisqa |
| `fields.manager.undo` | Qaytarish | Bekor qilish | §5 binding: undo = `Bekor qilish` |
| `fields.manager.tab.card` | Vazifa maydonlari | Karta maydonlari | §12.2 obyekt — karta (departments modulidagi imkoniyat nomi bilan bir xil) |
| `fields.manager.progressLabel` | {filled} / {total} toʻldirgan | {total} tadan {filled} tasi toʻldirgan | §10 maxraj «{total} tadan {filled} tasi» |
| `fields.manager.empty.person.title` | Xodimlar uchun maydon yoʻq | Hali xodim maydoni yoʻq | §7 boʻsh holat nima yoʻqligini aytadi |
| `fields.manager.empty.card.title` | Vazifalar uchun maydon yoʻq | Hali karta maydoni yoʻq | §7 + §12.2 karta |
| `fields.manager.empty.card.body` | Baholangan soat yoki hujjat havolasi kabi ustun qoʻshsangiz, u vazifa kartochkasida koʻrinadi. | Baholangan soat yoki hujjat havolasi kabi ustun qoʻshsangiz, u kartaning oʻzida koʻrinadi. | §11/9 `kartochka` → `karta` |
| `fields.my.saved` | Maʼlumotlaringiz saqlandi. | Saqlandi | §5 toast qisqa |
| `fields.my.saveFailed` | Saqlab boʻlmadi. Qaytadan urinib koʻring. | Saqlab boʻlmadi. Qayta urinib koʻring. | bitta shakl: «Qayta urinib koʻring» |
| `fields.card.saved` | Maydon yangilandi. | Saqlandi | §5 toast qisqa |
| `fields.card.requiredBlocksDone` | Bu maydon toʻldirilmaguncha vazifani yakunlab boʻlmaydi. | Bu maydon toʻldirilmaguncha kartani yakunlab boʻlmaydi. | §12.2 obyekt — karta |
| `fields.form.behaviourLegend` | Xatti-harakati | Qoidalari | §11/35 `Xatti-harakati` — odamning xatti-harakati boʻladi, maydonning qoidasi |
| `fields.form.showOnCardTile` | Kartochkada koʻrsatish | Kartada koʻrsatish | §11/9 `kartochka` → `karta` |
| `fields.form.showOnCardTileHint` | Doskadagi kartochkada kichik yozuv sifatida chiqadi. | Doskadagi kartada kichik yozuv boʻlib chiqadi. | §11/9 `kartochka` → `karta` |
| `fields.form.selfEditableHint` | Oʻchirilsa, faqat boshqarma boshligʻi kiritadi. | Oʻchirilsa, uni faqat boshqarma boshligʻi toʻldiradi. | §11/26 maydon «toʻldiriladi», «kiritilmaydi» |
| `fields.input.numberPlaceholder` | Raqam kiriting | Raqam | §14 placeholder — namuna, buyruq emas |
| `fields.input.derivedHint` | Bu qiymat avtomatik hisoblanadi. | Bu qiymat oʻzi hisoblanadi. | «avtomatik» → oʻzbekcha «oʻzi» |
| `fields.error.required` | Bu maydon majburiy. | Bu maydon toʻldirilishi kerak. | §6 tekshiruv jadvalidagi aynan shakl |
| `fields.error.too_long` | Matn juda uzun. | Matn juda uzun — qisqartiring. | §6 xato nima qilishni ham aytadi |

## Ikkinchi oʻqish (barcha modullar)

Birinchi tahrirdan keyin har bir modulning toʻrt va undan koʻp soʻzli satrlari yana bir bor
inglizchasi bilan yonma-yon oʻqib chiqildi. Quyidagilar shunda tuzatildi.

| kalit | avval | keyin | sabab |
|---|---|---|---|
| `structure.units.dragHint` | Tartibini oʻzgartirish uchun torting | Tortib tartibini oʻzgartiring | «…uchun torting» — inglizcha *to reorder* qurilmasi |
| `people.indicator.openCards.description` | Hozir bajarilayotgan vazifalar soni | Hozir bajarilayotgan vazifalar | «soni» ortiqcha — ustunning oʻzi son koʻrsatadi |
| `people.person.activity.empty.body` | Bu xodimning ish boʻyicha harakatlari hali qayd etilmagan. | Bu xodim boʻyicha hali hech qanday ish qayd etilmagan. | «ish boʻyicha harakatlari» — kitobiy |
| `work.ai.explainRiskPreviewTitle` | Xavf nima uchun qoʻyildi | Bu karta nega xavf ostida | Xavfni hech kim «qoʻymaydi» — u hisoblanadi |

## Yakuniy holat

| Fayl | uz-Latn oʻzgargan / jami |
|---|---|
| `uz-Latn.json` (qobiq, kirish, holatlar) | 32 / 153 |
| `modules/accounts` | 35 / 108 |
| `modules/departments` | 86 / 187 |
| `modules/structure` | 23 / 98 |
| `modules/people` | 43 / 290 |
| `modules/work` | 83 / 479 |
| `modules/projects` | 25 / 54 |
| `modules/fields` | 23 / 144 |
| **Jami** | **350 / 1513** |

uz-Cyrl faylarining hammasi tuzatilgan uz-Latn dan qayta hosil qilindi; qayta yugurtirilganda
fayllar bir bitga ham oʻzgarmaydi (determinizm tekshirildi). Oʻzgargan kirillcha qiymatlar: 366 —
lotinchadagidan koʻproq, chunki generator ikkita eskidan qolgan transliteratsiya xatosini ham
tuzatdi (`тикланганч` → `тиклангач`, `муддациз` → `муддатсиз`).

**Gate holati:** `node agentic/scripts/check-i18n.mjs` — `errors=0`;
`pnpm --filter @devon/i18n test:unit` — 78/78; `pnpm --filter @devon/i18n lint` — 0 xato
(prettier: «All matched files use Prettier code style»).
