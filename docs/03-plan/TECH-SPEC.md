# Devon — Technical Design Document (v2, final for build)

2026-09-05. Supersedes v1. Binding for every maker and verifier. Evidence lives in
`docs/01-research/` (cited as [file]); the product view is `FEATURE-PLAN.md`; the visual contract is
`DESIGN.md`; the master task list is `TASKS.md`; the production-hardening checklist is
`agentic/HARDENING.md`. Decisions from the CTO are in §19 and are frozen.

---

## 0. What it is, in one screen

A self-hosted platform where **a department runs its week**: a board with a column per person,
group projects, a personal workspace with sprints and a Pomodoro, events with RSVP, carpooling and
polls, an inbox and a Telegram bot, analytics anyone in the department can filter, and AI helpers
that actually think. One **super admin** runs the instance. **Anyone can register**; a fresh account
then **creates a department** (approved once by the super admin, the creator becomes its head) or
**joins one** with a key and a password. Inside a department **everyone can shape the structure**
(bo'limlar, sub-bo'limlar, self-assigned roles) unless the head turns that off. No ministry layer, no
HR module, no document registry, no chat.

Non-functional targets (verified by gates, §12):

| Area | Target |
|---|---|
| Availability | 99.5 % monthly on one server; zero-downtime deploys; pause switch instead of outages |
| Latency | p95 API < 150 ms for lists/details; every interaction optimistic; navigation instant |
| Scale | 200 departments × 300 people × 100k cards per instance without schema change |
| Accessibility | WCAG 2.2 AA, keyboard-complete, axe 0 serious/critical |
| i18n | uz-Latn (default), uz-Cyrl, ru, en, each 100 % (gate enforces four-way parity) |
| Security | OWASP ASVS 5.0 L2; `agentic/HARDENING.md` fully applied; cross-tenant isolation test in CI |
| Data residency | everything on the ministry server; AI on the government GPU cluster |
| Bundle | shell ≤ 200 kB gzip, route chunks lazy, Lighthouse ≥ 90 on the six main routes |
| Offline | read cache + visible write queue; destructive actions refuse offline |

---

## 1. Architecture and stack

```
 Browser (SPA) ─┐                                     ┌─ Postgres 17 (RLS, FTS+pg_trgm, pgvector, pg-boss)
 Telegram      ─┼─ Caddy (TLS) ─► apps/api (Fastify 5) ┼─ MinIO (S3)  ─ ClamAV
 Mini App/Bot  ─┘        │           ├ auth (sessions, 2FA)   ├─ Valkey (sessions, cache, rate limits)
                         │           ├ REST v1 + OpenAPI      └─ Centrifugo 6 (realtime fan-out)
                         │           ├ Telegram webhook (grammY)
                         │           └ AI gateway ─► GLM-5.2 @ https://api-llm.gpu.uz/v1 (gov GPU cluster)
                         │      apps/api worker (pg-boss): reminders, digests, AI jobs, scans, thumbnails,
                         │           outbox → notifications/Telegram/Centrifugo, audit anchoring
                         └─ infra/sentinel (host-level): pause/wipe executor, reachable only from localhost
```

### 1.1 Monorepo (pnpm workspaces + Turborepo)

```
apps/web            Vite 8 + React 19.2 + TanStack Router SPA (routes incl. /join/:key, /admin, /m for Telegram Mini App)
apps/api            Fastify 5: REST, sessions/auth, realtime publish, Telegram webhook; src/worker.ts for pg-boss jobs
packages/db         Drizzle schema, RLS policies, migrations, seed (--demo)
packages/contracts  Zod schemas + types for every DTO, event, filter grammar; CASL abilities
packages/ui         design system (shadcn-style on Base UI/Radix), tokens, icons, motion presets, illustrations
packages/i18n       Paraglide messages uz-Latn/uz-Cyrl/ru/en, TERMS.md, formatting helpers
packages/ai         GLM gateway, prompts, tool schemas, eval sets (promptfoo)
packages/config     tsconfig, eslint (flat), prettier, size-limit presets
e2e/                Playwright: routes.json, ritual specs, a11y, realtime, offline, load (k6)
infra/              docker-compose.yml, Caddyfile, pgbackrest, clamav, sentinel/, scripts/
agentic/  plugins/  delivery system (protocol, gates, HARDENING.md) and its plugin form
docs/               reference, research, plan (this file, FEATURE-PLAN, TASKS, backlog), escalations, ADRs
```

### 1.2 Pinned versions (exact, no `^`) [tech-frontend-stack-deep-dive; tech-backend-stack-deep-dive]

