# Devon (WorkPortal) — Technical Design Document

Version 1.0 draft, 2026-09-05. Status: ready for review before coding starts. Every choice cites the
research report that supports it (`docs/01-research/<file>.md`). Where a choice is still open it is
marked **[DECISION NEEDED]** and repeated in §19.

---

## 0. Scope, personas, non-functional targets

**What it is.** An internal team and work tracking platform for the units of the Ministry of Digital
Technologies of Uzbekistan (a directorate, department or division adopts it as its own workspace),
multi-tenant so any unit, and later any ministry, can adopt it. Modules: Home, People & Organisation
(directory, structure, availability), Work (tasks, projects, boards, timeline, decisions), Events &
Team building, Onboarding, Inbox, Admin. Plus a Telegram bot (phase 1) and Mini App (phase 2), and an
AI layer that removes clicks rather than chatting.

**What it is not (decisions 10–13).** Not an office suite, not a document-management or
correspondence-registry system, not a chat app, and **not an HR system**: no leave balances, trip
accounting, attestation or staffing-table administration; HR departments track their own work in
their own workspace like everyone else. Availability is a status a person sets ("ta'tilda 12–19 okt"),
not a process. Pages exist for onboarding, briefs and retro notes only (lightweight block editor);
files are attachments, not a drive.

**Personas.** Specialist (most users), head of sub-department, director, HR/administrator, tenant admin
(sysadmin in another ministry), newcomer (first 90 days).

**Non-functional targets (production-grade, not MVP).**

| Area | Target | Verified by |
|---|---|---|
| Availability | 99.5 % monthly on a single-box Compose install; zero-downtime deploys | gates `release`, smoke test |
| Latency | p95 API < 150 ms for list/detail; navigation feels instant (optimistic UI, prefetch) | k6 + Lighthouse CI |
| Scale | 50 tenants × 500 people × 50k tasks per instance without schema change; 20 concurrent editors per board | Testcontainers load test, Centrifugo limits [tech-realtime-boards-and-canvas] |
| Accessibility | WCAG 2.2 AA; keyboard-complete; axe 0 serious/critical | gate `a11y` |
| i18n | uz-Latn (default), uz-Cyrl, ru, en, each 100 % complete; Uzbek glyphs verified; plural rules | gate `i18n` (four-way parity) + wp-a11y-i18n |
| Security | OWASP ASVS 5.0 Level 2; cross-tenant isolation test in CI; audit of restricted reads | gate `security` (Semgrep/Trivy) + wp-security |
| Data residency | All persistent data in Uzbekistan; no foreign SaaS for personal data (identity, notifications, AI on Restricted tier) | architecture review |
| Bundle | ≤ 200 kB gzip shell; route chunks lazy | gate `bundle` |
| Offline | read cache + visible write queue; approvals require live connection | e2e offline spec |

---

## 1. Architecture overview

```
 Browser (SPA)  ─┐                                          ┌─ Postgres 17 (RLS, FTS, pgvector, pg-boss queues)
 Telegram Mini  ─┼─ Caddy (TLS) ─► apps/api (Fastify 5)  ─┼─ MinIO (S3 API)  ─ ClamAV
 App / Bot      ─┘        │             │  ├ BFF auth (OIDC) ─┼─ Keycloak 26 (single realm, Organizations)
                          │             │  ├ REST v1 + OpenAPI
                          │             │  ├ Telegram webhook (grammY)
                          │             │  └ Centrifugo publish ─► Centrifugo 6 ─► clients (WebSocket)
                          │        apps/api worker (pg-boss): reminders, digests, escalation sweep,
                          │             AI jobs, thumbnails, virus scan, outbox → notifications/webhooks
                          └─ Valkey (cache/rate limits)     LLM gateway (packages/ai) → Claude API | on-prem vLLM
```

One codebase, one Postgres, one API process (plus a worker process using the same code), one identity
provider. Everything self-hostable with Docker Compose on a single ministry box; k3s later
[backend-architecture-and-multitenancy; tech-backend-stack-deep-dive].

### 1.1 Monorepo layout (pnpm workspaces + Turborepo)

```
apps/web            Vite 8 + React 19.2 + TanStack Router SPA (also serves the Telegram Mini App route /m)
apps/api            Fastify 5: REST, BFF auth, realtime publish, Telegram webhook; src/worker.ts for pg-boss jobs
packages/db         Drizzle schema, RLS policies, migrations, seed (demo tenant)
packages/contracts  Zod schemas + TS types for every DTO, event and filter grammar; shared client/server
packages/ui         Design system (shadcn-style copied components on Base UI/Radix), tokens, icons, motion presets
packages/i18n       Paraglide messages (uz, ru, en), formatting helpers (dates, names, plurals)
packages/ai         LLM gateway, prompts, tool schemas, eval datasets (promptfoo)
packages/config     tsconfig, eslint (flat), prettier, size-limit presets
e2e/                Playwright: routes.json, ritual specs, a11y, realtime two-browser, offline
infra/              docker-compose.yml, Caddyfile, keycloak realm export, pgbackrest, clamav, scripts
agentic/            delivery-system runtime (protocol, gates, ledgers)     plugins/  wp-agentic plugin
docs/               reference, research, plan, escalations, ADRs
```

### 1.2 Provisional versions (pin exact, no `^`) [tech-frontend-stack-deep-dive; tech-backend-stack-deep-dive]

| Layer | Package | Version (2026-09) | Note |
|---|---|---|---|
| Build | Vite | 8.0.x | Rolldown default |
| UI | React / react-dom | 19.2.x | `<Activity>` for kept-alive panels; React Compiler 1.0 |
| Routing/data | @tanstack/react-router, react-query 5.101.x, react-table 9.2.x, react-form 1.x, react-virtual 3.x | pinned | Table v9 renamed hooks and roughly doubled gzip vs v8 (still small); supply-chain incident May 2026 → provenance checks in CI |
| Styling | Tailwind CSS 4.x, shadcn CLI 3.x on Base UI 1.0 (Radix kept where already used) | pinned | CSS-first tokens, `data-tenant` theming |
| Validation | Zod 4.5.x | pinned | no `z.interface()`; `.exactOptional()` |
| i18n | Paraglide JS 2.x, date-fns 4.x (uz, ru locales) | pinned | plural variants via Intl.PluralRules |
| Motion | motion 12.x | pinned | layout animations, reduced-motion gate |
| Palette/hotkeys | cmdk, react-hotkeys-hook, Sonner, Vaul | pinned | command registry pattern |
| Editor | Tiptap 3.x (+ Yjs only if collaboration is enabled) | pinned | see §7.9 |
| API | Fastify 5.x, fastify-type-provider-zod, @fastify/swagger, pino 9 | pinned | encapsulated domain plugins |
| DB | Postgres 17 (18 evaluated), Drizzle ORM latest, pgvector 0.8, pg-boss 10.x | pinned | RLS via `pgPolicy`; `set_config` tenant context |
| Realtime | Centrifugo 6.x, centrifuge-js | pinned | JWT auth, per-tenant channels |
| Identity | built-in: argon2 (node-argon2), otplib (TOTP), @simplewebauthn/server (optional passkeys), sessions in Postgres + Valkey | pinned | no external IdP; `IdentityProvider` interface for future OIDC |
| Cache | Valkey 9.x | pinned | rate limits, session store |
| Files | MinIO (behind S3 API), ClamAV | pinned | presigned uploads |
| Telegram | grammY 1.46.x, @telegram-apps/sdk 3.11.x | pinned | Bot API 10.3 |
| AI | GLM (~300B) self-hosted on the ministry GPU host behind an OpenAI-compatible endpoint (vLLM/SGLang), Vercel AI SDK 7 with the openai-compatible provider, bge-m3 (proposed) for embeddings, promptfoo | pinned | see §9; no external API |
| Tests | Vitest 4.x (5.0 just shipped; pin 4 for phase 1), Playwright 1.5x, Storybook 9 + addon-vitest, MSW 2, Testcontainers 12, k6 | pinned | |
| Lint | ESLint 9 flat + typescript-eslint, Prettier 3.7 | pinned | Biome deferred |

