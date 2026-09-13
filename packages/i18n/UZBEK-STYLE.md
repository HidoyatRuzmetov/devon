# UZBEK-STYLE.md — Devon (WorkPortal) oʻzbek tili uslub qoʻllanmasi

<!-- Hand-authored and binding. Unlike TERMS.md this file is NOT generated: edit it directly, and
     record every new wording decision here at the moment it is made. -->

## English preface (read this first)

This is the binding style guide for **all Uzbek copy in this product** — `packages/i18n/messages/**`
(both scripts), the Telegram bot table in `apps/api/src/modules/telegram/templates.ts`, the Mini App,
and any Uzbek string a future epic adds.

Why it exists: the CTO's verdict on the shipped Uzbek was *"it clearly seems like merely a
translation — it doesn't read or sound natural, it reads awkward."* He is right. The message files
are grammatical, but they are English and Russian sentences wearing Uzbek endings: `-ni amalga
oshirish` where a verb would do, `foydalanuvchi` where a ministry says `xodim`, `mavjud emas` where
a person says `yoʻq`, `maʼlumotlar` sprinkled over sentences that name nothing, `kartochka` next to
`karta` on the same screen, and the tenant called `boʻlim` in 200 strings and `boshqarma` in 34.

The target is not "correct Uzbek". The target is **the Uzbek a thoughtful colleague in the Ministry
of Digital Technologies would write for the people sitting next to him**: correct, warm, brief,
idiomatic — never a word-for-word rendering of the English or the Russian.

**Precedence.** `DESIGN.md` §5 (copy rules) > `packages/i18n/TERMS.md` (sourced terminology) > this
file > the epic's own spec. Where this file adds a word TERMS.md is silent on, this file is the
authority and the decision is recorded in §12 with its reason.

**Hard constraints that survive every rewrite.** Values only — never rename, add or remove a key;
never touch code; never change an ICU placeholder (`{name}`, `{count}`, `{count, plural, …}`), an
HTML-ish tag, or a line break. `node agentic/scripts/check-i18n.mjs` must stay green, and the
transliteration test in `packages/i18n/test/unit/transliterate.test.ts` must pass. `uz-Cyrl` is
**generated from the corrected `uz-Latn`** with `latinToCyrillic()` and then hand-checked (§13) —
never written independently, so the two scripts always say the same thing.

---

## 1. Qoʻllanmaning qamrovi

Bu hujjat quyidagilarga tegishli:

| Qayerda | Fayl |
|---|---|
| Umumiy qobiq (shell, login, holatlar) | `packages/i18n/messages/uz-Latn.json`, `uz-Cyrl.json` |
| Modul satrlari | `packages/i18n/messages/modules/*/uz-Latn.json`, `uz-Cyrl.json` |
| Telegram bot | `apps/api/src/modules/telegram/templates.ts` (`'uz-Latn'`, `'uz-Cyrl'` blokllari) |
| Mini App | `packages/i18n/messages/modules/miniapp/*` |

Uch savol — har bir satrni yozishdan oldin:

1. **Kim oʻqiydi?** Vazirlik xodimi. Dasturchi emas, menejer emas, mijoz emas.
2. **Qayerda turadi?** Tugmami, chipmi, sarlavhami, toastmi, Telegram xabarimi, forma izohimi?
   Bir xil maʼnoni beshta joyda beshta xil qilib yozish kerak (§3–§8).
3. **Odam buni ogʻzaki qanday aytadi?** Shuni yozing, faqat toza va qisqa qilib.

---

## 2. Murojaat va ohang

- **Doimo «siz»** — hurmatli koʻplik. «Sen» hech qayerda yoʻq. Boshliqqa ham, xodimga ham,
  super administratorga ham bir xil murojaat.
- **Xodimning oʻzi haqida** — egalik qoʻshimchasi bilan: «Vazifalaringiz», «Yuklamangiz»,
  «Maʼlumotlaringiz». «Sizning vazifalaringiz» — ortiqcha, `sizning` ni tashlang.
- **Tizim oʻzi haqida gapirmaydi.** «Tizim sizga xabar yuboradi» emas — «Xabar keladi».
  Kim bajarganini aytish kerak boʻlsa, odamni ayting: «Boshliq tasdiqladi».
- **Ayblov yoʻq.** Xato xabari nima boʻlganini va nima qilish kerakligini aytadi, «siz notoʻgʻri
  kiritdingiz» demaydi.
- **Undov belgisi faqat tabrikda.** Bajarilgan ish, tugagan davr, birinchi loyiha — shu yerda
  ruxsat. Xato, ogohlantirish, koʻrsatma, boʻsh holat — hech qachon.
  *Hozirgi xato:* `today.empty` — «Zoʻr kun tilaymiz!» → «Bugun uchun eslatma yoʻq.»
- **Emoji tizim matnida yoʻq** (DESIGN.md §5). Telegram tugmalarida ham yoʻq.
- **Qisqalik — hurmat.** Bir jumla yetsa, ikkitasini yozmang. Oʻzbekcha inglizchadan 20–35 % uzun
  chiqadi; qobiqdagi yozuvlar hech qachon qisqartirilmaydi (`devon/no-shell-truncate`), shuning uchun
  sigʻmagan yozuvning yechimi — **qisqaroq kalit**, kesilgan matn emas.
- **Kulgili boʻlmang, sovuq ham boʻlmang.** «Osoyishtalikdan bahramand boʻling» — adabiy, gʻalati.
  «Bugunga ish qolmadi.» — toʻgʻri ohang.

---

## 3. Tugma va menyu yozuvlari

**Qoida:** harakat nomi — **feʼlning `-sh`/`-ish` shakli** (TERMS.md `button_register`, LexUZ
manbasi bilan): `Saqlash`, `Bekor qilish`, `Yuborish`, `Qoʻshish`, `Ochish`, `Tasdiqlash`, `Chiqish`.

- ❌ `Saqlang` (buyruq — qoʻpol eshitiladi tugmada)
- ❌ `Siz saqlashingiz mumkin` (tavsif — tugma tavsif emas)
- ❌ `Saqlashni bosing` (tugmaning ichida «bosing» deyilmaydi)
- ❌ `OK` / `Ha` yolgʻiz — nima boʻlishini ayting: `Oʻchirish`, `Yuborish`

**Obyekt bilan:** tugma ikki soʻzdan oshmasin. Kontekst aniq boʻlsa, obyektni tashlang —
dialog sarlavhasi «Yangi maydon» boʻlsa, tugma shunchaki `Qoʻshish`.

| Holat | Toʻgʻri |
|---|---|
| Asosiy amal | `Saqlash` |
| Ikkinchi darajali | `Bekor qilish` |
| Yaratuvchi amal, roʻyxat ustida | `Vazifa qoʻshish`, `Tadbir qoʻshish` |
| Yangi obyekt (katta, oʻz sahifasi bor) | `Yangi loyiha`, `Yangi maydon` |
| Ochish | `Ochish` (hech qachon `Koʻrish uchun ochish`) |
| Qaytarish (toast ichida) | `Bekor qilish` |
| Qayta urinish | `Qayta urinish` |
| Yuklab olish | `CSV yuklab olish` (`Eksport` emas — §11) |
| Yopish | `Yopish` |

