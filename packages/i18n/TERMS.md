<!-- GENERATED FILE. Do not edit by hand -- edit packages/i18n/terms.json and run
     `pnpm --filter @devon/i18n terms:build`. A unit test asserts this file is
     byte-identical to a fresh regeneration (AC-5). -->
# Terminology (`packages/i18n/terms.json`)

Every row below has a citable source for the Uzbek choice (AC-5): a ministry site, a job posting, a form, or a live government digital-service page. `pnpm --filter @devon/i18n terms:verify` fails the build if a row lacks a source, the source is not `https://`, or the quote does not contain the recorded word.

| id | en | uz-Latn | uz-Cyrl | ru | source |
|---|---|---|---|---|---|
| `task` | Task | Vazifa | Вазифа | Задача | [O'zbekiston Respublikasi qonun hujjatlari ma'lumotlari milliy bazasi (LexUZ) -- O'zbekiston Respublikasi Konstitutsiyasi](https://lex.uz/uz/docs/-6445145) |
| `assignment` | Assignment (handed down from a superior) | Topshiriq | Топшириқ | Поручение | [LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi (28.10.2022 tahriri)](https://lex.uz/uz/docs/-6257288) |
| `deadline` | Deadline / term | Muddat | Муддат | Срок | [LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi](https://lex.uz/uz/docs/-6445145) |
| `unit` | Unit (organisational subdivision) | Boʻlim | Бўлим | Отдел | [LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi](https://lex.uz/uz/docs/-6257288) |
| `employee` | Employee | Xodim | Ходим | Сотрудник | [LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi](https://lex.uz/uz/docs/-6257288) |
| `event` | Event | Tadbir | Тадбир | Мероприятие | [O'zbekiston Respublikasi Hisob palatasi (ach.gov.uz) -- Prezident nutqining rasmiy matni](https://ach.gov.uz/uz/events-nav/news/detail/6a92731c5795f7ed7e864c9e) |
| `approval` | Approval | Tasdiqlash | Тасдиқлаш | Утверждение | [LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi](https://lex.uz/uz/docs/-6445145) |
| `undo` | Undo / repeal | Bekor qilish | Бекор қилиш | Отменить | [LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi](https://lex.uz/uz/docs/-6445145) |
| `save` | Save | Saqlash | Сақлаш | Сохранить | [LexUZ -- document toolbar control on a live government legal-database page](https://lex.uz/uz/docs/-6257288) |
| `buyruq` | Order / decree (administrative) | Buyruq | Буйруқ | Приказ | [LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi](https://lex.uz/uz/docs/-6257288) |
| `button_register` | Button label register: verbal noun, not the polite imperative | Saqlash | Сақлаш | Сохранить | [LexUZ -- document toolbar control on a live government legal-database page](https://lex.uz/uz/docs/-6257288) |

## Sources, quoted

### `task`

> Oʻzbekiston Respublikasi Oliy Majlisining Qonunchilik palatasi va Senati, zarurat boʻlgan taqdirda, muayyan vazifalarni bajarish uchun deputatlar, senatorlar orasidan komissiyalar tuzadi.

-- O'zbekiston Respublikasi qonun hujjatlari ma'lumotlari milliy bazasi (LexUZ) -- O'zbekiston Respublikasi Konstitutsiyasi, fetched 2026-09-06T09:10:00Z. https://lex.uz/uz/docs/-6445145

Seed list per design.md §1.4 (from docs/01-research/uzbekistan-context.md §6 glossary). 'Vazifa' is the Constitution's own word for an assigned duty/task, chosen over the informal loanword 'tapshiriq' spelling variants seen in casual speech.

### `assignment`

> Uch ish kunidan kechiktirmay boshqa tarafni yozma shaklda ogohlantirgan holda xodim qoʻshimcha ishni bajarishni muddatidan oldin rad etish, ish beruvchi esa uni bajarish toʻgʻrisidagi topshiriqlarni muddatidan oldin bekor qilish huquqiga ega.

-- LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi (28.10.2022 tahriri), fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

Distinct from 'vazifa' (task): a topshiriq is specifically handed down by someone with authority over the recipient (a manager to a subordinate), matching the department-head → member direction this platform models.

### `deadline`

> Shaxs sudning qarorisiz qirq sakkiz soatdan ortiq muddat ushlab turilishi mumkin emas.

-- LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi, fetched 2026-09-06T09:10:00Z. https://lex.uz/uz/docs/-6445145

### `unit`

> UMUMIY QISM I BOʻLIM. UMUMIY QOIDALAR

-- LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi, fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

The Code uses 'boʻlim' for its own top-level structural division; the same word is the everyday term for an organisational department/unit (e.g. 'kadrlar boʻlimi' -- HR unit) and is what department heads use for their own sub-units in this product.

### `employee`

> Ish beruvchining mehnat shartlarini xodimning roziligisiz oʻzgartirish huquqi ... ish beruvchi xodim mehnat shartnomasida shart qilib koʻrsatilgan mehnat vazifasini davom ettirayotganida xodimning roziligisiz mehnat shartlarini oʻzgartirishga haqli.

-- LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi, fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

### `event`

> Hurmatli tadbir ishtirokchilari!

-- O'zbekiston Respublikasi Hisob palatasi (ach.gov.uz) -- Prezident nutqining rasmiy matni, fetched 2026-09-06T09:35:00Z. https://ach.gov.uz/uz/events-nav/news/detail/6a92731c5795f7ed7e864c9e

Sourced in the calendar/gathering sense ('event with participants'), matching this product's later use for scheduled events -- not the legal 'chora-tadbir' (measure) sense also common in statute text.

### `approval`

> Oʻzbekiston Respublikasi tarkibiga yangi davlat tuzilmalarini qabul qilish va ularning Oʻzbekiston Respublikasi tarkibidan chiqishi haqidagi qarorlarni tasdiqlash;

-- LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi, fetched 2026-09-06T09:10:00Z. https://lex.uz/uz/docs/-6445145

### `undo`

> mahalliy davlat hokimiyati vakillik organlarining qarorlarini, ular qonunchilik normalariga muvofiq boʻlmagan taqdirda, bekor qilish;

-- LexUZ -- O'zbekiston Respublikasi Konstitutsiyasi, fetched 2026-09-06T09:10:00Z. https://lex.uz/uz/docs/-6445145

I-11's undo toast reuses the same everyday verb the Constitution uses for repealing a decision -- no separate software-only word was invented.

### `save`

> MS Word ga saqlash

-- LexUZ -- document toolbar control on a live government legal-database page, fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

The seed list (design.md §1.4) gives the confirmation toast form 'Saqlandi' ('has been saved'); that is the standard perfective inflection of this same root verb, not a separate terminology choice, and is used directly in the shell (see toast.copied for the pattern this epic ships; a generic save-confirmation toast arrives with the first persisted form field, EPIC-004).

### `buyruq`

> yakka tartibdagi huquqiy hujjatlar — buyruqlar, farmoyishlar, qarorlar (bundan buyon matnda buyruqlar deb yuritiladi) qabul qilishi mumkin.

-- LexUZ -- O'zbekiston Respublikasining Mehnat kodeksi, fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

RULING (spec.md §9.0 rule 2): the Labor Code defines a buyruq as a signed individual legal act (an employer's formal order, e.g. hiring/firing/discipline). That is not what a search-and-command overlay is. The shell therefore never calls it 'buyruqlar oynasi'; it is named 'Qidirish va amallar' (search.aria) -- 'amal' (action) rather than 'buyruq' (order) for the same reason a search bar is not a chain of command.

### `button_register`

> MS Word ga saqlash

-- LexUZ -- document toolbar control on a live government legal-database page, fetched 2026-09-06T09:20:00Z. https://lex.uz/uz/docs/-6257288

RULING (spec.md §14 SEV3-1): a real government digital-service control uses the plain verbal-noun/infinitive form ('saqlash', not the polite imperative 'saqlang'). spec.md §5 follows this form ('Kirish', 'Chiqish', 'Saqlash', 'Yuborish'), which also parallels the Russian infinitive convention the research independently endorses. docs/01-research/uzbekistan-context.md's competing lint rule (bare imperative reads as blunt, prefer '-ing') is about spoken/written correspondence register, not the compact, repeatedly-scanned register of a UI button; this product follows the source evidenced here for buttons specifically.

## Banned words

The following must never appear as a whole word in any of the four message files (`packages/i18n/messages/*.json`) -- they are project-management jargon this product deliberately does not use in front of a first-time civil servant (design.md §1.4):

sprint, ticket, epic, backlog, task, спринт, тикет, эпик, таск, бэклог