---

## 2. Tenancy, identity and sessions

- **Instance = ministry; workspace (tenant) = any unit that adopts the tool** (decisions 3, 11): a
  *boshqarma* (directorate), *departament*, *bo'lim* (division) or a subordinate organisation. The
  tenant record carries `unit_type` from the ministry's own vocabulary (see §3.1) so the UI never says
  "department" generically. Inside a workspace, sub-units are optional and may or may not have a head:
  a flat workspace of 8 people works exactly like a directorate with four divisions.
- **Who creates what.** Only the instance **super admin** creates a workspace (and its first
  workspace admin); nobody else, including ministry leadership, creates or deletes workspaces. The
  workspace admin (normally the unit head or a person they name) manages everything inside: people,
  sub-units, projects, settings. Workspaces are `private` by default (siblings see nothing) and can be
  switched by their admin to `ministry` visibility (siblings see the public profile fields, the org
  chart and the project list, read-only).
- **Ministry view.** People with the instance role `ministry_viewer` (the Minister, deputies,
  advisors, the Board secretariat) see every workspace **read-only**, regardless of its visibility,
  through a ministry-level Home that lists workspaces, their weekly pulse and escalations. They do not
  edit, assign or configure anything; if they want to instruct, they do it through their own
  workspace's tasks. Every ministry-view read is audited like any other.