**Menyu bandi** — tugma bilan bir xil shaklda: `Tahrirlash`, `Nusxa olish`, `Arxivga olish`,
`Oʻchirish`. Menyu sarlavhasi esa ot: `Ustunlar`, `Koʻrinish`, `Zichlik`.

**`aria-label`** — toʻliq, obyekt nomi bilan, chunki uni ekran oʻqiydi:
`«{title}» kartasini tanlash`, `{name} qatorini tanlash`. Yozuvni takrorlamang, toʻldiring.

---

## 4. Sarlavhalar

- **Sarlavha — ot yoki ot birikmasi**, feʼl emas, nuqtasiz: `Vazifalar`, `Xodimlar jadvali`,
  `Yuklama`, `Bildirishnoma sozlamalari`.
- **`eyebrow`** (sarlavha ustidagi kichik yozuv) — bir soʻz, bosh harflarda, boʻlim nomi:
  `ISH`, `TADBIRLAR`, `TIZIM`. Ikki soʻzdan oshsa — bu eyebrow emas, tavsif.
- **`description`** — sarlavha ostidagi bir jumla, **nima uchun kerakligini** aytadi, nima
  ekanligini emas. Nuqta bilan tugaydi.
  - ❌ «Bu sahifada yuklamani koʻrish mumkin.»
  - ✅ «Kim band, kimda joy bor — haftalar kesimida.»
- **Dialog sarlavhasi** — nima qilinayotgani: `Maydonni tahrirlash`, `Yangi qoida`,
  `Bosh sahifaga mahkamlash`.
- **Boʻlim sarlavhasi (`section`)** — bitta ot: `Vaqt`, `Bogʻliqliklar`, `Eslatmalar`.
- Sarlavhada nuqta yoʻq, ikki nuqta yoʻq, qavs yoʻq (sanoqdan tashqari: `Tarix ({count})`).

---

## 5. Toast va «Bekor qilish»

**Toast qisqa. Toast — natija, tabrik emas, hisobot emas.** DESIGN.md §4: qaytariladigan har bir
amalning toastida `Bekor qilish` boʻladi; tasdiq dialogi emas, **undo** — bu mahsulotning qoidasi.

| Nima boʻldi | Toast |
|---|---|
| Saqlandi | `Saqlandi` |
| Nusxa olindi | `Nusxa olindi` |
| Oʻchirildi | `«{title}» oʻchirildi` + `Bekor qilish` |
| Arxivga olindi | `Arxivga olindi` + `Bekor qilish` |
| Koʻchirildi | `«{title}» {target} ustuniga koʻchirildi` + `Bekor qilish` |
| Koʻp obyekt | `{count} ta karta arxivlandi` + `Bekor qilish` |
| Qaytarildi | `Qaytarildi` |

- ❌ `Muvaffaqiyatli saqlandi` — `muvaffaqiyatli` toastda **hech qachon** yozilmaydi: agar xato
  boʻlmasa, demak muvaffaqiyatli.
- ❌ `Maʼlumotlar muvaffaqiyatli saqlandi!`
- ❌ `Sizning oʻzgarishlaringiz saqlandi` — `Saqlandi` yetadi.
- Toastda nuqta qoʻymang, agar u bitta boʻlak boʻlsa. Ikki jumla boʻlsa — toast emas, banner.
- **Avtosaqlash** (qayd, doska): `Saqlanmoqda…` → `Saqlandi`. Uch nuqta — bitta belgi `…` (U+2026).
- **Undo yozuvi har doim `Bekor qilish`** (TERMS.md `undo`). `Qaytarish` — bu *redo* (doska
  asboblari). Ikkisini aralashtirmang; hozirgi `work.card.undo: "Qaytarish"` — xato.

---

## 6. Xato va tekshiruv xabarlari

**Shakl: [nima boʻlmadi] + [nima qilish kerak].** Ikki qismdan ortiq boʻlmasin.

- ✅ `Vazifalarni yuklab boʻlmadi` / `Qayta urinib koʻring. Xatolik takrorlansa, soʻrov raqamini
  administratorga yuboring.`
- ✅ `Saqlab boʻlmadi` (toast) — qisqa, chunki forma joyida turibdi.
- ❌ `Xatolik yuz berdi` — nima boʻlganini aytmaydi.
- ❌ `Nimadir xato ketdi` — inglizchadan («something went wrong») koʻchirilgan, nomaʼlum.
  Buning oʻrniga: `Tadbirlarni yuklab boʻlmadi`.
- ❌ `Xato kodi 500` — kod odamga koʻrsatilmaydi (DESIGN.md §4), **soʻrov raqami** koʻrsatiladi.

**Tekshiruv (validation)** — maydon ostida, bitta jumla, nuqta bilan, nima kutilayotganini aytadi:

| Holat | Matn |
|---|---|
| Boʻsh majburiy maydon | `Bu maydon toʻldirilishi kerak.` |
| Raqam emas | `Raqam kiriting.` |
| Sana | `Sanani tanlang.` |
| Havola | `Havola https:// bilan boshlanishi kerak.` |
| Uzunlik | `Matn juda uzun — {max} belgidan oshmasin.` |
| Mantiqiy | `Tugash vaqti boshlanish vaqtidan keyin boʻlsin.` |
| Chegara | `Eng koʻpi {max} ta. Yangisini qoʻshish uchun birortasini oʻchiring.` |

- «Iltimos» yozilmaydi — na xatoda, na yuklanishda (§11).
- Formaning umumiy xatosi: `Belgilangan maydonlarni tekshirib chiqing.`
- Huquq yetmaganda: `Bu maydonni faqat boshqarma boshligʻi toʻldiradi.` — kim qila olishini ayting.

---

## 7. Boʻsh, yuklanish, ruxsat yoʻq, aloqasiz

DESIGN.md §9.6: sarlavha + bitta jumla + **bitta** tugma. Ikkinchi tugma ham, «batafsil» havolasi
ham yoʻq.

**Boʻsh holat — keyingi qadamni oʻrgatadi.** Ikki qism: `title` nima yoʻqligini aytadi, `body`
nima qilishni aytadi, bitta doʻstona jumla bilan.

- ✅ `Qoida yoʻq` / `Birinchi qoidani qoʻshing — masalan, muddati oʻtgan kartani boshliqqa xabar
  qilsin.`
- ✅ `Diqqat markazi boʻsh` / `Kartani ochib, «Diqqat markaziga» tugmasini bosing.`
- ❌ `Maʼlumot topilmadi` — nima yoʻqligini aytmaydi, nima qilishni ham.
- ❌ `Hozircha maʼlumotlar mavjud emas` — ikkita kalka bitta jumlada (§11).
- Filtr natijasi boʻsh boʻlsa — boshqacha yoziladi: `Bu filtrga mos vazifa yoʻq` /
  `Boshqa filtr tanlang yoki tozalang.`

**Yuklanish** — feʼlning `-moqda` shakli, nuqtasiz, uch nuqtasiz: `Yuklanmoqda`,
`Tadbirlar yuklanmoqda`, `Sahifa yuklanmoqda`. Faqat avtosaqlash va AI kutishida `…` ishlatiladi
(`Saqlanmoqda…`, `Tayyorlanmoqda…`), chunki u davom etayotgan jarayonni bildiradi.

**Ruxsat yoʻq** — bu nima ekanini va **kimdan soʻrashni** aytadi:

- ✅ `Bu sahifa boshqarma boshligʻi uchun` / `Maqsadlarni faqat boshqarma boshligʻi koʻradi va
  qoʻyadi. Kerak boʻlsa, boshqarma boshligʻiga murojaat qiling.`
- ❌ `Ruxsat yoʻq` yolgʻiz — kimdan soʻrashni aytmaydi.
- ❌ `Kirish taqiqlangan` — «taqiq» soʻzi bu yerda ortiqcha qattiq.

**Aloqasiz (offline)** — banner + nima koʻrinayotgani:

- ✅ `Internet aloqasi yoʻq` / `Oxirgi yuklangan maʼlumotlar koʻrsatilmoqda.`
- ✅ Boʻsh sahifa uchun: `Bu sahifa aloqa tiklangach ochiladi.`
- Navbatga tushgan yozuv: `Aloqa tiklangach yuboriladi`.

---

## 8. Bildirishnoma va Telegram xabarlari

**Shakl (DESIGN.md §5): sabab — obyekt — [muddat] — havola oxirida.**

```
Sizga topshirildi: «Oylik hisobotni tayyorlash»
Muddat: 19.09.2026
Ochish → <havola>
```

- **Sabab birinchi**, ikki nuqta bilan: `Sizga topshirildi:`, `Muddati oʻtdi:`,
  `Qaror kutilmoqda:`, `Eslatma:`, `Sizni belgilashdi:`, `Tadbirga taklif:`.
- **Obyekt qoʻshtirnoqda** (`«»`), qisqartirilmaydi.
- **Havola har doim oxirida**, alohida qatorda yoki tugma sifatida. Xabar oʻrtasida havola yoʻq.
- **Bitta xabar — bitta ish.** Ikkita narsani birlashtirmang; xulosa (`digest`) alohida shakl.
- **Telegram tugmalari** — ikki soʻzdan oshmaydi: `Bajarildi`, `1 kunga kechiktirish`,
  `Ishtirok etaman`, `Ochish`, `Toʻldirish`.
- **Bot javobi** — bitta jumla, nuqta bilan: `Qabul qilindi.`, `1 kunga kechiktirildi.`
- **Shaxsiy maʼlumot Telegramga chiqmaydi** (CLAUDE.md): telefon, e-pochta, manzil — hech qachon.
- **Bot matni ham shu qoʻllanmaga boʻysunadi.** Hozir `templates.ts` da ikki nuqson bor va ular
  tuzatilishi kerak: `maintenance` da notoʻgʻri apostrof — `so‘ng`, `ko‘ring` (U+2018) →
  `soʻng`, `koʻring` (U+02BB); `today.empty` da undov — `Zoʻr kun tilaymiz!` → `Bugun uchun
  eslatma yoʻq.`

---

## 9. Sana, vaqt, son va davomiylik

Kod allaqachon shunday qiladi (`packages/i18n/src/format.ts`) — matnda ham shunga amal qiling:

| Nima | Shakl | Misol |
|---|---|---|
| Sana | `DD.MM.YYYY` | `19.09.2026` |
| Vaqt | 24 soat, `HH:mm` | `18:30` |
| Sana + vaqt | probel bilan | `19.09.2026 18:30` |
| Vaqt mintaqasi | `Asia/Tashkent` — doimo | — |
| Ming ajratgich | **boʻlinmas probel** (U+00A0) | `12 480` |
| Oʻnlik | **vergul** | `1,5 soat` |
| Foiz | belgi soʻzga yopishadi | `82%` |
| Oraliq | en tire, probelsiz | `80–100%`, `14:00–15:30` |
| Tartib son | defis bilan | `3-bosqich`, `2-variant` |

- **Nisbiy vaqt** — qisqa va tabiiy: `bugun`, `ertaga`, `kecha`, `2 kundan keyin`,
  `3 kun oldin`, `bu hafta`, `keyingi hafta`. «Bugungi kunda», «joriy haftada» — yozma uslub, UI emas.
- **Davomiylik** — soatdan boshlab, vergulsiz: `2 soat 30 daqiqa`, `45 daqiqa`, `3 kun`.
  Qisqa koʻrinish faqat torgina joyda: `2s 30d`, `45d`.
- **Ism tartibi** (DESIGN.md §5): rasmiy joyda `Familiya Ism Otasining ismi`, roʻyxat va
  kartada `Ism Familiya`.
- **Hafta kunlari** ikki harf: `Du Se Ch Pa Ju Sh Ya`. Toʻliq shakl faqat matn ichida:
  `juma kuni`.
- Oy nomi kerak boʻlsa — kichik harf bilan: `19 sentyabr`.

---

## 10. Sanoq va koʻplik

Oʻzbek tilida **son bilan turgan ot koʻplik qoʻshimchasini olmaydi**. Bu — tarjima matnini eng tez
fosh qiladigan xato.

- ✅ `3 ta vazifa` ❌ `3 vazifalar` ❌ `3 ta vazifalar`
- ✅ `{count} ta karta` ❌ `{count} kartalar`

**`ta` qachon qoʻyiladi, qachon yoʻq:**

| Qoʻyiladi | Qoʻyilmaydi |
|---|---|
| sanaladigan narsa: `5 ta vazifa`, `2 ta loyiha`, `{count} ta maydon` | oʻlchov: `3 soat`, `20 daqiqa`, `5 kun`, `2 hafta`, `4 oy` |
| `{count} ta xodim` (jadval izohi) | odam sanogʻi jonli matnda: `7 kishi boradi`, `12 nafar xodim` |
| | takror: `3 marta ishlagan` |
| | foiz, pul, koordinata: `82%` |

- **Maxraj bilan**: `{total} tadan {filled} tasi` — «{total} dan {filled}» emas.
  Misol: `oʻtgan hafta muddati kelgan 14 tadan 11 tasi`.
- **Nisbat (`{done}/{total}`)** — chiziqcha atrofida probel yoʻq: `7/12 vazifa`.
- **Chegara**: `{count} / {max}` (diqqat markazi) — bu yerda probel bor, chunki bu hisob emas,
  koʻrsatkich.
- **ICU.** Hozircha hech bir oʻzbekcha satrda `{count, plural, …}` yoʻq va bu toʻgʻri: oʻzbekchada
  bitta shakl yetarli. Agar inglizchada `plural` paydo boʻlsa, oʻzbekchasi **faqat `other`
  tarmogʻini** saqlaydi va ichida `{count} ta …` yozadi — tuzilma bir xil qoladi, parity gate yashil.
- **Nol** — «0 ta» deyilmaydi: `Vazifa yoʻq`, `Ochiq vazifa yoʻq`.
- **Bitta** — «1 ta» oʻrniga koʻpincha `bitta` tabiiyroq: `bitta band qoldi`. Placeholder bilan
  boʻlsa `{count} ta` qoladi.

---

## 11. Tarjima izlari: 40 ta kalka va ularning tabiiy muqobili

Bu roʻyxat — bu mahsulotda **haqiqatan uchragan** yoki uchrashi muqarrar boʻlgan konstruksiyalar.
Chapdagisi grammatik jihatdan toʻgʻri boʻlishi mumkin; lekin u tarjima ekanini bildirib turadi.

