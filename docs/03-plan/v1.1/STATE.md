# STATE.md — the WorkPortal (Devon) codebase as it stands, 2026-09-12

Written read-only from `master` at `21f8d86` while another session merges the `hd/*` hardening
branches. Every claim below carries the path it came from. Where a claim is an inference (a comment
says one thing and the code another), it is marked as such.

**Freshness caveat**: by the end of this read the concurrent merge session had staged
`hd/web-perf-a11y` into the index (48 files across `apps/web`, `packages/ui`, `packages/i18n`,
`pnpm-workspace.yaml`). Sections 2–4 describe the tree *before* that merge; §6 lists what each `hd/*`
branch brings, so treat §6 as the delta to apply on top of §2–4 as each branch lands.

Scope: what exists, where it lives, what it does, what it does not do. Product intent lives in
`docs/03-plan/FEATURE-PLAN.md`; the v1.1 asks live in `docs/03-plan/v1.1/BRIEF.md`.

---

## 1. Repo layout and package graph

### 1.1 Top level

| Path | What it is |
|---|---|
| `apps/api` | Fastify 5 API, `@devon/api` (`apps/api/package.json`) |
| `apps/web` | React 19 + Vite SPA, `@devon/web` (`apps/web/package.json`) |
| `packages/contracts` | `can()`, filter grammar, field tiers, Problem shapes — `@devon/contracts` |
| `packages/db` | Drizzle schema, raw SQL migrations, RLS, audit, outbox, demo seed — `@devon/db` |
| `packages/ui` | Design-system primitives, motion catalogue, shell pieces — `@devon/ui` |
| `packages/i18n` | Four-locale message store, merge/verify CLIs — `@devon/i18n` |
| `packages/ai` | GLM gateway, prompts, feature specs — `@devon/ai` |
| `packages/config` | Shared eslint / prettier / tsconfig / vitest / size-limit configs — `@devon/config` |
| `e2e/` | Playwright specs that run against the booted app (`devon-e2e`) |
| `infra/` | Compose stack, Caddy, backups, maintenance page, `infra/sentinel` (`@devon/sentinel`) |
| `tools/` | `tools/perf/` (k6, lighthouse, bundle), `tools/gate-mutation/` (mutation-tests the gates) |
| `agentic/` | Protocol, invariants, hardening checklist, gates, hooks, scripts, ledgers |
| `plugins/wp-agentic/` | The delivery system packaged as a Claude Code plugin |
| `docs/` | `01-research/` (25 reports), `03-plan/` (binding specs), `03-plan/v1.1/` (this round) |
| `scripts/start.mjs` | `pnpm start` / `pnpm dev` — boots Compose, migrates, starts api+web |
| `setup.mjs` | `pnpm setup` — first-run bootstrap |

Workspace definition: `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `saveExact: true`,
`engineStrict: true`, `shamefullyHoist: false`. Root `package.json` pins `pnpm@11.15.0`, Node
`>=22.11.0`, and one devDependency (`turbo@2.10.12`). `turbo.json` drives the task graph.

Note: `e2e/package.json` and `infra/sentinel/package.json` are **not** in the pnpm workspace globs —
they are standalone installs (`e2e/node_modules` exists on disk).

### 1.2 Package graph (from each `package.json`'s `dependencies`)

```
@devon/contracts   (zod only — the root of the graph, depends on nothing internal)
      ▲
      ├── @devon/db      (+ drizzle-orm, pg, @node-rs/argon2)
      ├── @devon/ai      (+ zod)
      ├── @devon/api     (+ @devon/db, @devon/ai, fastify, grammy, pg-boss, sharp, @aws-sdk/client-s3)
      └── @devon/web     (+ @devon/ui, @devon/i18n, react 19, @tanstack/react-query, tiptap, recharts,
                           motion, @atlaskit/pragmatic-drag-and-drop, @number-flow/react)