| Layer | Package | Version | Note |
|---|---|---|---|
| Build | Vite | 8.0.x | Rolldown |
| UI | React / react-dom, React Compiler | 19.2.x / 1.0 | `<Activity>` for kept-alive panels |
| Routing/data | @tanstack/react-router, react-query 5.101.x, react-table 9.2.x, react-form 1.x, react-virtual 3.x | pinned | provenance checks in CI |
| Styling | Tailwind CSS 4.x, shadcn CLI 3.x on Base UI 1.0 (Radix where already used) | pinned | CSS-first tokens |
| Validation | Zod 4.5.x | pinned | shared client/server |
| i18n | Paraglide JS 2.x, date-fns 4.x | pinned | four locales |
| Motion | motion 12.x, NumberFlow, Sonner, Vaul, cmdk, react-hotkeys-hook | pinned | tokens in DESIGN.md |
| Boards/canvas | @atlaskit/pragmatic-drag-and-drop, fractional-indexing, Excalidraw (MIT), FullCalendar 7, Recharts 3, vendored d3-org-chart | pinned | tldraw rejected (licence) |
| Editor | Tiptap 3.31 (+ @tiptap/markdown) | pinned | LWW autosave, versions |
| API | Fastify 5.x, fastify-type-provider-zod, @fastify/swagger, @fastify/helmet, @fastify/rate-limit, @fastify/compress, @fastify/cookie, pino 9 | pinned | |
| Auth | node-argon2, otplib, @simplewebauthn/server (optional passkeys) | pinned | built-in sessions |
| DB | Postgres 17, Drizzle ORM, pgvector 0.8, pg-boss 10.x | pinned | RLS via `pgPolicy` |
| Realtime | Centrifugo 6.x, centrifuge-js | pinned | |
| Cache | Valkey 9.x | pinned | |
| Files | MinIO, ClamAV, sharp | pinned | presigned uploads |
| Telegram | grammY 1.46.x, @telegram-apps/sdk 3.11.x | pinned | Bot API 10.3 |
| AI | openai-compatible client via Vercel AI SDK 7, promptfoo | pinned | `glm-5.2` |
| Tests | Vitest 4.x, Playwright 1.5x, Storybook 9 + addon-vitest, MSW 2, Testcontainers 12, k6, Lighthouse CI, axe | pinned | |
| Lint/sec | ESLint 9 flat + typescript-eslint, Prettier 3.7, Semgrep, Trivy, Renovate (self-hosted) | pinned | |

---

## 2. Accounts, departments, roles

### 2.1 Accounts (self-registration)

- Register with **login** (email or a chosen username; email optional so a server without SMTP still
  works), **password** (argon2id, ≥ 12 chars, breach-list check, no composition rules), **name**
  (given name, family name, optional patronymic), **photo** (optional; presigned upload, ClamAV, 512 px
  WebP variants), **title / lavozim** (optional free text), **locale** (default from browser among the
  four), **timezone** (default Asia/Tashkent).
- A new account has **no role and no department**: it lands on "Create a department or join one".
- Sessions: server-side (Postgres row + Valkey), `HttpOnly; Secure; SameSite=Lax` cookie, sliding
  12 h idle / 30 d absolute, device list with "sign out everywhere", CSRF double-submit token, login
  rate limit and progressive lockout with audit, no account enumeration on login/reset.
- **2FA optional for everyone** (decision 13): TOTP app or a code via the linked Telegram; recovery
  codes; recommended in Settings, never forced.
- **Password reset**: by the super admin (temporary password, forced change at next login) or, if
  Telegram is linked, a one-time code sent by the bot. No email reset unless SMTP is configured.
- An account may belong to **several departments** (a workspace switcher); most people have one.
- Deletion: self-service "delete my account" soft-deletes and anonymises after 30 days; the audit log
  keeps the events.

### 2.2 Departments (workspaces)

- **Create** (any account): form with department name (required), short description (optional), the
  list of **bo'limlar** (add as many rows as needed; optional; each with a name and an optional
  colour), default locale, an emoji/colour for the switcher (optional). Submitting creates a
  `department_requests` row and notifies the super admin (inbox + Telegram).
- **Approval** (super admin): approve or reject with a reason; on approval the department is created,
  the requester becomes **head**, the **join key** is generated (e.g. `DVN-7K3M-9Q2P-X8LZ`: 12
  characters from an unambiguous alphabet, unique, rotatable) and the head is asked to set the
  **join password** (or accepts a generated one). Super admins can also create departments directly.
- **Invite**: an "Invite" button in the department header opens a sheet with the link
  `https://<host>/join/<key>`, the password, a "Copy invitation" button that copies a localised text
  ("Bizning bo'limga qo'shiling: <link>, parol: <password>") in the inviter's current locale (all four
  available), a QR code, and controls to rotate the key or password and to toggle **join approval**
  (default off: joining is instant).
- **Join**: by link (`/join/:key` → if logged out, register/login first, then the password prompt) or
  by the "Join a department" form (key + password). Passwords are argon2id-hashed; join attempts are
  rate-limited per key and per IP; a wrong password says only "invalid key or password".
- **Membership**: `member` or `head`; the head can transfer headship, remove members, and change
  settings. Leaving a department keeps the person's archive readable by the department (attributed).

### 2.3 Roles and permissions (three roles, one settings page)

