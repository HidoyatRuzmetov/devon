# Realtime, calendar and web push — operations

EPIC-018 / EPIC-019, v1.1 SPEC §10. Referenced by `packages/db/migrations/1800_realtime_calendar.sql`.

Everything in this document is **optional**. A deployment that starts none of it runs the product
exactly as v1.0 did: the board polls every four seconds and says so in words, there are no calendar
subscriptions, and no browser reminders. Nothing here is on the critical path of any request.

---

## 1. Realtime (Centrifugo)

### Starting it

Centrifugo sits behind a Compose profile, so it does not start with `docker compose up`:

```bash
docker compose -f infra/docker-compose.yml --profile centrifugo up -d centrifugo
```

### The five environment variables

| Variable | Example | Meaning |
| --- | --- | --- |
| `CENTRIFUGO_WS_URL` | `wss://portal.example.uz/connection/websocket` | Browser-facing. Same-origin in production (Caddy proxies `/connection/*`); `ws://127.0.0.1:8000/connection/websocket` on a developer box. |
| `CENTRIFUGO_API_URL` | `http://centrifugo:8000` | Server-facing only. Never reached from a browser. |
| `CENTRIFUGO_API_KEY` | — | Must equal the container's `CENTRIFUGO_HTTP_API_KEY`. |
| `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` | — | Must equal the container's `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`. Signs every connection and subscription token. |
| `CENTRIFUGO_TOKEN_TTL_SECONDS` | `600` (default) | Connection-token life. Short on purpose — see below. |

`realtimeConfig().enabled` is true only when `CENTRIFUGO_WS_URL` **and** the HMAC key are both set.
`canPublish()` additionally needs the API URL and key; a deployment with only the browser half
configured has live channels that carry no server publications, which the boot log names explicitly
rather than failing silently.

Also set `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` on the container to the deployment's own origin. A
mismatch is refused at the WebSocket handshake, and the client then reports `off` — which looks
exactly like "not configured", so check this first when live mode will not come on.

### The four channel namespaces

`apps/api/src/modules/realtime/channels.ts` is the only place that builds or parses these names.

| Namespace | Carries | Presence | Client may publish |
| --- | --- | --- | --- |
| `dept:<id>` | "something in this department changed" — **ids only**, never content | no | no |
| `board:<id>` | who is on the board, and who is editing/typing | yes | no |
| `personal#<id>` | one person's inbox | no | no |
| `canvas:<id>` | live cursors and sticky sync on a shared canvas | yes | **yes** |

Two properties are worth stating plainly because they are what make this safe to run:

* **A department publication carries identifiers and nothing else.** `projectPayload()` drops every
  key that is not an id, an actor, or a list of changed field *names*. A person on the channel learns
  that card X changed; to learn *what* it says they must re-fetch it through the ordinary authorised
  endpoint, which runs `can()` and RLS as usual. So a live subscription can never widen what somebody
  is allowed to read.
* **`canvas:` is the only namespace a browser may publish to**, because a cursor at 20 Hz through an
  HTTP endpoint would be a self-inflicted denial of service. Centrifugo stamps every client
  publication with the publishing connection's own authenticated identity, so a participant cannot
  forge a colleague's cursor even there.

### Token lifetime

A connection token lasts ten minutes by default and the client refreshes it through
`GET /api/v1/realtime/token`, which re-reads the session and the memberships. So **somebody removed
from a department stops receiving its channels within one token life**, not whenever they next
reload. Subscription tokens are minted per channel by `POST /api/v1/realtime/subscribe-token`, each
behind its own `can()` call. Lengthening the TTL lengthens that window; do not raise it past an hour.

### Turning it off

Unset `CENTRIFUGO_WS_URL`. Every screen falls back to polling and says "jonli yangilanish yoqilmagan".
No data is lost and nothing needs migrating — presence and typing signals are never persisted at all.

---

## 2. Calendar feeds (ICS) and CalDAV

### What a person gets

`/calendar` → **Obunalar**. Each subscription carries three URLs for the same feed:

* **https** — for Google Calendar's "add by URL".
* **webcal://** — one click in Apple Calendar, iPhone and Outlook desktop *subscribes* instead of
  downloading a dead one-off snapshot. This is the single most common way an ICS feed gets used
  wrongly, which is why it is offered first-class rather than left for the person to construct.
* **CalDAV** — read-only, for DAVx5, Thunderbird and Evolution.

Three kinds: everything, events only, card due dates only. Twenty live feeds per person, which is a
cap against a scripted loop minting credentials, not a real limit.

### The security model, in one paragraph

**The URL is the credential, and it has to be.** A calendar application carries no session cookie and
never will, so there is nowhere else for the authority to live. The secret is 32 bytes of CSPRNG
output, base64url. Consequences an operator should know:

* Every one of these routes is `{ public: true }` (`plugins/authorize.ts`) and CSRF-exempt
  (`test/unit/csrf-guard.test.ts` lists them with the reasoning). There is no ambient cookie
  authority on them for CSRF to protect.
* An unknown, rotated or revoked secret gets a **bare 404** — never a distinguishable error, so the
  URL space cannot be probed.