@devon/ui          (radix primitives, cmdk, vaul, sonner, motion, cva, tailwind-merge) — no internal deps
@devon/i18n        (zod) — no internal deps
@devon/config      (no deps) — consumed by every package's eslint/prettier/tsconfig/vitest
```

The rule is one-way: `contracts ← everything`, and `@devon/db` deliberately does **not** import
`@devon/contracts` — it re-declares the identical `Role` union in `packages/db/src/context.ts`
(documented in the header of `packages/contracts/src/permissions.ts`).

`apps/web` never imports `@devon/db` or `@devon/api`; each web feature keeps its own Zod copy of the
API response shapes in `apps/web/src/features/<name>/api.ts` and validates at the fetch boundary
(see the header of `apps/web/src/features/work/api.ts`).

### 1.3 Source sizes

| Package | `.ts`/`.tsx` files in `src` | test files |
|---|---:|---:|
| `apps/api/src` | 106 | 36 |
| `apps/web/src` | 183 | 11 |
| `packages/db/src` | 52 | 13 |
| `packages/ui/src` | 140 | 31 |
| `packages/ai/src` | 22 | 7 |
| `packages/contracts/src` | 5 | 4 |
| `packages/i18n/src` | 16 | 12 |

Last recorded gate run (`agentic/ledger/last-gate.json`, 2026-09-12T15:31Z, profile `fast`):
`apps/api` 226 tests in 28 files, all five fast gates PASS, zero skipped.

---

## 2. `apps/api` — modules, routes, permissions, jobs, events

### 2.1 Boot path

`apps/api/src/server.ts` is the only file allowed to read `process.env` or open a pool. It calls
`loadConfig(process.env)` (`apps/api/src/config.ts`), `createRepo()` (`apps/api/src/db/repo.ts`),
then `buildApp(deps, config)` (`apps/api/src/app.ts`), then starts three background workers and
`app.listen({ port: config.API_PORT, host: '0.0.0.0' })` (default port **3000**).

`buildApp()` registers, in this exact order (`apps/api/src/app.ts`):

1. `onSend` hook — `cache-control: private, no-store` unless already set, plus `x-request-id`.
2. `setErrorHandler` — RFC7807 `application/problem+json` for validation (422), body-too-large (413)
   and internal (500). Registered *before* any child plugin because Fastify snapshots the handler at
   child-registration time.
3. `@fastify/cookie`, `@fastify/rate-limit` (`global: false`), `@fastify/swagger`.
4. `sessionPlugin` (`apps/api/src/plugins/session.ts`) — resolves `req.actor`.
5. `registerAvailabilityGate(app)` (`apps/api/src/modules/admin/availability-gate.ts`) — maintenance
   mode and paused-department denies, deliberately between session and authorize.
6. `authorizePlugin` (`apps/api/src/plugins/authorize.ts`).
7. `storagePlugin` (`apps/api/src/plugins/storage.ts`) — adds `PUT`/`GET` local-driver object routes.
8. `healthRoutes` (`apps/api/src/modules/health.ts`), `openapiRoutes` (`apps/api/src/modules/openapi.ts`).
9. Every directory under `apps/api/src/modules/<name>/index.ts`, auto-discovered by
   `apps/api/src/module-loader.ts` (`readdirSync`, alphabetical), registered at
   `/api/v1${mod.prefix}` where `prefix` is the module's own `export const prefix`.

**Adding an API module requires no edit to `app.ts`.** That is the point of
`apps/api/src/module-loader.ts`.

### 2.2 The permission mechanism

`apps/api/src/plugins/authorize.ts`:

- An `onRoute` hook **throws at boot** if a route has no `config.permission`. There is no way to
  register a route without a permission declaration.
- `preHandler` runs `can(req.actor, permission.action, permission.subject(req))` and, on deny, sends
  `unauthenticated` (401) or a byte-identical `forbidden` (403, deliberately with no `instance` field
  so a matched and an unmatched `/api/v1/admin/*` are indistinguishable) and writes
  `audit.events{action:'access.denied'}` — but only for an authenticated actor (denial-audit DoS
  guard, P6).
- `PUBLIC_ROUTES` is a frozen checked-in allow-list of **11** entries, asserted against the routes
  actually registered `{public:true}` by `apps/api/test/unit/public-routes.test.ts`:
  `GET /healthz`, `GET /readyz`, `GET /api/v1/openapi.json`, `GET /api/v1/instance`,
  `POST /api/v1/setup/:token`, `POST /api/v1/auth/login`, `POST /api/v1/accounts/register`,
  `POST /api/v1/accounts/2fa/login-verify`, `GET /api/v1/departments/join/:key`,
  `GET /api/v1/notifications/ics/:userId/:token`, `POST /api/v1/telegram/webhook/:secret`.

`req.actor` is built by `apps/api/src/lib/actor.ts` (`buildActor`) from the user row plus
`listActiveMembershipsForUser`. `actor.departmentId` = **first membership by `joined_at`** — there is
still no department-switch endpoint, and the client mirrors the same fallback
(`useDepartment()` in `apps/web/src/lib/session.ts`).

`actor.viewAs` **is** wired despite the comment in `apps/api/src/lib/actor.ts` saying it is not:
`apps/api/src/plugins/session.ts:80` sets
`req.actor = { ...req.actor, departmentId, viewAs: { departmentId } }` from the admin view-as cookie
(`apps/api/src/modules/admin/view-as.ts`). The comment in `lib/actor.ts` is stale.

### 2.3 Route table

211 routes across 18 domain modules plus health/openapi/storage. Prefix per module from its
`export const prefix`. "Who passes" is derived from `packages/contracts/src/permissions.ts`.

Subject helpers used in the handlers:

| Helper | Subject kind | Who passes |
|---|---|---|
| `departmentChildSubject` | `department_child` | **any active member** of that department (head and member alike); a super admin only under a matching `viewAs`, and only for `read` |
| `departmentSubject` / `department` | `department` | any member for `read`/`create`/`archive`; **head only** for `update`/`delete` |
| `ownerSubject` | `personal` | **the owner only** — no head, no super admin, no view-as exception (I-1) |
| `ownAccount` | `own_account` | the account holder only |
| `instanceSubject` | `instance` | **super_admin only**, and only when `viewAs === null` |
| `instanceExitViewAsSubject` | `instance_exit_view_as` | super_admin, the one subject that tolerates an active `viewAs` |

#### `accounts` — prefix `/accounts` (`apps/api/src/modules/accounts/index.ts`)

18 routes, **all `own_account`** — registration, sessions/devices, TOTP, avatar, deletion:

```
POST   /register [PUBLIC, read]        POST /password/change [update]
GET    /sessions [read]                POST /sessions/:id/revoke, /sessions/revoke-all [update]
GET    /2fa [read]                     POST /2fa/totp/enroll, /2fa/totp/verify, /2fa/disable [update]
POST   /2fa/login-verify [PUBLIC, update]
POST   /avatar, /avatar/upload-url [update]   DELETE /avatar [update]
GET    /avatar/:userId/:uploadId/:size [read]
POST   /delete [delete]  POST /delete/cancel [update]  GET /delete/status [read]
POST   /:userId/reset-password [administer]
```

Supporting files: `apps/api/src/modules/accounts/avatar-service.ts` (sharp resize + presigned put),
`crypto.ts`, `totp.ts`, `upload-sweeper.ts` (hourly retention sweep of abandoned presigned uploads,
started from `server.ts`), `repo.ts`, `schemas.ts`.

#### `admin` — prefix `/admin` (`apps/api/src/modules/admin/index.ts`)

29 routes, **every one `administer` on `{kind:'instance'}` — super_admin only**, except
`POST /api/v1/admin/view-as/stop` which uses `instance_exit_view_as`.

```
GET   /instance | /health | /maintenance | /analytics      PATCH /maintenance | /registration
GET   /departments | /departments/:id    POST /departments/:id/{pause,resume,archive,restore,view-as}
GET   /accounts | /accounts/:id          POST /accounts/:id/{lock,unlock,force-2fa-reset,anonymize}
GET   /audit/{events,export,verify}
GET   /wipe/status      POST /wipe/{start,execute,cancel}
GET   /sentinel/status  POST /sentinel/rotate-key       POST /view-as/stop
```

The module also installs a scoped `setNotFoundHandler` that calls `denyForSubject` so an unmatched
`/api/v1/admin/*` returns the *same* 403 body as a matched-but-denied one (see the header of
`apps/api/src/plugins/authorize.ts`). `apps/api/src/modules/admin/sentinel-client.ts` and
`sentinel-protocol.ts` speak to the host wipe sentinel (`infra/sentinel`);
`apps/api/src/modules/admin/crypto.ts` derives its key without a new `.env` var.

#### `ai` — prefix `/ai` (`apps/api/src/modules/ai/index.ts`)

```
POST   /api/v1/ai/features/:feature/run   create  featureRunSubject
GET    /api/v1/ai/settings                read    department_child   (any member)
PATCH  /api/v1/ai/settings                update  department         (HEAD ONLY)
GET    /api/v1/ai/usage                   read    department_child   (any member)
```

`PATCH /api/v1/ai/settings` is one of only two places in the whole API where a `{kind:'department'}` +
`update` subject actually restricts to the head.

#### `analytics` — prefix `/analytics` (`apps/api/src/modules/analytics/index.ts`)

11 routes, all `department_child` — **any member** reads and writes:

```
GET /summary | /personal | /export.csv
GET/POST /pins    DELETE /pins/:id    POST /pins/reorder
GET/POST /saved-filters    PATCH/DELETE /saved-filters/:id
```

`apps/api/src/modules/analytics/aggregate.ts` holds `recomputeDay()` and
`startAnalyticsRecomputeWorker()`; `filter.ts` applies the shared grammar; `csv.ts` renders the
export; `repo.ts` does the SQL.

#### `auth` — prefix `/auth` (`apps/api/src/modules/auth/index.ts`)

```
POST   /api/v1/auth/login    [PUBLIC]   (dummy-hash timing guard at index.ts:25)
POST   /api/v1/auth/logout   read
```

#### `departments` — prefix `/departments` (`apps/api/src/modules/departments/index.ts`)

The one module that actually uses the head distinction at the `can()` layer:

```
own_account:      GET /mine   POST /requests   GET /requests/mine
                  GET /join/:key [PUBLIC]      POST /join
instance (SUPER): GET /requests   POST /requests/:id/approve   POST /requests/:id/reject
department_child: GET /:id   GET /:id/members   POST /:id/leave
department (HEAD): PATCH /:id/settings
                  GET /:id/invite   PATCH /:id/invite/approval
                  POST /:id/invite/{password,rotate-key,rotate-password}
                  POST /:id/members/:userId/{remove,transfer-headship}
                  POST /:id/deletion-request
```

#### `events` — prefix `/events` (`apps/api/src/modules/events/index.ts`)

28 routes, **all `department_child`** — the head/member split is enforced *inside* handlers via
`currentActor(req).isHead` (defined at `apps/api/src/modules/events/index.ts:73-78`, used at lines
128, 162, 345 and 503 — the create/edit/cancel/photo-moderation paths).

```
GET/POST /            GET/PATCH /:eventId       POST /:eventId/cancel
POST /:eventId/rsvp   GET /:eventId/rsvps
GET/POST /:eventId/carpools    POST/DELETE /:eventId/carpools/:carpoolId/claim
GET/POST /:eventId/comments    DELETE /:eventId/comments/:commentId
GET/POST /:eventId/items       POST/DELETE /:eventId/items/:itemId/claim
GET/POST /:eventId/polls       POST /:eventId/polls/:pollId/vote
GET/POST /:eventId/photos      DELETE /:eventId/photos/:photoId
GET/POST /:eventId/feedback    GET /:eventId/ics     GET /ics/me
```

Also: `apps/api/src/modules/events/logic.ts` (waitlist/capacity), `ics.ts`, `service.ts`,
`errors.ts`, and `reminder-worker.ts` (30 s `setInterval` poller over `app.event_reminder_jobs`,
started from `apps/api/src/server.ts`).

#### `instance`, `me`, `setup` — all prefix `''`

```
GET    /api/v1/instance   [PUBLIC]  — setupRequired, registrationOpen, maintenance, locales
GET    /api/v1/me [read]   PATCH /api/v1/me [update]
POST   /api/v1/setup/:token [PUBLIC] — first-run super-admin bootstrap
```

Files: `apps/api/src/modules/{instance,me,setup}/index.ts`.

#### `notifications` — prefix `''` (`apps/api/src/modules/notifications/index.ts`)

13 routes, each carrying its own `/notifications` segment:

```
GET  /notifications [read]        POST /notifications/read | /read-all [update]
POST /notifications/archive [archive]     POST /notifications/:id/snooze [update]
GET/PUT /notifications/prefs | /quiet-hours | /departments/:departmentId/settings
GET  /notifications/ics-token [read]
GET  /notifications/ics/:userId/:token [PUBLIC — HMAC token verified in-handler]
```

Supporting files: `delivery.ts`, `events.ts` (domain-event intake), `ics.ts`, `jobs.ts` (pg-boss),
`notify.ts`, `quiet-hours.ts`, `repo.ts`, `schemas.ts`.

#### `pages` — prefix `/pages` (`apps/api/src/modules/pages/index.ts`)

12 routes, all `department_child` (any member creates, edits and deletes pages and onboarding
templates):

```
GET/POST /    GET/PATCH/DELETE /:id
GET /:id/versions    GET /:id/versions/:versionId    POST /:id/versions/restore
GET/POST /onboarding/templates    PATCH/DELETE /onboarding/templates/:id
```

#### `personal` — prefix `/personal` (`apps/api/src/modules/personal/index.ts`)

24 routes, **all `{kind:'personal'}` owner-only** (`ownerSubject`). This is the I-1 boundary — no head
or super-admin path exists at all, in `can()` or in RLS.

```
GET/POST /tasks    PATCH/DELETE /tasks/:id    POST /tasks/reorder
GET/POST /sprints  PATCH /sprints/:id         POST /sprints/:id/rollover
GET/POST /notes    PATCH/DELETE /notes/:id
GET/POST /canvases GET/PATCH/DELETE /canvases/:id
GET/PATCH /pomodoro/settings   GET/POST /pomodoro/sessions   PATCH /pomodoro/sessions/:id
GET /pomodoro/stats
```

#### `projects` — prefix `''` (`apps/api/src/modules/projects/index.ts`)

8 routes, all `department_child`:

```
GET/POST /api/v1/projects    GET/PATCH /api/v1/projects/:id
POST /api/v1/projects/:id/milestones    PATCH /api/v1/projects/:id/milestones/:milestoneId
GET  /api/v1/projects/templates         POST /api/v1/projects/from-template
```

#### `structure` — prefix `''` (`apps/api/src/modules/structure/index.ts`)

10 routes, all `department_child` at the `can()` layer — the head check happens in
`apps/api/src/modules/structure/repo.ts` via `actorRoleInDept: 'head' | 'member'` plus the
department's `allow_structure_edit` setting (`repo.ts:143-165`; `roleInDepartment()` at
`index.ts:45`). This is the only module that models "the head, *or* a member when the head opened it
up".

```
GET /api/v1/departments/:departmentId/roster
GET/POST .../units    PATCH/DELETE .../units/:unitId    POST .../units/:unitId/restore
POST .../units/reorder
GET/POST .../unit-roles     DELETE .../unit-roles/:unitRoleId
```

#### `telegram` — prefix `''` (`apps/api/src/modules/telegram/index.ts`)

```
POST /telegram/link-code [create]   GET /telegram/status [read]
POST /telegram/mute [update]        POST /telegram/unlink [delete]
POST /telegram/departments/:departmentId/connect-code [create]
GET  /telegram/departments/:departmentId/groups [read]
PATCH/DELETE /telegram/departments/:departmentId/groups/:groupId
POST /telegram/webhook/:secret      [PUBLIC — path-secret verified in handler]
```

Bot commands (`apps/api/src/modules/telegram/bot.ts`): `/start <code>` (line 92), `/help` (115),
`/today` (119), `/mytasks` (136), `/events` (149), `/mute` (165), `/connect` (183). Message templates
in `templates.ts`, send path in `transport.ts`, deep-link pointers in `pointer.ts`.

#### `work` — prefix `''` (`apps/api/src/modules/work/index.ts`) — routes are bare under `/api/v1`

19 routes, **all `department_child`** — no head/member distinction anywhere in this module:

```
GET /api/v1/board    GET /api/v1/archive    GET/POST /api/v1/cards    GET/PATCH /api/v1/cards/:id
GET /api/v1/cards/:id/activity
POST /api/v1/cards/:id/{checklist,comments,watchers,restore}
PATCH/DELETE /api/v1/cards/:id/checklist/:itemId
GET/POST /api/v1/labels    GET/POST /api/v1/views    DELETE /api/v1/views/:id
POST /api/v1/links/unfurl
```

(Confirmed against the client: `apps/web/src/features/work/api.ts` calls `/api/v1/board`,
`/api/v1/cards`, `/api/v1/labels`, `/api/v1/views`, `/api/v1/links/unfurl`.)
`apps/api/src/modules/work/link-unfurl.ts` carries an SSRF guard (`UnsafeUrlError`);
`context.ts` builds the tx context.

#### Non-module routes

- `GET /healthz`, `GET /readyz` — `apps/api/src/modules/health.ts`, both public.
- `GET /api/v1/openapi.json` — `apps/api/src/modules/openapi.ts`, public.
- `PUT` / `GET` object routes for the local storage driver — `apps/api/src/plugins/storage.ts:119,151`.

### 2.4 Background jobs

| Job | Where started | Schedule | File |
|---|---|---|---|
| Outbox drain (`startEventsWorker`) | `apps/api/src/server.ts` | polling loop | `packages/db/src/events-worker.ts` |
| Event reminder scan | `apps/api/src/server.ts` | `setInterval`, 30 s | `apps/api/src/modules/events/reminder-worker.ts:95-102` |
| Upload retention sweep | `apps/api/src/server.ts` | `setInterval`, hourly | `apps/api/src/modules/accounts/upload-sweeper.ts:34` |
| `reminder.due` | notifications plugin body | pg-boss cron `0 * * * *` (Asia/Tashkent) | `apps/api/src/modules/notifications/jobs.ts:188` |
| `digest.personal` | notifications plugin body | pg-boss cron `30 8 * * *` | `apps/api/src/modules/notifications/jobs.ts:189` |
| `digest.department` | notifications plugin body | pg-boss cron `0 18 * * 5` (Friday 18:00) | `apps/api/src/modules/notifications/jobs.ts:190` |
| Analytics nightly recompute | analytics plugin body | pg-boss cron, 02:00 Asia/Tashkent | `apps/api/src/modules/analytics/aggregate.ts:191-214` |

None of the `server.ts` workers start from `buildApp()`, so unit tests never pick up a timer
(comment in `apps/api/src/server.ts`).

### 2.5 Domain events

Mechanism: `tx.emit()` inserts into `app.outbox_events` **in the same transaction as the write that
caused it** (`packages/db/src/events.ts`, `packages/db/migrations/0007_events_outbox.sql`). Naming
convention `'<module>.<noun>.<verb-past>'`. Subscribers treat payloads as `unknown`.

**Emitted** (26 `.emit(` call sites across `apps/api/src/modules/`):

```
accounts.user.registered
departments.department.created, departments.member.joined, departments.request.created
structure.unit.created / .updated / .deleted / .restored / .reordered
structure.unit_role.assigned / .unassigned
work.card.created, work.card.updated, work.card.commented
projects.project.created
events.event.created / .updated / .cancelled / .reminder_due
events.rsvp.changed, events.comment.created, events.poll.created
events.carpool.created, events.carpool.seat_claimed
notifications.notification.created, notifications.action.requested
```

**Consumed**: exactly one subscriber, `subscribe('*', …)` at
`apps/api/src/modules/notifications/events.ts:142`, dispatching through `EVENT_REGISTRY`
(`events.ts:23-36`), which maps twelve event names to an inbox `Reason`:

```
work.card.assigned→assigned            work.card.comment.mentioned→mentioned
work.card.due→due                      work.card.updated→updated
work.card.comment.created→updated      events.event.rsvp_reminder→rsvp
events.event.updated→updated           events.event.cancelled→updated
events.poll.opened→poll                events.poll.closing_soon→poll
pages.decision.recorded→decision       memberships.member.joined→system
```

**This is a live mismatch** — see §7.1.

---

## 3. `apps/web` — features, routes, screens, roles

### 3.1 Shell

`apps/web/src/main.tsx` → `apps/web/src/app.tsx`. Routing is hand-rolled
(`apps/web/src/lib/router.tsx`): `apps/web/src/app.tsx:58` calls `matchFeatureRoute(path)` from
`apps/web/src/features/registry.ts` **first**, and only falls through to the four core routes —
`HomeRoute` (`apps/web/src/routes/home.tsx`), `LoginRoute` (`routes/login.tsx`), `SetupRoute`
(`routes/setup.tsx`), `NotFoundRoute` (`routes/not-found.tsx`).

Feature routes are **exact-path only** — no params, no wildcards
(`apps/web/src/features/types.ts`, `FeatureRoute.path`). That is why detail screens use query
strings: `/work/card?id=…`, `/projects/view?id=…`, `/department`, `/events?new=1`.

Shell pieces in `apps/web/src/shell/`: `app-shell.tsx`, `auth-shell.tsx`,
`command-palette-controller.tsx`, `palette-context.tsx`, `route-error-boundary.tsx`,
`forced-state-block.tsx` (the `?forceState=` debug harness — see `apps/web/src/lib/forced-state.ts`),
`use-shell-shortcuts.ts`, `nav.ts`.

`apps/web/src/features/registry.ts` discovers manifests with
`import.meta.glob(['./*/manifest.ts','./*/manifest.tsx'], { eager: true })` and **throws** if a
manifest's `name` disagrees with its directory. Adding a web feature requires no edit to the shell.

### 3.2 Navigation registry

`apps/web/src/shell/nav.ts`:

- `CORE_NAV_ENTRIES` = `home` (`/`) and `admin` (`/admin`, `visibleWhen: ctx.role === 'super_admin'`).
- `NAV_ENTRIES` = core + every manifest's `sidebar`, wrapped by `requireDepartmentFor()`, which adds
  `ctx.hasDepartment !== false` to nine department-scoped ids: `work, projects, personal, events,
  people, structure, pages, analytics, ai`. `departments` and `department-requests` are deliberately
  excluded so a membership-less account can still discover or request a department.
- `NAV_GROUPS` — five groups: `top` (home, inbox), `work` (work, projects, personal), `team` (events,
  people, structure), `knowledge` (pages, analytics, ai), `manage` (departments,
  department-requests, account-settings, admin). An ungrouped entry still renders (appended by
  `Sidebar`).
- `MOBILE_TAB_IDS` = `home, work, personal, events, inbox`, with short label keys in
  `MOBILE_TAB_SHORT_LABEL_KEYS` (no ellipsis allowed — DESIGN.md §3.5).

`resolveNavEntries` / `NavContext` / `NavEntry` live in `packages/ui/src/shell/nav-registry.ts`.

### 3.3 Feature manifests — routes, sidebar, palette, quick-add, roles

`FeatureManifest` shape: `apps/web/src/features/types.ts` — `name`, `routes`, optional `sidebar`,
`commands`, `quickAdd`, `useSidebarCounts`.

| Feature | Routes (path → screen file) | Sidebar | Palette | Quick-add | Role visibility |
|---|---|---|---|---|---|
| `home` (`features/home/manifest.tsx`) | `/` → `home-screen.tsx` | — (core entry) | — | — | everyone |
| `work` (`features/work/manifest.tsx`) | `/work`→`components/board-screen.tsx`, `/work/table`→`table-screen.tsx`, `/work/timeline`→`timeline-screen.tsx`, `/work/calendar`→`calendar-screen.tsx`, `/work/mine`→`mine-screen.tsx`, `/work/archive`→`archive-screen.tsx`, `/work/card`→`card-page-screen.tsx` | `work` | `work.mine`, `work.table` | `work.newCard`→`/work` | any member; **no head gate** |
| `projects` (`features/projects/manifest.tsx`) | `/projects`→`components/projects-list-screen.tsx`, `/projects/view`→`components/project-page-screen.tsx` | `projects` | — | `projects.newProject`→`/projects?new=1` | any member |
| `personal` (`features/personal/manifest.tsx`) | `/personal`→`personal-screen.tsx` | `personal` | `personal.open` | — | owner-only data; route visible to any member |
| `events` (`features/events/manifest.tsx`) | `/events`→`events-screen.tsx` | `events` | `events.create`→`/events?new=1` | `events.newEvent` | any member; head-only actions gated server-side |
| `structure` (`features/structure/manifest.tsx`) | `/structure`→`structure-screen.tsx`, `/people`→`people-screen.tsx` | `structure`, `people` | — | — | any member; edit gated by role + `allowStructureEdit` |
| `pages` (`features/pages/manifest.tsx`) | `/pages`→`pages-screen.tsx` | `pages` | `pages.open` | — | any member |
| `analytics` (`features/analytics/manifest.tsx`) | `/analytics`→`analytics-screen.tsx` | `analytics` | `analytics.open` | — | any member |
| `ai` (`features/ai/manifest.ts`) | `/ai`→`ai-settings-screen.tsx` | `ai` | `ai.open` | — | any member reads; `isHead` gates the form (`ai-settings-screen.tsx:134,192,245,251`) |
| `inbox` (`features/inbox/manifest.ts`) | `/inbox`→`inbox-screen.tsx`, `/inbox/preferences`→`preferences-screen.tsx`, `/inbox/telegram`→`telegram-screen.tsx` | `inbox` + `useSidebarCounts` (unread count, reuses the inbox list query) | `inbox.preferences`, `inbox.telegram` | — | everyone; group cards `isHead`-only (`telegram-screen.tsx:426,434`) |
| `departments` (`features/departments/manifest.ts`) | `/departments`→`departments-hub-screen.tsx`, `/departments/new`→`create-request-screen.tsx`, `/departments/requests`→`approval-queue-screen.tsx`, `/department`→`department-detail-screen.tsx`, `/join`→`join-screen.tsx` | `departments`; `department-requests` (`visibleWhen: role === 'super_admin'`) | `departments.create`, `departments.join` | — | detail tabs gated: `invite` and `danger` are `isHead` only (`department-detail-screen.tsx:736-738`) |
| `accounts` (`features/accounts/manifest.ts`) | `/register`→`register-screen.tsx`, `/account`→`account-settings-screen.tsx` | `account-settings` | — | — | everyone |
| `admin` (`features/admin/manifest.ts`) | `/admin`→`dashboard-screen.tsx`, `/admin/departments`→`departments-screen.tsx`, `/admin/accounts`→`accounts-screen.tsx`, `/admin/analytics`→`analytics-screen.tsx`, `/admin/audit`→`audit-screen.tsx`, `/admin/health`→`health-screen.tsx`, `/admin/settings`→`settings-screen.tsx` | — (core `admin` entry) | six entries, one per tab | — | super_admin only (core nav `visibleWhen` + server 403) |

Screens with internal tabs rather than routes:

- `/personal` — six tabs in `apps/web/src/features/personal/personal-screen.tsx:22-35`:
  `today, sprints, tasks, notes, canvas, pomodoro`; the Pomodoro widget renders in the page header on
  every tab (`pomodoro-widget.tsx`). Last tab persisted in `localStorage` under
  `devon.personal.requestedTab`.
- `/department` — `general | invite | members | danger`
  (`apps/web/src/features/departments/department-detail-screen.tsx:735-738`).
- `/admin/*` — one route per tab plus a shared `apps/web/src/features/admin/tabs.tsx` and
  `view-as-banner.tsx`.
- `/events` — one screen with a detail dialog and seven panels under
  `apps/web/src/features/events/components/`: `rsvp-panel`, `carpool-panel`, `polls-panel`,
  `items-panel`, `photos-panel`, `feedback-panel`, `comments-panel`.
- `/work` — `work-shell.tsx` wraps the six view screens; `filter-bar.tsx`,
  `filter-clause-chips.tsx`, `quick-add-bar.tsx`, `card-peek-dialog.tsx`, `card-detail.tsx`,
  `member-picker.tsx`, `dnd-announcer.tsx`, `touch-drag-preview.tsx` are shared.

### 3.4 Session and department context

`apps/web/src/lib/session.ts`: `Session` type at line 88; `Department = { departmentId, name, role:
'head'|'member' }` at line 127; `useDepartment()` at lines 132-160 picks the server's active
department, or a valid `localStorage` override, or the first membership.

`apps/web/src/lib/api-client.ts` is the one fetch wrapper; `api-schemas.ts` holds shared response
shapes; `query-client.ts` configures TanStack Query; `theme.ts`, `locale-boot.ts`, `use-online.ts`,
`use-media-query.ts`, `use-viewport-bounded-height.ts`, `avatar.ts`, `greeting.ts`, `constants.ts`
round it out. `apps/web/src/lint/` holds the app-local ESLint rules.

### 3.5 Role branching actually present in the client

A grep for `isHead` / `role === 'head'` across `apps/web/src` finds it in exactly five files:
`features/ai/ai-settings-screen.tsx`, `features/departments/department-detail-screen.tsx`,
`features/departments/departments-hub-screen.tsx`, `features/inbox/telegram-screen.tsx`,
`features/structure/structure-screen.tsx` (plus `features/structure/org-chart.tsx` and
`features/admin/accounts-screen.tsx`, which only *display* the role).
`apps/web/src/features/home/home-screen.tsx` branches only on `user.role === 'super_admin'`
(line 513) — **the head and the member see the same Home**. That is exactly CTO finding #2 in
`docs/03-plan/v1.1/BRIEF.md`.

---

## 4. Packages

### 4.1 `packages/db`

**Migrations** — `packages/db/migrations/`, expand-only, never edited once applied (I-15). 25 files:

Format is `<NNNN>_<name>.sql`, `0000`–`0007` foundation then `0100`+ one band per module
(`tables` / `policies` counted by `create table` / `create policy`):

| File | T | P | File | T | P |
|---|---:|---:|---|---:|---:|
| `0000_extensions` | 0 | 0 | `0302_work_rls` | 0 | 16 |
| `0001_roles` | 0 | 0 | `0303_memberships_self_read_rls` | 0 | 1 |
| `0002_audit` | 3 | 0 | `0400_events` | 12 | 11 |
| `0003_identity` | 6 | 0 | `0500_personal` | 6 | 6 |
| `0004_departments` | 2 | 0 | `0600_notifications` | 5 | 6 |
| `0005_rls` | 0 | 4 | `0601_telegram` | 4 | 0 |
| `0006_normalize_uz` | 0 | 0 | `0602_pgboss_schema` | 0 | 0 |
| `0007_events_outbox` | 1 | 0 | `0603_pgboss_database_create` | 0 | 0 |
| `0100_accounts_departments` | 5 | 1 | `0700_analytics_pages` | 7 | 14 |
| `0101_accounts_uploads` | 1 | 0 | `0800_ai` | 2 | 4 |
| `0200_structure` | 2 | 4 | `0900_admin_wipe_sentinel` | 2 | 0 |
| `0300_work_cards` | 7 | 0 | `0901_memberships_super_admin_read_rls` | 0 | 1 |
| `0301_work_projects` | 1 | 0 | | | |

**64 base tables** across schemas `app` and `audit`. Classification is mandatory: every table must
appear in `packages/db/src/tenancy.ts`'s `TENANCY` map or
`packages/db/test/tenancy.registry.test.ts` (run by the `migrate` gate) fails the build. A `global`
table additionally needs a one-line justification in the same file's `GLOBAL_ALLOWLIST`.

Tables by module and class (source: `packages/db/src/tenancy.ts`):

| Module | `department_owned` (`department_id` + RLS) | `user_owned` (`user_id` + RLS) | `global` (no RLS) |
|---|---|---|---|
| core/identity | `departments` (class `tenant_root`), `memberships` | — | `users`, `sessions`, `setup_tokens`, `instance_settings`, `seed_runs`, `idempotency_keys`, `outbox_events`, `_migrations` |
| accounts | — | — | `user_security`, `login_challenges`, `join_attempts`, `account_deletion_requests`, `uploads`, `department_requests` |
| structure | `units`, `unit_roles` | — | — |
| work | `cards`, `card_checklist_items`, `card_comments`, `card_activity`, `attachments`, `labels`, `saved_views` | — | — |
| projects | `projects` | — | — |
| personal | — | `personal_sprints`, `personal_tasks`, `personal_notes`, `personal_canvases`, `pomodoro_settings`, `pomodoro_sessions` | — |
| events | `events`, `event_rsvps`, `event_comments`, `carpools`, `carpool_seats`, `event_items`, `polls`, `poll_options`, `poll_votes`, `event_photos`, `event_feedback` | — | `event_reminder_jobs` |
| notifications | `notification_department_settings` | `notifications`, `notification_prefs`, `notification_quiet_hours`, `notification_deliveries` | — |
| telegram | — | — | `telegram_link_codes`, `telegram_links`, `telegram_group_connect_codes`, `telegram_groups` |
| analytics | `analytics_daily`, `analytics_saved_filters`, `analytics_pinned_charts` | — | — |
| pages | `pages`, `page_versions`, `onboarding_templates`, `onboarding_runs` | — | — |
| ai | `ai_department_settings`, `ai_traces` | — | — |
| admin | — | — | `wipe_requests`, `sentinel_keys` |
| audit | — | — | `audit.events`, `audit.private_reads`, `audit.anchors` (class `audit`) |

**RLS policy names** (from `create policy` statements in `packages/db/migrations/*.sql`) follow three
shapes, plus carve-outs:

- Split read/write — `<table>_read` (`for select`) + `<table>_write` (`for all`): `cards`,
  `card_checklist_items`, `card_comments`, `card_activity`, `attachments`, `labels`, `saved_views`,
  `projects`, `pages`, `page_versions`, `onboarding_templates`, `onboarding_runs`, `analytics_daily`,
  `analytics_saved_filters`, `analytics_pinned_charts`, `ai_department_settings`, `ai_traces`,
  `departments`, `memberships`, `notification_department_settings`.
- Single `for all` — `<table>_scope`: `units`, `unit_roles`, all eleven events tables,
  `notifications`, `notification_prefs`, `notification_quiet_hours`, `notification_deliveries`.
- Owner-only — `<table>_owner`: the four `personal_*` tables plus `pomodoro_settings` and
  `pomodoro_sessions`. These deliberately contain **no** `current_actor_role()` branch
  (`packages/db/src/rls.ts`, `userTableDDL`).
- Carve-outs: `departments_self_read`, `memberships_self_read` (`0303_…`), `memberships_read_own`,
  and a `memberships_read` re-created in `0901_…` for the super-admin read.

The GUC accessors every policy reads are named once in `packages/db/src/rls.ts`:
`app.current_department_id()`, `app.current_user_id()`, `app.current_actor_role()`,
`app.is_view_as()` (created in `packages/db/migrations/0005_rls.sql`). `departmentTableDDL()` and
`userTableDDL()` generate the canonical shape for a new table and are exercised generically by
`packages/db/test/tenancy.registry.test.ts`.

**Other `packages/db/src` files**: `context.ts` (transaction lifecycle, GUC set, `reviveTimestamps`),
`audit.ts` (append-only audit insert), `events.ts` + `events-worker.ts` (outbox + drain),
`tiers.ts` (field tiers), `normalize-uz.ts`, `migrate.ts` / `cli-migrate.ts`,
`schema/*.ts` (16 Drizzle mirror files, used by the seed only — the API queries via `tx.raw()`),
`seed/` (`fixtures.ts`, `demo.ts`, `guard.ts`, `scope.ts`, `ids.ts`, `module-loader.ts`,
`work-fixtures.ts`, four CLIs, and 13 per-module seeders under `seed/modules/`).

### 4.2 `packages/contracts`

Five source files: `permissions.ts`, `filter-grammar.ts`, `field-tiers.ts`, `problem.ts`, `index.ts`.

`packages/contracts/src/permissions.ts` (162 lines) is the whole authorization model:

- `Role = 'super_admin' | 'head' | 'member'` (I-8b — unit roles are labels, never permissions).
- `Action = 'read' | 'create' | 'update' | 'archive' | 'delete' | 'administer'`.
- `Subject` kinds: `instance`, `instance_exit_view_as`, `department`, `department_child`, `personal`,
  `own_account`, `audit`, `public`.
- `DenyReason`: `not_authenticated`, `not_super_admin`, `not_a_member`, `not_head`, `not_owner`,
  `read_only_view_as`, `department_paused`, `maintenance`.

The matrix, as encoded in `can()`:

| Subject | super_admin | head (member of that dept) | member (of that dept) | non-member |
|---|---|---|---|---|
| `public` | allow | allow | allow | allow |
| `instance` | allow **iff `viewAs === null`** | `not_super_admin` | `not_super_admin` | `not_super_admin` |
| `instance_exit_view_as` | allow (even under `viewAs`) | deny | deny | deny |
| `audit` | allow iff `viewAs === null` (no route uses it) | deny | deny | deny |
| `personal` | **deny unless owner** | **deny unless owner** | allow iff owner | deny |
| `own_account` | allow iff same `userId` | same | same | deny |
| `department` — `read`/`create`/`archive` | `read` only, and only under matching `viewAs` | allow | allow | `not_a_member` |
| `department` — `update`/`delete` | `read_only_view_as` | allow | **`not_head`** | `not_a_member` |
| `department_child` — `read` | allow under matching `viewAs` | allow | allow | `not_a_member` |
| `department_child` — any write | `read_only_view_as` | allow | **allow** | `not_a_member` |

The last row is the structural reason for CTO finding #1: **`department_child` gives a member exactly
the same rights as the head**, and about 180 of the 211 routes use it. `actingFor` is always ignored
by `can()` (no grants table exists — P7, fail-closed).

`packages/contracts/src/filter-grammar.ts` exports `parseFilterQuery` / `matchesFilterQuery` /
`FilterableCard`, shared by `apps/api/src/modules/work/index.ts` and the analytics filter bar.

### 4.3 `packages/ui`

`packages/ui/src/index.ts` (186 lines) is the only public entry; deep imports are not allowed.

- `styles/tokens.css` + `fonts.css` — exported as package subpaths, consumed as CSS, not JS.
- `lib/` — `cn`, `platform` (`isMacPlatform`, `modKeyLabel`), `use-reduced-motion`,
  `use-fonts-loaded`, `label-color`, `motion-tokens`.
- `motion/` (the UI-OVERHAUL §3 catalogue, re-exported wholesale): `tokens`, `motion-provider`,
  `page-transition`, `reveal`, `stagger`, `collapsible`, `hover-lift`, `hover-card`,
  `ambient-gradient`, `animated-check`, `celebrate`, `progress-ring`, `shimmer`, `view-transition`,
  `use-view-transition-theme`.
- `primitives/` (~40): `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Field`, `Kbd`/`ModKbd`,
  `Badge`, `Avatar` (+ `AvatarStack`, `unitHueClass`), `Separator`, `Skeleton`, `Tooltip`, `Dialog`,
  `DropdownMenu`, `Popover`, `HoverCard`, `Tabs`, `Checkbox`, `Switch`, `RadioGroup`, `Chip`,
  `Combobox`, `DatePicker`, `Progress`, `Breadcrumb`, `Card`, `KpiTile`, `StatNumber`,
  `DataList`/`DataRow`, `PageHeader`, `SparkleButton`, `AiPreviewPanel`, `Toast` (sonner),
  `Sheet` (vaul).
- `shell/`: `Sidebar` (+ `NavGroup`), `TopBar`, `BottomTabBar`, `CommandPalette`, `SearchTrigger`,
  `QuickAdd`, `InboxBell`, `AvatarMenu`, `LocaleMenu`, `ThemeToggle`, `DemoChip`,
  `DepartmentSwitcher`, `ShortcutOverlay`, `SidebarUserBlock`, `PageContainer`, `nav-registry.ts`.
- `states/`: `StateView`, `EmptyState`, `OfflineBanner` — the
  empty/loading/error/no-permission/offline contract. `illustrations/` — open-licence set recoloured
  to tokens. `lint/no-shell-truncate.js` — a custom ESLint rule enforcing DESIGN.md §3.5 (the shell
  may not ellipsize). Storybook is configured, with a `*.stories.tsx` beside most primitives plus
  `foundations/{formatting,glyphs}.stories.tsx`.

### 4.4 `packages/i18n`

- Per-module sources: `packages/i18n/messages/modules/<module>/<locale>.json` for 14 modules
  (`accounts, admin, ai, analytics, departments, events, home, inbox, pages, personal, projects,
  structure, telegram, work`) × 4 locales. Shell/global keys live in
  `packages/i18n/messages/<locale>.json` (146 keys each).
- Merged output: `packages/i18n/messages/<locale>.generated.json` — **1845 keys per locale**,
  produced by `pnpm --filter @devon/i18n messages:merge`
  (`packages/i18n/src/cli/merge-messages.ts`) and committed.
- Locales `uz-Latn` (default), `uz-Cyrl`, `ru`, `en` — also listed in `agentic/gates.json`
  (`limits.locales`). Runtime:
  `packages/i18n/src/{t,react,store,locale,format,terms,transliterate,normalize-uz,env,messages}.ts`.
- CLIs under `packages/i18n/src/cli/`: `merge-messages`, `terms-build`, `terms-verify`,
  `break-locale-key` (deliberately breaks `ru` or `uz-Cyrl` to prove the gate catches it),
  `break-hardcoded`. `packages/i18n/banned.json` holds banned phrasings.
- The `i18n` gate (`agentic/scripts/check-i18n.mjs`) last reported
  `locales=uz-Latn,uz-Cyrl,ru,en keys=1845 used=1106 errors=0` — i.e. **739 defined keys are not
  referenced anywhere** in the app.

### 4.5 `packages/ai`

- `gateway.ts` — the single `run()`: history trim → provider call → "empty content +
  `finish_reason: length` ⇒ retry with doubled `max_tokens`" → tool-call extraction → Zod validation
  with exactly one retry carrying the validation error back → cost/latency accounting. Nothing above
  it touches `AiProvider`. Providers: `glm-provider.ts` (the configured GLM endpoint),
  `mock-provider.ts` (tests/evals).
- `features.ts` + `feature-spec.ts` — each feature declares `systemPrompt(input)`,
  `buildUserContent(input)`, an input schema and an output tool schema; one prompt file each under
  `packages/ai/src/prompts/`.
- `AiFeature` union (`packages/ai/src/types.ts:79-90`), ten features: `quick_add_parse`,
  `subtask_breakdown`, `plan_sprint`, `deadline_risk`, `weekly_summary`, `draft_event`,
  `summarize_thread`, `nl_analytics`, `translate`, `what_did_i_miss`.
- `budget.ts` (`tokensToCostUzs`), `config.ts` (`minMaxTokens >= 1024`), `trim.ts`,
  `locale-prompt.ts`, `schemas.ts`. `pnpm --filter @devon/ai evals` is a declared gate
  (`agentic/gates.json` → `ai-evals`, non-blocking locally, blocking on release).

Client side: `apps/web/src/features/ai/feature-forms.ts` declares one form per feature;
`assistant-panel.tsx` renders it; `use-ai.ts` runs it; `@devon/ui`'s `AiPreviewPanel` and
`SparkleButton` are the shared surface. Other in-product AI entry points:
`apps/web/src/features/personal/lib/use-quick-add-ai.ts` and `lib/ai-helpers.ts`,
`apps/web/src/features/analytics/ask-analytics.tsx`, and
`apps/web/src/features/events/components/event-form-dialog.tsx` (`events.form.aiIdeaPlaceholder`).

### 4.6 `packages/config` and `infra/sentinel`

`packages/config` — shared configuration consumed by every other package: `eslint/`, `prettier/`,
`tsconfig/`, `vitest/`, `size-limit/`, `test/` (each with its top-level entry file). No runtime deps.

`infra/sentinel` (`@devon/sentinel`) — a standalone Node package (not in the pnpm workspace)
implementing the host-side wipe sentinel that `apps/api/src/modules/admin/sentinel-client.ts` talks
to. Scripts `start`, `prove`, `keygen`, `wipe`, `test`; helpers under `infra/sentinel/scripts/`
(`client.mjs`, `devon-wipe.mjs`, `keygen.mjs`, `lint.mjs`, `prove.mjs`); systemd units under
`infra/sentinel/systemd/`, Windows equivalents under `infra/sentinel/windows/`; config example
`infra/sentinel/sentinel.conf.example`.

---

## 5. The agentic system and tooling, as of now

### 5.1 Binding documents

`agentic/PROTOCOL.md` (how a cycle runs; binding), `agentic/INVARIANTS.md` (four sections — *Tenancy
and data*, *Permissions*, *Product*, *Engineering*, I-1 … I-18; hook-protected against edits),
`agentic/HARDENING.md` (30 numbered sections, H1 Security … H30 Final audit; verifiers cite item ids
like H1.5, H3.4 — EPIC-014 runs it in full), `agentic/ROSTER.md`, `agentic/README.md`,
`agentic/i18n.config.json`, and `agentic/templates/` (`acceptance-criteria.md`, `adr.md`,
`escalation.md`, `verification-report.md`, `work-item.md`).

### 5.2 Gates — `agentic/gates.json` (version 2)

Profiles:

| Profile | Gates |
|---|---|
| `fast` | typecheck, lint, unit, i18n, secrets |
| `item` | fast + build, e2e-smoke |
| `integration` | item + migrate, e2e, a11y, bundle, security |
| `release` | integration + perf, deps |

Limits: `MAX_FIX_ROUNDS 3`, `MAX_EPIC_ROUNDS 2`, `MAX_GATE_ATTEMPTS 2`, `coverage_lines_min 70`,
`bundle_main_kb_max 350`, a11y blocking impacts `serious`/`critical`, four locales, screenshot widths
`1440 / 1024 / 390`.

`protected_paths` (hooks refuse edits): `agentic/gates.json`, `agentic/INVARIANTS.md`,
`agentic/PROTOCOL.md`, `agentic/hooks/`, `agentic/scripts/gate.mjs`, `agentic/scripts/dod.mjs`,
`.claude/settings.json`.

`fixer_forbidden_globs`: `**/*.test.*`, `**/*.spec.*`, `**/e2e/**`, `**/__tests__/**`,
`packages/db/migrations/**` — a fixer can never edit a test or an applied migration to go green.

`security` and `perf` gates carry `optional_local: true` and `requires_cmd` (`semgrep`/`trivy`;
`lhci`/`k6`), so they skip locally when those binaries are absent — and per CLAUDE.md, a skipped gate
must never be reported as green.

### 5.3 Scripts — `agentic/scripts/`

`gate.mjs` (runs a profile, writes `agentic/ledger/last-gate.json`), `backlog.mjs`, `ledger.mjs`,
`dod.mjs`, `selftest.mjs`, `check-i18n.mjs`, `check-secrets.mjs`, `check-bundle.mjs`,
`diff-guard.mjs`. `tools/gate-mutation/run.mjs` mutation-tests the gates themselves — one mutation
module per gate under `tools/gate-mutation/mutations/` (`a11y, build, bundle, e2e, i18n, lint,
migrate, secrets, security, typecheck, unit`), helpers in `tools/gate-mutation/lib/`.

### 5.4 Hooks — `.claude/settings.json` → `agentic/hooks/`

| Event | Matcher | Hook | Timeout |
|---|---|---|---:|
| PreToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | `agentic/hooks/guard-edit.mjs` | 15 s |
| PreToolUse | `Bash` | `agentic/hooks/guard-bash.mjs` | 15 s |
| PostToolUse | `Edit\|Write\|MultiEdit` | `agentic/hooks/post-edit-format.mjs` | 30 s |
| Stop | — | `agentic/hooks/stop-gate.mjs` | 900 s |
| SubagentStop | — | `agentic/hooks/stop-gate.mjs` | 900 s |

The `Stop`/`SubagentStop` gate re-runs the fast profile; per user memory this is why concurrent
Docker/tsx work causes false 5 s-timeout reds. `guard-bash.mjs` is aggressive about history-rewriting
patterns — it refused a `cat > … <<'EOF'` heredoc while this report was being written, because the
*content* mentioned the forbidden flag; use the Write tool for long documents.

`plugins/wp-agentic/hooks/` carries the same five files plus `hooks.json` — **the two copies must be
kept in sync** (CLAUDE.md), and the same is true of the agent definitions below.

`.claude/settings.json`'s deny list blocks `git push --force*`, `git push -f *`, and all reads/writes
of `.env*` (which also blocks `.env.example`, despite CLAUDE.md pointing at it).

### 5.5 Agents

Sixteen role agents, defined **twice** — `plugins/wp-agentic/agents/*.md` (addressed by workflows as
`wp-agentic:wp-ui`) and `.claude/agents/*.md` (shadowing bare names):

`wp-pm`, `wp-architect`, `wp-designer`, `wp-lead`, `wp-backend`, `wp-frontend`, `wp-ui`, `wp-fixer`,
`wp-reviewer`, `wp-qa`, `wp-qa-visual`, `wp-a11y-i18n`, `wp-security`, `wp-devops`, `wp-scout`,
`wp-release`.

Model tiers (CLAUDE.md): research/review/QA on Sonnet; architecture/design/adjudication/security on
Opus; haiku runners for scripts; the orchestrating session on Fable. **The v1.1 brief overrides
this**: "Opus is the lowest model for any agent; Fable for architecture and adjudication; effort
medium or high everywhere" (`docs/03-plan/v1.1/BRIEF.md`).

### 5.6 Workflows — `.claude/workflows/`

All eleven are tracked in git as of this reading:

| File | Purpose |
|---|---|
| `ship.js` | master loop: next ready epic → `feature-cycle`, repeat to cap; writes `agentic/ledger/run-summary.md` |
| `feature-cycle.js` | one epic: freeze ACs → design → decompose → build (gates / review / bounded fix) → integrate → verify → adjudicate → release → scout |
| `blitz.js` | product-first parallel build in worktrees, two waves, no ceremony |
| `ui-blitz.js` | UI overhaul: research → foundation → parallel screen rebuilds → merge → screenshot → critique → fix |
| `hardening-blitz.js` | EPIC-014: baseline → six parallel hardening packages → merge → sweep → measure → audit → release |
| `review-sweep.js` | six-lens bug hunt, fingerprint dedupe, adversarial refuters, bounded fixes |
| `polish-sweep.js` | screenshot every route → designer critique → top-N fixes → before/after report |
| `research-sweep.js` | 18-dimension research, verified, vision drafts judged and synthesized |
| `v11-blitz.js` | the v1.1 round's build loop |
| `recon.js` | codebase reconnaissance (the sibling of this report) |
| `merge-hd.js` | merges the `hd/*` hardening branches — **running concurrently right now** |

Plugin-side copies live in `plugins/wp-agentic/workflows/` and are exposed as skills
(`/wp-agentic:ship`, `/wp-agentic:status`, `/wp-agentic:escalations`).

### 5.7 Plugins, MCPs, skills

`.claude/settings.json` → `enabledPlugins`:

- `wp-agentic@workportal-local` — **on** (`plugins/wp-agentic/.claude-plugin/plugin.json`, v1.0.0).
- `typescript-lsp@claude-plugins-official` — **on**. Use the `LSP` tool (`findReferences`,
  `goToDefinition`, `hover`, `documentSymbol`, `incomingCalls`) instead of grep for TS/TSX symbols; it
  resolves across `@devon/*` boundaries and costs no tokens.
- `frontend-design@claude-plugins-official` — **on**, fires on UI work. Precedence:
  `DESIGN.md` > the epic's spec > the skill.
- `security-guidance@claude-plugins-official` — **off** (would add `Stop` + `SubagentStop` LLM review
  hooks on top of the existing five, one per subagent in a blitz run).
- `semgrep@semgrep-marketplace` — **off** (authenticates to `semgrep.dev` and uploads scanned code;
  unresolved data-egress question for a government codebase).

Enabling either of the two disabled plugins requires an escalation file first (CLAUDE.md).

`.mcp.json`:

```json
{ "playwright":       "npx -y @playwright/mcp@0.0.80 --isolated",
  "chrome-devtools":  "npx -y chrome-devtools-mcp@1.9.0 --isolated" }
```

Skills: `.claude/skills/higgsfield-video-explainer/` (CLI `@higgsfield/cli@1.1.24`, for the
management intro video only — it uploads prompts and frames to Higgsfield's cloud, so invented or
already-public demo data only, never a real department's screen). The other eight higgsfield skills
are deliberately not installed.

`extraKnownMarketplaces`: `workportal-local` (this repo's `plugins/` directory),
`claude-plugins-official`, `semgrep-marketplace`.

`worktree` settings: `baseRef: "head"`, `symlinkDirectories: ["node_modules"]`, `bgIsolation: "none"`.

The Claude CLI is installed (`@anthropic-ai/claude-code`); `claude plugin list`,
`claude plugin details <name>` and `claude mcp list` answer plugin/MCP questions deterministically.

### 5.8 Evidence ledgers — `agentic/ledger/`

| Path | Contents |
|---|---|
| `agentic/ledger/last-gate.json` | the most recent `gate.mjs` run (2026-09-12, profile `fast`, all PASS, 0 skipped) |
| `agentic/ledger/cycles/EPIC-000/` | `spec.md`, `ac.md`, `design.md`, `items.json`, `items/EPIC-000.{1..10,demo}.md` — the only epic run through the full `feature-cycle` |
| `agentic/ledger/blitz/` | four empty subdirs (`integrate`, `integrate-blitz`, `integrate-verify`, `integration`) |
| `agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/` | `critique.md`, `report.md`, plus `critique-shots/`, `after/`, `round2/`, `round3/`, `final/` screenshot sets at 1440/390 × light/dark × locale |
| `agentic/ledger/ui-foundation/` | the design-system foundation pass |
| `agentic/ledger/hardening/2026-09-08T06-45-00-05-00/` | `baseline.md` (the BEFORE measurements) and `gate-release-output.log` |

### 5.9 How a build is launched

```bash
# whole backlog, autonomously
/wp-agentic:ship                       # or: Skill ship  {max: 5, ts: "<ISO>"}

# one epic
Skill feature-cycle  {epic: "EPIC-012"}

# the v1.1 round
# .claude/workflows/v11-blitz.js — driven as a workflow, not by hand

# state of play
node agentic/scripts/backlog.mjs list --status ready
node agentic/scripts/ledger.mjs summary
node agentic/scripts/dod.mjs --epic EPIC-000
/wp-agentic:status
```

`docs/03-plan/backlog.json` is the only place scope enters. Current status: **EPIC-000 `done`;
EPIC-001 … EPIC-020 all still `ready`** — because EPIC-001…013 were built by `blitz.js` /
`ui-blitz.js` rather than through `feature-cycle`, so nothing ever flipped their status. The backlog
status field is therefore **not** a reliable indicator of what exists; the code is.

---

## 6. What is on unmerged branches

`git branch --list "hd/*" "claude/*"` plus `git log master..<branch>`, read 2026-09-12. A `+` in
`git branch` output means the branch is checked out in a worktree under `.claude/worktrees/`.

### 6.1 `hd/*` — the six hardening packages (EPIC-014)

| Branch | Commits | Diff vs master | Theme |
|---|---:|---|---|
| `hd/security` | 11 | 47 files, +4217/−150 | H1/H16: security headers, CORS allow-list, global CSRF guard, log redaction; progressive login lockout; JSON depth bound; rich-text node/mark/URL-scheme allow-list; Telegram webhook secret-token verification with constant-time compare + replay window; GCM tag length pinned; the unfurler's socket pinned to the address it approved; **cross-department object-id refusal with a 48-attempt id-swap proof**; process-fatal handlers; 113 new lines in `packages/contracts/test/unit/permissions.test.ts` and a new `rich-text.test.ts` |
| `hd/api-data` | 13 | 36 files, +1143/−96 | H2/H3/H9/H10/H14/H27/H29: brotli + gzip and ETag/If-None-Match on every response; N+1 fixes (poll DTOs, project progress, notification-prefs upsert) plus a Semgrep `query-in-loop` rule in `tools/semgrep/`; Postgres pool sized per process with timeouts; composite cards index + title/name trigram search via `normalize_uz`; streaming audit CSV export (removes a hardcoded 1000-row cap); single-flight stampede protection on analytics summary/personal/export; AI response cache keyed by (department, feature, prompt hash), 5 min TTL, bounded LRU; unique constraints + advisory-lock serialisation for poll votes; explicit body-size, JSON-depth and AI-input-length limits; a PgBouncer container-readiness race fix in the migrate-verify harness |
| `hd/resilience-observability` | 10 | 38 files, +1819/−86 | H8/H13/H15: circuit breaker + timeout primitives for every outbound dependency (AI, Telegram, MinIO/S3, ClamAV), verified against a really-stopped MinIO; a ClamAV outage queues uploads as pending-scan instead of failing closed; the weekly Telegram digest routed through the timeout+breaker path; structured per-request logs, HTTP latency histograms, slow-request log, `/metrics`; pg-boss dead-letter queue + retry policy with queue-depth and dead-letter gauges; AI latency/cost/token metrics; graceful SIGTERM/SIGINT drain; `/readyz` reports dependency circuit state **without** gating readiness on it |
| `hd/web-perf-a11y` | 10 | 48 files, +992/−109 | H4/H5/H6/H22/H23/H24: React Compiler wired for Rolldown-Vite and then scoped to measured hot spots; core routes lazy-loaded; avatar lazy loading, critical font preload, sourcemaps off `dist`; optimistic updates with rollback (personal tasks, event RSVP); Pomodoro tick-interval leak fix; `content-visibility` on the audit log's rows; per-route SEO meta and a maintenance-notice title; prefetch on hover/focus for the board, events and inbox nav entries; plus two leftover ui-blitz round-3 fixes (#21 nbsp, #23 a real second hover-card action) |
| `hd/ops-tooling` | 6 (incl. `c4abd19`, shared with `claude/exciting-shaw-5b4f05`) | 32 files, +2885/−47 | H17/H18/H19/H20/H28/H29/H1.12: production Dockerfiles for api/web/worker, a production compose file, non-root static web (`infra/web/nginx.conf`); `*.map` sourcemap requests blocked in the production web server; `security:scan`, `perf:check`, `knip`, `madge`, `arch:urls` wired; curl-into-shell trivy install fixed in CI; self-hosted Renovate; backup/drill row-count manifest timing bug fixed plus ops docs; `tools/semgrep/rules/{query-in-loop,sync-fs-in-handlers}.yml` |
| `hd/tests` | 1 (`1330406`, marked **wip**) | 24 files, +3280/−12 | H25/H30: flow e2e specs and integration tests, incl. `apps/web/test/e2e/sprint-pomodoro.flow.spec.ts` and edits to `shell.smoke.spec.ts` |

### 6.2 `claude/*` — side sessions

Eleven of the thirteen `claude/*` branches have **zero commits ahead of master** — they are the eight
side-session branches already merged on 2026-09-07, documented one row each (with the merge commit,
the conflicts, and what was ported vs dropped) in `docs/03-plan/SIDE-BRANCHES.md`.

Two are still ahead:

| Branch | Commits | Diff | Content |
|---|---:|---|---|
| `claude/dazzling-wu-97fed9` | 1 (`928d1f1`) | 4 files, +424/−1 | H18.1/H13.1 graceful shutdown — SIGTERM/SIGINT close the API cleanly; adds `apps/api/test/unit/graceful-shutdown.test.ts` (179 lines). **Overlaps `hd/resilience-observability`'s `1d067d2`**, which implements the same drain; reconcile rather than merging both blindly. |
| `claude/exciting-shaw-5b4f05` | 1 (`c4abd19`) | 8 files, +614/−14 | H17.1/H18.1 production Dockerfiles + compose + `infra/web/nginx.conf`. **This exact commit is already in `hd/ops-tooling`'s history**, so merging `hd/ops-tooling` subsumes it. |

### 6.3 Other branch families (all merged, kept for history) and live worktrees

`blitz/*` (9: `accounts-departments`, `admin`, `ai`, `analytics-pages`, `events`, `inbox-telegram`,
`personal`, `structure`, `work`), `ui/*` (6: `analytics-pages-ai-admin`, `events-inbox`, `personal`,
`shell-auth-home`, `structure-departments`, `work-projects`), `ui2/*` (4: `demo-super-admin`,
`departments-people-events`, `personal-home-shell`, `work-views`) — the wave-1/wave-2 module
worktrees and the two UI-overhaul rounds; `git log master..` is empty for all of them.

`.claude/worktrees/` still holds 11 directories: `dazzling-wu-97fed9`, `exciting-shaw-5b4f05`,
`hd-api-data`, `hd-resilience-observability`, `hd-tests`, `hd-web-perf-a11y`, `recon-app`,
`ui-shell-auth-home`, `ui-work-projects`, `ui2-demo-super-admin`, `ui2-departments-people-events`.
Per user memory, dead worktrees leave stale plugin install records — prune, do not debug.

---

## 7. Known gaps and TODOs

There are **zero** `TODO` / `FIXME` / `XXX` markers anywhere under `apps/*/src`, `packages/*/src`,
`infra/` or `e2e/`. The convention in this repo is that a gap is written as a full explanatory
comment at the site, or as an escalation file, never as a marker. The gaps below were found by
reading those comments and cross-checking the code.

### 7.1 The notification event registry does not match the events that are emitted

`apps/api/src/modules/notifications/events.ts:23-36` keys `EVENT_REGISTRY` on twelve names. The API
actually emits the 26 names listed in §2.5. The overlap is **three** names:
`work.card.updated`, `events.event.updated`, `events.event.cancelled`.

Registry names that nothing emits: `work.card.assigned`, `work.card.comment.mentioned`,
`work.card.due`, `work.card.comment.created`, `events.event.rsvp_reminder`, `events.poll.opened`,
`events.poll.closing_soon`, `pages.decision.recorded`, `memberships.member.joined`.

Emitted names the registry ignores: `work.card.created`, `work.card.commented`,
`events.rsvp.changed`, `events.poll.created`, `events.comment.created`, `events.carpool.created`,
`events.carpool.seat_claimed`, `departments.member.joined`, `departments.department.created`,
`departments.request.created`, `projects.project.created`, all seven `structure.*`,
`accounts.user.registered`.

Worse, the handler additionally requires a `notify` block inside the payload
(`parseNotifyBlock`, `apps/api/src/modules/notifications/events.ts:62-91`) — and
`grep -rn "notify:" apps/api/src/modules/` returns **nothing**. No emitted payload carries one, and
no module outside `notifications/` calls `notifyUser` (`apps/api/src/modules/notifications/notify.ts`).

Conclusion: **the outbox → inbox path currently produces no notifications at all**; the inbox is fed
only by the three pg-boss jobs in `apps/api/src/modules/notifications/jobs.ts` (hourly
`reminder.due`, daily personal digest, Friday department digest). This is worth confirming live
before designing v1.1's "notify to fill" custom-column flow on top of it.

### 7.2 Role model: `department_child` erases the head/member distinction

`can()` allows any active member every action on `department_child`
(`packages/contracts/src/permissions.ts`, `case 'department' / 'department_child'`). Concretely, with
no further check, a `member` can today:

- create, edit, archive, restore and comment on any card in the department
  (`apps/api/src/modules/work/index.ts` — all 19 routes `department_child`; the string `'head'`
  appears in `modules/work/` only as a display value in `repo.ts:109/116` and `schemas.ts:28`);
- create and edit projects and milestones (`apps/api/src/modules/projects/index.ts`, 8 routes);
- create, edit and **delete** pages, page versions and onboarding templates
  (`apps/api/src/modules/pages/index.ts`, 12 routes);
- create, delete and reorder analytics pins and saved filters, and export the department CSV
  (`apps/api/src/modules/analytics/index.ts`, 11 routes).

Three modules do add a gate below `can()`:
`apps/api/src/modules/structure/repo.ts` (`actorRoleInDept` + `allow_structure_edit`),
`apps/api/src/modules/events/index.ts` (`currentActor(req).isHead` at lines 128/162/345/503),
`apps/api/src/modules/ai/index.ts` (`PATCH /ai/settings` uses `{kind:'department'} + update`).
`apps/api/src/modules/departments/index.ts` is the only module that uses `{kind:'department'}`
throughout.

On the client, role branching exists in only five feature files (§3.5) and Home does not branch at
all. This is the mechanical basis of CTO findings #1 and #2 in `docs/03-plan/v1.1/BRIEF.md`.

### 7.3 Stale code comments that mislead

- `apps/api/src/lib/actor.ts:31-34` — "no view-as endpoint exists yet either; always the real
  actor's own lens". False: `apps/api/src/plugins/session.ts:80` sets `viewAs`, and
  `apps/api/src/modules/admin/view-as.ts` implements the lens.
- `apps/api/src/modules/work/index.ts:63` — `unitName: null, // EPIC-003 (structure/bo'limlar) has
  not shipped yet`. EPIC-003 has shipped (`app.units`, `apps/api/src/modules/structure/`), so every
  filter clause on `unit` silently matches nothing.
- `apps/api/src/types.ts:37` and the header of `apps/api/src/modules/work/index.ts` — "has not
  shipped a department-switching endpoint yet". Still true; the active department is the first
  membership by `joined_at` in both API and client. `packages/ui/src/shell/department-switcher.tsx`
  exists as a component with no endpoint behind it.
- `apps/api/src/modules/analytics/repo.ts:344` documents that per-viewer project progress is
  "deliberately not applied" — relevant when v1.1 adds per-person workload indicators.

### 7.4 Backlog status is wrong

`docs/03-plan/backlog.json`: EPIC-000 `done`, every other epic (001–020) `ready`, including
EPIC-001…EPIC-013 which demonstrably shipped via the blitz workflows, and EPIC-014 (hardening) which
is half-landed on `hd/*`. `node agentic/scripts/backlog.mjs list --status ready` therefore cannot be
used to pick the next epic in this round without curation.

### 7.5 Findings carried forward from the UI blitz

`agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/report.md` scorecard: 18 fixed, 5 fixed-by-commit,
7 partially fixed, **10 not fixed** — items 9, 21, 24, 26, 33, 34, 36, 37, 39, 40. Named explicitly
in the tail of that report:

- #35 Home tiles still lead with prose rather than a number on three of five tiles.
- #36 the onboarding checklist is still misaligned with its own title on `/` (visible in
  `.../final/root__1440__light__uz-Latn.png`).
- #37 the theme-change crossfade double-exposes text; no commit touches the toggle's transition.
- #38 the `--` double-hyphen typo was fixed in one i18n string only; six more instances remain across
  `events`, `admin`, `telegram`, `projects` and `personal`
  (`packages/i18n/messages/modules/*/uz-Latn.json`), and the lint rule that would stop it regressing
  was never added.
- #39 `/people` repeats "Bo'lim belgilanmagan" under a heading that already says it, 22 times, and
  still has no hover card — directly relevant to the v1.1 "people table" ask.
- #40 the Pomodoro session log has no date grouping.
- The report's own bottom line: the Gantt timeline (`/work/timeline`) and the work table
  (`/work/table`) "need a proper rebuild rather than small polish".

### 7.6 Findings carried forward from the hardening baseline

`agentic/ledger/hardening/2026-09-08T06-45-00-05-00/baseline.md`:

- **Bundle budget disagreement.** `agentic/scripts/check-bundle.mjs` passes at 295.6 kB gz largest
  chunk against `gates.json`'s `bundle_main_kb_max: 350`, but TECH-SPEC §12 states a **200 kB shell**
  target. The largest chunk is `apps/web/dist/assets/api-client-*.js` at 295.6 kB gz / 1024 kB raw —
  the whole typed API client plus every Zod schema in one chunk, not route-split. Total JS 888 kB gz;
  total shippable ≈ 1.23 MB.
- **Sourcemaps**: 11.2 MB on disk, larger than the rest of the build combined; nothing in
  `infra/Caddyfile` blocked `*.map` at baseline time (`hd/ops-tooling`'s `e25eab5` fixes this for the
  production web server, and `hd/web-perf-a11y`'s `2afc16c` turns them off for `dist`).
- **`/` (home) makes 232 requests, 5.6 MB on the wire, and has 16 duplicate request groups** — by far
  the worst route measured. `/work` 241 req / 1.14 MB / 224 SQL calls; `/work/table` 227 req /
  524 kB / 247 SQL calls / 737 rows.
- `pg_stat_statements` was added to `infra/docker-compose.yml`'s `postgres` command for the baseline
  and is expected to stay (recreating that container drops all live connections — do it *before*
  booting the app).
- All numbers are single runs, explicitly "directional, not statistically tight".

### 7.7 i18n

739 of 1845 defined keys are unreferenced (`keys=1845 used=1106`, `agentic/ledger/last-gate.json`).
Dead keys are cheap but they hide real gaps — a key defined for a screen that was never built looks
identical to one for a screen that was.

### 7.8 Tables with no RLS

Nineteen `app.*` tables plus the three `audit.*` tables have no policy (§4.1). Each has a written
justification in `packages/db/src/tenancy.ts`'s `GLOBAL_ALLOWLIST`, and the `migrate` gate enforces
that the justification exists — but the enforcement is a code-level `can()` check, not a database
boundary, for `app.uploads`, `app.department_requests`, `app.telegram_links`, `app.telegram_groups`
and `app.event_reminder_jobs` in particular.

### 7.9 Open structural absences (relevant to v1.1)

- **No department switcher endpoint.** A user in two departments always works in the first one by
  `joined_at` (`apps/api/src/lib/actor.ts`, `apps/web/src/lib/session.ts`).
- **No delegation grants table.** `Actor.actingFor` is permanently `null`; `can()` ignores it (P7).
- **`{kind:'audit'}` is unused** — reserved for a per-department audit view, currently fail-closed to
  super_admin (`packages/contracts/src/permissions.ts`, `case 'audit'`).
- **No person page, no people table with dynamic columns, no custom fields, no "notify to fill".**
  The four biggest v1.1 asks have no code yet. `/people` is
  `apps/web/src/features/structure/people-screen.tsx`, a card grid, and
  `GET /api/v1/departments/:departmentId/roster` is its only data source. There is no indicator
  registry, no per-person aggregate endpoint, and no custom-field table in
  `packages/db/src/tenancy.ts`.
- **No card→person deep link.** `apps/web/src/features/work/components/member-picker.tsx` and
  `packages/ui`'s `Avatar`/`AvatarStack` render people but link nowhere.

---

## 8. How to boot and test

### 8.1 First run

```bash
pnpm install
pnpm setup                    # setup.mjs — bootstrap
pnpm start --demo             # scripts/start.mjs: compose up, migrate, seed demo, api + web
```

`pnpm dev` is an alias of `pnpm start`. `DEVON_DEMO=1` is equivalent to `--demo`.
`scripts/start.mjs` loads `.env` itself (shell env wins over `.env`), and quotes commands specially
on Windows because pnpm and the docker CLI plugins need `shell: true` there.

### 8.2 Ports

| Service | Port | Source |
|---|---:|---|
| API | 3000 | `apps/api/src/config.ts:17` (`API_PORT`) |
| Web (Vite) | 5173 | `apps/api/src/config.ts:18` (`DEVON_PUBLIC_URL`) |
| Postgres | 55432 | `infra/docker-compose.yml:76` (`POSTGRES_PORT`) |
| Valkey | 56379 | `infra/docker-compose.yml:101` |
| Caddy | 80 / 443 | `infra/docker-compose.yml:127-128` |
| MinIO | 9000 / 9001 | `infra/docker-compose.yml:160-161` |
| Centrifugo | 8000 | `infra/docker-compose.yml:192` |
| ClamAV | 3310 | `infra/docker-compose.yml:210` |
| GlitchTip | 8080 | `infra/docker-compose.yml:270` |

Per user memory, Windows reserves 55433-55532 — avoid that band when picking an alternate Postgres
port. A busy 5173 is common with parallel sessions; `WEB_PORT=5199 pnpm start --demo` was the
documented workaround in `docs/03-plan/SIDE-BRANCHES.md`.

### 8.3 Demo logins

Seeded by `pnpm --filter @devon/db seed:demo` (idempotent, ADR-013). Fixtures:
`packages/db/src/seed/fixtures.ts`.

| Login | Name / title | Role | Department |
|---|---|---|---|
| `demo.boshliq` | Anvar Aliyev, "Boʻlim boshligʻi" | `head` | Raqamli xizmatlar boshqarmasi |
| `demo.xodim` | Nodira Karimova, "Xodim" | `member` | Raqamli xizmatlar boshqarmasi |
| `admin.super` | `DEMO_SUPER_ADMIN` | `super_admin` | none (global, no membership row) |

Password for all three: `DEMO_PASSWORD` in `packages/db/src/seed/fixtures.ts` (~line 94) — a real
argon2id hash, so `POST /api/v1/auth/login` genuinely accepts it. Documented in
`MODULE-GUIDE.md:268-283` and nowhere else. `admin.super` is demo-only —
`packages/db/src/seed/guard.ts`'s `assertSeedAllowed` refuses to seed it on a non-demo instance.

Sign in at `/login`. A super admin with no membership sees only `home`, `inbox`, `departments`,
`department-requests`, `account-settings` and `admin` in the sidebar
(`apps/web/src/shell/nav.ts`, `requireDepartmentFor`).

### 8.4 Gates and tests

```bash
node agentic/scripts/selftest.mjs                 # guards + scripts behave
node agentic/scripts/gate.mjs --profile fast      # typecheck, lint, unit, i18n, secrets
node agentic/scripts/gate.mjs --profile item      # + build, e2e-smoke
node agentic/scripts/gate.mjs --profile integration
node agentic/scripts/gate.mjs --profile release
node agentic/scripts/backlog.mjs list --status ready
node agentic/scripts/ledger.mjs summary
node agentic/scripts/dod.mjs --epic EPIC-000
```

Per-package:

```bash
pnpm -r typecheck   &&  pnpm -r lint  &&  pnpm -r test:unit -- --run
pnpm --filter @devon/db migrate:verify   # migrations + tenancy registry + RLS probes (real Postgres)
pnpm --filter @devon/db seed:demo | seed:reset | tenancy:report | audit:prove | test:seed-idempotence
pnpm --filter @devon/i18n messages:merge | terms:verify   # merge regenerates *.generated.json
pnpm --filter @devon/ai evals
pnpm --filter @devon/web test:e2e | test:a11y
pnpm --filter @devon/ui storybook
```

API "prove" scripts run against a **real** Postgres/MinIO and are the fastest way to validate a
module end to end (`apps/api/package.json`): `setup:prove`, `session:prove`, `admin:prove`,
`work:prove`, `telegram:prove`, `accounts:prove`, `avatar:prove`, `storage:prove`.

### 8.5 E2E suites

Two separate Playwright projects:

- `e2e/` (`devon-e2e`, standalone install): `e2e/tests/smoke.spec.ts`, `routes.spec.ts`,
  `screenshots.spec.ts`, `states.spec.ts`, `overflow-390.spec.ts`, `glyphs.spec.ts`,
  `ambient-gradient.spec.ts`. Scripts: `test`, `test:smoke`, `test:a11y`, `test:390`, `test:glyphs`,
  `test:states`, `shots`.
- `apps/web/test/e2e/` (its own `playwright.config.ts`, helpers `flow-api.ts`, `flow-db.ts`,
  `flow-env.ts`, `flow-process.ts`, `global-setup.ts`): `shell.smoke.spec.ts`,
  `admin-pause.flow.spec.ts`, `board-move.flow.spec.ts`, `event-carpool-poll.flow.spec.ts`,
  `group-project.flow.spec.ts`, `register-department-join.flow.spec.ts`,
  `sprint-pomodoro.flow.spec.ts`. `hd/tests` adds more.

### 8.6 Browser and code tooling for this round

- `mcp__chrome-devtools__*` — performance traces, `lighthouse_audit`, CPU/network `emulate`. Use it
  for every HARDENING web-vitals item: **measure, never describe**. `wp-qa-visual`, `wp-scout` and
  `wp-a11y-i18n` are wired to it.
- `mcp__playwright__*` — deterministic, replayable capture for evidence that must be identical every
  cycle, and for sequences that belong in `e2e/`. Runs `--isolated`, so parallel worktrees do not
  fight over a browser profile.
- The `LSP` tool for every TS/TSX symbol lookup instead of grep — it resolves across `@devon/*`
  boundaries, so a contract change enumerates real call sites rather than string matches.
- `tools/perf/playwright/measure-routes.mjs` — the baseline's route-measurement harness (needs
  `pnpm start --demo` already up on 127.0.0.1:5173 / :3000); resets and reads `pg_stat_statements`
  per route and records wire bytes via CDP. Also `tools/perf/{k6,lighthouse}/` and
  `tools/perf/bundle/report.mjs`.
- `?forceState=` on any route drives the empty/loading/error/no-permission/offline states
  (`apps/web/src/lib/forced-state.ts`, `apps/web/src/shell/forced-state-block.tsx`).

### 8.7 House rules that bite

From `CLAUDE.md` and `agentic/INVARIANTS.md`: every department table carries `department_id` + RLS
and personal rows are owner-only; every write emits audit + outbox **in one transaction**; every
endpoint checks `can()`; every string goes through i18n in four locales; every screen has
empty/loading/error/no-permission/offline states; undo over confirm; `Ctrl/⌘+K` reaches everything;
tokens only; no query in a loop; timeouts on every outbound call. Pin exact versions (TECH-SPEC
§1.2); never edit an applied migration; never force-push; no secrets. Do not add scope mid-epic (file
it `proposed` in `docs/03-plan/backlog.json`); do not ask the human in chat from inside a workflow
(write an escalation file); do not report "gates green" while any gate is `skipped`. Do not read
`.env` — use `.env.example` (note: the settings deny list currently blocks that too). Do not send
personal contact details to Telegram. Do not call any AI endpoint other than the configured GLM
(`docs/03-plan/integrations/glm-api-instruction.md`; the key is never in the repo). Agents and hooks
are defined twice (`plugins/wp-agentic/` and `.claude/`) — change one, copy it across, or they drift.
