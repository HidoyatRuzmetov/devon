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