| Role | Scope | Can |
|---|---|---|
| `super_admin` | instance | everything: approve requests, manage departments and accounts, reset passwords, lock accounts, view-as (read-only) any department, global analytics, audit viewer, pause switch, wipe switch, system health. Every action audited with the role. |
| `head` | one department | everything a member can, plus: settings, invite key/password, join approval, remove members, transfer headship, request department deletion, department Telegram group connection (if restricted) |
| `member` | one department | create/edit/archive cards for anyone (giver/assignee are free choices), projects, events, polls, pages; create/edit/delete bo'limlar and sub-bo'limlar, self-assign to units and unit roles (bo'lim boshlig'i, o'rinbosar, a'zo), when the settings allow (default: allowed) |

Department settings (head): `allow_self_assign` (default on), `allow_structure_edit` (default on),
`join_requires_approval` (default off), `who_can_connect_telegram_group` (everyone / head; default
everyone), `quiet_hours`, default locale, colours, archive visibility (department-wide, default) and
the deletion request. Unit-level roles (`bo'lim boshlig'i` etc.) are labels for the org chart and
for routing (a unit head receives unit-level reminders and summaries); they grant no extra
permissions. The UI is designed so a department with no unit heads at all looks complete.

Authorisation is CASL abilities in `packages/contracts` (shared with the client) translated to
predicates in repositories, with Postgres RLS on `department_id` as the backstop, and every list
endpoint scoped by department membership. Personal workspace data is scoped to the owner only.

---

## 3. Domain model

Conventions: `id` uuid v7; `department_id` on every department-owned table; `created_at`,
`updated_at`, `deleted_at` (soft), `version` (optimistic concurrency); UTC storage; user content in
the language typed; system text as `{uz, uzc, ru, en}` jsonb. The `audit` schema is immutable (§3.7).

### 3.1 Accounts and departments

| Table | Key columns |
|---|---|
| `users` | login, email null, password_hash, given_name, family_name, patronymic null, title null, avatar_key null, locale, timezone, status enum(active, locked, deleted), totp_secret_enc null, recovery_codes_hash[], telegram_user_id null (unique), telegram_link_code null, must_change_password bool, last_login_at |
| `sessions` | user_id, token_hash, device_label, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at |
| `departments` | name, slug, description, emoji, colour, locale_default, timezone, settings jsonb (§2.3), join_key (unique), join_password_hash, join_requires_approval, status enum(active, paused_by_admin, deletion_requested, archived), created_from_request_id |
| `department_requests` | requester_user_id, name, description, units jsonb[], locale, status enum(pending, approved, rejected), reviewed_by, reason, reviewed_at |
| `memberships` | department_id, user_id, role enum(head, member), title_override null, joined_at, left_at, status enum(active, pending_approval, removed) |
| `units` | department_id, parent_unit_id null, name, colour, sort, path ltree | unlimited nesting; `unit_closure` maintained by trigger |
| `unit_roles` | unit_id, user_id, role enum(head, deputy, member), assigned_by, at | self-assigned when allowed |
| `join_attempts` | key, ip, user_id null, ok bool, at | rate limiting and audit |
| `instance_settings` | singleton: maintenance jsonb {enabled, message {uz,uzc,ru,en}, since, by}, registration_open bool, ai jsonb, telegram jsonb, limits jsonb |

### 3.2 Work (department board)

| Table | Key columns |
|---|---|
| `cards` | department_id, kind enum(task, project_task), title, description jsonb (blocks), assignee_user_id, giver_user_id null (who assigned; from the member list), project_id null, project_scope enum(none, objective, subjective), status enum(active, done, archived), priority enum(none, low, medium, high, urgent), start_at null, due_at null, done_at null, order_key (fractional), labels uuid[], watchers uuid[], links jsonb[] ({url, title, favicon}), recurrence jsonb null, source enum(manual, ai, telegram, template), risk enum(none, at_risk, overdue) computed |
| `card_checklist_items` | card_id, parent_item_id null, text, done_at, assignee_user_id null, due_at null, sort | nested |
| `card_comments` | card_id, author_user_id, body jsonb, mentions uuid[], edited_at | the Jira-like timeline together with `card_activity` |
| `card_activity` | card_id, actor_user_id, kind (created, assigned, status, due, comment, link, checklist…), data jsonb, at | rendered in the timeline |
| `attachments` | subject_type/id, key, name, mime, size, scan_status, thumb_key | links are preferred; files allowed with limits |
| `labels` | department_id, name, colour |
| `projects` | department_id, title, description jsonb, colour, cover_key, owner_user_id, members uuid[], status enum(planning, active, on_hold, done, archived), start_on, target_on, progress computed, milestones jsonb[] |
| `saved_views` | owner_user_id, department_id, name, filter (grammar), layout enum(people_board, table, timeline, calendar, mine), shared bool |
| `archive` | (view over cards where status = archived, grouped by former assignee; department-wide readable; restore allowed) |

Rules. The **People board** is the default view: one column per member, grouped under colour-coded
bo'lim sections (unassigned last), each column showing the person's active cards sorted by due date
then order key; done cards leave the board and go to the person's archive (visible to the whole
department, searchable, restorable). A **group project** appears as one card in every member's
column: **objective tasks** are shared checklist items/cards with one state for everyone; **subjective
tasks** are per-member cards under the project. Project progress = weighted completion of objective
tasks and members' subjective tasks. Every card shows giver → assignee, deadline with a risk badge,
link chips, a checklist fraction, and a comment count; opening it shows the full timeline. Detail is
progressive: board → card peek → full card page.