* Every write verb answers **403 unconditionally**, before the body is read. CalDAV here is read-only
  by construction, not by policy.
* `app.calendar_feeds` carries **no RLS policy**, and that is deliberate and documented in
  `packages/db/src/tenancy.ts`: the secret must be resolved to a user id *before* any user context
  exists to satisfy a policy — the same bootstrap shape as `app.sessions` and `app.telegram_links`.
  Per-user visibility is enforced in the application layer by `can()` plus an explicit `user_id`
  predicate on every authenticated query.

**Renewing is revoking.** "Havolani yangilash" invalidates the old secret the instant the new one
exists; there is no undo, which is why that button asks first rather than offering one afterwards.
Tell people to renew whenever a link has been somewhere it should not have been.

`last_accessed_at` and `access_count` on each feed are the audit surface: a subscription that has
never been read, or is being read far more often than a calendar app would, is visible on the screen
that owns it.

---

## 3. Web push (VAPID)

### Keys

One keypair identifies the whole deployment to Mozilla, Google and Apple. It is generated on first
use into `app.push_vapid_keys` and kept — a self-hosted ministry box has nowhere to paste a key into.
`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in the environment win when **both** are set, for an
operator who would rather manage it outside the database.

**Rotating the keypair silently unsubscribes every browser.** There is no migration path and no
notification; everybody has to press "Eslatmalarni yoqish" again. Only rotate on a suspected
compromise.

### The service worker

Served by the API at `GET /api/v1/realtime/sw.js` with `Service-Worker-Allowed: /`, which widens its
scope to the whole origin. It is served from the API rather than shipped as a static file because
`apps/web` has no `public/` of its own; the browser reaches it at the same relative `/api/...` path in
every environment, so there is no environment-specific registration URL anywhere.

It owns three events — `push`, `notificationclick`, `install`/`activate` — and deliberately registers
**no `fetch` handler**: a worker with one sits on the critical path of every request the page makes,
and an offline cache is a decision for its own epic, not a side effect of turning reminders on.

### What is actually sent

Only four reasons: `mentioned`, `assigned`, `due`, `decision` (`PUSHABLE_REASONS` in
`modules/realtime/events.ts`). Everything else stays in the inbox. Quiet hours are honoured — the
same per-user and per-department window the inbox uses — and a suppressed push is logged at debug.

The opt-in is **per browser**, not per account: a phone and a desk machine are separate
subscriptions, each granted by its own browser prompt and revocable on its own. The screen says so
rather than pretending there is one global switch.

A push that fails with 404/410 disables that subscription row; other failures increment a counter.
The sender runs behind a circuit breaker (8 failures, 30 s reset) with a 5 s timeout, so a push
service having a bad day cannot slow the notification pipeline it rides behind.

---

## 4. Canvas sharing — the rule

`app.personal_canvases` stays **owner-only, for ever**. Migration 1800 changes no policy on it.

Sharing does not open a window onto the private canvas. The owner publishes a **copy** into exactly
one project or one event they belong to (`app.shared_canvases`, a department-owned row with its own
RLS). Participants of that project/event may open the copy, and may edit it and show a cursor on it
when `allow_edit` is true. The owner may revoke at any moment, which closes the live channel and
hides the copy; the private original is never touched by any of it.

Practical consequences, all of which the sharing dialog states in plain words before the button is
pressed:

* Later edits to the private canvas **do not travel** to the copy. They are two documents after the
  moment of sharing.
* Re-sharing the same canvas to the same target updates the existing share rather than making a
  second one nobody can tell apart (a partial unique index enforces this).
* Revoking is not undoable with one press — re-sharing makes a fresh copy — so that button asks
  first.

Who may publish where is decided by `canPublishCanvasTo()`: owner or member for a project, organiser
or an RSVP for an event, and a head may publish into anything in their own department. The target
picker in the UI narrows the list to the same rule, so a person is never offered a choice the server
will refuse — but the server is still the one that decides.

---

## 5. Troubleshooting

| Symptom | First thing to check |
| --- | --- |
| Board says "Jonli rejim oʻchiq" with Centrifugo running | `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` on the container must include the deployment's origin exactly. |
| Live mode connects then drops repeatedly | `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` must be byte-identical on both sides. |
| Presence avatars never appear, everything else is live | The `board` namespace needs `presence: true` and `allow_presence_for_subscriber: true` (see the Compose file's `CENTRIFUGO_CHANNEL_NAMESPACES`). |
| Google Calendar rejects the feed URL | It must be absolute. `DEVON_PUBLIC_URL` is what the API builds it from. |
| Calendar app shows an empty calendar | The feed's kind may be `events`/`tasks` with nothing matching yet. `GET` the https URL directly — it answers `text/calendar` and a bare 404 for a dead secret. |
| "Bu serverda eslatmalar sozlanmagan" | `GET /api/v1/push/key` returned `enabled: false` — the VAPID keypair could not be generated or read. Check the API log for the `push: VAPID keys unavailable` warning. |
| Reminders stopped arriving on one device | The push service rotated its endpoint. Opening `/calendar` re-registers whatever subscription the browser currently holds and repairs it. |
