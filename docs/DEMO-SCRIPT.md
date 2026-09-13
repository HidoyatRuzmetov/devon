# Devon (WorkPortal) — namoyish stsenariysi / Demo script

Bu hujjat — boshqaruvga (texnik boʻlmagan auditoriyaga) mahsulotni koʻrsatish uchun tayyor
stsenariy. Toʻrt tilda, uz-Latn birinchi.

| Til | Boʻlim |
|---|---|
| Oʻzbekcha (lotin) | [1. Oʻzbekcha (lotin)](#1-oʻzbekcha-lotin) |
| Ўзбекча (кирилл) | [2. Ўзбекча (кирилл)](#2-ўзбекча-кирилл) |
| Русский | [3. Русский](#3-русский) |
| English | [4. English](#4-english) |

Ekran rasmlari: [`docs/demo/`](demo/). Har bir qadam oʻz rasmiga havola qiladi.

---

## 1. Oʻzbekcha (lotin)

### 1.1. Namoyishdan oldin (5 daqiqa)

1. **Sanani tekshiring.** Maʼlumotlar toʻplami bitta kunga bogʻlangan:
   `packages/db/src/seed/clock.ts` faylidagi `DEMO_NOW`. Hozir u **2026-09-13**. Agar namoyish shu
   sanadan bir-ikki haftadan koʻproq keyin boʻlsa, oʻsha bitta qatorni yaqin yakshanbaga oʻzgartiring
   va qaytadan seed qiling — aks holda «Tahlil» sahifasidagi «oʻtgan hafta» plitkalari `0` va `-100%`
   deb koʻrsatadi (bu xato emas, maʼlumotlar haftasi oʻtib ketgani):

   ```bash
   pnpm --filter @devon/db seed:reset --demo
   pnpm --filter @devon/db seed:demo
   ```

2. **Ishga tushiring:** `pnpm start --demo`. Postgres, Valkey va Centrifugo koʻtariladi, migratsiyalar
   qoʻllanadi, demo maʼlumotlar yoziladi, keyin API va veb ishga tushadi.
3. **Sarlavhadagi «Demo maʼlumotlar» chipini** koʻrsating va aytib qoʻying: bu maxsus namoyish
   nusxasi, haqiqiy boshqarmaning maʼlumotlari emas. Barcha ismlar va hujjatlar oʻylab topilgan.
4. **Brauzer:** bitta oyna, 1440×900 dan kichik emas, masshtab 100%. Ikkita yorliq oching: asosiy
   ilova va (agar Mini App koʻrsatmoqchi boʻlsangiz) `pnpm --filter @devon/miniapp dev`.
5. **Kirish maʼlumotlari** (uchalasi ham bitta parol: `Ishonchli#2026`):

   | Login | Kim | Nima uchun kerak |
   |---|---|---|
   | `demo.boshliq` | Anvar Aliyev, boshqarma boshligʻi | Namoyishning katta qismi |
   | `demo.xodim` | Nodira Karimova, yetakchi mutaxassis | «Xodim koʻzi bilan» qismi |
   | `admin.super` | Sanjar Neʼmatov, super administrator | Faqat oxirgi 30 soniya |

### 1.2. Hikoya

> **Raqamli xizmatlar boshqarmasi** — 16 kishilik boshqarma, uchta boʻlim. Boshligʻi Anvar Aliyev.
> Ikkita boʻlimning oʻz boshligʻi bor (Jasur Qodirov, Dilnoza Rahimova), uchinchisi hozircha
> boshliqsiz — hayotda shunday boʻladi. Olti kun oldin yangi xodim keldi: Feruza Xolmatova, hozir
> moslashuv roʻyxatidan oʻtyapti. Eshik oldida yana ikki kishi turibdi — qoʻshilish soʻrovi bergan.
>
> Chorak yakuniga uch hafta qoldi. Toʻrtta loyiha bor: biri jadvalda, biri kechikyapti, biri
> tugagan, biri endi boshlandi. 85 ta vazifa, oʻntachasi muddatidan oʻtgan.
>
> Savol bitta: **boshliq dushanba kuni ertalab nimani koʻradi va nima qiladi?**

### 1.3. Rollar

| # | Ism | Lavozim | Boʻlim |
|---|---|---|---|
| 1 | Anvar Aliyev | Boshqarma boshligʻi | — |
| 2 | Jasur Qodirov | Boʻlim boshligʻi | Elektron xizmatlar |
| 3 | Otabek Norqobilov | Yetakchi muhandis (oʻrinbosar) | Elektron xizmatlar |
| 4 | Bekzod Yusupov | Dasturchi | Elektron xizmatlar |
| 5 | Sardor Mirzayev | Tarmoq muhandisi | Elektron xizmatlar |
| 6 | Farrux Saidov | Tizim administratori | Elektron xizmatlar |
| 7 | Dilnoza Rahimova | Boʻlim boshligʻi | Tahlil va hisobot |
| 8 | Madina Tosheva | Tahlilchi | Tahlil va hisobot |
| 9 | Gulnoza Ashurova | Iqtisodchi | Tahlil va hisobot |
| 10 | Sanjar Tursunov | Yetakchi mutaxassis | Tahlil va hisobot |
| 11 | Nodira Karimova | Yetakchi mutaxassis | Devonxona va huquq |
| 12 | Zarina Ergasheva | Yurist | Devonxona va huquq |
| 13 | Kamola Yoldasheva | Kadrlar boʻyicha mutaxassis | Devonxona va huquq |
| 14 | Shahnoza Neʼmatova | Matbuot kotibi | Devonxona va huquq |
| 15 | Ulugʻbek Gʻaniyev | Devonxona mudiri | Devonxona va huquq |
| 16 | Feruza Xolmatova | Kichik mutaxassis — **yangi xodim** | Devonxona va huquq |

### 1.4. 12 daqiqalik stsenariy

---

#### Qadam 1 — Kirish (0:00–1:00) · [`01-login.png`](demo/01-login.png)

**Kim:** hali hech kim.
**Qayerda:** `/login`.

**Nima qilasiz:** Til tanlagichni bosing va toʻrtta tilni koʻrsating (oʻzbekcha lotin, kirill, rus,
ingliz), keyin lotinchaga qaytaring. `demo.boshliq` / `Ishonchli#2026` bilan kiring.

**Nima deysiz:**
> «Bu — bitta boshqarma oʻz haftasini olib boradigan tizim. Oʻzimizning serverimizda turadi,
> maʼlumot tashqariga chiqmaydi. Toʻrt tilda ishlaydi — xodim qaysi tilda qulay boʻlsa, oʻshanda.
> Men boshqarma boshligʻi sifatida kiraman.»

---

#### Qadam 2 — Boshliqning dushanbasi (1:00–3:00) · [`02-head-today.png`](demo/02-head-today.png)

**Kim:** `demo.boshliq`.
**Qayerda:** bosh sahifa, «BUGUN».

**Nima qilasiz:** Hech narsa bosmang — 20 soniya shunchaki qoldiring. Keyin ketma-ket koʻrsating:

- **«Kechikayotgan ishlar»** — kim qancha kechiktirgani, ism boʻyicha. Bittasini bosing: xodimlar
  jadvaliga oʻtadi.
- **«Xavf ostida»** — ikki kun ichida muddati tugaydigan, hali bajarilmagan ishlar.
- **«Bu hafta yuklama»** — kim qanchalik band, foizda.
- **«Loyihalar»** — toʻrtta loyiha, eng orqada qolgani birinchi.

**Nima deysiz:**
> «Bu sahifani hech kim toʻldirmaydi — hammasi xodimlarning kundalik ishidan oʻzi yigʻiladi.
> Boshliq ertalab kabinetiga kirib, hisobot soʻramasdan turib boshqarmasining holatini koʻradi.
> Mana bu raqamni bosaman — va darhol kimning nimasi kechikkanini koʻraman.»

**«Wow» nuqtasi:** plitkadagi raqamni bosish → toʻgʻridan-toʻgʻri oʻsha odamning ishlari roʻyxati.
Hisobot soʻrash, kutish, Excel yigʻish yoʻq.

---

#### Qadam 3 — Doska (3:00–5:00) · [`03-board.png`](demo/03-board.png)

**Kim:** `demo.boshliq`.
**Qayerda:** yon menyudan **Vazifalar** → «Doska».

**Nima qilasiz:**

1. Doskani koʻrsating: **har bir xodimga bitta ustun**, ustunlar boʻlimlar boʻyicha guruhlangan.
2. «Elektron xizmatlar boʻlimi» sarlavhasini koʻrsating — Jasur Qodirovning boʻlimi.
3. Bitta kartani **sichqoncha bilan tortib** boshqa ustunga oʻtkazing — vazifa boshqa xodimga
   berildi. Hech qanday forma, hech qanday tasdiqlash oynasi yoʻq.
4. Kartadagi doiracha (bajarildi) belgisini bosing — **kichik animatsiya** chiqadi.
5. Pastdagi «Bekor qilish» tugmasini koʻrsating va bosing — hammasi joyiga qaytadi.

**Nima deysiz:**
> «Boshqarmaning butun haftasi bitta ekranda. Ustun — odam, karta — ish. Ishni boshqa odamga berish
> — shunchaki surib qoʻyish. Xato qildingizmi — “Bekor qilish”. Biz hech qachon “Rostdan ham
> oʻchirasizmi?” deb soʻramaymiz; oʻrniga qaytarib berish imkonini beramiz.»

**«Wow» nuqtasi:** kartani tortib oʻtkazish va bajarildi animatsiyasi. Buni albatta **sekin** qiling —
auditoriya koʻzi bilan kuzatib ulgursin.

---

#### Qadam 4 — Bitta karta (5:00–6:30) · [`16-my-work.png`](demo/16-my-work.png)

**Kim:** `demo.boshliq`.
**Qayerda:** Nodira Karimovaning ustunidan **«Shartnomani huquqiy ekspertizadan oʻtkazish»**
kartasini oching.

**Nima qilasiz va aytasiz** — kartaning oʻng tomonidagi xossalarni birma-bir:

- **«Bogʻliq»** chipi: bu ish «Shartnoma loyihasi matnini tayyorlash» tugamaguncha boshlanmaydi.
  > «Zanjir koʻrinib turibdi: matn → ekspertiza → imzoga topshirish. Kim kimni kutayotgani
  > bahs mavzusi emas, ekranda yozib qoʻyilgan.»
- **Tekshirish roʻyxati** (3/5): kichik qadamlar.
- **Izoh** va undagi **@eslatma**: Anvar Nodirani eslatgan — bu Nodiraning «Bildirishnomalar»iga
  tushgan.
- **Baholangan vaqt**: shu raqam yuqoridagi «yuklama» foiziga qoʻshiladi.
- **Takrorlanuvchi vazifa**: Nodiraning «Haftalik ijro intizomi hisobotini topshirish» kartasi har
  dushanba oʻzi qayta ochiladi.
- **Manba**: baʼzi kartalarda «Namunadan», «Telegramdan» yoki «AI» deb yozilgan.

> «Har bir karta — bir ishning toʻliq tarixi: kim bergan, kim bajarayotgan, nima kutilyapti, nima
> gaplashilgan. Hech qanday alohida jurnal yuritilmaydi.»

---

#### Qadam 5 — Loyihalar (6:30–8:00) · [`05-projects.png`](demo/05-projects.png)

**Kim:** `demo.boshliq`.
**Qayerda:** yon menyudan **Guruh loyihalari**.

**Nima qilasiz:** Toʻrtta loyihani ketma-ket koʻrsating — ular ataylab **toʻrt xil holatda**:

| Loyiha | Holati | Nima deyiladi |
|---|---|---|
| Yagona portal 2.0 | 57% — jadvalda | «Bu — normal loyiha. Keyingi bosqich 25-sentabr.» |
| Maʼlumotlar bazasi migratsiyasi | 40% — **kechikyapti** | «Bosqich sanasi 28-avgust edi, hali belgilanmagan. Ana shuni koʻrmoqchi edim.» |
| Yangi xodimlar dasturi | 0% — endi boshlandi | «Bu hafta ochildi.» |
| Fuqarolar soʻrovnomasi | 100% — tugagan | «Yopildi, Vazirlikka topshirildi.» |

Kechikayotgan loyihani oching va bosqichlarni koʻrsating.

**Nima deysiz:**
> «Loyiha rangi yoki foizi emas, **sanasi** gapiradi. Muddati oʻtgan bosqich — qizil. Boshliq uchta
> loyihani emas, bitta muammoni koʻradi.»

**«Wow» nuqtasi:** Boshliqning bosh sahifasidagi «Loyihalar» plitkasida ham xuddi shu tartib —
eng orqada qolgani birinchi turadi. Drill-down: plitka → loyiha → bosqich → karta → xodim.

---

#### Qadam 6 — Odamlar va tuzilma (8:00–9:30) · [`04-people.png`](demo/04-people.png), [`11-structure.png`](demo/11-structure.png), [`12-join-requests.png`](demo/12-join-requests.png)

**Kim:** `demo.boshliq`.

**Nima qilasiz:**

1. **Xodimlar** → boʻlimlar boʻyicha kartochkalar. «Boʻlim boshligʻi» va «Oʻrinbosar» nishonlarini
   koʻrsating. «Devonxona va huquq boʻlimi»da boshliq yoʻqligini aytib qoʻying — bu ataylab:
   > «Boʻlim boshliqsiz turishi mumkin. Tizim shundan buzilmaydi.»
2. **Tuzilma** → oʻsha uchta boʻlim sxema koʻrinishida.
3. **Xodimlar jadvali** → «Taʼlim» ustunini koʻrsating. Feruza Xolmatovaning katagi boʻsh.
   Uning qatoridagi **«Toʻldirishni soʻrash»** tugmasini bosing.
   > «Yangi xodim, olti kun boʻldi. Kadrlar boʻlimi qoʻngʻiroq qilmaydi — tizim oʻzi soʻraydi.»
   - Agar Telegram bot ulangan boʻlsa, xabar darhol **Telegramga** tushadi.
   - Ulanmagan boʻlsa, u xodimning ilovadagi **«Bildirishnomalar»**iga tushadi. Ikkalasi ham bitta
     yoʻl bilan yuboriladi — farqi faqat yetkazib berish kanalida.
4. **Boʻlim → Aʼzolar** → yuqorida **«Qoʻshilish soʻrovlari · 2»**. Aziza Raximova va Doniyor
   Eshonqulov. «Qabul qilish» tugmasini koʻrsating (bosmang — yoki bosing va «Bekor qilish»).
   > «Boshqarmaga kim kirishini boshliq hal qiladi, IT boʻlimi emas.»

---

#### Qadam 7 — Raqamlar, maqsadlar va qoidalar (9:30–10:30) · [`06-analytics.png`](demo/06-analytics.png), [`07-goals.png`](demo/07-goals.png), [`08-automations.png`](demo/08-automations.png)

**Kim:** `demo.boshliq`.

**Nima qilasiz:**

1. **Tahlil** → toʻrtta plitka (oʻtgan hafta bajarilgan, ochiq kartalar, muddati oʻtganlar, oʻz
   vaqtida bajarish). Pastda **12 haftalik grafik** — chorak boshidan buyon.
   > «Bu raqamlar hech kimdan soʻralmagan. Ular kartalardan oʻzi hisoblanadi. Demak, ularni
   > “chiroyliroq” qilib boʻlmaydi.»
2. **Maqsadlar** → uchta maqsad, uchtasi ham kartalardan oʻzi hisoblanadi:
   «Shu oyda 25 ta vazifa yakunlansin», «Muddatida bajarish 85% dan past tushmasin»,
   «Ochiq “Muhim” ishlar 15 tadan oshmasin».
3. **Qoidalar** → uchta qoida va ostida **«Bajarilishlar tarixi»**.
   > «Bir qoida yoqilgan: “Muhim” yorligʻi qoʻyilsa — muhimlik koʻtariladi. Oltita marta ishlagan,
   > mana ular. Ikkinchisi oʻchirilgan: uni yoqqanimizda boshliqning pochtasiga bir ertalabda
   > oʻnlab xabar tushdi — tarixda koʻrinib turibdi. Shuning uchun oʻchirilgan holda keladi.»

**«Wow» nuqtasi:** avtomatlashtirish nafaqat «ishladi», balki **nega ishlamadi** ham yozib boriladi
(«Karta filtrga tushmadi», «Bugun allaqachon bajarilgan»).

---

#### Qadam 8 — Xodim koʻzi bilan (10:30–11:30) · [`13-member-today.png`](demo/13-member-today.png), [`14-inbox.png`](demo/14-inbox.png), [`16-my-work.png`](demo/16-my-work.png), [`15-personal.png`](demo/15-personal.png)

**Kim:** chiqing va `demo.xodim` (Nodira Karimova) bilan kiring.

**Nima qilasiz:**

1. **Bosh sahifa** — boshqacha ekran: «Mendan kutilmoqda 7», «Atrofimda 1 tadbir». Boshliqning
   raqamlari yoʻq.
   > «Bir xil tizim, lekin xodim boshqa narsani koʻradi: unga tegishlisini.»
2. **Bildirishnomalar** — sabablar boʻyicha guruhlangan: topshiriq, eslatish, muddat, ishtirok.
   Bittasini bosing — toʻgʻri kartaga olib boradi.
3. **Vazifalar → Mening vazifalarim** — yuqorida **«Diqqat markazi»** (5 tagacha asosiy ish),
   ostida muddati oʻtganlar, keyin qolganlari.
4. **Shaxsiy** — sprint, vazifalar, qaydlar, Pomodoro.
   > «Bu boʻlim — faqat oʻziniki. Boshliq ham, super administrator ham bu yerni koʻra olmaydi.
   > Bu texnik cheklov, siyosat emas: maʼlumotlar bazasining oʻzi ruxsat bermaydi.»

---

#### Qadam 9 — AI, tadbirlar, Mini App va yakun (11:30–12:00) · [`10-ai.png`](demo/10-ai.png), [`09-events.png`](demo/09-events.png), [`18-miniapp.png`](demo/18-miniapp.png), [`17-admin.png`](demo/17-admin.png)

Tez, har biriga ~15 soniya.

1. **AI** (boshliq sifatida): yoqilgan imkoniyatlar roʻyxati va **sarf** jadvali.
   > «AI — davlatning oʻz GLM modelida. Har bir soʻrov qancha turgani yozib boriladi. Yoqish yoki
   > oʻchirish — boshliqning qoʻlida.»
2. **Tadbirlar**: oʻtgan koʻngillilar kuni (rasmlar va fikrlar bilan), oldindagi piknik (avtomobil
   ulashish va sana soʻrovnomasi), voleybol turniri (joylar toʻlgan — navbat), Excel treningi.
   > «Boshqarma faqat ish emas. Kim kim bilan boradi, kim nima olib keladi — hammasi shu yerda.»
3. **Mini App** (agar tayyorlangan boʻlsa): telefonda Telegram ichida — bugungi ishlar, xabarlar,
   doska, fokus.
4. **Super administrator** (`admin.super`): boʻlimlar roʻyxati, toʻxtatish va oʻchirish tugmalari.
   > «Butun instansiyaning kaliti bitta odamda. Boʻlimni toʻxtatish, arxivlash yoki butunlay
   > oʻchirish — hammasi jurnalga yoziladi.»

**Yakuniy jumla:**
> «Koʻrganingiz — bitta boshqarmaning bitta haftasi. Hech kim hisobot yozmadi, hech kim Excel
> yigʻmadi. Boshliq ertalab kirdi va nima boʻlayotganini koʻrdi. Bizga kerak boʻlgani — shu.»

### 1.5. 3 daqiqalik qisqa variant

| Vaqt | Qadam |
|---|---|
| 0:00–0:20 | `demo.boshliq` bilan kiring, «Demo maʼlumotlar» chipini aytib oʻting. |
| 0:20–1:10 | **Bosh sahifa**: «Kechikayotgan ishlar» plitkasidagi ismni bosing → xodimlar jadvali. |
| 1:10–2:00 | **Vazifalar → Doska**: bitta kartani tortib oʻtkazing, bittasini bajarildi qiling, «Bekor qilish». |
| 2:00–2:40 | **Guruh loyihalari**: toʻrtta holat — jadvalda, kechikyapti, boshlandi, tugadi. |
| 2:40–3:00 | **Tahlil**: 12 haftalik grafik. «Bu raqamlar hech kimdan soʻralmagan.» |

### 1.6. Nimalarni qilmaslik kerak

- **Yangi maʼlumot kiritmang.** Stsenariy mavjud maʼlumot ustida quriladi; yangi karta yaratsangiz
  raqamlar siljiydi va keyingi qadamdagi gapingiz toʻgʻri kelmay qoladi.
- **«Oʻchirish» tugmalarini bosmang** (ayniqsa super administratorda).
- **Ekranni kattalashtirmang** — doska ustunlari siljiydi.
- Agar biror raqam kutilganidan farq qilsa, **sababi deyarli har doim sana**: 1.1-boʻlimdagi
  `DEMO_NOW` ni tekshiring.

---

## 2. Ўзбекча (кирилл)

### 2.1. Намойишдан олдин (5 дақиқа)

1. **Санани текширинг.** Маълумотлар тўплами битта кунга боғланган: `packages/db/src/seed/clock.ts`
   файлидаги `DEMO_NOW`. Ҳозир у **2026-09-13**. Агар намойиш шу санадан бир-икки ҳафтадан кўпроқ
   кейин бўлса, ўша битта қаторни яқин якшанбага ўзгартиринг ва қайтадан seed қилинг — акс ҳолда
   «Таҳлил» саҳифасидаги «ўтган ҳафта» плиткалари `0` ва `-100%` деб кўрсатади:

   ```bash
   pnpm --filter @devon/db seed:reset --demo
   pnpm --filter @devon/db seed:demo
   ```

2. **Ишга туширинг:** `pnpm start --demo`.
3. **Сарлавҳадаги «Demo маълумотлар» чипини** кўрсатинг: бу махсус намойиш нусхаси, ҳақиқий
   бошқарманинг маълумотлари эмас. Барча исмлар ўйлаб топилган.
4. **Браузер:** битта ойна, 1440×900 дан кичик эмас, масштаб 100%.
5. **Кириш маълумотлари** (учаласи ҳам битта парол: `Ishonchli#2026`):

   | Логин | Ким | Нима учун керак |
   |---|---|---|
   | `demo.boshliq` | Анвар Алиев, бошқарма бошлиғи | Намойишнинг катта қисми |
   | `demo.xodim` | Нодира Каримова, етакчи мутахассис | «Ходим кўзи билан» қисми |
   | `admin.super` | Санжар Неъматов, супер администратор | Фақат охирги 30 сония |

### 2.2. Ҳикоя

> **Рақамли хизматлар бошқармаси** — 16 кишилик бошқарма, учта бўлим. Бошлиғи Анвар Алиев. Иккита
> бўлимнинг ўз бошлиғи бор (Жасур Қодиров, Дилноза Раҳимова), учинчиси ҳозирча бошлиқсиз. Олти кун
> олдин янги ходим келди: Феруза Холматова, ҳозир мослашув рўйхатидан ўтяпти. Эшик олдида яна икки
> киши турибди — қўшилиш сўрови берган.
>
> Чорак якунига уч ҳафта қолди. Тўртта лойиҳа: бири жадвалда, бири кечикяпти, бири тугаган, бири энди
> бошланди. 85 та вазифа, ўнтачаси муддатидан ўтган.
>
> Савол битта: **бошлиқ душанба куни эрталаб нимани кўради ва нима қилади?**

### 2.3. 12 дақиқалик сценарий

| Вақт | Ким | Қаерда | Нима қилинади | Нима дейилади |
|---|---|---|---|---|
| 0:00–1:00 | — | `/login` | Тил танлагични кўрсатинг (тўрт тил), `demo.boshliq` билан киринг | «Бу — битта бошқарма ўз ҳафтасини олиб борадиган тизим. Ўзимизнинг серверимизда туради.» |
| 1:00–3:00 | бошлиқ | Бош саҳифа | «Кечикаётган ишлар» → исмни босинг; «Хавф остида»; «Бу ҳафта юклама»; «Лойиҳалар» | «Бу саҳифани ҳеч ким тўлдирмайди — ҳаммаси кундалик ишдан ўзи йиғилади.» |
| 3:00–5:00 | бошлиқ | Вазифалар → Доска | Ҳар ходимга битта устун, бўлимлар бўйича гуруҳ; битта картани **тортиб** ўтказинг; биттасини бажарилди қилинг; «Бекор қилиш» | «Устун — одам, карта — иш. Хато қилдингизми — “Бекор қилиш”.» |
| 5:00–6:30 | бошлиқ | Нодиранинг «Шартномани ҳуқуқий экспертизадан ўтказиш» картаси | «Боғлиқ» чипи, текшириш рўйхати, изоҳ ва @эслатма, баҳоланган вақт, такрорланувчи вазифа, манба | «Занжир кўриниб турибди: матн → экспертиза → имзога топшириш.» |
| 6:30–8:00 | бошлиқ | Гуруҳ лойиҳалари | Тўртта ҳолат: 57% жадвалда, 40% кечикяпти (босқич санаси ўтган), 0% бошланди, 100% тугади | «Лойиҳа ранги эмас, **санаси** гапиради.» |
| 8:00–9:30 | бошлиқ | Ходимлар, Тузилма, Ходимлар жадвали, Бўлим → Аъзолар | «Бўлим бошлиғи»/«Ўринбосар» нишонлари; бошлиқсиз бўлим; Ферузанинг бўш «Таълим» катаги → «Тўлдиришни сўраш»; «Қўшилиш сўровлари · 2» | «Янги ходим, олти кун бўлди. Тизим ўзи сўрайди.» |
| 9:30–10:30 | бошлиқ | Таҳлил, Мақсадлар, Қоидалар | Тўртта плитка, 12 ҳафталик график; учта мақсад; қоидалар ва «Бажарилишлар тарихи» | «Бу рақамлар ҳеч кимдан сўралмаган — картaлардан ўзи ҳисобланади.» |
| 10:30–11:30 | `demo.xodim` | Бош саҳифа, Билдиришномалар, Менинг вазифаларим, Шахсий | Бошқа рақамлар; сабаблар бўйича гуруҳ; «Диққат маркази»; спринт ва Помодоро | «Шахсий бўлим — фақат ўзиники. Бошлиқ ҳам кўра олмайди. Бу техник чеклов.» |
| 11:30–12:00 | бошлиқ / `admin.super` | AI, Тадбирлар, Mini App, Бошқарув | AI сарфи; кўнгиллилар куни (расмлар), пикник (авто улашиш, сўровнома), навбат; телефонда Mini App; бўлимни тўхтатиш | «Кўрганингиз — битта бошқарманинг битта ҳафтаси. Ҳеч ким ҳисобот ёзмади.» |

### 2.4. 3 дақиқалик қисқа вариант

| Вақт | Қадам |
|---|---|
| 0:00–0:20 | `demo.boshliq` билан киринг. |
| 0:20–1:10 | **Бош саҳифа**: «Кечикаётган ишлар» плиткасидаги исмни босинг. |
| 1:10–2:00 | **Доска**: битта картани тортиб ўтказинг, биттасини бажарилди қилинг, «Бекор қилиш». |
| 2:00–2:40 | **Гуруҳ лойиҳалари**: тўртта ҳолат. |
| 2:40–3:00 | **Таҳлил**: 12 ҳафталик график. |

### 2.5. Нималарни қилмаслик керак

- Янги маълумот киритманг — рақамлар силжийди.
- «Ўчириш» тугмаларини босманг.
- Экранни катталаштирманг.
- Рақам кутилганидан фарқ қилса, сабаби деярли ҳар доим сана: `DEMO_NOW` ни текширинг.

---

## 3. Русский

### 3.1. Перед демонстрацией (5 минут)

1. **Проверьте дату.** Набор данных привязан к одному дню — `DEMO_NOW` в
   `packages/db/src/seed/clock.ts`. Сейчас это **2026-09-13**. Если показ проходит больше чем через
   неделю-две после этой даты, измените одну строку на ближайшее воскресенье и пересейдите — иначе
   плитки «за прошлую неделю» на странице «Аналитика» покажут `0` и `-100%` (это не ошибка: неделя
   данных просто прошла):

   ```bash
   pnpm --filter @devon/db seed:reset --demo
   pnpm --filter @devon/db seed:demo
   ```

2. **Запуск:** `pnpm start --demo`.
3. **Покажите чип «Demo maʼlumotlar»** в шапке: это специальная демонстрационная копия, а не данные
   реального управления. Все имена вымышлены.
4. **Браузер:** одно окно, не меньше 1440×900, масштаб 100%.
5. **Учётные записи** (у всех троих один пароль: `Ishonchli#2026`):

   | Логин | Кто | Зачем |
   |---|---|---|
   | `demo.boshliq` | Анвар Алиев, начальник управления | Бо́льшая часть показа |
   | `demo.xodim` | Нодира Каримова, ведущий специалист | Блок «глазами сотрудника» |
   | `admin.super` | Санжар Нематов, суперадминистратор | Последние 30 секунд |

### 3.2. История

> **Управление цифровых услуг** — 16 человек, три отдела. Начальник — Анвар Алиев. У двух отделов
> есть свои начальники (Жасур Кодиров, Дилноза Рахимова), третий пока без начальника — так бывает.
> Шесть дней назад пришёл новый сотрудник: Феруза Холматова, сейчас проходит адаптацию. У двери ещё
> двое — подали заявку на вступление.
>
> До конца квартала три недели. Четыре проекта: один идёт по плану, один отстаёт, один завершён,
> один только начался. 85 задач, около десяти просрочены.
>
> Вопрос один: **что начальник видит в понедельник утром и что он с этим делает?**

### 3.3. Сценарий на 12 минут

| Время | Кто | Где | Что делать | Что говорить |
|---|---|---|---|---|
| 0:00–1:00 | — | `/login` | Показать переключатель языка (четыре языка), войти как `demo.boshliq` | «Это система, в которой одно управление ведёт свою неделю. Стоит на нашем сервере, данные наружу не уходят.» |
| 1:00–3:00 | начальник | Главная | «Просроченные» → нажать на имя; «Под риском»; «Загрузка на неделю»; «Проекты» | «Эту страницу никто не заполняет — всё собирается из ежедневной работы само.» |
| 3:00–5:00 | начальник | Задачи → Доска | По колонке на человека, сгруппированы по отделам; **перетащить** карточку; отметить одну выполненной; «Отменить» | «Колонка — человек, карточка — работа. Ошиблись — “Отменить”. Мы не спрашиваем “вы уверены?”, мы даём вернуть.» |
| 5:00–6:30 | начальник | Карточка «Провести правовую экспертизу договора» у Нодиры | Чип «Заблокировано», чек-лист, комментарий с @упоминанием, оценка времени, повторяющаяся задача, источник | «Цепочка видна: текст → экспертиза → на подпись. Кто кого ждёт — не предмет спора, это написано на экране.» |
| 6:30–8:00 | начальник | Групповые проекты | Четыре состояния: 57% по плану, 40% отстаёт (дата этапа прошла), 0% только начат, 100% завершён | «Говорит не цвет проекта, а **дата**. Просроченный этап — красный.» |
| 8:00–9:30 | начальник | Сотрудники, Структура, Таблица сотрудников, Отдел → Участники | Значки «Начальник отдела»/«Заместитель»; отдел без начальника; пустая ячейка «Образование» у Ферузы → «Запросить заполнение»; «Заявки на вступление · 2» | «Новый сотрудник, шесть дней. Кадры не звонят — система спрашивает сама.» |
| 9:30–10:30 | начальник | Аналитика, Цели, Правила | Четыре плитки, график за 12 недель; три цели; правила и «История срабатываний» | «Эти цифры ни у кого не запрашивали. Они считаются из карточек — значит, их нельзя “причесать”.» |
| 10:30–11:30 | `demo.xodim` | Главная, Уведомления, Мои задачи, Личное | Другие цифры; группировка по причинам; «Фокус»; спринт и Помодоро | «Личный раздел — только его. Ни начальник, ни суперадминистратор туда не попадут. Это техническое ограничение, не политика.» |
| 11:30–12:00 | начальник / `admin.super` | AI, Мероприятия, Mini App, Управление | Расходы на AI; субботник с фото и отзывами, пикник (попутчики, опрос), лист ожидания; Mini App на телефоне; приостановка отдела | «Вы увидели одну неделю одного управления. Никто не писал отчёт и не собирал Excel.» |

### 3.4. Короткая версия на 3 минуты

| Время | Шаг |
|---|---|
| 0:00–0:20 | Войти как `demo.boshliq`. |
| 0:20–1:10 | **Главная**: нажать имя в плитке «Просроченные». |
| 1:10–2:00 | **Доска**: перетащить карточку, отметить выполненной, «Отменить». |
| 2:00–2:40 | **Групповые проекты**: четыре состояния. |
| 2:40–3:00 | **Аналитика**: график за 12 недель. |

### 3.5. Чего не делать

- Не вводите новые данные — цифры сдвинутся, и следующая реплика перестанет совпадать с экраном.
- Не нажимайте кнопки удаления (особенно у суперадминистратора).
- Не увеличивайте масштаб — колонки доски разъедутся.
- Если цифра отличается от ожидаемой, причина почти всегда в дате: проверьте `DEMO_NOW`.

---

## 4. English

### 4.1. Before the demo (5 minutes)

1. **Check the date.** The dataset is anchored to one day — `DEMO_NOW` in
   `packages/db/src/seed/clock.ts`, currently **2026-09-13**. If you are presenting more than a week
   or two after that, move that one line to the coming Sunday and re-seed; otherwise the "last week"
   tiles on the Analytics page read `0` and `-100%` (not a bug — the dataset's week has simply gone
   by):

   ```bash
   pnpm --filter @devon/db seed:reset --demo
   pnpm --filter @devon/db seed:demo
   ```

2. **Boot:** `pnpm start --demo`.
3. **Point at the "Demo maʼlumotlar" chip** in the header and say so out loud: this is a
   demonstration copy, not a real department's data. Every name is invented.
4. **Browser:** one window, at least 1440×900, zoom at 100%.
5. **Logins** (all three share one password: `Ishonchli#2026`):

   | Login | Who | What it is for |
   |---|---|---|
   | `demo.boshliq` | Anvar Aliyev, head of the department | Most of the demo |
   | `demo.xodim` | Nodira Karimova, senior specialist | The "through a colleague's eyes" block |
   | `admin.super` | Sanjar Neʼmatov, super admin | The last 30 seconds only |

### 4.2. The story

> **Raqamli xizmatlar boshqarmasi** (Digital Services Department) — sixteen people in three units.
> Anvar Aliyev heads it. Two units have their own heads (Jasur Qodirov, Dilnoza Rahimova); the third
> has none at the moment, which is what a real department looks like between appointments. Six days
> ago a new colleague arrived — Feruza Xolmatova, currently working through her onboarding checklist.
> Two more people are waiting at the door with join requests.
>
> Three weeks remain in the quarter. Four projects: one on track, one slipping, one finished, one
> just started. 85 cards, about ten of them overdue.
>
> One question: **what does the head see on Monday morning, and what does he do about it?**

### 4.3. The 12-minute script

| Time | Who | Where | What to do | What to say |
|---|---|---|---|---|
| 0:00–1:00 | — | `/login` | Show the language switcher (four locales), sign in as `demo.boshliq` | "This is where one department runs its week. It sits on our own server; nothing leaves the building." |
| 1:00–3:00 | head | Home | "Overdue" → click a name; "At risk"; "Workload this week"; "Projects" | "Nobody fills this page in. It assembles itself out of what people did this week." |
| 3:00–5:00 | head | Work → Board | One column per person, grouped by unit; **drag** a card across; mark one done; "Undo" | "A column is a person, a card is a piece of work. Made a mistake? Undo. We never ask 'are you sure' — we let you take it back." |
| 5:00–6:30 | head | Nodira's card "Shartnomani huquqiy ekspertizadan oʻtkazish" | The "blocked" chip, checklist, comment with an @mention, estimate, the recurring card, the source | "The chain is on screen: draft → review → send for signature. Who is waiting on whom is not a matter of opinion." |
| 6:30–8:00 | head | Group projects | Four shapes: 57% on track, 40% slipping (milestone date has passed), 0% just started, 100% done | "It is the **date** that talks, not the colour. An overdue milestone is red, and the head sees one problem rather than four projects." |
| 8:00–9:30 | head | People, Structure, People table, Department → Members | "Unit head"/"Deputy" badges; the headless unit; Feruza's empty "Education" cell → "Ask to fill in"; "Join requests · 2" | "Six days in. HR does not phone her — the system asks, and it reaches her wherever she already is." |
| 9:30–10:30 | head | Analytics, Goals, Rules | Four tiles, the 12-week chart; three goals; the rules and their run log | "Nobody was asked for these numbers. They are computed from the cards, which is exactly why they cannot be tidied up." |
| 10:30–11:30 | `demo.xodim` | Home, Inbox, My work, Personal | Different numbers; grouped by reason; the focus list; the sprint and Pomodoro | "The personal space is hers alone. Neither the head nor the super admin can look into it — and that is a database constraint, not a policy." |
| 11:30–12:00 | head / `admin.super` | AI, Events, Mini App, Admin | AI spend; the past volunteering day with photos and feedback, the picnic with carpooling and a date poll, the waitlist; the Mini App on a phone; pausing a department | "What you have seen is one week of one department. Nobody wrote a report and nobody assembled a spreadsheet." |

### 4.4. The 3-minute version

| Time | Step |
|---|---|
| 0:00–0:20 | Sign in as `demo.boshliq`; mention the demo chip. |
| 0:20–1:10 | **Home**: click a name in the "Overdue" tile → straight to that person's work. |
| 1:10–2:00 | **Board**: drag one card across, mark one done, then Undo. |
| 2:00–2:40 | **Group projects**: the four shapes — on track, slipping, started, finished. |
| 2:40–3:00 | **Analytics**: the 12-week chart. "Nobody was asked for these numbers." |

### 4.5. What not to do

- **Do not enter new data.** The script is built on what is already there; a new card moves the
  numbers and your next line stops matching the screen.
- **Do not press any delete button**, least of all in the super admin console.
- **Do not zoom** — the board columns reflow.
- If a number is not what you expected, the cause is almost always the date: check `DEMO_NOW`.

---

## Ekran rasmlari / Screenshots

Barchasi ishlayotgan ilovadan olingan (Playwright, 1440×900), `docs/demo/`:

| Fayl | Ekran |
|---|---|
| [`01-login.png`](demo/01-login.png) | Kirish sahifasi |
| [`02-head-today.png`](demo/02-head-today.png) | Boshliqning bosh sahifasi — «BUGUN» |
| [`03-board.png`](demo/03-board.png) | Doska, boʻlimlar boʻyicha guruhlangan |
| [`04-people.png`](demo/04-people.png) | Xodimlar, boʻlimlar boʻyicha |
| [`05-projects.png`](demo/05-projects.png) | Toʻrtta loyiha, toʻrt holatda |
| [`06-analytics.png`](demo/06-analytics.png) | Tahlil — plitkalar va 12 haftalik grafik |
| [`07-goals.png`](demo/07-goals.png) | Maqsadlar |
| [`08-automations.png`](demo/08-automations.png) | Qoidalar va bajarilishlar tarixi |
| [`09-events.png`](demo/09-events.png) | Tadbirlar |
| [`10-ai.png`](demo/10-ai.png) | AI — imkoniyatlar va sarf |
| [`11-structure.png`](demo/11-structure.png) | Tuzilma — uchta boʻlim |
| [`12-join-requests.png`](demo/12-join-requests.png) | Qoʻshilish soʻrovlari va aʼzolar |
| [`13-member-today.png`](demo/13-member-today.png) | Xodimning bosh sahifasi |
| [`14-inbox.png`](demo/14-inbox.png) | Bildirishnomalar |
| [`15-personal.png`](demo/15-personal.png) | Shaxsiy ish maydoni |
| [`16-my-work.png`](demo/16-my-work.png) | Mening vazifalarim — diqqat markazi |
| [`17-admin.png`](demo/17-admin.png) | Super administrator konsoli |
| [`18-miniapp.png`](demo/18-miniapp.png) | Telegram Mini App |

## Maʼlumotlar toʻplami haqida / About the dataset

Namoyish maʼlumotlari `packages/db/src/seed/` da, `pnpm start --demo` bilan yoziladi. Qisqacha:

| Nima | Qancha |
|---|---|
| Boshqarma | «Raqamli xizmatlar boshqarmasi» (+ namoyish uchun yana 5 ta boʻlim) |
| Xodimlar | 16 nafar (shu jumladan 1 boshqarma boshligʻi, 2 boʻlim boshligʻi, 1 oʻrinbosar, 1 yangi xodim) |
| Boʻlimlar | 3 ta (bittasi ataylab boshliqsiz) |
| Qoʻshilish soʻrovlari | 2 ta, kutmoqda |
| Vazifalar | 85 ta (40 ochiq, 43 bajarilgan, 2 arxivda; ochiqlaridan ~10 tasi muddati oʻtgan) |
| Loyihalar | 4 ta: jadvalda / kechikyapti / tugagan / endi boshlandi |
| Maqsadlar | 3 ta, kartalardan hisoblanadi |
| Qoidalar | 3 ta (1 yoqilgan) + 9 qatorli bajarilishlar tarixi |
| Tadbirlar | 5 ta: koʻngillilar kuni (rasm + fikr), piknik (avto + soʻrovnoma), voleybol (navbat), trening, bekor qilingan sayohat |
| Maxsus maydonlar | 2 ta xodim maydoni (14/16 toʻldirilgan) + 1 ta karta maydoni, 2 ta toʻldirish soʻrovi ochiq |
| Tahlil tarixi | 85 kun (12 hafta) |
| AI | Yoqilgan imkoniyatlar + bir oylik sarf jadvali |

Barchasi **oʻylab topilgan**: hech bir ism, hujjat yoki raqam haqiqiy boshqarmaga tegishli emas.
`seed:demo` va `seed:reset --demo` idempotent — ikkinchi marta ishga tushirish hech narsa
yozmaydi/oʻchirmaydi, `pnpm --filter @devon/db test:seed-idempotence` buni tekshiradi.