### 3.3 Personal workspace (private to the user)

| Table | Key columns |
|---|---|
| `personal_sprints` | user_id, kind enum(3h, day, week, custom), starts_at, ends_at, goal, status |
| `personal_tasks` | user_id, sprint_id null, parent_id null (nested), title, done_at, notes, sort, estimate_min null, linked_card_id null |
| `personal_notes` | user_id, title, body jsonb, pinned |
| `personal_canvases` | user_id, title, scene jsonb (Excalidraw), stickies overlay jsonb |
| `pomodoro_settings` | user_id, focus_min (25), short_break_min (5), long_break_min (15), cycles_before_long (4), sound, notifications, auto_start |
| `pomodoro_sessions` | user_id, task_id null, started_at, ended_at, kind, completed bool |

Nothing in this section is visible to anyone else, including the head; the super admin's view-as does
not include personal workspaces (only aggregate counts).

### 3.4 Events

| Table | Key columns |
|---|---|
| `events` | department_id, title, description jsonb, category enum(team_building, sports, volunteering, social, training, family, other), starts_at, ends_at, place, place_url, cover_key or illustration_id, capacity null, rsvp_deadline null, cost_note, organizer_user_id, status enum(draft, open, full, cancelled, done), updated_summary text (what changed, for notifications) |
| `event_rsvps` | event_id, user_id, status enum(yes, no, maybe, waitlist), guests smallint, note, changed_at | change or cancel any time before the deadline |
| `event_comments` | event_id, author, body, mentions |
| `carpools` | event_id, driver_user_id, seats, departure_place, departure_at, note, status | others claim seats |
| `carpool_seats` | carpool_id, user_id, claimed_at | waitlist when full |
| `event_items` | event_id, text ("who brings what"), claimed_by null | potluck / checklist |
| `polls` | department_id, event_id null, kind enum(date, single, multi), question, options jsonb[], anonymous bool, closes_at, created_by, status |
| `poll_votes` | poll_id, option_id, user_id (null when anonymous → stored as hash) |
| `event_feedback` | event_id, user_id, rating 1–5, comment, anonymous bool |
| `event_photos` | event_id, url, added_by |

Reminders: default 1 day and 1 hour before (organizer editable), via inbox and Telegram; changes to
time/place send an "updated" notification with the diff; cancellation notifies everyone who RSVPed.
ICS per event and per person.

### 3.5 Pages and onboarding-lite

`pages` (department, kind enum(how_we_work, onboarding, brief, note), blocks jsonb, versions) and
`onboarding_templates` (department; checklist items with owner role newcomer/head/buddy). When
enabled, a newcomer's join creates their onboarding checklist as personal-workspace tasks linked to
the template.

### 3.6 Notifications, Telegram, AI, platform

| Table | Key columns |
|---|---|
| `notifications` | user_id, type, reason enum(assigned, mentioned, due, updated, rsvp, poll, decision, digest, system), subject_type/id, title jsonb, read_at |
| `notification_prefs` | user_id, channel enum(inapp, telegram, email), type, enabled, digest_mode |
| `notification_deliveries` | notification_id, channel, status, provider_id, attempts, error |
| `telegram_links` | user_id, chat_id, linked_at, link_code_used |
| `telegram_groups` | department_id, chat_id, title, connected_by, kinds text[] (events, polls, announcements, weekly_summary, deadlines), connected_at |
| `ai_traces` | user_id, department_id null, feature, model, prompt_hash, in_tokens, out_tokens, reasoning_tokens, cost_uzs, latency_ms, accepted bool null |
| `ai_budgets` | department_id, month, limit_uzs, spent_uzs |
| `outbox` | event_type, payload, published_at |
| `jobs` (pg-boss) | reminders, digests, AI jobs, scans, thumbnails, audit anchor, retention |

### 3.7 Audit (immutable; decision 14)

`audit.events(seq, actor_user_id, actor_role, on_behalf_of null, department_id null, action,
subject_type, subject_id, before, after, ip, user_agent, request_id, at, prev_hash, row_hash)`.
The application role has INSERT and SELECT only; UPDATE/DELETE/TRUNCATE revoked and trigger-blocked;
SHA-256 chain; nightly anchor of the chain head to an append-only file on a separate volume and to
the super admin's Telegram; the audit viewer verifies the chain on demand. Never retained-away.
`audit.private_reads` records views of another person's contact details by the head or super admin.

---

## 4. API