| # | Kalka | Tabiiy shakl | Nega |
|---|---|---|---|
| 1 | `muvaffaqiyatli saqlandi` | `Saqlandi` | Xato boʻlmasa — muvaffaqiyatli. Toastda hech qachon «muvaffaqiyatli» yozilmaydi. |
| 2 | `iltimos, kuting` | `Biroz kuting` / `Yuklanmoqda` | «Iltimos» — inglizcha *please* ning mexanik izi; oʻzbekcha UI da yolvormaydi. |
| 3 | `foydalanuvchi` | `xodim` (odam), `hisob` (akkaunt) | Vazirlikda «foydalanuvchi» degan odam yoʻq — xodim bor. `admin` modulida 6 marta, tuzatilsin. |
| 4 | `yaratish` — hamma narsaga | `qoʻshish` (karta, maydon, qoida, band), `ochish` (loyiha, davr), `tuzish` (qoralama), `yaratish` (boshqarma, hisob) | Inglizcha *create* bitta soʻz, oʻzbekchada obyektga qarab uchta feʼl bor. |
| 5 | `amalga oshirildi` | `Bajarildi` | Rasmiy hujjat uslubi; tugma yonidagi toastda gʻalati va uzun. |
| 6 | `mavjud emas` | `yoʻq` / `hozircha yoʻq` | Eng koʻp uchraydigan kitobiy iz. `Hozircha tizim holati mavjud emas.` → `Tizim holati hali kelmadi.` |
| 7 | `maʼlumotlar` — toʻldiruvchi soʻz sifatida | narsaning oʻzini ayting | `Maʼlumotlarni yuklab boʻlmadi` → `Vazifalarni yuklab boʻlmadi`. Hozir 12 faylda 38 marta. |
| 8 | `tizim` — hamma joyda | tashlang yoki `ilova` / `Devon` | `Tizimdan chiqish` → `Chiqish`. `Tizim sizga xabar yuboradi` → `Xabar keladi`. |
| 9 | `kartochka` | `karta` | `analytics` moduli `kartochka`, qolgan hamma joy `karta`. Bitta soʻz tanlansin: **karta**. |
| 10 | `Yaqinlashib kelayotgan tadbirlar` | `Yaqin tadbirlar` | *Upcoming* ning soʻzma-soʻz tarjimasi; uch soʻz oʻrniga bitta sifat. |
| 11 | `Nimadir xato ketdi` | nima boʻlmaganini ayting | *Something went wrong* — hech narsa aytmaydi. |
| 12 | `Xatolik yuz berdi` | `Yuklab boʻlmadi` / `Saqlab boʻlmadi` | Feʼl bilan ayting, ot bilan emas. |
| 13 | `muvaffaqiyatsiz tugadi` | `boʻlmadi` | `Yuborib boʻlmadi`, `Saqlab boʻlmadi`. |
| 14 | `X tomonidan bajarildi` | `X bajardi` | Rus tilidagi *кем* ergash qurilishi; oʻzbekchada ega oldinda turadi. |
| 15 | `X hisoblanadi` («X — bu Y») | `X — Y` | *is a* ning kitobiy izi. `Doska — kartalar taxtasi.` |
| 16 | `-ni amalga oshirish` | feʼlning oʻzi | `oʻzgartirishni amalga oshirish` → `oʻzgartirish`. |
| 17 | `imkoniyatiga ega` | `-a oladi` | `tahrirlash imkoniyatiga ega` → `tahrirlay oladi`. |
| 18 | `mavjud boʻlgan` | `bor` / tashlang | `mavjud boʻlgan boʻlimga qoʻshiling` → `boshqa boshqarmaga qoʻshiling`. |
| 19 | `ushbu` | `bu` | `Ushbu sahifa` → `Bu sahifa`. `Ushbu` faqat rasmiy xat uslubida. |
| 20 | `quyidagi` | tashlang | `Quyidagi maydonlarni toʻldiring` → `Maydonlarni toʻldiring`. |
| 21 | `joriy` | `hozirgi` yoki tashlang | `joriy hafta` → `bu hafta`. |
| 22 | `maʼlum bir` | `bir` yoki tashlang | *a certain* ning izi. |
| 23 | `berilgan` (*given*) | `bu` / `tanlangan` | `berilgan sanada` → `shu kuni`. |
| 24 | `element` / `obyekt` | narsani nomlang | `3 ta element topildi` → `3 ta vazifa topildi`. |
| 25 | `identifikator` | `raqam` / `kalit` | `Havolada vazifa identifikatori yoʻq` → `Havolada vazifa raqami yoʻq`. |
| 26 | `kiritish` — hamma narsaga | `toʻldirish` (forma), `yozish` (matn), `tanlash` (roʻyxat) | *Enter/Input* bitta soʻz, oʻzbekchada uchta. |
| 27 | `bosing` koʻrsatmada | amalni nomlang | `Saqlash tugmasini bosing` → `Saqlang` (izohda) yoki shunchaki `Saqlash` (tugmada). |
| 28 | `sahifani yangilang` | `Qayta urinish` | Brauzer haqida emas, ish haqida gapiring. |
| 29 | `Eksport` | `CSV yuklab olish` | Foydalanuvchi «eksport» qilmaydi, fayl yuklab oladi. |
| 30 | `Rad etish` (AI taklifini) | `Bekor qilish` / `Kerak emas` | «Rad etish» — ariza rad etiladi, taklif esa shunchaki olinmaydi. |
| 31 | `Diqqat!` / `Ogohlantirish!` | matnning oʻzi | Sarlavha-ogohlantirish kerak emas; xabar oʻzi ogohlantiradi. |
| 32 | `Soʻrovingiz muvaffaqiyatli yuborildi` | `Soʻrov yuborildi` | Uch soʻz ortiqcha. |
| 33 | `Roʻyxatdan oʻtish` (tadbirga) | `Ishtirokni belgilash` | Roʻyxatdan oʻtish — hisob ochish; tadbirga esa javob beriladi. |
| 34 | `Kirish qutisi` (shaxsiy vazifalar) | `Yigʻma` | Pochta metaforasi vazifa roʻyxatiga yopishmaydi. |
| 35 | `Xatti-harakati` (*behaviour*, maydon formasi) | `Qoidalari` | Odamning xatti-harakati boʻladi, maydonning — qoidasi. |
| 36 | `Umumiy vazifalar` / `Shaxsiy vazifalar` (loyihada, *objective/subjective*) | `Boshqarma vazifalari` / `Oʻz vazifalarim` | Hozirgi tarjima maʼnoni yoʻqotgan: gap egalik haqida, obyektivlik haqida emas. |
| 37 | `Jamoa qurish` (*team building*) | `Jamoani jipslashtirish` | «Qurish» — bino quriladi. |
| 38 | `Boshlanishi` / `Tugashi` (sana filtri) | `Qaysi sanadan` / `Qaysi sanagacha` | Filtrda sana chegarasi soʻraladi, hodisaning boshlanishi emas. |
| 39 | `Ichida bor` (*contains*) | `Soʻz bor` | «Ichida bor» — hech kim aytmaydi. |
| 40 | `Tahlildan soʻrash` | `Savol bering` | Hisobotdan soʻralmaydi; odam savol beradi. |

**Soʻz tartibi va yuklamalar — yana toʻrtta qoida:**

