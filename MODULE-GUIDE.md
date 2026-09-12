# MODULE-GUIDE

How to add a whole module to WorkPortal (Devon) without editing a file another module is also
editing. Read this before touching `apps/api/src/modules/`, `packages/db/src/schema/`,
`packages/db/migrations/`, `packages/db/src/seed/modules/`, `packages/i18n/messages/modules/`, or
`apps/web/src/features/`. If something here disagrees with the code, the code wins — fix this file.

Everything below is additive: a module ships by **adding files**, never by editing a file another
module also touches. The few exceptions (a shared registry that must list every table, a security
allowlist) are called out explicitly, because they are still single, obvious diffs, not merge
conflicts waiting to happen.

## Folder conventions at a glance

```
apps/api/src/modules/<name>/index.ts          Fastify plugin (routes, services, repos, jobs, Zod)
packages/db/src/schema/<name>.ts              Drizzle table definitions this module owns
packages/db/migrations/0XXX_<name>_....sql    hand-authored SQL, filename-ordered
packages/db/src/seed/modules/<name>.ts        { order, seed(ctx) } for the demo dataset
packages/i18n/messages/modules/<name>/*.json  uz-Latn.json, uz-Cyrl.json, ru.json, en.json
apps/web/src/features/<name>/manifest.ts(x)   routes, sidebar entries, command-palette entries
apps/web/src/features/<name>/*                the feature's own screens/components/hooks
```

Reserved migration-number prefixes (pick the one matching what you're building; ask in an escalation
if none fits):

| Prefix | Domain                      |
|--------|------------------------------|
| 0100   | accounts / departments       |
| 0200   | structure                    |
| 0300   | work                         |
| 0400   | events                       |
| 0500   | personal                     |
| 0600   | notifications                 |
| 0700   | analytics / pages            |
| 0800   | ai                            |
| 0900   | admin                         |

(`0000`–`0007` are the foundation migrations that predate this numbering — extensions, roles, audit,
identity, departments, RLS, Uzbek collation, the event outbox. Leave them alone.)

## API modules

Create `apps/api/src/modules/<name>/index.ts` exporting a Fastify plugin as its `default`:

```ts
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

const myModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/widgets', { config: { permission: { action: 'read', subject: (r) => ({ kind: 'department_child', departmentId: r.actor!.departmentId! }) } }, schema: { response: { 200: widgetListSchema } } }, async (req) => {
    return app.devon.listWidgets(req.actor!.departmentId!)
  })
}

export default myModule
export const prefix = '/widgets' // optional; '' mounts directly under /api/v1
```

`apps/api/src/module-loader.ts` discovers every directory under `src/modules/` that has an
`index.ts`/`index.js`, imports it, and registers it at `/api/v1${prefix}` — alphabetically, so the
order is identical on every machine. **`app.ts` is never edited to add a module.**

