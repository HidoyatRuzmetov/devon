# `@devon/miniapp` — the Telegram Mini App

v1.1 SPEC §9 / EPIC-015. A phone-sized client for the seven things a xodim opens Telegram to do:
**Bugun** (the private today list), **Bildirishnomalar** (inbox, with the inline actions),
**Doska** (my column and the department summary), the **card quick view** (done, comment),
**Tadbirlar** (RSVP, carpool, polls), **Fokus** (a Pomodoro synced with the personal workspace),
and **Mening maʼlumotlarim** (the fields the department asked this person to fill in). The head
also gets **Telegram sozlamasi**, a setup checklist.

It is a **thin client over the existing API**. Its inbox is `GET /api/v1/notifications`, its card is
`PATCH /api/v1/cards/:id`, its RSVP is `POST /api/v1/events/:id/rsvp`, its Pomodoro is
`POST /api/v1/personal/pomodoro/sessions`. Not one permission check, audit row or domain event is
re-implemented for the phone. Only three reads genuinely need a phone-shaped endpoint, and they live
in `apps/api/src/modules/telegram/miniapp.ts`.

## How signing in works

Telegram opens `https://<DEVON_PUBLIC_URL>/miniapp/` in its webview and hands the page a signed query
string (`window.Telegram.WebApp.initData`). The page posts it once, in the `X-Telegram-Init-Data`
header, to `POST /api/v1/telegram/miniapp/session`. The server verifies the HMAC against the bot
token (`miniapp-initdata.ts` — pure, and covered by
`apps/api/test/unit/telegram.miniapp-initdata.test.ts`), finds which Devon account that Telegram chat
is linked to, and mints an ordinary Devon session: the same `app.sessions` row, the same `devon_sid`
/ `devon_csrf` cookies, the same audit trail as `POST /auth/login`. The cookie is short-lived (12 h):
Telegram relaunches a Mini App constantly and re-exchanging costs one request.

**There is no "skip verification" flag**, and there must never be one — a flag like that is one
misconfigured environment away from being an authentication bypass in a government system.

## Running it in a normal browser (the documented dev path)

What the dev path replaces is the _environment_, not the identity. `src/lib/telegram.ts` stands in
for `window.Telegram.WebApp` — theme, viewport, back button, haptics, `start_param` — so every
Telegram-specific code path runs; the identity comes from the ordinary `devon_sid` cookie of whoever
is signed in on the same origin. `POST /session` answers `source: "web_session"` in that mode and the
app paints a "Namunaviy rejim" strip, so a screenshot of this path can never be mistaken for the real
thing.

```bash
# 1. A database of this app's own, cloned from an already-migrated one (this package owns no migrations)
docker exec devon-postgres psql -U postgres -c \
  "create database devon_v11_miniapp template devon_demo"

# 2. API + Vite, on ports of their own, against that database
node apps/miniapp/scripts/dev-stack.mjs      # api :3061, mini app :5299

# 3. Sign in once on the same origin, then open the app
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"login":"demo.xodim","password":"Ishonchli#2026"}' \
  http://127.0.0.1:3061/api/v1/auth/login
open http://127.0.0.1:5299/miniapp/
```

`demo.xodim` is a member, `demo.boshliq` the head (who also sees the setup checklist).

Three query parameters exist for the screenshot harness and the four-locale review, and all three
behave as the Telegram equivalent would:

| parameter                                          | what it stands in for                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `?startapp=inbox` (also `card_<id>`, `event_<id>`) | Telegram's `start_param` — how a bot button opens one screen                |
| `?theme=dark` / `?theme=light`                     | the theme Telegram reports; with neither, the host's `prefers-color-scheme` |
| `?locale=ru`                                       | forces one of the four locales over the account's own saved choice          |

## Against a real bot

With `TELEGRAM_BOT_TOKEN` set and BotFather's menu button pointed at `<DEVON_PUBLIC_URL>/miniapp/`,
the identical build runs the `source: "telegram"` path. Two details are load-bearing:

- **The public URL must be HTTPS.** Telegram rejects a message containing a `web_app` button whose
  URL is not, so every builder in `miniapp-buttons.ts` degrades to a plain `url` button below HTTPS
  rather than taking the whole notification down with it.
- **The Mini App must be same-origin with the API.** Its session is the ordinary `devon_sid` cookie,
  and a cookie set by another origin would never come back. In production the reverse proxy maps
  `/miniapp/` to `apps/miniapp/dist`; in development Vite proxies `/api` to the API.

The head's **Telegram sozlamasi** screen shows the bot username, the Mini App address (with a copy
button) and a six-step checklist of what is still missing.

## Layout

```
src/
  app.tsx              shell: Telegram theme + viewport, tab bar, boot states
  main.tsx             locale before first paint, theme before first paint
  lib/
    telegram.ts        the one place `window.Telegram` is touched, plus the dev stub
    api.ts             one network seam: same-origin, cookie-carrying, Zod-validated, timed out
    session.tsx        the sign-in exchange and the four states it can end in
    router.ts          hash routes, shared with the bot through `@devon/contracts`
    use-query.ts       the four render states every screen owes (DESIGN.md §4)
  components/          the pieces three or more screens need
  screens/             one file per screen
test/unit/             router, telegram stub, and the four-locale message gate
scripts/dev-stack.mjs  the per-worktree launcher described above
```

Strings live in `packages/i18n/messages/modules/miniapp/*.json`, four locales.
`test/unit/messages.test.ts` fails the build when the source asks for a key any locale is missing —
the repo-wide i18n gate only scans `apps/web/src`, so this app carries its own.