1. **Feʼl oxirida.** Yangi maʼlumot feʼldan oldin turadi: `Vazifa {name}ga oʻtkazildi`, aksi emas.
2. **`-ning` zanjiri ikkitadan oshmasin.** `boshqarmaning boʻlimining boshligʻining sahifasi` →
   `boʻlim boshligʻining sahifasi`.
3. **`-mi` faqat dialogda va bannerda**, yozuvda emas: `…koʻchirasizmi?` — banner; tugmada esa
   `Koʻchirish`.
4. **`va` bilan uchta narsani bogʻlamang** — vergul ishlating: `tadbirlar, soʻrovnomalar va
   eʼlonlar`. `hamda` faqat rasmiy roʻyxatda.

---

## 12. Atamalar jadvali

### 12.1 TERMS.md dan (manbasi bor, oʻzgarmaydi)

| en | uz-Latn | uz-Cyrl | Izoh |
|---|---|---|---|
| Task | **vazifa** | вазифа | Umumiy ish birligi |
| Assignment (from a superior) | **topshiriq** | топшириқ | Faqat boshliqdan xodimga |
| Deadline | **muddat** | муддат | |
| Unit (subdivision) | **boʻlim** | бўлим | Boshqarma ichidagi boʻlinma |
| Employee | **xodim** | ходим | `foydalanuvchi` emas |
| Event | **tadbir** | тадбир | |
| Approval | **tasdiqlash** | тасдиқлаш | |
| Undo | **bekor qilish** | бекор қилиш | |
| Save | **saqlash** | сақлаш | |
| Order/decree | **buyruq** | буйруқ | Faqat rasmiy hujjat. `Ctrl+K` oynasi — `Qidirish va amallar`, `buyruqlar` emas |
| Concurrence | **kelishish** | келишиш | |
| Leave | **taʼtil** | таътил | |
| Business trip | **xizmat safari** | хизмат сафари | |
| Escalation queue | **Ijro nazorati** | Ижро назорати | |

**Taqiqlangan soʻzlar** (`packages/i18n/banned.json`, testda tekshiriladi):
`sprint`, `ticket`, `epic`, `backlog`, `task`, `спринт`, `тикет`, `эпик`, `таск`, `бэклог`.

### 12.2 Bu qoʻllanma qaror qilgan atamalar

#### Tashkiliy tuzilma — **binding ruling**

| en | uz-Latn | Qaror |
|---|---|---|
| Department (the tenant — whole workspace) | **boshqarma** | Mahsulotning ijara birligi. TECH-SPEC demo maʼlumoti ham shunday: «Raqamli xizmatlar boshqarmasi». |
| Unit (a subdivision inside it) | **boʻlim** | TERMS.md `unit`. Boshqarma ichidagi boʻlinma. |
| Head of department | **boshqarma boshligʻi** | |
| Head of unit | **boʻlim boshligʻi** | |
| Deputy | **oʻrinbosar** | |
| Member | **xodim** | |
| Super admin | **tizim administratori** | Bitta joyda «tizim» qoladi — bu lavozim nomi |

> ⚠️ **Hozirgi holat nomuvofiq.** `boʻlim` ijara birligi maʼnosida ~200 satrda, `boshqarma` esa
> 34 satrda ishlatilgan — bir xil narsaga ikki xil nom. Har bir modul tahrirlanganda shu jadvalga
> keltirilsin: ijara birligi — **boshqarma**, ichki boʻlinma — **boʻlim**.

#### Ish (work)

| en | uz-Latn | Izoh |
|---|---|---|
| Card | **karta** | `kartochka` emas |
| Board | **doska** | Xodimlar doskasi |
| Column | **ustun** | |
| Project | **loyiha** | |
| Milestone | **bosqich** | |
| Label | **yorliq** | |
| Priority | **muhimlik** | `prioritet` emas |
| Status | **holat** | |
| Checklist | **bajarish roʻyxati** | Qisqa joyda `roʻyxat` |
| Comment | **izoh** | |
| Activity / history | **tarix** | |
| Archive (v.) | **arxivga olish** | Toastda `arxivlandi` |
| Assignee | **masʼul** (ot), `Kimga` (maydon yozuvi) | |
| Watcher | **kuzatuvchi** | |
| Filter | **filtr** | Oʻzlashgan, qoladi |
| Saved view | **saqlangan koʻrinish** | |

#### v1.1 qoʻshimchalari

| en | uz-Latn | uz-Cyrl | Izoh / nega shu soʻz |
|---|---|---|---|
| Custom fields | **maydonlar** | майдонлар | «Maxsus maydon» faqat tushuntirishda; sahifa nomi — `Maydonlar` |
| Workload | **yuklama** | юклама | «Ish hajmi» — uzun; yuklama vazirlikda tayyor soʻz |
| Goals | **maqsadlar** | мақсадлар | |
| Automations | **qoidalar** (sahifa), **avtomatlashtirish** (eyebrow) | қоидалар / автоматлаштириш | Odam «qoida qoʻydim» deydi, «avtomatizatsiya yaratdim» demaydi |
| Rule | **qoida** | қоида | |
| Trigger | **hodisa** | ҳодиса | `trigger` oʻzlashmagan |
| Dependencies | **bogʻliqliklar** | боғлиқликлар | Bitta karta uchun — `bogʻliqlik` |
| Blocked / blocks | **toʻxtab turibdi** / **toʻxtatib turibdi** | тўхтаб / тўхтатиб турибди | `bloklangan` faqat chipda, joy tor boʻlganda |
| Estimate | **baho** (qisqa), **taxminiy vaqt** (izohda) | баҳо / тахминий вақт | Chipda `Baho`, forma yozuvida `Baholangan vaqt` |
| Time logged | **sarflangan vaqt** | сарфланган вақт | |
| Focus list | **diqqat markazi** | диққат маркази | |
| Focus timer (Pomodoro) | **diqqat vaqti** | диққат вақти | `fokus` dan voz kechiladi — `Diqqat markazi` bilan chalkashmasin |
| Templates | **andozalar** | андозалар | `shablon` qolmasin: `projects` moduli ikkalasini aralashtirgan |
| Reminders | **eslatmalar** | эслатмалар | |
| Notification | **bildirishnoma** | билдиришнома | Eslatma ≠ bildirishnoma: eslatma — oʻzingiz qoʻygan, bildirishnoma — tizim yuborgan |
| Person page | **xodim sahifasi** | ходим саҳифаси | Sarlavhasi — xodimning ismi |
| Directory | **maʼlumotnoma** | маълумотнома | |
| Indicators | **koʻrsatkichlar** | кўрсаткичлар | `metrika` emas |
| Join approval | **qoʻshilishni tasdiqlash** | қўшилишни тасдиқлаш | Soʻrov — `qoʻshilish soʻrovi` |
| Join request | **qoʻshilish soʻrovi** | қўшилиш сўрови | |
| Capabilities (feature toggles) | **imkoniyatlar** | имкониятлар | ⚠️ `workload.capacity` ham hozir `imkoniyat` — u **hafta sigʻimi** boʻlsin, chalkashmasin |
| Weekly capacity | **haftalik sigʻim** | ҳафталик сиғим | Yuqoridagi tuzatish |
| Canvas (personal) | **oq taxta** | оқ тахта | `doska` ish doskasi bilan toʻqnashadi |
| Sprint (personal) | **davr** | давр | `sprint` taqiqlangan |
| Note | **qayd** | қайд | |
| Poll | **soʻrovnoma** | сўровнома | |
| Carpool | **birga borish** | бирга бориш | |
| RSVP | **ishtirok** (ot), `Ishtirok etaman` (javob) | иштирок | |
| Digest | **xulosa** | хулоса | |
| Quiet hours | **tinch soatlar** | тинч соатлар | |
| Snooze | **kechiktirish** | кечиктириш | |
| Deep link | **havola** | ҳавола | Foydalanuvchiga «deep link» degan tushuncha yoʻq |
| Request id | **soʻrov raqami** | сўров рақами | |

