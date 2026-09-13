# telegram-miniapp — EPIC-015 / SPEC §9 evidence

Branch `v11/telegram-miniapp`. Every screenshot is 390 px wide (the Telegram webview target), taken
in Chrome against a live API (`apps/miniapp/scripts/dev-stack.mjs`, api :3061, Vite :5299) and the
database `devon_v11_miniapp` (a clone of `devon_demo`, so no other worktree was disturbed).

Personas: `demo.xodim` (Nodira Karimova, member) and `demo.boshliq` (Anvar Aliyev, head), in separate
isolated browser contexts.

| file | what it proves |
|---|---|
| `01-today-uz-latn-390.png` | Bugun: the private today list, add field, done/open sections, the head-or-fields "Yana" shortcuts. Each row is one `button[role=checkbox]`, 469×44, named by its own title. |
| `02-inbox-uz-latn-390.png` | Bildirishnomalar: real rows from the notification pipeline (a card reassignment made through the API two minutes earlier), reason chips, unread rail, inline Oʻqildi / Ertaga / Arxivlash. |
| `03-board-mine-uz-latn-390.png` | Doska → "Mening ustunim": my 29 cards with priority, due-risk and checklist counts. |
| `04-board-team-uz-latn-390.png` | Doska → "Boʻlim": department open/overdue totals and the per-person summary (name, title, overdue, open) — one batched query, never one per person. |
| `05-card-quick-view-uz-latn-390.png` | Card quick view: status, priority, due chip, description, checklist, comments, composer. |
| `06-card-done-and-comment-uz-latn-390.png` | The same card after a comment posted and "Bajarildi deb belgilash" tapped from inside the sheet — both persisted. |
| `07-events-rsvp-uz-latn-390.png` | Tadbirlar: date/place/attendee count, three-way RSVP, capacity chip, and the designed past/cancelled states. |
| `08-event-carpool-polls-uz-latn-390.png` | Event detail: RSVP, carpool with seats and claim/release, and the poll with vote bars. |
| `09-focus-pomodoro-uz-latn-390.png` | Fokus: phase segmented control, ring, the privacy note ("the bot never sends the task name"), today/week focus minutes. |
| `10-focus-running-uz-latn-390.png` | The same timer running — the row it wrote is in `app.pomodoro_sessions`, the personal workspace's own table. |
| `11-inbox-ru-dark-390.png` | The inbox in Russian and in the dark theme (`?locale=ru&theme=dark`). |
| `12-board-startapp-deeplink-uz-cyrl-390.png` | `?startapp=board` resolved to `#/board` — the deep link a bot `web_app` button uses — in uz-Cyrl. |
| `13-today-head-more-section-390.png` | The head's Bugun, with "Telegram sozlamasi" in the Yana section (a member never sees it). |
| `14-setup-checklist-head-390.png` | Telegram sozlamasi: bot, Mini App address with copy, the six-step checklist with per-step Tayyor/Qoldi and the linked-members progress. |
| `15-fields-empty-state-390.png` | Maydonlar with no field definitions in the department — the designed empty state, not an error (the `fields` module lands in a sibling worktree, so every read feature-detects). |
| `16-fields-notify-to-fill-390.png` | Maydonlar with definitions present: a requested+missing text field, a select, and a head-only field that says who fills it. |
| `17-no-permission-member-on-head-screen-390.png` | A member opening `#/setup`: the server answers 403 from the head-only route and the screen reads "Ruxsat yoʻq", not a crash. |
| `18-unlinked-state-390.png` | No session at all: "Hisob ulanmagan" with the instruction to get a link code — a 401 from the exchange is an instruction, not an error. |

## Written through, not just rendered

Confirmed in `devon_v11_miniapp` after driving the UI:

- `app.cards` — comment row and `done_at` from the card screen.
- `app.event_rsvps` / `app.poll_votes` — RSVP moved Balki → Boraman (count 3 → 4), vote moved option.
- `app.pomodoro_sessions` — `focus` session started and ended from the Fokus screen.
- `app.field_values` — the STIR value, with `updated_by_user_id` set.
- `app.field_requests` — the open fill request resolved by that same write.
- `audit.events` — `fields.value_set`, `personal.pomodoro_session.started`/`ended`, `events.poll_voted`,
  `notifications.created`.
- `app.notifications` — the head's `fields.value.filled` row, reason `digest`, title
  "Maydon toʻldirildi: Nodira Karimova" (the registry entry this package added).

## Keyboard and 390 px

Measured in the page, per screen (`#/`, `#/inbox`, `#/board`, `#/events`, `#/focus`, `#/fields`):
every focusable element has an accessible name, every hit target is at least 44 px, and
`documentElement.scrollWidth === clientWidth` — no horizontal scroll at 390. The first row of the
today list was focused and toggled with the keyboard alone.

## Gates

`node agentic/scripts/gate.mjs --profile fast` — typecheck, lint, unit, i18n, secrets all PASS,
nothing skipped. `pnpm --filter @devon/web build` and `pnpm --filter @devon/miniapp build` green.
`packages/db` is untouched, so `migrate:verify` does not apply.
