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