#### v1.1 tahririda qaror qilingan atamalar (A qismi: qobiq, accounts, departments, structure, people, work, projects, fields)

| en | uz-Latn | Qaror va sabab |
|---|---|---|
| Card (doskadagi obyekt) | **karta** | Obyekt ustidagi amal — karta: `karta qoʻshish`, `arxivga olish`, `kartani koʻchirish`, `karta maydonlari`, `karta andozasi`. §5 toast jadvali va §12.2 shuni talab qiladi. |
| Task (odamga berilgan ish) | **vazifa** | Sahifa nomi (`Vazifalar`), `Mening vazifalarim`, `Vazifa berish`, bildirishnoma matni. Bitta ekranda ikkisi aralashmasin: doskada karta turadi, odamga vazifa beriladi. |
| Session (kirilgan qurilma) | **qurilma** | `seans` — ruscha *сеанс*; odam ekranda qurilmani koʻradi. `Kirilgan qurilmalar`, `Hamma qurilmadan chiqish`. |
| Copy (amal) | **nusxa olish** / **…ni nusxalash** | Obyektsiz tugma — `Nusxa olish`; obyekt bilan — `Havolani nusxalash`, `Taklifni nusxalash`. Toast esa hamma joyda §5 boʻyicha `Nusxa olindi`. |
| Danger zone | **Xavfli amallar** | «Xavfli hudud» — *danger zone* soʻzma-soʻz; sahifada amallar turadi, hudud emas. |
| Role in a unit | **oʻrni** | `Boʻlimdagi oʻrni`. `rol` oʻzlashmasi shart emas, `lavozim` esa boshqa maydon (job title). |
| Project member | **ishtirokchi** | Boshqarmada `xodim`, loyihada `ishtirokchi`. `aʼzo` faqat «boshqarmaga aʼzo emassiz» kabi holat bildirganda qoladi. |
| Revert (saqlangan koʻrinish) | **asliga qaytarish** | §5 dagi undo/redo juftligiga tegmaydi: undo — `Bekor qilish`, redo — `Qaytarish`. |
| Recurrence period | **oraligʻi** | `davr` shaxsiy ish maydonidagi sprint nomi (§12.2) — takrorlanish oynasida toʻqnashmasin. |
| Draft (AI javobi) | **qoralama** | `loyiha` bu mahsulotda project; `Javob loyihasi` ikki maʼnoni chalkashtiradi. |
| Arrow (klaviatura / diagramma) | **oʻq tugmalari** / **chiziq** | `strelka` — ruscha. |
| Export PNG / CSV | **PNG yuklab olish**, **CSV yuklab olish** | §11/29 ning tuzilma sxemasiga ham tatbiqi («PNG sifatida saqlash» emas). |
| Nav landmark (aria) | **Asosiy sahifalar** | `boʻlim` tashkiliy boʻlinma nomi; yon panel aria yozuvida u boshqarma almashtirgich yonida turib chalkashtiradi. |

#### Saqlanadigan oʻzlashmalar

Hamma ishlatadigan soʻzlarni oʻzbekchalashtirmang: **fayl, havola, sozlamalar, filtr, arxiv,
format, kod, parol, login, administrator, Telegram, CSV, QR, API, AI, Pomodoro**.
Lekin oʻzbekcha soʻz tirik boʻlsa — oʻzbekchasi olinadi: `prioritet` → **muhimlik**,
`status` → **holat**, `metrika` → **koʻrsatkich**, `shablon` → **andoza**, `eksport` →
**yuklab olish**, `kolonka` → **ustun**, `spisok` → **roʻyxat**.

---

## 13. Kirill yozuvi (uz-Cyrl)

**Qoida: uz-Cyrl hech qachon qoʻlda yozilmaydi.** Tuzatilgan `uz-Latn` dan
`latinToCyrillic()` (`packages/i18n/src/transliterate.ts`) bilan hosil qilinadi, keyin quyidagi
roʻyxat boʻyicha qoʻlda tekshiriladi. Shunda ikki yozuv **bir xil gapni** aytadi.

### 13.1 Harf mosligi

`oʻ → ў` · `gʻ → ғ` · `q → қ` · `h → ҳ` · `x → х` · `sh → ш` · `ch → ч` · `ng → нг` ·
`ʼ (hamza) → ъ` · `ya/ye/yo/yu → я/е/ё/ю` (soʻz boshida yoki unlidan keyin) ·
`e` soʻz boshida → `э`, undoshdan keyin → `е`.

`h → ҳ` va `x → х` ni **hech qachon** almashtirmang: `hisobot → ҳисобот`, `xodim → ходим`.

### 13.2 Qoʻlda tekshiriladigan joylar

1. **`ts` tuzogʻi.** Transliterator har qanday `ts` ni `ц` qiladi. Bu qoʻshimcha chegarasida
   notoʻgʻri: `muddatsiz` → ❌ `муддациз`, toʻgʻrisi **`муддатсиз`**. Shuningdek `hisobotsiz`,
   `natijatsiz` kabi `-t + -siz` va `-t + -si` birikmalari. Har bir `ts` ni koʻzdan kechiring.
   Haqiqiy `ц` faqat ruscha oʻzlashmalarda: `авторизация`, `функция`.
2. **`ё` va `е`.** `yo` soʻz boshida va unlidan keyin `ё`: `yoʻq → йўқ` (bu maxsus hol —
   `й` + `ў`, `ё` emas), `yordam → ёрдам`, `yoqilgan → ёқилган`. Undoshdan keyin `y` — alohida
   undosh `й`: `tayyor → тайёр`.
3. **`ъ` (tutuq belgisi).** `maʼlumot → маълумот`, `taʼtil → таътил`, `eʼlon → эълон`,
   `sanʼat → санъат`. Agar lotinchada apostrof tushib qolgan boʻlsa, kirillchada `ъ` ham yoʻqoladi —
   avval lotinchani tuzating.
4. **Ruscha oʻzlashmalar rus imlosida qoladi:** `администратор`, `техник`, `интернет`, `формат`,
   `календарь` emas — bu mahsulotda `taqvim → тақвим`.
5. **Lotincha qoladigan nomlar:** `Telegram`, `WorkPortal`, `CSV`, `QR`, `API`, `AI`, `Pomodoro`,
   `https://`, `/mute`, `/connect`. Ularni kirillchaga oʻgirmang.
6. **Bosh harflar.** `applyCase()` bosh harfni saqlaydi, lekin `OʻZ` kabi qisqartmalarni
   tekshiring.