Rules every route already follows and yours must too:
- Every route declares `config.permission`: either `{ public: true }` or `{ action, subject }` — a
  route registered without one throws at boot (`apps/api/src/plugins/authorize.ts`'s `onRoute` guard).
  `action` is one of `'read' | 'create' | 'update' | 'archive' | 'delete' | 'administer'`; `subject`
  is a function of the request returning a `Subject` from `@devon/contracts` — for a department-owned
  table, that's `{ kind: 'department_child', departmentId }` (see `packages/contracts/src/
  permissions.ts` for the full list, and add a new `Subject` variant there if your table needs a
  genuinely new permission shape — a small, reviewable diff, not a merge conflict, since only your PR
  touches it while you're building your module).
- A **public** route must also be added to `PUBLIC_ROUTES` in `apps/api/src/plugins/authorize.ts` —
  the one intentional shared-file edit in this whole system, because "which routes need no auth" is a
  security fact that has to be reviewable in one place. Everything else about your module stays in
  your own files.
- Validate every body/params/query with Zod (`fastify-type-provider-zod`); never trust `req.body` raw.
- `req.actor` (set by `plugins/session.ts`) is your auth helper: `req.actor.userId`, `.role`,
  `.departmentId`, `.memberships`. Your department helper is exactly that field — there is no separate
  department-lookup service; a route reads `req.actor.departmentId` (or a specific membership from
  `req.actor.memberships`) the same way every existing route does.
- Business logic goes through `app.devon.<method>()` (your module's own additions to a `Deps`-shaped
  interface, backed by `@devon/db`'s `withContext()`), never a direct `@devon/db` import from a route
  handler — same separation `apps/api/src/deps.ts`/`db/repo.ts` already models.
- No query in a loop. No secrets in code.

## DB: schema

Add `packages/db/src/schema/<name>.ts` with your Drizzle table definitions (mirror
`packages/db/src/schema/app.ts`'s style: `appSchema.table(...)`). **You do not add an `export *` line
to `schema/index.ts`.** Your module's own repo code imports your schema file directly
(`import * as schema from '../../schema/<name>.js'`) and calls `tx.drizzle.select().from(schema.
myTable)` — the classic query builder works against any table object, so nothing needs your table to
appear in the shared schema map that `Tx.drizzle`'s type parameter carries (that map only matters for
the *relational* query API, `db.query.foo`, which nothing in this codebase uses yet).

One required shared-file edit, and it's deliberate: register every new table in
`packages/db/src/tenancy.ts`'s `TENANCY` map (`'tenant_root' | 'department_owned' | 'user_owned' |
'global' | 'audit'`), with a `GLOBAL_ALLOWLIST` reason if you pick `'global'`.
`test/tenancy.registry.test.ts` fails the build if a live table has no entry — this is a safety
invariant registry, not scope-entry, and it's the one file every module's PR touches for exactly one
line.

## DB: migrations

Plain SQL in `packages/db/migrations/0XXX_<name>_<what>.sql`, applied in filename order by
`packages/db/src/migrate.ts` (`pnpm --filter @devon/db migrate:apply`, which `scripts/start.mjs` runs
on every `pnpm start`). Conventions (`test/unit/migration-lint.test.ts` enforces these):
- `set role devon_migrator;` at the top, `reset role;` at the bottom.
- Idempotent: `create table if not exists`, `create index if not exists`, `do $$ ... exception when
  duplicate_object then null; end $$;` for enum types.
- Expand-only: no `DROP TABLE`/`DROP COLUMN`/`ALTER COLUMN ... TYPE`/`TRUNCATE`/`DELETE FROM` outside
  a `*_contract.sql` file carrying a `-- CONTRACT: safe because ...` header.
- No personal-data column names (`birth*`, `dob`, `passport*`, `pinfl*`, `address*`, `salary*`,
  `nationality`, `religio*`, bare `inn`).
- A grant on any `audit.*` table is `INSERT`/`SELECT` only.

Tracking is a real `app._migrations(name, applied_at)` table (created by `migrate.ts` itself, not
drizzle-kit's journal) — `migrate:apply` against an already-migrated database applies zero files.

## DB: seeds

Add `packages/db/src/seed/modules/<name>.ts`:

```ts
import { inArray } from 'drizzle-orm'
import type { SeedModuleContext } from '../module-loader.js'

export const order = 100 // core.ts (department/users/memberships) is 0 — run after it

const ROWS = [{ id: demoId('my.thing.1'), ... }] // name every id once, so seed() and reset() agree

export async function seed(ctx: SeedModuleContext): Promise<number> {
  const inserted = await ctx.tx.drizzle.insert(schema.myTable).values(ROWS).onConflictDoNothing().returning()
  return inserted.length // rows this module actually wrote
}

export async function reset(ctx: SeedModuleContext): Promise<number> {
  const deleted = await ctx.tx.drizzle
    .delete(schema.myTable)
    .where(inArray(schema.myTable.id, ROWS.map((r) => r.id)))
    .returning()
  return deleted.length // rows this module actually deleted -- children before parents
}
```

`packages/db/src/seed/module-loader.ts` discovers every file under `src/seed/modules/`, and
`runSeedDemo` (`src/seed/demo.ts`) calls each module's `seed()` in ascending `order`, inside the one
transaction/advisory-lock/checksum wrapper it already owns. `runResetDemo` (`seed:reset --demo`) calls
each module's `reset()` in *descending* `order` — so your rows are gone before the users/departments
they point at are — and only then deletes `core.ts`'s foundation rows. Use deterministic ids
(`packages/db/src/seed/ids.ts`'s `demoId('your.thing')`) and `ON CONFLICT DO NOTHING` so a second
`seed:demo` run writes zero rows for your module too, and delete exactly those ids in `reset()`:
`test/seed.idempotence.test.ts` asserts that after a reset every `app.*` table is back to its pre-seed
row count, so a row without a matching delete fails the migrate gate. Rows that live in a second demo
department, or in an owner-only table (personal workspace, notifications), sit behind RLS the shared
seed context cannot reach — write *and* delete them under `packages/db/src/seed/scope.ts`'s
`asDepartment(tx, id, fn)` / `asUser(tx, id, fn)`, never through a second `withContext()` (a different
connection cannot see the run's own uncommitted rows). Uzbek three-part names, believable dates around
2026-09 — match `fixtures.ts`'s existing style.

## i18n messages

Add `packages/i18n/messages/modules/<name>/{uz-Latn,uz-Cyrl,ru,en}.json`, each namespaced under your
module name:

```json
{ "myModule": { "title": "Widgets", "empty": { "title": "No widgets yet" } } }
```

**Never edit `packages/i18n/messages/{uz-Latn,uz-Cyrl,ru,en}.json`** (the hand-authored core
catalogue) or the sibling `*.generated.json` files. `pnpm --filter @devon/i18n messages:merge` (wired
into that package's `build` and `dev`) folds every module's tree into the four `*.generated.json`
files `src/messages.ts` actually loads; `agentic/scripts/check-i18n.mjs` also merges your module's
files in-memory for the gate itself, so a forgotten `messages:merge` never lets a stale gate pass. A
key that collides with an existing one (yours or another module's) fails the merge loudly — pick a
name inside your own namespace.

## Web features

Add `apps/web/src/features/<name>/manifest.ts(x)`:

```tsx
import * as React from 'react'
import { Boxes } from 'lucide-react'
import type { FeatureManifest } from '../types.js'

const WidgetsScreen = React.lazy(() => import('./widgets-screen.js'))

const manifest: FeatureManifest = {
  name: 'widgets', // must equal the directory name
  routes: [{ path: '/widgets', component: WidgetsScreen, titleKey: 'myModule.title' }],
  sidebar: [{ id: 'widgets', labelKey: 'myModule.title', icon: Boxes, route: '/widgets' }],
  commands: [{ id: 'widgets.open', labelKey: 'myModule.title', path: '/widgets' }],
}
export default manifest
```

`apps/web/src/features/registry.ts` discovers every manifest via `import.meta.glob`; `app.tsx`'s
route outlet, `shell/nav.ts`'s sidebar, and `shell/command-palette-controller.tsx`'s palette all read
the registry — **none of those three files is ever edited to add a feature.** The component is always
`React.lazy`, so a feature nobody visits costs nothing in the initial bundle. Routes are exact-path
only (no `:params` yet — same tradeoff `src/lib/router.tsx` documents for the five core routes); ask
in an escalation if your feature genuinely needs one.

Auth/session/department helpers your feature's screens use:
- `useSession()` (`src/lib/session.ts`) — `{ user, memberships, membershipCount, isLoading,
  isAuthenticated }`, backed by the same cached `/me` query the shell uses (no second network call).
- `useDepartment()` (`src/lib/session.ts`) — `{ department, departmentId, memberships,
  setDepartmentId }`. `setDepartmentId` is a client-only switcher stub (localStorage) until a real
  "switch department" endpoint exists; build department-switching UI against it now and it keeps
  working unchanged once the server-backed version lands.
- `apiClient` (`src/lib/api-client.ts`) — `apiClient.get/post/patch(path, ..., zodSchema)`: same-origin,
  cookies included, RFC 9457 `Problem` parsing into `ApiError`, response validated against your schema.
  Build your feature's own endpoint functions on this (`src/features/<name>/api.ts`), the same way
  every function in `api-client.ts` already does.
- Login/logout already exist (`src/routes/login.tsx`, `useLogoutMutation()`) — every demo account
  (`demo.boshliq` / `demo.xodim`, `packages/db/src/seed/fixtures.ts`) can sign in and exercise your
  feature today.

Every screen needs empty/loading/error/no-permission states (`<StateView kind="empty|loading|error|
forbidden|offline">` from `@devon/ui`) and every string through `t('myModule....')` — the same rules
as every other screen in this app.

## Domain events

`Tx.emit({ type, payload, departmentId? })` (`packages/db/src/context.ts`) writes to
`app.outbox_events` in the **same transaction** as the write that caused it (never a separate
connection) — call it from inside a `withContext()` callback exactly like `tx.audit()`.

Naming convention: `'<module>.<noun>.<verb-past-tense>'`, e.g. `'people.employee.hired'`,
`'work.card.moved'`. A payload is whatever JSON your module wants — there is no shared payload-types
package, and there never should be (that would be exactly the cross-module edit this bus exists to
avoid).

Subscribe at import time, anywhere that runs once at boot (your module's `index.ts`, or its own
`events.ts`):

```ts
import { subscribe } from '@devon/db'
subscribe('people.employee.hired', async (event) => {
  // event: { id, type, payload, departmentId, createdAt, attempts }
})
```

`startEventsWorker()` (`packages/db/src/events-worker.ts`) is called exactly once, from
`apps/api/src/server.ts` (never from `app.ts`, so unit tests building a test app never start a
background timer). It polls `app.outbox_events` every 2s (`for update skip locked`, so a future
second worker process never double-runs a row), calls every matching handler, and retries a failing
row up to 5 times before leaving it for an operator to inspect — the table itself is the queue, no
Valkey/BullMQ needed at this scale.

## The audit helper

Every write appends an audit event: `tx.audit({ action: 'module.thing_happened', subjectType,
subjectId, before?, after? })` (`packages/db/src/audit.ts`), buffered and flushed in the same
transaction right before commit, exactly like `tx.emit()`. `action` is `'<domain>.<verb>'`. Any field
name in `packages/contracts`'s secret tier is redacted automatically wherever it appears in `before`/
`after`, recursively — you do not redact it yourself.

## Running the app

```bash
pnpm setup                 # once, on a fresh clone: corepack, pnpm install, .env from .env.example
pnpm start --demo          # Postgres + Valkey (Docker), migrate:apply, seed:demo, api+web dev servers
```

Demo accounts (`packages/db/src/seed/fixtures.ts`): `demo.boshliq` (head) and `demo.xodim` (member),
department "Raqamli xizmatlar boshqarmasi", plus `admin.super` (`DEMO_SUPER_ADMIN`, package
`demo-super-admin`) — a global `super_admin` account with no department membership, seeded so
`/admin/*` can actually be signed into and screenshotted against `pnpm start --demo` (before this
fixture existed, every `/admin*` route in a demo-only environment could only ever render its
no-permission state — `agentic/ledger/ui-blitz/2026-09-07T11-25-00-05-00/report.md`'s "One gap up
front"). All three sign in at `/login` with the same password, `Ishonchli#2026` (`DEMO_PASSWORD`,
exported from `@devon/db`'s seed barrel — a real argon2id hash, not a placeholder), and `admin.super`
gets an `app.user_security` row with 2FA off, exactly like a real account created through `/setup`
(`apps/api/src/db/repo.ts`'s `consumeSetupToken` — `core.ts`'s seed module mirrors that insert).
Verified end to end while building this system: `POST /api/v1/auth/login` with `demo.boshliq` /
`Ishonchli#2026` returns `204` with a session cookie, `GET /api/v1/me` with that cookie returns Anvar
Aliyev, and `GET /api/v1/admin/instance` with the same (`head`, not `super_admin`) session returns
`403`; the identical login with `admin.super` / `Ishonchli#2026` returns `204` and that session's
`GET /api/v1/admin/instance` succeeds. `/setup` still exists to create a super-admin account against a
fresh, non-demo instance — `admin.super` is demo-only (`guard.ts`'s `assertSeedAllowed` refuses this
seed outside a non-production environment) and must never be seeded in production.

**Two environment bugs found and fixed while proving `pnpm start --demo` boots** (both outside any one
module, both blocked a cold boot on every machine, every time):
- `infra/docker-compose.yml`'s `postgres` image was plain `postgres:17-alpine`, which has no `vector`
  extension — `migrations/0000_extensions.sql`'s `create extension if not exists vector` failed on
  first boot. Fixed: pinned to `pgvector/pgvector:0.8.6-pg17`, the same image `packages/db/test/
  harness.ts` already uses for exactly this reason.
- `.env`/`.env.example`'s `MIGRATION_DATABASE_URL` authenticates as `devon_migrator` — a role that
  `migrations/0001_roles.sql` itself creates, so a fresh database can never accept that connection to
  run the migration that would create it. `MIGRATION_DATABASE_URL` must authenticate as the Postgres
  superuser (`postgres` / `POSTGRES_SUPERUSER_PASSWORD`) instead — the same role
  `POSTGRES_PASSWORD` gives `postgres` in `infra/docker-compose.yml`. **This file could not be edited
  from this session** (`.env`/`.env.example` reads and writes are blocked by this environment's own
  permission settings) — fix the `MIGRATION_DATABASE_URL` line in both files by hand before your first
  `pnpm start`. Everything downstream of a correct `MIGRATION_DATABASE_URL` was verified working: with
  it pointed at the superuser, `migrate:apply` applies all 8 migrations cleanly, a second run applies
  zero, `seed:demo` writes 5 rows once and 0 on a repeat, and login/session/permission-deny all work
  as shown above.

## v1.1 conventions (SPEC §2, §4.2, §5)

Three things the v1.1 skeleton put in place. Every package built on top of it uses them rather than
rolling its own.

### 1. Permissions: one registry, two readers

`packages/contracts/src/app-actions.ts` is the matrix as data — every action the product has, the
feature area it belongs to and the subject kind it reduces to. `canAction(actor, id, ctx)` resolves an
id through `can()`; nothing anywhere re-implements a rule, and `role === 'head'` never appears in a
module again (I-7, I-9).

Subject kinds, after v1.1:

| kind | reads | writes |
|---|---|---|
| `department` | any active member | head |
| `department_managed` | **head** | head |
| `department_child` | any active member | any active member |
| `owned` | any active member | the owner set (`ownerUserIds`) **or** the head |
| `personal` | owner only, no exceptions ever (I-1) | owner only |
| `authenticated` | any signed-in session | — |

**Server.** Declare the subject on the route; pass the real owner ids for an `owned` object:

```ts
config: { permission: { action: 'read', subject: (r) => ({ kind: 'department_managed', departmentId: activeDepartmentId(r) }) } }
```

Per-object ownership is checked inside the handler with the same `can()` — see
`apps/api/src/modules/work/index.ts`'s `requireCardOwnership` (404 for a foreign id, 403 for a real
row the caller does not own) — and the answer is echoed back on the DTO as `canEdit`/`canManage` so
the client never guesses. Head-only routes are listed in `apps/api/test/unit/head-only-routes.test.ts`;
adding one is a visible diff there, exactly like `PUBLIC_ROUTES`.

The per-department role lives in one place: `apps/api/src/lib/actor.ts`'s `departmentRoleOf` /
`isHeadOf` / `contextDepartmentRole`. `Actor.role` is the **instance** role and is `member` for every
real boshqarma boshligʻi (I-8b) — it is never the answer to "is this the head?". RLS gets the same
fact through `RequestContext.departmentRole` → `app.current_department_role()` (migration `0904`).

**Client.** `apps/web/src/lib/can.tsx`:

```tsx
const canEdit = useCan('work.card.edit', { ownerUserIds: card.ownerUserIds }) // one object
const canSeeTable = useCan('people.table.read')                               // the capability
<Can action="fields.definition.manage"><FieldManager /></Can>
```

Omitting the object asks "does this person ever get to do this here?", which is what a sidebar entry
or a palette command needs. Sidebar entries, palette commands and page-header actions declare the
action id they need (`NavEntry.action`) and the shell hides them through the same `can()` — the entry
and the 403 can never disagree. The client only hides; the server always decides.

### 2. People indicators: one registry, one endpoint

`packages/contracts/src/indicators.ts` lists every auto indicator with its `id`, `labelKey`, `type`,
`format`, `descriptionKey`, `headOnly`, `source` and footer `calculations`.
`GET /api/v1/people/indicators?ids=&keys=` computes them — one batched query **per source**, never per
person (I-14), cached 60 s per department, head-only. The table, the person page and the head's
dashboard all read that one service, and `apps/web/src/features/people/format.ts` renders a value
according to the registry's own `format`, so a percent is always a percent and a missing value is
always the same em dash.

Adding an indicator: add the spec, add its four locale strings under `people.indicator.<id>`, and
teach the matching source function in `apps/api/src/modules/people/repo.ts`. Never add one that could
carry personal-workspace *content* — `focusMinutes7d` is an aggregate minute count served by a
`security definer` function whose return type is physically `(user_id, minutes)` (I-1).

### 3. Custom fields: the interface the `fields` module implements

`packages/contracts/src/custom-fields.ts` declares `FieldDef`, `FieldValueRecord`, `FieldRequest`,
`FIELD_CAPS` and the `CustomFieldsPort` interface (SPEC §5). The people table, the card detail
property column, the person page and the Telegram Mini App's "Maydonlar" screen are built against that
port; the `fields` module implements it. Person values are stored against the **membership**
(department-scoped), head-only values never appear in a list endpoint, and `packages/ai` strips person
field values from every prompt payload.


## Before you're done

```bash
node agentic/scripts/gate.mjs --profile fast   # typecheck, lint, unit, i18n, secrets — must be green
```

Green means every gate in the fast profile ran and passed — not skipped. If a gate is red because of
code outside your module, fix the root cause there too and say so; do not route around it.