- **Super admin.** At least one instance-level `super_admin` exists (the CTO's operations role): full
  read and write everywhere, every action written to the immutable audit log with `actor_role =
  super_admin`, no way to disable that logging. Every tenant-owned table carries `tenant_id`; Postgres RLS is the single
  enforcement point, predicates written as `(select current_setting('app.tenant_id', true))::uuid` so
  Postgres evaluates them once per query [tech-backend-stack-deep-dive §2].
- **Transaction wrapper** sets context with bound parameters:
  `select set_config('app.tenant_id', $1, true), set_config('app.person_id', $2, true), set_config('app.roles', $3, true)`.
  Never string-interpolated `SET LOCAL`.
- **Built-in identity (decision 4)**: username (work email or login) + password hashed with argon2id;
  server-side sessions (Postgres row + Valkey cache) referenced by an `HttpOnly; Secure; SameSite=Lax`
  cookie; sliding expiry (12 h idle, 30 d absolute), device list with "sign out everywhere"; CSRF
  double-submit token; login rate limits and lockout with audit; password policy (length ≥ 12, breach
  list check, no composition rules); admin-issued first passwords with forced change; second factor
  optional for everyone (decision 13): TOTP (otplib) or a Telegram-delivered code, passkeys optional
  (SimpleWebAuthn), recommended in Settings and never forced. The auth module sits behind an
  `IdentityProvider` interface so OIDC/SSO can be added later without touching the rest of the app.
  No Keycloak, no OneID [auth-permissions-security-compliance for the threat model].
- **Telegram link**: `initData` HMAC validation for the Mini App; Login Widget for linking a Telegram
  account to a person; Telegram is never the primary identity [notifications-telegram-mobile addendum §A/§C].
- **Provisioning**: `tenants` row + Keycloak organization + admin invite + demo/holiday calendar copy
  happen in one job (`tenant.provision`), so "a new department in an afternoon" is a form, not a runbook.

---

## 3. Domain model

Conventions: `id uuid` (UUIDv7), `tenant_id uuid not null`, `created_at/updated_at timestamptz`,
`deleted_at timestamptz null` (soft delete), `version int` (optimistic concurrency), i18n text columns as
`jsonb {uz,ru,en}` only where the *system* authors text (unit names, templates); user content is stored
in the language typed. Names use three fields. Timestamps UTC, displayed in `Asia/Tashkent` [uzbekistan-context].

### 3.1 Organisation and people

| Table | Key columns | Notes |
|---|---|---|
| `instances` | name jsonb, settings jsonb | the ministry; exactly one row per deployment |
| `instance_roles` | user_id, role enum(super_admin, ministry_viewer) | instance-level roles; every action by these roles is audited with the role |
| `tenants` (workspaces) | slug, name jsonb, unit_type enum(vazirlik, boshqarma, departament, bo'lim, sektor, xizmat, markaz, tashkilot), parent_label jsonb (e.g. "Vazirning birinchi o'rinbosari"), visibility enum(private, ministry), locale_default, timezone, theme jsonb, quiet_hours jsonb, settings jsonb, created_by (super admin) | one row per adopting unit; `unit_type` words come from the ministry's own structure page |
| `units` | tenant_id, parent_unit_id null, unit_type enum(bo'lim, sektor, guruh), name jsonb, mandate jsonb, head_person_id null, sort | optional sub-units; a head is optional; `unit_closure` maintained by trigger |
| `positions` | tenant_id, unit_id null, title jsonb, holder_person_id null, sort, is_vacant generated | lightweight: a title and whether it is filled, so the org chart can show vacancies; no grades, no HR administration |
| `people` | user_id, given_name, patronymic, family_name, display_name generated, work_email, work_phone, unit_id null, position_id null, title_free text, start_date, status enum(active, inactive), avatar_key, locale, skills text[], bio, birthday_month_day (opt-in), telegram_user_id, private_note text | **public within the workspace** except `birthday_month_day` (opt-in) and the small `private` group below |
| `people_private` | person_id PK, personal_phone, emergency_contact text | visible to self, the person's unit head, the workspace admin; read logged. No birth dates, IDs, addresses or documents anywhere in the system |
| `person_roles` | person_id, role enum(workspace_admin, head, member), scope_unit_id null | `head` scoped to a unit or to the whole workspace; a workspace works with zero heads (admin + members) |
| `delegations` | principal_person_id, delegate_person_id, starts_at, ends_at, reason | acting-for while away; audit stores both identities |
| `availability` | person_id, kind enum(vacation, trip, sick, remote, training, other), starts_on, ends_on, note, acknowledged_by null | a status, not a request: sets the "away" badge, auto-delegation prompt, and the head is notified; no balances |
| `holidays` | tenant_id null (instance-wide) or tenant, date, name jsonb, kind enum(holiday, moved_weekend, moved_workday) | admin-editable, seeded from decree PF-257 for 2026; used for deadlines and events |

Unit and title vocabulary as actually used on the ministry's structure page (digital.uz/oz/structure,
read 2026-09-05): *Vazir*, *Hay'at*, *Vazirning birinchi o'rinbosari*, *Vazir o'rinbosari*, *Vazir
maslahatchisi*, *boshqarma* (directorate, e.g. "Axborot-tahlil va ijro intizomi boshqarmasi"),
*departament* (e.g. "Sun'iy intellekt texnologiyalarini rivojlantirish departamenti"), *bo'lim*
(division, e.g. "Nazorat va ijro intizomi bo'limi", "Murojaatlar bo'limi"), *xizmat* (service, e.g.
"Axborot xizmati"), *bosh mutaxassis* (a standalone chief-specialist position). Titles of heads and
specialists (boshqarma boshlig'i, bo'lim boshlig'i, bosh mutaxassis, yetakchi mutaxassis, 1-toifali
mutaxassis, mutaxassis) are confirmed in the EPIC-000 terminology pass and stored in
`packages/i18n/TERMS.md`.

### 3.2 Work

| Table | Key columns | Notes |
|---|---|---|
| `projects` | title, description jsonb(blocks), unit_id, owner_person_id, objective_id, status enum(planning, active, on_hold, done, archived), health enum(on_track, at_risk, blocked, late) **computed**, start_date, target_date, progress smallint, color, cover_key, template_id | health is derived nightly and on write from dates, pulses and escalations, never typed [portfolio-pm-analytics-dashboards] |
| `project_pulses` | project_id, week_start date, status enum(on_track, at_risk, blocked), note text (≤ 280 chars), author_person_id, ai_drafted bool | the Friday ritual; unique (project_id, week_start) |
| `tasks` | project_id null, parent_task_id null, kind enum(task, topshiriq), title, description jsonb, assigner_person_id, assignee_person_id, unit_id, status enum(backlog, todo, in_progress, in_review, done, cancelled), priority enum(none, low, medium, high, urgent), start_at, due_at, completed_at, estimate_minutes, order_key text (fractional index), column_id, labels uuid[], watchers uuid[], recurrence jsonb, report text, escalation enum(none, overdue, escalated, acknowledged), source enum(manual, ai, telegram, meeting, template), embedding vector(1024) null | topshiriq = assigner ≠ assignee with a report expected; chain of accountability = assigner → assignee; subtasks via parent_task_id (max depth 2) |
| `boards` / `board_columns` | scope (project or unit), name, type enum(kanban, list, timeline, calendar), swimlane_by, wip_limit, column status mapping | views over the same tasks; columns map to statuses or custom stages per project |
| `checklists` / `checklist_items` | task_id, title, done_at, assignee_person_id, due_at, sort | Trello-style fraction badge |
| `labels` | name, color, unit_id null | |
| `comments` | subject_type, subject_id, body jsonb, author_person_id, mentions uuid[], edited_at | mentions create notifications |
| `reactions` | comment_id, person_id, emoji | |
| `attachments` | subject_type, subject_id, key, name, mime, size, scan_status enum(pending, clean, infected), thumb_key | MinIO presigned upload; ClamAV job |
| `saved_views` | owner_person_id, scope, name, filter text (grammar §4.4), sort, group_by, columns jsonb, shared bool | Linear-style filters, bookmarkable |
| `objectives` | unit_id, quarter, title, key_results jsonb[2..4], status | 3–5 per department per quarter; never per person |
| `automations` | scope, trigger enum(task_done, due_passed, status_changed, label_added, checklist_done), conditions jsonb, actions jsonb, enabled | max 5 trigger types on purpose (Butler pattern, no engine sprawl) [all-in-one-suites addendum] |

State machines (enforced in the service layer, tested):
- task.status: backlog→todo→in_progress→in_review→done; any→cancelled; done→in_progress (reopen, audited).
- task.escalation: none →(due_at passed)→ overdue →(24 h without update or immediate if blocked)→ escalated
  (appears in the unit head's *Ijro nazorati* queue) →(head acknowledges/reassigns)→ acknowledged →(done)→ none.
- project.health: computed = late if target_date passed and status ≠ done; blocked if last pulse blocked or
  any escalated topshiriq; at_risk if last pulse at_risk or no pulse for 2 weeks; else on_track.

### 3.3 Decisions (the one approval primitive)

There is no requests module (decision 12). Anything that needs someone's yes/no is a **decision** on
a task: a task (or checklist item) can carry `decision_needed_from = person`, which puts it in that
person's "needs my decision" queue, in the inbox, and on Telegram as an inline button. The decision
(`approve` / `return with comment` / `decline`) is recorded on the task with actor, acting-for and
timestamp, and the task moves on. This covers "sign off this report", "agree to this plan",
"confirm the event budget" without a workflow engine. Multi-party concurrence is simply several
decision checklist items on the same task.

| Table | Key columns | Notes |
|---|---|---|
| `decisions` | subject_type enum(task, checklist_item, event), subject_id, requested_from_person_id, requested_by_person_id, state enum(pending, approved, returned, declined), comment, decided_at, acting_for_person_id | one row per ask; a task shows its open decisions as chips |

### 3.4 Events and culture

| Table | Key columns | Notes |
|---|---|---|
| `events` | title, category enum(team_building, sports, volunteering, social, training, family), starts_at, ends_at, venue, capacity, budget_amount, budget_currency 'UZS', organizer_person_id, checklist jsonb, cover_key, rsvp_deadline, state enum(draft, open, full, closed, done, cancelled), poll_id null | checklist template from the reference (owner/budget, transport, capacity, accessibility, safety, feedback) |
| `event_rsvps` | event_id, person_id, status enum(yes, no, maybe, waitlist), guests smallint, note | capacity → waitlist automatically |
| `event_feedback` | event_id, person_id (nullable anonymous at department level), rating, comment | |
| `polls` / `poll_options` / `poll_votes` | kind enum(date, choice), question, anonymous bool, closes_at | date polls for events; anonymous only department-wide |
| `kudos` | from_person_id, to_person_id, text, subject_type/id null, visibility | attached to work or events, no separate feed |

### 3.5 Pages, onboarding, canvas

| Table | Key columns | Notes |
|---|---|---|
| `pages` | kind enum(onboarding, team, brief, retro, note), title, blocks jsonb (Tiptap JSON), parent_page_id, unit_id, owner_person_id, template_id, last_verified_at, status enum(draft, current, stale, archived), search_text generated | small editor; "stale" auto-set 180 days after last verification |
| `page_versions` | page_id, blocks jsonb, author, created_at | diff view |
| `onboarding_templates` | role/unit, items jsonb (title, owner_role, due_offset_days, page_ref) | 30/60/90 structure |
| `onboarding_plans` | person_id, template_id, manager_person_id, buddy_person_id, hr_person_id, start_date, checkpoints jsonb (30/60/90 feedback) | progress = done items / total |
| `onboarding_items` | plan_id, title, owner_role enum(newcomer, manager, hr, buddy, it), assignee_person_id, due_at, done_at, task_id | each item is also a task in the assignee's "My work" |
| `canvases` | kind enum(retro, brainstorm, whiteboard), scene jsonb, voting jsonb, timer jsonb, linked subject | library per §7.10 |

### 3.6 Notifications, audit, AI, platform

| Table | Key columns | Notes |
|---|---|---|
| `notifications` | person_id, type, reason enum(assigned, mentioned, subscribed, escalated, decision, digest, reminder), subject_type/id, title jsonb, read_at, archived_at | inbox-first; payload is a pointer, never restricted data |
| `notification_prefs` | person_id, channel enum(inapp, telegram, email, push), type, enabled, digest_mode | quiet hours are tenant-level server defaults (20:00–08:00 + weekends) with per-person override only to *more* quiet |
| `notification_deliveries` | notification_id, channel, status, provider_message_id, attempts, last_error | audit trail of delivery |
| `audit.events` | seq bigserial, tenant_id null, actor_user_id, actor_role, acting_for_person_id, action, subject_type/id, before jsonb, after jsonb, ip, user_agent, request_id, at, prev_hash, row_hash | **immutable** (decision 14): lives in its own `audit` schema; the application role has INSERT and SELECT only, UPDATE/DELETE/TRUNCATE are revoked at the database level and a trigger raises on any attempt; each row hashes its content plus the previous row's hash (SHA-256), and a nightly job writes the chain head to an append-only file on a separate volume and to the super admin's Telegram, so even a database superuser cannot rewrite history undetected; no retention sweep ever touches it; export only |
| `audit.private_reads` | actor_user_id, subject_person_id, at | who looked at someone's private contact block |
| `outbox` | event_type, payload jsonb, published_at null | worker publishes to notifications, webhooks, Centrifugo |
| `ai_traces` | feature, tier, provider, model, prompt_hash, input_tokens, output_tokens, cost_micro, latency_ms, subject, accepted bool | governance and budget |
| `webhooks` / `api_keys` | tenant, url, secret, events[], last_delivery | integrations for other ministries |
| `jobs` (pg-boss schema) | | reminders, digests, escalation sweep, thumbnails, scans, AI jobs |

---

## 4. API design

- **Style**: REST, JSON, `/api/v1/...`, OpenAPI 3.1 generated from the same Zod schemas that validate
  requests (`fastify-type-provider-zod` + `@fastify/swagger`) [tech-backend-stack-deep-dive §1]. tRPC is
  not used: other ministries' contractors must be able to consume the API.
- **Tenant scoping**: from the session; `X-Tenant` header only for instance admins.
- **Resources** (all support `GET list`, `GET one`, `POST`, `PATCH`, `DELETE` soft; `If-Match` with
  `version` for optimistic concurrency): `me`, `people`, `people/:id/restricted` (HR only, purpose
  required), `positions`, `units`, `org-chart`, `delegations`, `projects`, `projects/:id/pulses`,
  `tasks`, `tasks/:id/checklist`, `boards`, `views`, `labels`, `comments`, `attachments` (presign),
  `requests`, `requests/:id/decide`, `leave-balances`, `holidays`, `events`, `events/:id/rsvp`, `polls`,
  `pages`, `pages/:id/versions`, `onboarding/templates`, `onboarding/plans`, `canvases`, `kudos`,
  `notifications`, `notification-prefs`, `search`, `ai/*` (§9), `admin/*`, `audit`, `webhooks`.
- **Conventions**: cursor pagination (`?cursor=&limit=`), `?fields=` sparse fieldsets, `?include=`
  for relations, RFC 9457 problem details for errors, `Idempotency-Key` on POSTs that create, rate
  limits per person and per tenant (Valkey), request id in every log line and response header.
- **Filter grammar** (Linear/GitHub-style tokens, parsed by a 200-line parser in `packages/contracts`):
  `assignee:@me status:in_progress,in_review due:<=friday label:egdi unit:strategy "evidence"`.
  Supports `@me`, relative dates (`today`, `friday`, `+7d`, `week`, `quarter`), negation `-label:x`,
  free-text (goes to FTS). Saved views store the string. The same grammar drives quick filters and the
  command palette.
- **Realtime**: Centrifugo channels `t.{tenant}.inbox.{personId}`, `t.{tenant}.board.{boardId}`,
  `t.{tenant}.project.{projectId}`, `t.{tenant}.page.{pageId}`; messages `{type, id, version, patch}`;
  clients apply patches and re-fetch on version gaps [tech-realtime-boards-and-canvas].
- **Webhooks**: signed (`HMAC-SHA256`), retried with backoff from the outbox, events like
  `task.completed`, `request.approved`, `event.rsvp`.

---

## 5. Authorisation

- **Five roles, two levels** (decision 11):
  instance `super_admin` (everything, always logged), instance `ministry_viewer` (read-only across
  all workspaces); workspace `workspace_admin` (people, units, settings, projects), `head` (of a unit
  or of the workspace: sees the unit's work, receives escalations and decisions, acknowledges
  availability), `member` (own work, own unit's boards and projects, the workspace directory).
  A person can be `head` of one unit and `member` elsewhere. There is no HR role.
- **`can(actor, action, subject)`**: CASL ability definitions in `packages/contracts` (reused by the
  client for optimistic UI), translated to SQL predicates in the repository layer; RLS is the backstop.
- **Cross-workspace visibility**: `tenants.visibility = private` (default) hides everything from
  sibling workspaces; `ministry` exposes public profile fields, the org chart and project titles
  read-only. `ministry_viewer` and `super_admin` see all workspaces regardless.
- **Object shares**: `shares(subject_type, subject_id, grantee_person_id|unit_id|tenant_id, level
  enum(view, edit))` for the occasional joint project between workspaces; the UI always shows
  *effective* access.
- **Field visibility**: everything on a profile is visible within the workspace except the opt-in
  birthday and the `people_private` block (personal phone, emergency contact), which self, the unit
  head and the workspace admin can read, with the read logged.
- **Delegation**: a delegate's request carries `acting_for`; `can()` evaluates the principal's abilities
  within the delegation scope and window; audit records both.

---

## 6. Backend services

- `apps/api/src/plugins/` cross-cutting: `context` (AsyncLocalStorage: request id, tenant, person,
  roles, acting_for), `db` (Drizzle + transaction wrapper with `set_config`), `auth` (BFF), `errors`
  (single `setErrorHandler`, 5xx flattened), `rate-limit`, `openapi`, `realtime` (Centrifugo publisher),
  `outbox`, `storage`, `ai`.
- `apps/api/src/modules/<domain>/` each a Fastify plugin: `routes.ts` (Zod schemas), `service.ts`
  (rules and state machines), `repo.ts` (Drizzle), `events.ts` (outbox event types), `jobs.ts`.
- **Outbox pattern**: every write appends `audit_events` and `outbox` rows in the same transaction;
  the worker publishes to Centrifugo, notifications and webhooks, marking `published_at`. pg-boss jobs
  are created inside the same transaction as the business write [tech-backend-stack-deep-dive §4].
- **Jobs** (pg-boss, cron in `Asia/Tashkent`): `escalation.sweep` (every 15 min), `pulse.nudge`
  (Fri 15:00), `digest.department` (Fri 18:00), `digest.personal` (daily 08:30), `reminder.due`
  (hourly), `health.recompute` (nightly), `onboarding.tick` (daily), `event.rsvp_reminder`,
  `profile.verification` (quarterly), `attachment.scan`, `attachment.thumb`, `ai.*`, `webhook.deliver`,
  `retention.sweep`.
- **Search**: Postgres FTS `russian` config for ru text, `simple` + `pg_trgm` over a generated
  `normalize_uz(text)` column (folds ʻ ʼ ' ’, transliterates Cyrillic→Latin) for names and Uzbek text;
  pgvector 0.8 with `hnsw.iterative_scan` for semantic search when embeddings are enabled
  [tech-backend-stack-deep-dive §3].
- **Files**: presigned PUT to MinIO, `attachment.scan` with ClamAV before the file becomes visible,
  thumbnails via sharp, private signed GET URLs (5 min).

---

## 7. Frontend architecture

- **Shell**: left sidebar (5 areas + tenant switcher), top command bar (`Ctrl/⌘+K`, quick-add), right
  detail panel routed (`?panel=task:ID`) and kept mounted with `<Activity mode="hidden">`, inbox
  drawer, toast region (Sonner) with undo. Mobile (390 px) uses bottom sheets (Vaul) and a bottom tab bar.
- **Routing/data**: TanStack Router file routes; `validateSearch` + `loaderDeps` make every filtered list
  a shareable URL; loaders prefetch with TanStack Query; the one optimistic-mutation shape everywhere
  (cancel → snapshot → optimistic set → rollback on error → invalidate on settle)
  [tech-frontend-stack-deep-dive §5].
- **State**: server state in Query (persisted to IndexedDB for instant reopen), URL state for views and
  filters, Zustand for small UI state (sidebar, density), no global store.
- **Offline**: read cache + mutation queue with a visible "pending" badge; approvals disabled offline.
- **Command registry**: one registry feeds the palette and hotkeys (`react-hotkeys-hook`); every
  navigable object and primary action registers; `?` shows the shortcut overlay.
- **Forms**: TanStack Form + shared Zod schema; autosave drafts for long forms; undo instead of confirm.
- **Tables**: TanStack Table v9 + Virtual, inline edit, column filters, grouping, saved views, density
  toggle, bulk actions with undo [data-dense-ui-components].
- **Boards**: pragmatic-drag-and-drop with keyboard DnD and live-region announcements; fractional
  `order_key`; layout animations via `motion` `layoutId` gated by reduced motion.
- **Timeline**: custom SVG/CSS-grid roadmap (projects and milestones), no Gantt library in phase 1.
- **Calendar**: FullCalendar 7 (GA 2026-06-19, MIT core) with uz/ru locales. Schedule-X rejected:
  its v4 free package dropped drag-and-drop/resize [data-dense-ui-components addendum].
- **Org chart**: `d3-org-chart` vendored from the GitHub source (the npm package has been stale since
  2023), vacancies rendered dashed, keyboard navigation and ARIA added by us.
- **Charts**: Recharts via shadcn chart components; animated draw-in; no dashboards without an owner.
- **§7.9 Pages editor**: Tiptap 3.31 (MIT, incl. `@tiptap/markdown`) with StarterKit, a custom
  `AssignableTaskItem` node (assignee, due date, linked task), dual Mention (`@person`, `#project`),
  slash menu, `Callout` node, image, table; JSON stored in `pages.blocks` with a generated
  `search_text`/tsvector column; last-write-wins autosave with optimistic locking (`version`) and
  `page_versions` history in phase 1; Yjs + Hocuspocus 4.6 (MIT) behind a flag only if simultaneous
  editing becomes a real need [notion-model-and-block-editors addendum].
- **§7.10 Canvas**: retro/brainstorm boards with sticky notes, dot voting and a timer, built on
  **Excalidraw (MIT)** embedded; scene JSON in `canvases.scene`, voting/timer as our own overlay.
  tldraw rejected: its licence requires a paid or watermarked licence for production use, which an
  internal government deployment plausibly is [data-dense-ui-components addendum].
- **i18n (decision 6)**: four locales, all 100 % complete: `uz-Latn` (default), `uz-Cyrl`, `ru`, `en`.
  Paraglide compiled messages; Uzbek single plural form, Russian four categories, parity across all
  four enforced by `check-i18n.mjs`; `uz-Cyrl` strings generated from `uz-Latn` by deterministic
  transliteration and then human-reviewed (reviewed keys are locked); dates `DD.MM.YYYY`, week starts
  Monday; names `Familiya Ism Otasining ismi`; per-person locale switch in the header, tenant default
  in settings.
- **Fonts**: Inter for UI (Cyrillic + Latin), display face per DESIGN.md; Uzbek glyphs `Oʻ Gʻ ʼ` verified
  in-browser before phase 1 ships (test page in Storybook).
- **Performance**: route-level code splitting, prefetch on hover/focus, `size-limit` 200 kB shell,
  Lighthouse CI ≥ 90 performance/accessibility on the five main routes.

---

## 8. Design system (summary; the full spec is `DESIGN.md`)

- Tokens in DTCG format → CSS variables via Style Dictionary; OKLCH 12-step scales; per-tenant override
  through `data-tenant` attribute (primary hue, logo, name) so one build serves every ministry.
- Identity (decision 8): Palette B from the identity research ("Navy-led, product-owned blue"): warm
  paper `#f7f5f0`, Devon's own navy primary `#1b4a76` (distinct in hue and chroma from the ministry's
  `#013d8c`), near-black navy sidebar `#071b31`, amber wayfinding `#d69f58`, green reserved as the
  semantic success colour; the ministry's official navy `#013d8c` (observed on digital.uz/gov.uz,
  which share one token set under the unified gov platform) used verbatim for one official touchpoint
  only. Flag colours never as chrome [uzbekistan-gov-visual-identity-research].
- Type: IBM Plex Serif display (Cyrillic + Latin Extended, Uzbek modifier letters verified), Inter UI
  (Golos Text evaluated for Russian body), IBM Plex Mono; tabular numerals; 8-pt rhythm.
- Motion system: 140 / 220 / 300 ms (+ 480 ms one-shot celebration), expo-out entrances, expo-in
  exits, critically-damped springs, per-component reduced-motion replacement; 28-item catalogue in
  [tech-animation-and-visual-craft].
- Every component ships light/dark, three densities where relevant, and empty/loading/error/no-permission
  states in Storybook.

---

## 9. AI layer

**Principle**: AI removes clicks on the simple model; it never becomes a chat-shaped workaround for
complexity, never changes a privacy tier, and never writes the record of truth without a human accept
[ai-features-and-assistants].

**Gateway** (`packages/ai`): `run({feature, tier, input, schema?, tools?, budget})`.
- Provider (decision 1, details in `docs/03-plan/integrations/glm-api-instruction.md`): the
  government GPU cluster's OpenAI-compatible API, base URL `https://api-llm.gpu.uz/v1`, model
  **`glm-5.2`**, bearer key from `AI_API_KEY` (never in the repo; the instruction file is stored with
  its key fields blank). Facts that shape the code: 256 000-token context (input + output + tool
  definitions + reasoning); the model **always reasons first** and spends 200–500 tokens of
  `max_tokens` on it, returning the reasoning in `message.reasoning_content`, so every call sets
  `max_tokens ≥ 1024` (2048+ for extraction with long inputs) and treats empty `content` with
  `finish_reason: "length"` as a retry with a larger budget; tool calling in the standard OpenAI
  format (`tools`, `tool_choice`, `message.tool_calls`); streaming supported; billed per token in UZS
  (19 500 UZS per million, input and output alike), which the gateway records per call and rolls up
  into a per-workspace monthly budget with a soft cap and an admin alert. The endpoint sits on the
  INHA cluster inside Uzbekistan, so every data tier may use it; the gateway still keeps a provider
  abstraction (AI SDK 7 openai-compatible provider) and a tier switch so a second model can be added.
  Embeddings are not offered by this API: a small in-country embedding model (bge-m3 proposed) is
  deployed next to the app for search and duplicate detection, or those two features stay
  FTS/trigram-only until it exists.
- Mechanics: JSON-schema tool calls for extraction (validated with Zod, retried once with the error
  fed back); history trimming and a stable, short workspace-context block to stay well inside the
  context limit; batched nightly digests via pg-boss; streaming for drafts; `reasoning_content`
  never shown to users and never stored beyond the trace; pinned model id recorded in every
  `ai_traces` row. Uzbek Latin/Cyrillic and Russian quality is benchmarked with a golden set in
  EPIC-011 before any feature is enabled by default.
- Safety: permission-aware retrieval (embeddings live on RLS-protected rows; retrieval runs as the
  user); prompt-injection defences (content is data, tools are allow-listed per feature, no feature has
  both restricted-read and external-send); citations mandatory for any answer about policy/HR; every
  call logged to `ai_traces` with cost; per-tenant monthly budget; promptfoo golden set + red-team
  suite as a CI gate for every feature and model bump.

**Feature ladder** (surface → capability → tier):

| Phase | Feature | Surface | Capability |
|---|---|---|---|
| 1 | Quick-add parsing uz/ru/en | Ctrl+K quick-add | extraction (schema) |
| 1 | Translate on demand | any text field toggle | generation |
| 1 | Friday pulse draft from activity | pulse composer | summarisation (structured input) |
| 1 | "What did I miss" after leave | Home card | summarisation, permission-scoped |
| 1 | Newcomer project briefing | project page button | summarisation over project data |
| 1 | Duplicate detection on create | task form warning | embeddings |
| 1 | Stalled-work and deadline-risk badges | cards, queue | rules + optional rationale |
| 1 | Auto-tag suggestions | pre-filled chips | classification |
| 1 | Smart digest ranking | inbox digest mode | ranking |
| 1 | Event date suggestions | event form | constraint solving over calendars |
| 2 | Meeting notes → tasks (paste or upload) | review panel, accept per item | extraction |
| 2 | Retro summarisation | retro canvas → summary page | summarisation (Restricted-aware) |
| 2 | Semantic search | Ctrl+K search | embeddings + FTS hybrid |
| 2 | Ask with citations | docked panel | RAG, citations required |
| 2 | Onboarding plan drafting per role | onboarding module | constrained generation |
| 2 | Similar past projects | new project wizard | embeddings |
| 2 | Auto-link related items | related panel | embeddings + entities |
| 3 | Multi-step agent ("move X's overdue items to next week and notify") | preview → confirm → undo window | agentic tool use via internal MCP server |
| 3 | Anomaly flags on requests | approval screen (flag, never auto-reject) | classification |
| 3 | Department workload signals (aggregate only) | director view | aggregation |
| 3 | Cross-unit status roll-up | director brief | summarisation |

---

## 10. Notifications and Telegram

- Model: domain event → `notifications` (reason-tagged) → per-person preferences → channel adapters
  (in-app realtime, Telegram, email, web push) → digests; a ~300-line pg-boss worker instead of Novu
  (fewer moving parts) [notifications-telegram-mobile addendum §L].
- Quiet hours: tenant default 20:00–08:00 and weekends, server-enforced; only `blocking` escalations
  may override.
- Telegram bot (grammY, webhook on `apps/api`): account linking, deep links to records, inline
  buttons for approve/decline/RSVP/mark-done with `answerCallbackQuery`, message editing for live RSVP
  counts, Friday nudges, daily/weekly digests, uz/ru/en templates, rate-limit-aware sender with
  auto-retry, "pointer not payload" enforced by an allow-list serializer and a build-time check.
- Mini App (phase 2): inbox, approvals, pulse, RSVP, quick-add; `initData` HMAC validation; theme tokens
  mapped to Telegram theme params; haptics on confirm.
- Email: local SMTP relay; never on the critical path of an approval.
- Web push (VAPID): secondary, opt-in.
- Calendar: ICS feeds per person and unit (leave, events, deadlines); CalDAV/Graph sync in phase 2.

---

## 11. Security and compliance

- ASVS 5.0 Level 2 checklist tracked in `docs/adr/ADR-000-security-baseline.md` (to be written in
  EPIC-000).
- Data localisation: all services in-country; provider allow-list for AI by tier; no telemetry egress.
- Secrets: env only, `.env.example` documented, Compose secrets; SBOM (Trivy) + dependency scanning
  + Renovate self-hosted; npm provenance checks for `@tanstack/*` and other critical packages.
- Audit: append-only tables with revoked UPDATE/DELETE; restricted reads logged with purpose;
  retention policy per table (`retention.sweep`).
- Threats explicitly tested in CI: cross-tenant read/write, vertical escalation, restricted-field leak
  through list/search/export/notification/Telegram, CSRF, file type sniffing, SSRF in URL fields, CSV
  injection in exports, prompt injection into AI features.
- Certification: the platform likely falls under state-body information-system requirements
  (expertise/certification); the architecture keeps a clean boundary (single box, documented data flows)
  to make that process tractable [uzbekistan-context addendum §5] **[DECISION NEEDED: timing]**.

---

## 12. Testing and gates (maps to `agentic/gates.json`)

| Gate | Implementation |
|---|---|
| typecheck / lint | `tsc -b`, ESLint 9 flat + typescript-eslint, Prettier check |
| unit | Vitest 4 (services, state machines, filter grammar, `can()`, plural rules); Storybook 9 addon-vitest for components |
| i18n | `check-i18n.mjs` (parity, missing keys, hard-coded strings, ru plural completeness) |
| secrets / deps | `check-secrets.mjs`, Trivy, npm audit high |
| build | web + api builds; `size-limit` on the shell |
| migrate | Testcontainers Postgres 17: apply all migrations twice; drift check; **cross-tenant isolation test** (required) |
| e2e | Playwright projects at 1440/1024/390 × light/dark × uz/ru for the ritual flows: quick-add, Friday pulse, escalation queue, leave in 3 taps + inbox approval, RSVP with waitlist, onboarding checklist, delegation, Telegram callback (mocked), offline queue; two-browser realtime board test |
| a11y | axe on every route in `e2e/routes.json`, keyboard walkthrough spec |
| bundle | `check-bundle.mjs` |
| perf | Lighthouse CI ≥ 90 on Home, People, Board, Project, Request; k6 smoke (200 VUs) |
| ai-evals | promptfoo golden set (warn in phase 1, blocking from AI level 2) |

---

## 13. Deployment and operations

- `infra/docker-compose.yml`: caddy (TLS, HTTP/3), api, worker, web (static via caddy), postgres 17
  (+ pgvector, pg_trgm), valkey, minio, centrifugo, clamav, pgbackrest sidecar, optional
  grafana/loki/tempo. The GLM inference service runs on the separate ministry GPU host and is reached
  over the internal network as an OpenAI-compatible endpoint (`AI_BASE_URL`). Images pinned by digest; healthchecks; resource limits;
  `.env.example` documents every variable; `pnpm setup && pnpm dev` for developers (Docker for
  Postgres/MinIO/Keycloak only).
- Backups: pgBackRest full weekly + WAL; quarterly restore drill scripted (`infra/scripts/restore-drill.sh`).
- Upgrades: expand → migrate → contract; previous image + no destructive migration in the same release
  = rollback; `/healthz`, `/readyz`; structured logs (pino) with request/tenant ids; OpenTelemetry traces
  optional; Sentry self-hosted or GlitchTip **[DECISION NEEDED]**.
- Sizing (single ministry, 500 users): 4 vCPU / 16 GB / 200 GB SSD; AI on-prem needs a separate GPU host.
- k3s/Helm only when tenants or HA require it.

---

## 14. Demo tenant and seed

Demo mode (decision 7): `pnpm start --demo` (or `DEVON_DEMO=1`) seeds everything below on first boot
and shows a "demo data" chip in the header; without it a fresh install starts empty and opens the
admin bootstrap wizard (create tenant, first admin, locale, holidays). `packages/db/seed/` creates
tenant `raqamli-demo` with the department from the reference (director,
4 units, 23 people with three-part Uzbek names, positions incl. 2 vacancies, 14 projects with pulse
history, ~180 tasks incl. topshiriqs and escalations, leave balances and 2026 holidays, 4 events with
RSVPs, an onboarding plan for a newcomer starting next Monday, 6 pages, 2 retro canvases, notifications,
and demo accounts `director@demo`, `head.sr@demo`, `spec.db@demo`, `hr@demo`, `admin@demo`,
`newcomer@demo` (password printed by the seed). The seed doubles as Playwright fixtures and the
"show it to another ministry" demo.

---

## 15. Delivery plan (epics → `docs/03-plan/backlog.json`)

| Epic | Title | Phase | Depends on | Class |
|---|---|---|---|---|
| EPIC-000 | Foundation: monorepo, tokens, shell, built-in auth (sessions, 2FA), tenancy + RLS, audit/outbox, `--demo` seed, four-locale i18n, terminology pass, gates, CI, Compose | 1 | – | C |
| EPIC-001 | People & Organisation: directory, positions, org chart, privacy tiers, verification, delegation | 1 | 000 | C |
| EPIC-002 | Work core: tasks/topshiriq, projects, list/board/timeline, quick-add, filter grammar, saved views, comments, attachments, labels, checklists | 1 | 001 | B |
| EPIC-003 | Rituals: Friday pulse, health computation, Ijro nazorati queue, objectives | 1 | 002 | B |
| EPIC-004 | Inbox & notifications: event bus, preferences, quiet hours, digests, email, ICS | 1 | 002 | B |
| EPIC-005 | Telegram bot: link, nudges, approvals, RSVP, deep links | 1 | 004 | C |
| EPIC-006 | Availability & decisions: away status with auto-delegation prompt, the decision primitive on tasks, one-tap decide from inbox and Telegram | 1 | 004 | B |
| EPIC-007 | Events & team building: events, RSVP/waitlist, checklist, budget, feedback, date polls, photos | 1 | 004 | B |
| EPIC-008 | Pages editor: Tiptap, templates, mentions, assignable checklist items, versions | 1 | 002 | B |
| EPIC-009 | Onboarding: templates, plans, items by role, buddy, "how we work" pages, progress, 30/60/90 | 1 | 008 | B |
| EPIC-010 | Home & director brief, search (FTS + normalize_uz), "My work", "Waiting on" | 1 | 003, 006 | B |
| EPIC-011 | AI level 1: gateway, quick-add parse, translate, pulse draft, catch-up, briefing, duplicates, tags, digest ranking | 1 | 010 | C |
| EPIC-012 | Instance & workspace admin: super admin console, workspace creation, ministry view (read-only), visibility switch, theme, holidays, roles, immutable audit viewer with chain verification, API keys/webhooks | 1 | 001 | C |
| EPIC-013 | Hardening: a11y, i18n QA, performance, offline queue, error states, release 1.0 | 1 | 003–012 | B |
| EPIC-014 | Telegram Mini App | 2 | 005, 013 | C |
| EPIC-015 | Canvas (retro/brainstorm), voting, timer | 2 | 008 | B |
| EPIC-016 | AI level 2: semantic search, ask with citations, meeting notes → tasks, retro summary, onboarding drafting | 2 | 011, 015 | C |
| EPIC-017 | Team extras: capacity as a derived person × week view, 1:1 notes, kudos on finished work, birthdays | 2 | 010 | B |
| EPIC-018 | Calendar sync (CalDAV/Graph), web push, ICS subscriptions | 2 | 004 | C |
| EPIC-019 | Automations (5 triggers), recurring tasks, templates gallery | 2 | 002 | B |
| EPIC-020 | Multi-ministry operations: tenant provisioning UI, instance admin, backups UI, k3s option | 2 | 012 | C |
| EPIC-021 | State integrations (OneID, E-Imzo, ijro) — **dropped by decision 10** | – | – | – |
| EPIC-022 | AI level 3: agent execution with preview/undo, anomaly flags, workload signals | 3 | 016 | C |
| EPIC-023 | Decision intelligence: delivery confidence trend, dependency alerts, forecasts | 3 | 017 | B |
| EPIC-024 | Cyrillic Uzbek locale, EGDI observatory for Strategy & Rankings | 3 | 013 | B |

Phase 1 = EPIC-000…013 (target ninety days with the agentic loop; sequential by dependency, parallel
worktrees where TOUCHES are disjoint).

---

## 16. Coding standards (binding for makers)

- TypeScript strict; no `any` in `packages/contracts`; Zod schemas are the source of truth for types.
- Every table: `tenant_id`, timestamps, soft delete, `version`; every write: audit + outbox in one
  transaction; every endpoint: `can()`; every string: i18n; every screen: four states; every primary
  action: keyboard path + command registry entry.
- Commits `<ITEM-ID>: <user-visible change>`; migrations additive first; tests assert behaviour.
- Never edit an applied migration; never bypass the API client; never hard-code a colour.

---

## 17. Risks

| Risk | Mitigation |
|---|---|
| TanStack Table v9 freshly stable; AI-generated code follows v8 shapes | pin exact version; reviewer checklist item; one shared table component |
| Uzbek FTS quality | `normalize_uz` validated against a real name corpus in EPIC-010; trigram fallback |
| On-prem model quality for Uzbek | benchmark before routing Restricted tier; phase-1 AI features avoid Restricted data |
| Keycloak operational weight | realm export in repo, provisioning job, admin runbook in EPIC-000 |
| Telegram policy in the ministry | pointer-only policy documented; feature-flag the bot per tenant |
| Ninety-day scope | bounded loop, gates, and the backlog order above; hardening epic reserved |
| Certification of state systems | clean single-box architecture; documented data flows; ADR-000 |

---

## 18. Decisions log (to become ADRs in EPIC-000)

ADR-000 security baseline (ASVS L2); ADR-001 monorepo and versions; ADR-002 tenancy = shared schema +
RLS, Keycloak Organizations; ADR-003 BFF auth; ADR-004 outbox/audit; ADR-005 filter grammar; ADR-006
notifications model and Telegram pointer policy; ADR-007 AI gateway routing by tier; ADR-008 pages
editor storage (JSON, LWW, Yjs behind flag); ADR-009 canvas library; ADR-010 design tokens and
per-tenant theming.

## 19. Decisions (answered by the CTO on 2026-09-05; frozen)

| # | Decision | Consequence in this spec |
|---|---|---|
| 1 | **AI = GLM (~300B) self-hosted on the ministry's GPU host.** No external API. | §9: single in-country provider for every tier; OpenAI-compatible endpoint through the AI SDK provider; embeddings model to be deployed alongside (bge-m3 proposed); Uzbek quality benchmarked in EPIC-011. |
| 2 | **Hosting = ministry server (on-prem).** | §13: Docker Compose on the ministry box; GLM on the separate GPU host. |
| 3 | **Tenant = department, one instance per ministry.** | §2: many department tenants in one deployment; ministry-wide directory of *public* profile fields, everything else department-scoped (default; see open point A). |
| 4 | **Identity = built-in username/password with server sessions and optional 2FA. No OneID, no Keycloak.** | §2 rewritten: argon2id passwords, Postgres+Valkey sessions, HttpOnly cookies, CSRF, TOTP and Telegram-OTP as second factors, passkeys optional; OIDC-ready abstraction kept for the future. |
| 5 | **Telegram bot approved** for notifications/reminders, one-tap approvals, RSVP, account linking, optional OTP. | §10 unchanged; OTP delivery added as an option. |
| 6 | **Four locales, 100 % complete: uz-Latn (default), uz-Cyrl, ru, en.** | §0, §7: gate `i18n` enforces parity across four; Cyrillic generated by transliteration then human-reviewed. |
| 7 | **No staffing table to import; the product ships a fully detailed demo mode (`--demo`).** | §14: `pnpm start --demo` / `DEVON_DEMO=1` seeds the complete demo ministry; production starts empty with an admin bootstrap wizard. |
| 8 | **Palette B (navy-led, product-owned blue).** Real-world terminology to be researched from actual usage, not legal jargon. | `DESIGN.md` §2 switched to Palette B; terminology pass scheduled before UI copy is frozen (EPIC-000 deliverable). |
| 9 | **The CTO maintains and directs.** | TypeScript stack stands; runbooks written for one operator. |
| 10 | **No E-Imzo, no ijro.gov.uz, no OneID.** | EPIC-021 dropped; Phase 3 keeps only AI level 3, decision intelligence, Cyrillic/EGDI items. |

| 11 | **Hierarchy = instance (ministry) → workspaces (any unit: boshqarma / departament / bo'lim) → optional sub-units with optional heads.** Workspaces private by default with a `ministry` visibility switch; ministry leadership gets a read-only ministry view; only the super admin creates workspaces; workspace admins run everything inside. | §2, §3.1, §5 rewritten; modelled on the ministry's structure page (digital.uz/oz/structure). |
| 12 | **No HR module.** Availability is a status; decisions are a primitive on tasks; no leave balances, trips, attestation, restricted HR records. | §3.3 rewritten; `people_restricted` removed; EPIC-006 re-scoped. |
| 13 | **2FA optional for everyone** (TOTP or Telegram code), recommended in settings, never forced. | §2. |
| 14 | **At least one super admin; an audit log that cannot be deleted after production.** | §3.6: `audit` schema, INSERT/SELECT-only role, hash chain, nightly anchor to a separate volume and Telegram, no retention sweep. |
| 15 | **GLM-5.2 at `https://api-llm.gpu.uz/v1`** (256k context, reasoning-first, tool calling, UZS billing). | §9; instruction file saved at `docs/03-plan/integrations/glm-api-instruction.md` with key fields blank. |

No open points remain that block the build.