REST, JSON, `/api/v1`, OpenAPI 3.1 from the same Zod schemas [tech-backend-stack-deep-dive].
Resources: `auth/*` (register, login, logout, sessions, 2fa, reset), `me`, `departments`,
`departments/requests`, `departments/:id/{members,units,unit-roles,settings,invite,join-approvals,
telegram-groups,analytics}`, `join/:key`, `cards`, `cards/:id/{checklist,comments,activity,links}`,
`projects`, `views`, `labels`, `attachments/presign`, `events`, `events/:id/{rsvp,comments,carpools,
items,photos,feedback}`, `polls`, `pages`, `personal/{sprints,tasks,notes,canvases,pomodoro}`,
`notifications`, `prefs`, `telegram/*`, `search`, `ai/*`, `admin/*` (requests, departments, users,
password-reset, lock, view-as, analytics, audit, health, maintenance, wipe), `webhooks`.
Conventions: cursor pagination, sparse fieldsets, `include`, RFC 9457 errors, `Idempotency-Key` on
creates, `If-Match` on updates, per-user and per-IP rate limits, request id everywhere, Brotli/gzip.
Filter grammar (Linear-style tokens, ~200-line parser in `packages/contracts`):
`assignee:@me giver:@nodira status:active due:<=friday project:"EGDI" label:urgent unit:"Data" "evidence"`.
Realtime channels: `d.{department}.board`, `d.{department}.project.{id}`, `u.{user}.inbox`,
`d.{department}.event.{id}`; delta messages with versions.

---

## 5. Frontend

Shell: sidebar (Home, Board, Projects, Events, Personal, Analytics, Pages; department switcher;
super admin gets Admin), top bar (quick-add, `Ctrl/⌘+K`, inbox bell), routed detail panel kept
mounted with `<Activity>`, Sonner toasts with undo, Vaul sheets on mobile, `?` shortcut overlay.
Data: TanStack Router loaders + Query (persisted cache), the single optimistic-mutation shape
everywhere, URL-as-state for filters/views, Zustand for UI state, offline read cache + write queue with
a pending badge. Boards: pragmatic-drag-and-drop with keyboard DnD and live-region announcements;
fractional order keys; `layoutId` motion gated by reduced motion. People board columns virtualised
horizontally and vertically. Tables: TanStack Table v9 + Virtual. Timeline: SVG. Calendar:
FullCalendar 7. Org chart: vendored d3-org-chart, correct with or without heads. Canvas:
Excalidraw embedded with our sticky-note/vote/timer overlay. Editor: Tiptap 3.31 with mentions,
checklist items, callouts, links with unfurled titles. Charts: Recharts 3 with draw-in and NumberFlow
tickers. Illustrations: a curated open-licence 2D vector set (unDraw-style, recoloured to tokens) for
empty states, events and onboarding, plus small Lottie sequences only where the animation report
allows. i18n: Paraglide, four locales, terminology from `packages/i18n/TERMS.md`. Fonts: IBM Plex
Serif display, Inter UI (Uzbek glyphs verified). Motion: the tokens in `DESIGN.md` §2.5.

---

## 6. Backend services