7. **Placeholder va teglar teginilmaydi:** `{count}`, `{name}`, `{date}` — hech qachon
   tarjima qilinmaydi va kirillchaga oʻgirilmaydi.
8. **`ngʻ` — `нғ`, `нгъ` emas.** Transliteratorning `ng` digrafi `n` ni yutib yuboradi va
   modifikator harfni `ъ` ga aylantiradi: `qorongʻi` → ❌ `қоронгъи`, toʻgʻrisi **`қоронғи`**.
   `ngʻ` har doim `n` + `gʻ`.
9. **`menyu`, `tayyor` kabi soʻzlar.** `menyu → меню` (`менйу` emas), `tayyor → тайёр`
   (`таййор` emas) — `й` dan keyin `ё` yoziladi.
10. **Lotincha nom + kirillcha qoʻshimcha.** Nom lotinchaligicha qoladi, qoʻshimcha kirillchada:
    `WorkPortalдан фойдаланиш`, `Telegramда ёзиш`.
11. **Filtr kalit soʻzlari va format niqoblari lotinchada qoladi:** `field:`, `label:`,
    `assignee:`, `due:`, `YYYY-MM-DD`. Bular odam yozadigan sintaksis, soʻz emas —
    `фиэлд:` yoki `ЙЙЙЙ-ММ-ДД` ishlamaydi.
12. **Til nomlari tarjima qilinmaydi:** `Русский`, `English` va til almashtirgichdagi
    `Oʻzbekcha (lotin)` ikkala yozuvda ham bir xil qoladi.

### 13.3 Tartib

```
1. uz-Latn ni tuzating (bu qoʻllanma boʻyicha)
2. latinToCyrillic() bilan uz-Cyrl hosil qiling
3. §13.2 boʻyicha qoʻlda oʻqib chiqing
4. node agentic/scripts/check-i18n.mjs  (kalitlar parity)
5. pnpm --filter @devon/i18n test        (transliteratsiya + banned words)
```

---

## 14. Imlo va belgilar

- **Modifikator harflar majburiy:** `ʻ` (U+02BB) — `oʻ`, `gʻ` ichida; `ʼ` (U+02BC) — hamza
  (`maʼlumot`, `taʼtil`). ASCII `'`, teskari apostrof `` ` ``, qiyshiq qoʻshtirnoq `’` `‘` —
  foydalanuvchi matnida **taqiqlangan**. `normalizeUz()` erkin matnni tuzatadi, lekin message
  fayllari qoʻlda toʻgʻri yozilishi kerak.
  > Hozirgi ikki nuqson: `modules/work/uz-Latn.json` → `qat'i nazar` (ASCII `'`) → `qatʼi nazar`;
  > `apps/api/src/modules/telegram/templates.ts` → `so‘ng`, `ko‘ring` (U+2018) → `soʻng`, `koʻring`.
  > Shu faylda `surliadi` → `suriladi` imlo xatosi ham bor.
- **Qoʻshtirnoq:** obyekt nomi uchun `«…»`. ASCII `"` faqat JSON sintaksisida.
- **Tire:** fikr ajratuvchi — em tire `—` probel bilan; son oraligʻi — en tire `–` probelsiz;
  qoʻshma soʻz — defis `-`.
- **Uch nuqta:** bitta belgi `…` (U+2026), uchta nuqta emas. Faqat davom etayotgan jarayonda.
- **Nuqta qoʻyiladi:** `body`, `description`, `hint`, tekshiruv xabari, Telegram jumlasi.
  **Nuqta qoʻyilmaydi:** sarlavha, tugma, chip, yorliq, jadval ustuni, toastning bitta boʻlagi,
  `placeholder`.
- **Placeholder** — namuna yoki koʻrsatma, nuqtasiz: `Ism, lavozim yoki boʻlim boʻyicha qidirish`,
  `Masalan: 2 soat 30 daqiqa`.

---

## 15. Tekshiruv roʻyxati (har bir modul tahriridan keyin)

- [ ] Ijara birligi hamma joyda **boshqarma**, ichki boʻlinma — **boʻlim** (§12.2)
- [ ] `foydalanuvchi`, `kartochka`, `shablon`, `eksport`, `prioritet`, `metrika` qolmadi (§11, §12)
- [ ] `muvaffaqiyatli`, `amalga oshirildi`, `mavjud emas`, `iltimos`, `ushbu`, `quyidagi` qolmadi
- [ ] `maʼlumotlar` va `tizim` faqat haqiqatan kerak joyda qoldi
- [ ] Har bir sonda `ta` toʻgʻri qoʻyilgan, koʻplik qoʻshimchasi yoʻq (§10)
- [ ] Tugmalar `-sh`/`-ish` shaklida, ikki soʻzdan oshmaydi (§3)
- [ ] Xato xabari nima boʻlganini **va** nima qilishni aytadi (§6)
- [ ] Boʻsh holat keyingi qadamni oʻrgatadi, bitta tugmasi bor (§7)
- [ ] Undov belgisi faqat tabrikda; emoji yoʻq (§2)
- [ ] Sana `DD.MM.YYYY`, vaqt 24 soat, ming ajratgich — boʻlinmas probel (§9)
- [ ] `ʻ` va `ʼ` toʻgʻri; ASCII apostrof yoʻq (§14)
- [ ] `{placeholder}` lar, teglar, qator uzilishlari teginilmagan
- [ ] uz-Cyrl transliteratsiyadan hosil qilindi va §13.2 boʻyicha oʻqildi
- [ ] `node agentic/scripts/check-i18n.mjs` — yashil
- [ ] `pnpm --filter @devon/i18n test` — yashil

---

## 16. Qaror tarixi

Bu qoʻllanma yangi soʻz tanlaganda — qatorni shu yerga qoʻshing: sana, soʻz, qaror, sabab.

