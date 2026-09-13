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
qilindi (`.uzwork/gen-cyrl.ts`), soʻng §13.2 boʻyicha qoʻlda oʻqib chiqildi — `ts`/`ц` tuzogʻi,
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