Fastify plugins: `context` (AsyncLocalStorage: request id, user, department, role), `db`
(transaction wrapper with `select set_config('app.department_id', $1, true)` etc.), `auth`,
`errors` (5xx flattened; no stack, SQL or paths in responses), `security` (helmet, CSP with nonces,
HSTS, CORS allow-list, rate limits), `compress`, `openapi`, `realtime`, `outbox`, `storage`, `ai`,
`telegram`, `maintenance` (§11). Modules under `src/modules/<domain>/{routes,service,repo,events,jobs}.ts`.
Outbox in the same transaction as every write; jobs created in the same transaction. Search: FTS
(`russian` config) + `simple` with `normalize_uz()` (folds ʻ ʼ ' ’, Cyrillic→Latin) and `pg_trgm`;
embeddings optional (bge-m3 sidecar) for semantic search and duplicate detection. Files: presigned
PUT, ClamAV before visibility, sharp thumbnails, signed 5-minute GETs, filename sanitisation,
size/MIME/extension allow-lists.

Jobs (pg-boss, Asia/Tashkent): `reminder.due` (hourly), `reminder.event` (per event schedule),
`digest.personal` (08:30), `digest.department` (Fri 18:00 + weekly summary to Telegram groups),
`risk.recompute` (nightly), `sprint.rollover`, `attachment.scan/thumb`, `ai.*`, `audit.anchor`
(nightly), `retention.sweep` (notifications, sessions, temp uploads only), `backup.verify` (weekly).

---

## 7. Telegram

Per user: Settings → "Connect Telegram" shows `/start <code>` deep link and a QR; the bot links the
chat, confirms in the user's locale; preferences per notification type; quiet hours; commands
`/today`, `/mytasks`, `/events`, `/done <id>`, `/rsvp`, `/mute 2h`; inline buttons for RSVP, poll
votes, "mark done", "snooze deadline 1 day"; 2FA/reset codes when enabled.
Per department group: add the bot to a group, send `/connect <join key>` (allowed roles per
settings); the group receives new events, polls, announcements, weekly summaries and deadline
digests (kinds chosen at connect time, editable in settings). "Pointer not payload": messages carry
titles, dates and deep links, never personal contact details [notifications-telegram-mobile].
Webhook on `apps/api`, grammY with throttler + auto-retry, `initData` HMAC validation for the Mini App.

---

## 8. AI (GLM-5.2 on the government GPU cluster; decision 15)

Gateway `packages/ai`: `run({feature, user, department, input, schema?, tools?, maxTokens})` →
OpenAI-compatible call to `https://api-llm.gpu.uz/v1` with `AI_API_KEY` from env; `max_tokens ≥ 1024`
always (reasoning costs 200–500 tokens; empty content + `finish_reason: length` → retry with double);
`reasoning_content` never shown or stored beyond token counts; tool calls with strict JSON schemas
validated by Zod (one retry with the error); history trimmed to fit 256k; per-department monthly
budget in UZS (19 500 per million tokens) with a soft cap, an admin alert and a hard stop; every
call traced; feature flags per department; promptfoo golden sets in CI (`ai-evals` gate).

Features (each a small, specific tool, with its own prompt, schema and eval set; the user always
sees a preview and accepts): quick-add parsing in four locales; task breakdown into subtasks; "plan
my day/sprint" for the personal workspace; deadline-risk explanations; weekly summary per person and
per department (drafts the digest); event drafting (description, checklist, poll options, carpool
plan) from a one-line idea; comment-thread summary on long cards; natural-language analytics ("show
overdue cards of Data bo'limi this month" → filter grammar + chart choice); translate any text among
the four locales; smart reminder timing suggestions; duplicate/related card detection; "what did I
miss" after time away; retro/feedback summarisation; department health narrative for the head. Guard
rails: content is data, tools are allow-listed per feature, no feature both reads private contact
blocks and sends externally, citations (links to cards/events) in every summary.

---

## 9. Analytics (for everyone in the department)

One analytics page with a filter bar (person, unit, project, giver, label, date range, status, any
grammar token) and saved filters; sections: throughput (cards done per week), on-time rate, open vs
overdue trend, load per person and per unit, project progress and burn-up, cycle time distribution,
events participation and RSVP rates, poll turnout, Pomodoro/sprint stats for the viewer only. Every
chart has an owner question in its header, animates in, supports keyboard, exports CSV/PNG, and can
be pinned to Home. Aggregates are precomputed nightly into `analytics_daily` and refreshed on write
for the current day; heavy queries never run on the request path.

---

## 10. Super admin console

Requests queue (approve/reject with reason), departments (list, view-as read-only, pause a
department, archive, restore, delete after retention), accounts (search, lock/unlock, reset password,
force 2FA reset, delete/anonymise), global analytics (departments, people, activity, AI spend) in
polished visualisations, audit viewer with chain verification and export, system health (queues,
DB, storage, Telegram, AI endpoint latency, backups), registration open/closed, **pause switch**
and **wipe switch** (§11).

---

## 11. Pause and wipe switches (decision 16)

- **Pause (maintenance mode).** A toggle with a message in four locales. When on: every page renders
  the message on a branded 503 page (super admin login and the console stay reachable), every API
  returns 503 with the message, workers pause non-critical jobs, the Telegram bot answers with the
  message, and Caddy serves the same page if the API is down. State in `instance_settings` and in
  Valkey for instant effect; audited.
- **Wipe (kill switch).** Removes everything about this project from the server and nothing else.
  Because the app cannot delete itself, `infra/sentinel/` is a tiny host service (systemd unit,
  listens on `127.0.0.1` only) that accepts a wipe command signed with a key that exists only in the
  sentinel's config and the super admin's password-protected console. In the console: type the
  department-count phrase shown, re-enter the password, confirm 2FA if enabled, then a 60-second
  countdown with cancel. The sentinel then: stops and removes the project's containers, images and
  volumes, deletes the project directory, backups and logs under `/opt/devon`, and writes a single
  line "wiped at <time> by <user>" to `/var/log/devon-wipe.log`. Also available as a CLI on the host
  (`devon-wipe --confirm`) for the CTO. Documented in `infra/README.md` with a recovery note (there
  is none, by design).

---

## 12. Gates (maps to `agentic/gates.json`) and the hardening pass

| Gate | Implementation |
|---|---|
| typecheck / lint | `tsc -b`, ESLint 9, Prettier |
| unit | Vitest 4: services, state rules, filter grammar, `can()`, plural rules, AI schema validators; Storybook addon-vitest for components |
| i18n | `check-i18n.mjs`: four-way parity, missing keys, hard-coded strings, ru plural completeness |
| secrets / deps / security | `check-secrets.mjs`, npm audit, Trivy (fs + image), Semgrep (OWASP rules), licence allow-list |
| build / bundle | web + api builds; `size-limit` 200 kB shell; `check-bundle.mjs` |
| migrate | Testcontainers Postgres 17: migrations twice; drift; **cross-department isolation test**; **audit immutability test** (UPDATE/DELETE must fail) |
| e2e | Playwright at 1440/1024/390 × light/dark × uz-Latn/ru: register → create department → approve → invite → join; people board drag; group project; personal sprint + Pomodoro; event with RSVP, carpool, poll; Telegram callback (mocked); pause switch; offline queue; two-browser realtime |
| a11y | axe on every route in `e2e/routes.json`; keyboard walkthrough spec |
| perf | Lighthouse CI ≥ 90 on Home, Board, Project, Events, Personal, Analytics; k6 (200 VUs, p95 < 150 ms API) |
| ai-evals | promptfoo golden + red-team sets (warn until EPIC-012, then blocking) |
| hardening | `agentic/HARDENING.md` checklist executed and evidenced in the production-readiness report (EPIC-014) |

---

## 13. Deployment and operations

`infra/docker-compose.yml`: caddy (TLS, HTTP/3, Brotli), api, worker, web (static), postgres 17
(+ pgvector, pg_trgm), valkey, minio, centrifugo, clamav, pgbackrest, optional grafana/loki/tempo,
optional bge-m3 embedding sidecar; `infra/sentinel/` on the host; images pinned by digest;
healthchecks; resource limits; `.env.example` documents every variable; `pnpm setup && pnpm dev`
for developers; `pnpm start --demo` seeds the demo; production starts with the super admin
bootstrap (first run prints a one-time setup URL). Backups: pgBackRest full weekly + WAL, MinIO
mirror, weekly automated restore verification, quarterly drill. Zero-downtime: expand → migrate →
contract; rolling restart behind Caddy; graceful shutdown; queued jobs survive. Observability: pino
structured logs with request/user/department ids and no secrets, OpenTelemetry optional, error
tracking self-hosted (GlitchTip), `/healthz`, `/readyz`, queue and AI metrics on the admin health page.

---

## 14. Demo mode

`--demo` (or `DEVON_DEMO=1`) seeds: the super admin, 3 departments (one modelled on "Axborot-tahlil
va ijro intizomi boshqarmasi" with two bo'limlar and a sub-bo'lim; one flat team without unit heads;
one pending request), ~40 users with three-part Uzbek names and avatars, ~250 cards across people
columns with givers, links, checklists and comment timelines, 6 group projects with objective and
subjective tasks, archives, 5 events (one with carpools and a date poll, one cancelled, one done with
photos and feedback), polls, pages and an onboarding template, personal workspaces for the demo
accounts (sprints, nested tasks, a canvas, Pomodoro history), notifications, Telegram links (mock),
AI traces, 2026 holidays, and an audit chain. Demo accounts (target dataset): `superadmin`, `head.sr`,
`head.flat`, `member.db`, `newcomer`, `pending.creator` (passwords printed by the seed; demo chip in
the header).

**Current implementation (package `demo-super-admin`).** Today's `--demo` seed
(`packages/db/src/seed/fixtures.ts`) ships three logins, all sharing `DEMO_PASSWORD`
(`Ishonchli#2026`): `demo.boshliq` (head of "Raqamli xizmatlar boshqarmasi"), `demo.xodim` (member of
the same department), and `admin.super` (`DEMO_SUPER_ADMIN`) — a global `super_admin` account with no
department membership and an `app.user_security` row (2FA off), seeded the same way `/setup` creates
a real first super admin. `admin.super` exists so the super admin console (§10) can be signed into
and demoed/screenshotted at all; before it existed, every `/admin/*` route rendered only its
no-permission state in a demo environment, since no seeded account held the `super_admin` role. This
account is demo-only and refused outside a non-production environment by the same seed guard as every
other demo row (§12); it is not the full §14 target roster above, which lands with EPIC-013/EPIC-014.

---

## 15. Delivery plan (epics, in `backlog.json`; work items in `TASKS.md`)

| Epic | Title | Depends on |
|---|---|---|
| EPIC-000 | Foundation: monorepo, tokens, shell, gates, CI, Compose, sentinel skeleton, audit schema, sessions core, super admin bootstrap, demo framework, four locales, terminology pass | – |
| EPIC-001 | Accounts: registration, login, sessions, devices, optional 2FA, profile & photo, password reset paths, account deletion | 000 |
| EPIC-002 | Departments: create request, super admin approval, join key + password, invite sheet with localised copy and QR, join by link/form, memberships, settings, switcher | 001 |
| EPIC-003 | Structure: bo'limlar with unlimited nesting, self-assignment, unit roles, org chart correct without heads, colours, reorder | 002 |
| EPIC-004 | Work core: cards, giver/assignee, deadlines, links/attachments, checklists (nested), comments + activity timeline, labels, watchers, People board grouped by bo'lim, quick-add, filter grammar, saved views, table/timeline/calendar/mine, archive, undo | 003 |
| EPIC-005 | Group projects: members, objective vs subjective tasks, progress, milestones, project page, templates | 004 |
| EPIC-006 | Inbox & notifications: reasons, preferences, quiet hours, deadline reminders, digests, ICS | 004 |
| EPIC-007 | Telegram: personal linking, commands, inline actions, department groups via join key, group updates, reminders, reset/2FA codes | 006 |
| EPIC-008 | Events: create/edit/cancel with change notifications, RSVP with guests/cancel/waitlist, comments, reminders, carpooling with seats, polls (date/single/multi, anonymous), who-brings-what, photos, feedback, calendar, ICS, illustrations | 006 |
| EPIC-009 | Personal workspace: sprints (3h/day/week/custom), nested tasks with checkboxes, today/focus, notes, canvas with stickies, Pomodoro (defaults, editable, sessions, sounds, notifications), privacy | 004 |
| EPIC-010 | Analytics for everyone: filter bar, saved filters, throughput/on-time/load/overdue/projects/events, precomputed aggregates, exports, animated charts, pin to Home | 005, 008 |
| EPIC-011 | Pages & onboarding-lite: how-we-work pages, onboarding checklist template, newcomer flow | 004 |
| EPIC-012 | AI helpers L1 (list in §8), gateway, budgets, evals, settings | 010 |
| EPIC-013 | Super admin console: requests, departments, accounts, password reset, view-as, global analytics, audit viewer + chain verify, health, pause switch, wipe switch + sentinel | 002 |
| EPIC-014 | Hardening & release 1.0: execute `agentic/HARDENING.md` end to end, production-readiness report with before/after measurements | all above |
| EPIC-015 | Telegram Mini App: inbox, board peek, RSVP, polls, Pomodoro companion | 007, 014 |
| EPIC-016 | AI L2: embeddings sidecar, semantic search, ask with citations, related cards, similar projects | 012 |
| EPIC-017 | Automations (5 triggers), recurring cards, templates gallery | 005 |
| EPIC-018 | Realtime polish: presence on boards, live cursors on canvas, typing indicators | 009 |
| EPIC-019 | Calendar sync (CalDAV/Graph), web push | 006 |
| EPIC-020 | Operations: install guide for another server, restore drills, update channel, k3s option | 013 |

---

## 16. Coding standards (binding)

TypeScript strict; Zod schemas are the source of truth; every department table has `department_id`
and RLS; every write emits audit + outbox in one transaction; every endpoint checks `can()`; every
string through i18n in four locales; every screen has empty/loading/error/no-permission/offline
states; undo over confirm; `Ctrl/⌘+K` reaches everything; tokens only; commits `<ITEM-ID>: <user-visible
change>`; migrations additive first; tests assert behaviour; no secrets in the repo; no `console.log`
in production code; every list endpoint paginated; no query in a loop; no `await` in a loop over
independent items; every external call has a timeout and bounded retries.

---

## 17. Risks

TanStack Table v9 freshness (pin, shared component); Uzbek FTS (normalize_uz validated in EPIC-004);
GLM quality for Uzbek (golden set gate in EPIC-012, features off by default until green); Telegram
policy (feature-flag per department); wipe switch misuse (password + 2FA + countdown + host-only
sentinel); scope size (bounded loop, epics ship independently, hardening epic reserved).

---

## 18. ADRs to write in EPIC-000

ADR-000 security baseline (ASVS L2 + HARDENING); ADR-001 monorepo/versions; ADR-002 tenancy =
department_id + RLS; ADR-003 built-in auth; ADR-004 audit immutability; ADR-005 filter grammar;
ADR-006 notifications & Telegram pointer policy; ADR-007 AI gateway (GLM-5.2); ADR-008 pages
storage; ADR-009 canvas (Excalidraw); ADR-010 tokens/theming; ADR-011 pause/wipe switches.

---

## 19. Decisions (CTO, 2026-09-05; frozen)

| # | Decision |
|---|---|
| 1 | AI = `glm-5.2` at `https://api-llm.gpu.uz/v1` (OpenAI-compatible, 256k, reasoning-first, tool calling, UZS billing); no external AI; key only in env |
| 2 | Hosting = ministry server, Docker Compose |
| 3 | No ministry layer: one instance = super admin + departments; departments never see each other |
| 4 | Identity = built-in login/password with server sessions; 2FA optional for everyone (TOTP or Telegram code); password reset by super admin or Telegram code; no OneID/Keycloak |
| 5 | Telegram bot approved: personal notifications/reminders, inline actions, department groups connected by join key, codes |
| 6 | Four locales, 100 %: uz-Latn (default), uz-Cyrl, ru, en |
| 7 | No import; `--demo` seeds a fully detailed demo; production starts with a super admin bootstrap |
| 8 | Palette B; terminology from real usage (`packages/i18n/TERMS.md`) |
| 9 | The CTO directs and maintains |
| 10 | No E-Imzo, ijro.gov.uz, OneID |
| 11 | Anyone can register; a fresh account creates a department (approved once by the super admin; creator becomes head) or joins with key + password; invite link `/join/<key>` with localised copy |
| 12 | Inside a department everyone can create/edit/delete bo'limlar (unlimited nesting) and self-assign roles, controlled by head settings that default to allowed; UI complete without unit heads |
| 13 | No HR module; personal workspace is private; department board = column per person grouped by bo'lim; done cards go to a department-readable archive |
| 14 | Immutable, hash-chained audit log; at least one super admin who can see and edit everything, always logged |
| 15 | GLM details as in §8 |
| 16 | Super admin pause switch (custom message, four locales) and wipe switch (host sentinel; removes only this project) |
| 17 | The production-hardening pass (`agentic/HARDENING.md`, 30 sections) is mandatory for every epic's verification and is executed in full in EPIC-014 |
| 18 | Build everything in `backlog.json` end to end, not only phase 1; the ship loop runs until the backlog is empty |