| Sana | Qaror | Sabab |
|---|---|---|
| 2026-09-13 | Ijara birligi = **boshqarma**, ichki boʻlinma = **boʻlim** | Ikkisi 200/34 nisbatda aralashib ketgan edi; TECH-SPEC demo maʼlumoti «…boshqarmasi» + ikki `boʻlim` deb modellashtirgan |
| 2026-09-13 | `kartochka` → **karta** | Bitta ekranda ikki xil nom |
| 2026-09-13 | `shablon` → **andoza** | Oʻzbekcha soʻz tirik va rasmiy matnlarda ishlatiladi |
| 2026-09-13 | `Eksport` → **CSV yuklab olish** | Odam fayl yuklab oladi, «eksport qilmaydi» |
| 2026-09-13 | Pomodoro `fokus` → **diqqat vaqti**, roʻyxat = **diqqat markazi** | Bitta ildizli ikki tushuncha chalkashayotgan edi |
| 2026-09-13 | `canvas` = **oq taxta** (ish doskasi = `doska`) | Ikkisi bir xil nomlangan edi |
| 2026-09-13 | `capabilities` = **imkoniyatlar**, `weekly capacity` = **haftalik sigʻim** | Ikkalasi `imkoniyat` deb atalgan edi |
| 2026-09-13 | `objective/subjective` loyiha kartalari → **Boshqarma vazifalari / Oʻz vazifalarim** | Hozirgi «Umumiy/Shaxsiy vazifalar» maʼnoni yoʻqotgan |
| 2026-09-13 | Undo = **Bekor qilish**, redo = **Qaytarish** | `work.card.undo` ikkisini almashtirib yuborgan |
| 2026-09-13 | Doskadagi obyekt = **karta**, odamga berilgan ish = **vazifa** | `work` moduli ikkisini bitta ekranda aralashtirgan edi («Karta qoʻshish» tugmasi ostida «Vazifalar yoʻq») |
| 2026-09-13 | `seans` → **qurilma** | Ruscha *сеанс*; odam ekranda qurilma nomini koʻradi |
| 2026-09-13 | Tugmada **`Nusxa olish`** / **`…ni nusxalash`**, toastda doim **`Nusxa olindi`** | Uch modul uch xil yozgan edi: `Nusxalash`, `Nusxa olish`, `nusxalandi` |
| 2026-09-13 | `Xavfli hudud` → **Xavfli amallar** | *Danger zone* soʻzma-soʻz; sahifada amallar turadi |
| 2026-09-13 | Boʻlimdagi `rol` → **oʻrni**; loyihada `aʼzo` → **ishtirokchi** | `lavozim` (job title) bilan toʻqnashardi; boshqarmada esa `xodim` |
| 2026-09-13 | Saqlangan koʻrinishni tiklash = **Asliga qaytarish** | §5 dagi undo (`Bekor qilish`) / redo (`Qaytarish`) juftligiga tegmasin |
| 2026-09-13 | Takrorlanish `davr` → **oraligʻi**; AI `javob loyihasi` → **qoralama** | `davr` — shaxsiy sprint, `loyiha` — project; ikkalasi band |
| 2026-09-13 | `strelka` → **oʻq tugmalari** / **chiziq**; `PNG sifatida saqlash` → **PNG yuklab olish** | Ruscha oʻzlashma va §11/29 ning sxemaga tatbiqi |

---

## 17. B guruh qarorlari (2026-09-13)

`events`, `personal`, `inbox`, `telegram`, `miniapp`, `analytics`, `pages`, `ai`, `admin`,
`automations`, `calendar`, `home` modullari va API tarafidagi oʻzbekcha satrlar tahrir qilinganda
qabul qilingan, TERMS.md jim boʻlgan qarorlar. §12 bilan bir xil kuchga ega.

| Sana | Qaror | Sabab |
|---|---|---|
| 2026-09-13 | `calendar` = **taqvim** (`kalendar` emas) | §13.2 kirillcha uchun allaqachon `тақвим` deb belgilagan edi; lotinchasi `kalendar` boʻlib qolgani ikki yozuvni ikki soʻzga ajratardi. Mahsulot nomlari (`Google Calendar`, `Apple Calendar`) oʻzgarmaydi. |
| 2026-09-13 | Telegram bot amrlari — **buyruq** | `/today`, `/mute` haqiqatan ham buyruq. TERMS.md `buyruq` dagi taqiq `Ctrl+K` oynasiga tegishli (u qidiruv, buyruqlar zanjiri emas), botga emas. |
| 2026-09-13 | `mention` (ot, chip, sabab yozuvi) = **belgilash** | `eslatish` — oʻzingiz qoʻygan eslatma; sizni izohda **belgilashadi**. `inbox.reason.mentioned` va `REASON_LABEL.mentioned` ikkalasi ham tuzatildi. |
| 2026-09-13 | `assignee` (bildirishnoma oʻzgarish roʻyxatida) = **masʼul** | TERMS.md `masʼul`; `ijrochi` zavod uslubi va UI ning qolgan qismidan farq qilardi. |
| 2026-09-13 | Sana/vaqt filtri chegaralari = **Qaysi sanadan / Qaysi sanagacha**, soat uchun **Qaysi soatdan / Qaysi soatgacha** | §11.38 ning davomi: tinch soatlar formasida ham hodisaning boshlanishi emas, chegara soʻraladi. |
| 2026-09-13 | `email` = **e-pochta** | «Elektron pochta» rasmiy blankda yaxshi, kanal yozuvi uchun uzun. |
| 2026-09-13 | `digest frequency` = **xulosa davriyligi** | `chastota` — fizika soʻzi. |
| 2026-09-13 | `unpin` = **mahkamlashni olib tashlash** | `Bekor qilish` undo uchun band (§5). |
| 2026-09-13 | `photos` = **suratlar** | `fotosurat` rasmiy hujjat uslubi; tadbir sahifasida `surat` tabiiy. |
| 2026-09-13 | `italic` = **kursiv**, `session` (Pomodoro) = **seans** | Ikkalasi ham tirik oʻzlashma (§12 «Saqlanadigan oʻzlashmalar»), oʻzbekchalashtirilsa sunʼiy chiqadi. |
| 2026-09-13 | Pomodoro `pause` = **toʻxtatib turish**, `stop` = **tugatish** | `Pauza` va `Toʻxtatish` bir ekranda ikki xil toʻxtashni anglatib chalkashtirardi. |
| 2026-09-13 | Carpool bildirishnomasi sarlavhasi = **Mashinada joy bor** | «Yoʻlda joy taklifi» — soʻzma-soʻz tarjima; odam «mashinamda joy bor» deydi. |
| 2026-09-13 | AI tadbir qoralamasidagi `travel` = **yoʻl** | «Yoʻl-yoʻriq» — koʻrsatma degani, safar emas. |
| 2026-09-13 | `eyebrow` yozuvlari bir soʻzga keltirildi: `BILIM` (pages), `FAQAT SIZGA` (personal), `TAQVIM` (calendar), `HISOBOTLAR` (analytics), `BOSHQARUV` (admin) | §4: eyebrow — boʻlim nomi, tavsif emas («REJA VA ESLATMALAR», «FAQAT SIZ UCHUN» tavsif edi). |
| 2026-09-13 | Super administrator panelida ijara birligi **boshqarma**, ichki boʻlinma **boʻlim** | Panel ularni teskari nomlagan edi: ijara birligi `boʻlim`, boʻlinma `boʻlinma`. |

### 17.1 uz-Cyrl ni hosil qilishda lotincha qoladigan tokenlar

`latinToCyrillic()` dan oʻtkazilmaydigan (§13.2 item 5 ning kengaytirilgan roʻyxati):
ICU `{placeholder}` lar va teglar; filtr sintaksisi (`assignee:@me`, `status:active`, `due:<today`,
`label:` kalitining oʻzi); havolalar va fayl yoʻllari (`infra/sentinel/sentinel.conf`);
`kalit=qiymat` shakli (`public_key=`); bot buyruqlari (`/connect`, `/setmenubutton`);
`SCREAMING_SNAKE` muhit oʻzgaruvchilari (`TELEGRAM_BOT_TOKEN`); klaviatura qisqartmalari (`Ctrl+K`);
mahsulot nomlari (`Telegram`, `WorkPortal`, `Google Calendar`, `Outlook`, `iPhone`, `CalDAV`,
`DAVx5`, `Webcal`, `VAPID`, `embeddings`) — bunda kirillcha qoʻshimcha nomga yopishib keladi:
`Telegramда`, `Outlookка`.

Qoʻlda tekshirilgan kirillcha tuzoqlar: `ts → ц` faqat ruscha oʻzlashmada (`муддатсиз` toʻgʻri,
`муддациз` xato), `yy → йё` (`tayyor → тайёр`, `таййор` emas), `byudjet → бюджет`.
