# EPIC-000 Foundation — design

- **Epic:** EPIC-000  **Class:** C (auth, sessions, audit grants, RLS, migrations, deploy config, host sentinel)
- **Frozen criteria:** `agentic/ledger/cycles/EPIC-000/ac.md` @ 2026-09-05T23:56:19+05:00 (AC-1…AC-15)
- **Architect:** wp-architect (Opus). `wp-security` is mandatory on W2, W6, W8, W10.
- **Sources:** TECH-SPEC §1, §2, §3.7, §4, §6, §11, §12, §13, §14, §18, §19; DESIGN.md §2–§7; INVARIANTS I-1, I-2, I-5, I-5a, I-5b, I-6, I-7, I-8, I-8a, I-9, I-10, I-15, I-17, I-18, I-19; HARDENING H1.1–1.16, H3.3, H3.7, H4.4, H7.3, H16.1, H17.1, H18.1.

## 0. What this epic actually decides

Eight surfaces ship together. The decisions that will surprise the next engineer are all in the ADRs; the short version:

1. **The tenant column is `department_id`. There is no `tenant_id`.** CLAUDE.md says "every table has `tenant_id`"; INVARIANTS I-1 and TECH-SPEC §3 say `department_id`; decision 3 says there is no ministry layer. One name, `department_id`, everywhere. Per-ministry isolation is a *deploy topology* (one Compose stack per ministry), never a schema fork. → **ADR-002**.
2. **Not every table is department-owned.** Four classes, declared in a registry, enforced by the migrate gate. A new table that is not classified fails the gate. → **ADR-002**.
3. **Sessions are a Postgres row, full stop, in this epic.** TECH-SPEC §2.1 says "Postgres row + Valkey"; the Valkey mirror is deferred because every cache design I could draw either leaves a stale-authentication window (fails AC-13) or adds a distributed-invalidation problem to a foundation epic. → **ADR-003**.
4. **`SameSite=Lax`, not `Strict`**, against the research recommendation, because `/join/:key` invite links and Telegram deep links are cross-site top-level GETs. Compensated by double-submit CSRF + `Origin` check. → **ADR-003**.
5. **The audit hash chain serialises audit writes** (advisory lock in the insert trigger). That is a deliberate throughput ceiling, measured and budgeted. → **ADR-004**.
6. **The i18n gate is configured, not rewritten, to reach four-way parity**; where it is extended, it is strengthen-only, and a meta-test locks the strengthening in. → **ADR-012**.
7. **The demo chip is data-driven, not env-driven.** → **ADR-013**.
8. **Every AC has a one-command evidence producer** (§9). Verifiers should never have to invent a procedure.

Simplicity budget spent in this epic: one Postgres, one API process (+ one worker process sharing the image), one static SPA, one host sentinel. Valkey is present only for rate limits. Centrifugo, MinIO, ClamAV, pgBackRest, GlitchTip are declared in Compose with `profiles:` so they are **not started by `pnpm setup`** — they arrive with the epics that need them. Every added moving part in EPIC-000 has an AC pointing at it.

---

## 1. Contracts

### 1.1 Consumers I grepped

There is no application code yet, so the consumers of these contracts are the delivery tooling and the frozen documents. Each imposes a hard constraint:

| Consumer | Constraint it imposes | Where I read it |
|---|---|---|
| `agentic/gates.json` `migrate` | the db package **must** be named `@devon/db` and expose script `migrate:verify` | gates.json:27 |
| `agentic/gates.json` `e2e`, `e2e-smoke`, `a11y` | the web package **must** be named `@devon/web`, scripts `test:e2e` (supporting `--grep @smoke`) and `test:a11y` | gates.json:28-30 |
| `agentic/gates.json` `security`, `perf` | root workspace **must** define `security:scan` and `perf:check` or the gate is a vacuous `--if-present` no-op (AC-14 disproof) | gates.json:32-33 |
| `agentic/gates.json` `typecheck/lint/unit/build` | **every** workspace package must define these scripts, else the gate matches no package | gates.json:21-26 + AC-14 |
| `agentic/scripts/check-i18n.mjs` | messages live at `packages/i18n/messages/<locale>.json`; sources scanned at `apps/web/src`; keys are detected only as `t('a.b.c')` or `i18nKey="a.b.c"`; locale list comes from `agentic/i18n.config.json` | check-i18n.mjs:9-14, 35-38 |
| `agentic/scripts/check-bundle.mjs` | build output must land in `apps/web/dist/assets`; budget = `limits.bundle_main_kb_max` = **350 kB gz largest chunk** | check-bundle.mjs:10, gates.json:9 |
| `agentic/scripts/check-secrets.mjs` | `.env.example` is skipped; `${VAR}` and `process.env` forms are allowed; a literal password assignment anywhere else fails | check-secrets.mjs:9, 22 |
| `agentic/hooks/guard-edit.mjs` | migrations must live at `packages/db/migrations/*.sql` to get applied-migration protection (I-15) | guard-edit.mjs:31 |
| `agentic/scripts/dod.mjs` | screenshots named `<route with non-alnum → _>__<width>__<light\|dark>__<uz\|ru>.png` in `<cycle>/qa-visual/`, plus `manifest.json` with `routes[]` and `states_verified:true` | dod.mjs:34-49 |
| `agentic/gates.json` `limits.locales` | the four locale ids are exactly `uz-Latn`, `uz-Cyrl`, `ru`, `en` | gates.json:11 |
| DESIGN.md §2.3 | `Oʻ`/`Gʻ` use **U+02BB**, `ʼ` uses **U+02BC**; fonts must not be subset below Spacing Modifier Letters | DESIGN.md:74 |

**Consequence, stated once so nobody "fixes" it:** `gates.json` (protected) allows a 350 kB largest chunk; TECH-SPEC §1 and H4.4 demand a 200 kB shell. We enforce **200 kB inside `@devon/web`'s own `build` script via `size-limit`**, and let `check-bundle` stand as the 350 kB outer backstop. Nobody edits `gates.json`.

### 1.2 Package graph and names (fixed by the gates)

```
@devon/config     tsconfig / eslint flat / prettier / size-limit / vitest presets
@devon/contracts  Zod schemas + inferred types + can() + Problem shape   (no runtime deps beyond zod)
@devon/db         drizzle schema, migrations, tenancy registry, audit, seed
@devon/i18n       messages, t(), locale model, terms.json → TERMS.md, formatters
@devon/ui         tokens, primitives, shell components, Storybook
@devon/api        Fastify app + src/worker.ts
@devon/web        Vite SPA
@devon/sentinel   host service (published to infra/sentinel, not a runtime dep of anything)
```

Dependency direction is one-way: `contracts` ← everything; `db` ← `api`; `i18n`,`ui`,`contracts` ← `web`. `madge` circular check runs in `lint` (H28.1).

### 1.3 Locale model — `packages/i18n`

```ts
// packages/i18n/src/locale.ts
export const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'uz-Latn'
export const localeSchema = z.enum(LOCALES)

/** Native endonym, rendered in its own script — this is what the switcher shows. */
export const LOCALE_LABEL: Record<Locale, string> = {
  'uz-Latn': 'Oʻzbekcha',
  'uz-Cyrl': 'Ўзбекча',
  ru: 'Русский',
  en: 'English',
}
/** Two-letter chip shown in the top bar next to the globe (AC-8 discoverability). */
export const LOCALE_CHIP: Record<Locale, string> = { 'uz-Latn': 'UZ', 'uz-Cyrl': 'ЎЗ', ru: 'RU', en: 'EN' }

export function resolveLocale(input: { user?: string | null; stored?: string | null; header?: string | null }): Locale

/** Message accessor. The dotted-key form is mandatory: agentic/scripts/check-i18n.mjs
 *  only detects t('a.b.c') / i18nKey="a.b.c". Do not call Paraglide's m.* directly in apps/web. */
export function t(key: string, params?: Record<string, string | number>): string
export function useT(): (key: string, params?: Record<string, string | number>) => string

/** DESIGN.md §5: dates DD.MM.YYYY, times 24h, Asia/Tashkent, in every locale. */
export function formatDate(d: Date, locale: Locale, tz?: string): string   // 05.09.2026
export function formatTime(d: Date, locale: Locale, tz?: string): string   // 18:30
export function formatNumber(n: number, locale: Locale): string
export function formatUzs(n: number, locale: Locale): string               // maximumFractionDigits: 0

/** DESIGN.md §2.3: fold ASCII/typographic apostrophes to U+02BB / U+02BC on save. */
export function normalizeUz(input: string): string
```

Message file shape (`packages/i18n/messages/uz-Latn.json`, nested; `check-i18n.mjs` flattens with `.`):

```json
{
  "shell": {
    "nav": { "home": "Bosh sahifa", "board": "Doska", "projects": "Loyihalar",
             "events": "Tadbirlar", "personal": "Shaxsiy", "analytics": "Tahlil",
             "pages": "Sahifalar", "admin": "Boshqaruv" },
    "search": { "trigger": "Qidirish yoki buyruq", "placeholder": "Qidirish yoki buyruq…" },
    "locale": { "label": "Til", "switch": "Tilni oʻzgartirish" },
    "demo": { "chip": "Namoyish", "tooltip": "Bu namoyish maʼlumotlari" }
  },
  "state": {
    "empty":   { "title": "…", "body": "…", "action": "…" },
    "error":   { "title": "…", "body": "…", "action": "Qayta urinish" },
    "forbidden": { "title": "…", "body": "…", "action": "…" },
    "offline": { "title": "…", "body": "…", "action": "Qayta urinish" }
  },
  "error": { "unauthenticated": { "title": "…", "body": "…" }, "forbidden": { … }, "gone": { … } }
}
```

`agentic/i18n.config.json` (new file, owned by W3 — this is how four-way parity is switched on **without touching a gate script**):

```json
{
  "src": "apps/web/src",
  "messages": "packages/i18n/messages",
  "locales": ["uz-Latn", "uz-Cyrl", "ru", "en"],
  "allow_hardcoded": []
}
```

`allow_hardcoded` stays empty for the whole epic. If a maker wants to add an entry, that is a reviewer finding, not a fix.

### 1.4 Terminology — `packages/i18n/terms.json` → `TERMS.md` (AC-5)

`terms.json` is the source of truth; `TERMS.md` is generated (`pnpm --filter @devon/i18n terms:build`) and committed; a unit test regenerates and asserts a byte-identical file.

```ts
export type Term = {
  id: string                 // 'task', 'assignment', 'unit', 'deadline', 'employee', 'event'
  en: string
  uzLatn: string
  uzCyrl: string             // produced by the Latn→Cyrl transliterator, then human-checked
  ru: string
  source: { url: string; publisher: string; quote: string; fetchedAt: string }  // ALL required
  note?: string
}
```

`pnpm --filter @devon/i18n terms:verify` fails when: any row lacks `source.url` (must be `https://`), any row lacks a `quote`, or `normalizeUz(quote)` does not contain `normalizeUz(uzLatn)` (case-folded). Separately, `banned.json` — `sprint, ticket, epic, backlog, task, спринт, тикет, эпик, таск, бэклог` — must not appear as a whole word in any of the four message files. Both run inside `@devon/i18n test:unit`, so the `unit` gate carries them. The human/agent still fetches ≥5 sources for the a11y-i18n evidence; the script makes the *shape* non-negotiable.

Seed terms (from `docs/01-research/uzbekistan-context.md` §6 glossary, which supplies the wording but **not** the URLs — sourcing the URLs is W3's job): task=`Vazifa`, assignment-from-above=`Topshiriq`, deadline=`Muddat`, unit=`Boʻlim`, employee=`Xodim`, event=`Tadbir`, approval=`Tasdiqlash`, undo=`Bekor qilish`, saved=`Saqlandi`.

### 1.5 Errors — RFC 9457 (`packages/contracts/src/problem.ts`)

```ts
export const PROBLEM_CODES = [
  'unauthenticated', 'forbidden', 'not_found', 'gone', 'conflict',
  'validation_failed', 'rate_limited', 'maintenance', 'internal',
] as const
export type ProblemCode = (typeof PROBLEM_CODES)[number]

export const problemSchema = z.object({
  type: z.string(),            // 'https://devon.local/problems/forbidden' — stable, no domain data
  title: z.string(),           // short English, stable; clients localise from `code`
  status: z.number().int(),
  code: z.enum(PROBLEM_CODES),
  detail: z.string().optional(),   // fixed sentences only; NEVER user input, ids, SQL, paths
  instance: z.string().optional(), // 'urn:devon:request:01J...'
  errors: z.array(z.object({ path: z.string(), code: z.string() })).optional(), // validation only, no values
})
export type Problem = z.infer<typeof problemSchema>
```

`detail` is drawn from a frozen table of literals. A unit test asserts `JSON.stringify(problem)` for every code contains none of: a uuid, a login, an email, `select `, `/src/`, `at Object.` (mechanises AC-11 "no domain data" and H1.13).

### 1.6 Permissions — the single `can()` (`packages/contracts/src/permissions.ts`)

```ts
export type Role = 'super_admin' | 'head' | 'member'          // I-8b: exactly these three

export type Membership = { departmentId: string; role: Exclude<Role, 'super_admin'> }

export type Actor = {
  userId: string
  role: Role                                  // instance role
  memberships: readonly Membership[]
  departmentId: string | null                 // active department context for this request
  /** I-8. Populated ONLY from a verified, unexpired delegation row. EPIC-000 never populates it;
   *  can() ignores a grant it cannot see (fail-closed). */
  actingFor: { userId: string; role: Role; grantId: string } | null
  /** I-8a: super admin read-only cross-department view. Makes every non-read action deny. */
  viewAs: { departmentId: string } | null
}

export type Action = 'read' | 'create' | 'update' | 'archive' | 'delete' | 'administer'

export type Subject =
  | { kind: 'instance' }                                   // /api/v1/admin/*  → super_admin only
  | { kind: 'department'; departmentId: string }
  | { kind: 'department_child'; departmentId: string }     // memberships, and every future dept table
  | { kind: 'personal'; ownerUserId: string }              // I-1: owner only, never head, never view-as
  | { kind: 'own_account'; userId: string }
  | { kind: 'audit' }
  | { kind: 'public' }                                     // /healthz, /readyz, login, setup

export type DenyReason =
  | 'not_authenticated' | 'not_super_admin' | 'not_a_member' | 'not_head'
  | 'not_owner' | 'read_only_view_as' | 'department_paused' | 'maintenance'

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason }

export function can(actor: Actor | null, action: Action, subject: Subject): Decision
```

Rules encoded (and unit-tested one assertion per rule):

- `{kind:'instance'}` → allowed **iff** `actor.role === 'super_admin'` and `viewAs === null`.
- `{kind:'personal'}` → allowed iff `subject.ownerUserId === effectiveActor.userId`. `super_admin` gets **no** exception. `viewAs` gets no exception. (I-1, TECH-SPEC §3.3.)
- `{kind:'department'|'department_child'}` → allowed iff a membership matches `departmentId`; `update`/`delete` on `{kind:'department'}` additionally require `role === 'head'`; `super_admin` may `read` any department **only** through `viewAs`, and any non-`read` action under `viewAs` denies with `read_only_view_as`.
- `actingFor` replaces the effective actor for the permission decision but never for the audit row: **both** identities are always recorded (I-8).
- `DenyReason` never reaches the wire. It goes to the audit row and the pino log. The client gets `code: 'forbidden'` only.

**Enforcement, mechanically (I-7).** Every Fastify route declares its permission in `config`:

```ts
declare module 'fastify' {
  interface FastifyContextConfig {
    permission: { action: Action; subject: (req: FastifyRequest) => Subject } | { public: true }
  }
}
```

`apps/api/src/plugins/authorize.ts` adds one global `preHandler` that reads `req.routeOptions.config.permission`, calls `can()`, and on deny writes the audit row + returns the Problem. A route with no `permission` throws at **registration time** (fail fast at boot, H7.3). A unit test walks `app.printRoutes()` and asserts the set of `{public:true}` routes equals a checked-in allow-list — so adding a public route is a visible diff, and forgetting `can()` is impossible.

### 1.7 OpenAPI paths appearing in this epic

Generated from the same Zod schemas via `fastify-type-provider-zod` + `@fastify/swagger`, served at `GET /api/v1/openapi.json` (I-19).

```
GET    /healthz                          → 200 {status:'ok'}                       public
GET    /readyz                           → 200 | 503 {db, valkey, migrations}      public
GET    /api/v1/openapi.json              → 200                                     public
GET    /api/v1/instance                  → 200 InstancePublic                      public
POST   /api/v1/setup/{token}             → 201 SetupResult | 410 Problem           public, loopback-gated
POST   /api/v1/auth/login                → 204 + Set-Cookie | 401 Problem          public, rate-limited
POST   /api/v1/auth/logout               → 204 + expired cookie                    authenticated
GET    /api/v1/me                        → 200 Me | 401 Problem                    authenticated
PATCH  /api/v1/me                        → 200 Me                                  own_account
GET    /api/v1/admin/instance            → 200 AdminInstance | 403 Problem         instance
GET    /api/v1/admin/audit/verify        → 200 ChainVerification | 403 Problem     instance
ALL    /api/v1/admin/*  (unmatched)      → 403 Problem  (scoped notFoundHandler)   instance
```

```ts
export const instancePublicSchema = z.object({
  isDemo: z.boolean(),
  maintenance: z.object({ enabled: z.boolean(), message: z.record(localeSchema, z.string()).nullable() }),
  registrationOpen: z.boolean(),
  locales: z.array(localeSchema),
  defaultLocale: localeSchema,
  setupRequired: z.boolean(),          // true only when there are zero users
})

export const meSchema = z.object({
  user: z.object({
    id: z.string().uuid(), login: z.string(),
    givenName: z.string(), familyName: z.string(), patronymic: z.string().nullable(),
    title: z.string().nullable(), avatarKey: z.string().nullable(),
    locale: localeSchema, timezone: z.string(), role: z.enum(['super_admin','head','member']),
    mustChangePassword: z.boolean(),
  }),                                   // NOTE: no email here — email is Restricted, see §3.4
  memberships: z.array(z.object({
    departmentId: z.string().uuid(), name: z.string(), role: z.enum(['head','member']),
  })).max(20),
  membershipCount: z.number().int(),    // §4(h): the shell never fetches an unbounded list
  activeDepartmentId: z.string().uuid().nullable(),
  actingForUserId: z.string().uuid().nullable(),
  instance: z.object({ isDemo: z.boolean(), maintenance: z.boolean() }),
  csrfToken: z.string(),
})

export const patchMeSchema = z.object({           // explicit allow-list, H1.3 (no mass assignment)
  locale: localeSchema.optional(),
  timezone: z.string().max(64).optional(),
}).strict()

export const setupBodySchema = z.object({
  login: z.string().min(3).max(64).regex(/^[a-z0-9._-]+$/),
  password: z.string().min(12).max(256),
  givenName: z.string().min(1).max(100),
  familyName: z.string().min(1).max(100),
  patronymic: z.string().max(100).optional(),
  locale: localeSchema.default('uz-Latn'),
}).strict()

export const chainVerificationSchema = z.object({
  ok: z.boolean(),
  checkedFrom: z.number().int(), checkedTo: z.number().int(), rows: z.number().int(),
  firstBadSeq: z.number().int().nullable(),
  failure: z.enum(['row_hash_mismatch','prev_hash_mismatch','gap']).nullable(),
})
```

Conventions applied from the first endpoint (H2.x): `Idempotency-Key` accepted on `POST /api/v1/setup/{token}`; `Cache-Control: private, no-store` on every authenticated JSON response; `ETag` on `GET /api/v1/instance`; request id in `X-Request-Id` and in `problem.instance`; Brotli/gzip via `@fastify/compress`.

### 1.8 Database access — `packages/db` public API (the only path to Postgres)

```ts
export type RequestContext = {
  requestId: string
  userId: string | null
  actorRole: Role | null
  departmentId: string | null
  actingForUserId: string | null
  viewAs: boolean
  ip: string
  userAgent: string
}

export interface Tx {
  readonly drizzle: DrizzleTransaction
  /** The raw-query escape hatch named in AC-10. Asserts the GUCs are set before executing. */
  raw<R = unknown>(query: SQL): Promise<R[]>
  /** I-5: buffered, flushed inside THIS transaction. Never a separate connection. */
  audit(event: AuditEventInput): void
  /** I-2 / field tiers: records a Restricted-field read by head or super_admin. */
  privateRead(input: { subjectUserId: string; fields: string[] }): void
}

/** The ONLY exported way to reach Postgres. The Pool is module-private. */
export function withContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T>

export type AuditEventInput = {
  action: `${string}.${string}`          // 'session.created', 'access.denied', 'setup.completed'
  subjectType: string
  subjectId: string | null
  departmentId?: string | null
  before?: unknown
  after?: unknown
}
```

`withContext` opens a transaction and issues, as the first statement:

```sql
select set_config('app.request_id',  $1, true),
       set_config('app.user_id',     $2, true),
       set_config('app.actor_role',  $3, true),
       set_config('app.department_id',$4, true),
       set_config('app.view_as',     $5, true);
```

`true` = **transaction-local** (`SET LOCAL` semantics). This is the PgBouncer-transaction-pooling requirement from `backend-architecture-and-multitenancy.md` §A8 and H3.3. A plain `SET` anywhere is a SEV1 and is banned by an ESLint `no-restricted-syntax` rule plus a Semgrep pattern.

`raw()` executes `select current_setting('app.user_id', true)` guard logic once per transaction (cached on the `Tx`) and throws `TenancyContextMissing` if the transaction opened without going through `withContext`. Belt: because policies compare against a NULL GUC, an unscoped query returns **zero rows** rather than every row — default-deny, not default-allow.

### 1.9 Sentinel wire contract — `infra/sentinel`

```
POST http://127.0.0.1:8787/command      Content-Type: application/json   (≤ 4096 bytes)

{ "v": 1,
  "command": "noop",
  "nonce": "<64 hex chars = 32 bytes>",
  "issued_at": "2026-09-06T10:00:00.000Z",
  "sig": "<base64url ed25519 over canonicalJson({v,command,nonce,issued_at})>" }

200 {"ok":true,"command":"noop","at":"…"}
400 {"error":"malformed"} | {"error":"unknown_command"}
401 {"error":"bad_signature"} | {"error":"expired"} | {"error":"replay"}
403 {"error":"forbidden"}            // non-loopback peer; body carries nothing else
413 {"error":"too_large"}

GET  /healthz → 200 {"ok":true,"commands":["noop"]}
```

`canonicalJson` = keys sorted ascending, no whitespace, UTF-8. Verification order is fixed: **peer address → size → parse → signature → freshness (|now − issued_at| ≤ 60 s) → nonce unseen → command allow-list**. Every outcome writes one line to `/var/log/devon-sentinel.log`. Public key only in `/etc/devon/sentinel.conf` (mode 0600, owner root); the private key exists only on the operator's machine and, later, in the super admin console (EPIC-013).

---

## 2. Data model delta

Everything here is new. Conventions (TECH-SPEC §3): `id` uuid v7 (demo rows use deterministic uuid v5, §5.3), `created_at`/`updated_at`/`deleted_at` timestamptz, `version int not null default 1` for optimistic concurrency, UTC storage, `department_id` on every department-owned table.

### 2.1 Table classes (the registry)

```ts
// packages/db/src/tenancy.ts
export type TableClass = 'tenant_root' | 'department_owned' | 'user_owned' | 'global' | 'audit'

export const TENANCY: Readonly<Record<string, TableClass>> = {
  'app.departments':        'tenant_root',        // policy on id
  'app.memberships':        'department_owned',
  'app.users':              'global',
  'app.sessions':           'global',
  'app.setup_tokens':       'global',
  'app.instance_settings':  'global',
  'app.seed_runs':          'global',
  'app.idempotency_keys':   'global',
  'audit.events':           'audit',
  'audit.private_reads':    'audit',
  'audit.anchors':          'audit',
}
```

The migrate-gate test (`packages/db/test/tenancy.registry.test.ts`) does all of the following against a live Testcontainers Postgres 17:

1. Every base table in schemas `app` and `audit` appears in `TENANCY`. **An unclassified new table fails the gate.**
2. `department_owned` ⇒ has `department_id uuid not null references app.departments(id)`, `relrowsecurity`, `relforcerowsecurity`, ≥1 policy whose `qual` references `app.current_department_id()`, and an index leading with `department_id`.
3. `tenant_root` ⇒ RLS + a policy referencing `id = app.current_department_id()` or `app.current_actor_role() = 'super_admin'`.
4. `user_owned` ⇒ has `user_id uuid not null`, RLS, policy `user_id = app.current_user_id()`, and **no** policy mentioning `actor_role` (I-1: the head and the super admin never see personal rows).
5. `global` ⇒ appears in a checked-in `GLOBAL_ALLOWLIST` with a one-line justification. Adding a table to `global` is a visible, reviewable diff.
6. `audit` ⇒ `devon_app` has exactly `{INSERT, SELECT}` (`information_schema.role_table_grants`), and the mutation-block triggers exist.

Because `user_owned` has zero real tables in this epic, the test additionally creates two throwaway tables through the `departmentTable()` / `userTable()` helpers inside the test transaction and runs the same assertions plus an isolation probe on them — so the *mechanism* is proven for the epics that will use it, not just the two tables that exist today.

### 2.2 Tables

**`app.departments`** (tenant_root) — `id`, `name text not null`, `slug citext not null`, `description text`, `emoji text`, `colour text`, `locale_default text not null default 'uz-Latn'`, `timezone text not null default 'Asia/Tashkent'`, `settings jsonb not null default '{}'`, `status` enum(`active`,`paused_by_admin`,`deletion_requested`,`archived`) default `active`, `created_at`, `updated_at`, `deleted_at`, `version`.
Unique: `(slug) where deleted_at is null`. Join key/password columns are **not** here — EPIC-002 adds them (expand step).

**`app.memberships`** (department_owned) — `id`, `department_id not null`, `user_id not null`, `role` enum(`head`,`member`), `title_override text`, `joined_at`, `left_at`, `status` enum(`active`,`pending_approval`,`removed`), `created_at`, `updated_at`, `deleted_at`, `version`.
Unique: `(department_id, user_id) where deleted_at is null` — **scoped to the tenant**, never global (the constraint-leak gotcha from `backend-architecture-and-multitenancy.md` §2: a global unique constraint leaks the existence of another tenant's row through a duplicate-key error).
Index: `(department_id, user_id)`, `(user_id) where status='active'`.

**`app.users`** (global) — `id`, `login citext not null unique`, `email citext null` *(Restricted, §3.4)*, `password_hash text not null`, `given_name`, `family_name`, `patronymic null`, `title null`, `avatar_key null`, `locale text not null default 'uz-Latn'` (check ∈ four), `timezone text not null default 'Asia/Tashkent'`, `role` enum(`super_admin`,`head`,`member`) not null default `member`, `status` enum(`active`,`locked`,`deleted`), `must_change_password bool not null default false`, `last_login_at`, `created_at`, `updated_at`, `deleted_at`, `version`.
Index: `(lower(family_name) collate "uz-x-icu", lower(given_name) collate "uz-x-icu")` for name sorting (§4(i)).
Columns deliberately absent, and enforced absent by test: any column matching `/birth|dob|passport|pinfl|inn|address|salary|nationality|religio/i` in **any** migration file → migrate gate fails (I-2).

**`app.sessions`** (global) — `id uuid`, `user_id not null`, `token_hash bytea not null` (SHA-256 of a 32-byte CSPRNG token; the raw token exists only in the cookie), `csrf_hash bytea not null`, `device_label text`, `ip inet`, `user_agent text`, `created_at`, `last_seen_at`, `expires_at not null`, `revoked_at null`, `revoked_reason text null`.
Unique index on `token_hash`. Partial index `(user_id) where revoked_at is null`. Idle 12 h / absolute 30 d (TECH-SPEC §2.1).

**`app.setup_tokens`** (global) — `id`, `token_hash bytea not null unique`, `created_at`, `expires_at not null` (created_at + 24 h), `consumed_at null`, `consumed_by_user_id null`, `issued_reason text` (`first_boot` | `reissue`).

**`app.instance_settings`** (global, singleton) — `id smallint primary key default 1 check (id = 1)`, `is_demo bool not null default false`, `registration_open bool not null default true`, `maintenance jsonb not null default '{"enabled":false}'`, `limits jsonb`, `created_at`, `updated_at`, `version`.

**`app.seed_runs`** (global) — `name text primary key`, `checksum text not null`, `applied_at timestamptz not null default now()`, `rows_written int not null`.

**`app.idempotency_keys`** (global) — `key text`, `route text`, `user_id null`, `request_hash text`, `response_status int`, `response_body jsonb`, `created_at`, primary key `(key, route)`, index on `created_at` for the retention sweep (24 h).

**`audit.events`** (audit) — `seq bigint generated always as identity primary key`, `id uuid not null default gen_random_uuid()`, `at timestamptz not null default now()`, `actor_user_id uuid null`, `actor_role text null`, `on_behalf_of uuid null`, `department_id uuid null`, `action text not null`, `subject_type text not null`, `subject_id text null`, `before jsonb`, `after jsonb`, `ip inet`, `user_agent text`, `request_id text`, `prev_hash bytea not null`, `row_hash bytea not null`.
Indexes: `(at)`, `(department_id, at)`, `(actor_user_id, at)`, `(subject_type, subject_id)`.
**No `deleted_at`. Never retained away** (I-3).

**`audit.private_reads`** (audit) — `seq bigint identity`, `at`, `viewer_user_id not null`, `viewer_role`, `subject_user_id not null` *(indexed — the "who looked at my record" self-service view in a later epic needs it as a first-class column, per `auth-permissions-security-compliance.md` §G1; adding it later is a migration, adding it now is free)*, `fields text[] not null`, `department_id null`, `request_id`.

**`audit.anchors`** (audit) — `seq bigint identity`, `at`, `head_seq bigint not null`, `head_hash bytea not null`, `written_to text not null` (file path / channel).

### 2.3 Audit immutability and the hash chain

```sql
-- 0002_audit.sql
create schema audit;
revoke all on schema audit from public;
grant usage on schema audit to devon_app;

-- ... table DDL ...

grant insert, select on audit.events, audit.private_reads, audit.anchors to devon_app;
revoke update, delete, truncate, references, trigger on audit.events from devon_app;
-- identity column needs no sequence grant; if a sequence is ever added, grant USAGE only.

create or replace function audit.block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit.% is append-only (INVARIANT I-5a); attempted %',
    tg_table_name, tg_op using errcode = '42501';
end $$;

create trigger events_no_update before update on audit.events
  for each row execute function audit.block_mutation();
create trigger events_no_delete before delete on audit.events
  for each row execute function audit.block_mutation();
create trigger events_no_truncate before truncate on audit.events
  for each statement execute function audit.block_mutation();

create or replace function audit.chain_row() returns trigger language plpgsql as $$
declare prev bytea;
begin
  perform pg_advisory_xact_lock(hashtext('audit.events'));
  select row_hash into prev from audit.events order by seq desc limit 1;
  new.prev_hash := coalesce(prev, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  new.row_hash  := digest(new.prev_hash || audit.canonical(new), 'sha256');
  return new;
end $$;
create trigger events_chain before insert on audit.events
  for each row execute function audit.chain_row();
```

`audit.canonical(audit.events)` is an `immutable` function producing a stable byte string from the content columns **only** (`id, at, actor_user_id, actor_role, on_behalf_of, department_id, action, subject_type, subject_id, before, after, ip, user_agent, request_id`) — deliberately excluding `seq`, `prev_hash`, `row_hash`. `jsonb` is canonicalised by Postgres's own key ordering, which is stable for a given server version; the anchor file records the server version so a future major upgrade that changed jsonb ordering would be detectable rather than silent.

```sql
create or replace function audit.verify_chain(from_seq bigint default 1, to_seq bigint default null)
returns table (ok boolean, first_bad_seq bigint, failure text, rows_checked bigint)
```

It walks in `seq` order and reports the **first** seq where either `row_hash <> digest(prev_hash || canonical(row))` (→ `row_hash_mismatch`, i.e. the payload was altered) or `prev_hash <> previous.row_hash` (→ `prev_hash_mismatch`, i.e. a row was removed or inserted out of band). AC-9's "tampering with one row's payload as a superuser makes verification report exactly that row" is satisfied by the first branch reporting that row's own `seq`.

Nightly `audit.anchor` pg-boss job writes `{head_seq, head_hash, at, pg_version}` as one appended line to `${AUDIT_ANCHOR_PATH}` (default `/var/lib/devon/audit-anchor.log`, a separate volume, mounted append-only) and inserts an `audit.anchors` row. Telegram delivery of the anchor is EPIC-007.

**Grants alone are not enough and triggers alone are not enough** — AC-9's disproof names both. We ship both, and the migrate-gate test asserts both independently: it drops nothing, but it runs `set role devon_app` and attempts UPDATE / DELETE / TRUNCATE (expect 3 errors), then asserts `role_table_grants` shows exactly `INSERT, SELECT`.

### 2.4 RLS

```sql
-- 0005_rls.sql
create or replace function app.current_department_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.department_id', true), '')::uuid $$;
create or replace function app.current_user_id() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create or replace function app.current_actor_role() returns text language sql stable as
  $$ select nullif(current_setting('app.actor_role', true), '') $$;
create or replace function app.is_view_as() returns boolean language sql stable as
  $$ select coalesce(nullif(current_setting('app.view_as', true), ''), 'false')::boolean $$;

alter table app.memberships enable row level security;
alter table app.memberships force row level security;
create policy memberships_read on app.memberships for select
  using (department_id = app.current_department_id());
create policy memberships_write on app.memberships for all
  using (department_id = app.current_department_id() and not app.is_view_as())
  with check (department_id = app.current_department_id() and not app.is_view_as());

alter table app.departments enable row level security;
alter table app.departments force row level security;
create policy departments_read on app.departments for select
  using (id = app.current_department_id() or app.current_actor_role() = 'super_admin');
create policy departments_write on app.departments for all
  using (id = app.current_department_id() and app.current_actor_role() in ('head','super_admin')
         and not app.is_view_as())
  with check (id = app.current_department_id() and not app.is_view_as());
```

Three properties that are easy to get wrong and are therefore asserted:

- **The app role is not the table owner.** `devon_migrator` owns everything; `devon_app` only has DML grants. If the app role were the owner, RLS would not apply to it at all and AC-10 would silently pass in tests and fail in production. `FORCE ROW LEVEL SECURITY` is set anyway so that a future accidental owner-connection is still constrained. A test asserts `pg_class.relowner <> devon_app` for every table.
- **No policy uses a sub-select against another table.** `backend-architecture-and-multitenancy.md` §2 documents a READ COMMITTED race where a lookup-table sub-query in a policy can see stale rows and momentarily expose cross-tenant data. Our policies compare a column to a GUC — no sub-select, no race. If a future policy needs a lookup, it must use `SECURITY DEFINER` or `FOR SHARE`; a migration linter rejects `select` inside a `create policy … using (…)` clause without one of those markers.
- **Unset context = zero rows**, never "all rows".

### 2.5 Search, collation, Uzbek text

```sql
-- 0006_normalize_uz.sql
create or replace function app.normalize_uz(t text) returns text
  language sql immutable strict parallel safe as $$
  select lower(translate(t, 'ʻʼ'''`ʹ', ''))     -- fold all apostrophe variants away for matching
  $$;   -- Cyrillic→Latin folding table added in the same function body (EPIC-004 validates it against real data)
```

Collation: names sort with `collate "uz-x-icu"` where available. `0006` checks `pg_collation` and falls back to `und-x-icu` with a `raise notice`; the migrate-gate test asserts the chosen collation orders `Oʻzoqov` after `Ozodov` and before `Qodirov` — a real ordering assertion, not a smoke test. Postgres FTS uses `simple` + `pg_trgm` for Uzbek (no core Uzbek config exists — `backend-architecture-and-multitenancy.md` §6) and `russian` for ru. EPIC-000 ships the function and the index helper; EPIC-004 uses them.

### 2.6 Retention

| Data | Retention | Mechanism |
|---|---|---|
| `audit.events`, `audit.private_reads`, `audit.anchors` | **never** | I-3, I-5a. No sweep job may touch the `audit` schema; the retention job's table allow-list is checked in and unit-tested. |
| `app.sessions` (revoked or expired) | 90 days | `retention.sweep` hard-delete, one audit row per sweep with counts. |
| `app.setup_tokens` (consumed or expired) | 365 days | kept long enough to prove a bootstrap happened; then hard-deleted with an audit row. |
| `app.idempotency_keys` | 24 hours | sweep. |
| pino logs | 30 days, rotated | Compose logging driver limits. |

`retention.sweep` is registered in EPIC-000 with only these four entries and a hard assertion that every table it touches is in `{sessions, setup_tokens, idempotency_keys}` ∪ future registrations, and never in schema `audit`.

### 2.7 Migration plan — expand → migrate → contract

Every migration in this epic is **expand-only** (CREATE only). There is nothing to migrate and nothing to contract, and that is the property that makes §5's rollback free.

| File | Contents | Idempotent by |
|---|---|---|
| `0000_extensions.sql` | `create extension if not exists pgcrypto, pg_trgm, citext, vector`; `create schema if not exists app, audit` | `if not exists` |
| `0001_roles.sql` | `devon_migrator`, `devon_app` roles; schema usage; `alter default privileges` so future tables grant DML to `devon_app` automatically but grant nothing on `audit` | `do $$ … if not exists … $$` |
| `0002_audit.sql` | audit tables, `canonical()`, `chain_row()`, `block_mutation()`, triggers, grants/revokes, `verify_chain()` | `create table if not exists`, `create or replace function`, `drop trigger if exists` then `create trigger` |
| `0003_identity.sql` | `users`, `sessions`, `setup_tokens`, `instance_settings`, `seed_runs`, `idempotency_keys` | `if not exists` |
| `0004_departments.sql` | `departments`, `memberships` | `if not exists` |
| `0005_rls.sql` | GUC helper functions; enable+force RLS; policies | `create or replace`, `drop policy if exists` then `create policy` |
| `0006_normalize_uz.sql` | `normalize_uz()`, collation probe, trigram index helpers | `create or replace` |

`migrate:verify` (`pnpm --filter @devon/db migrate:verify`) does, on a fresh Testcontainers Postgres 17:

1. apply all migrations → assert exit 0;
2. apply again → assert exit 0 **and** `drizzle-kit check` reports zero drift (idempotence, gate table row "migrations apply cleanly on an empty DB, then again");
3. run `tenancy.registry.test.ts` (§2.1);
4. run `rls.isolation.test.ts` — seed departments A and B, then for every `department_owned` and `tenant_root` table, under A's context, `select count(*)` of B's rows = 0, via **both** the Drizzle path and `tx.raw()`; plus one run through PgBouncer in transaction mode with 20 concurrent interleaved transactions asserting zero cross-reads (§4(a));
5. run `audit.immutability.test.ts` — grants, three denials as `devon_app`, 500-row concurrent chain build, `verify_chain()` ok, then a superuser `update audit.events set after = …` on one row (superuser bypasses the trigger only if the trigger is disabled — so the test uses `alter table … disable trigger` as superuser, mutates, re-enables) and asserts `verify_chain()` returns exactly that `seq`;
6. run `seed.idempotence.test.ts` — seed twice, compare per-table counts;
7. run `migration-lint.mjs` — no `DROP TABLE|DROP COLUMN|ALTER COLUMN … TYPE|TRUNCATE|DELETE FROM` outside a `*_contract.sql` file carrying a `-- CONTRACT: safe because <release that shipped the expand step>` header; no forbidden personal-data column names (I-2); no `SET ` without `LOCAL`/`set_config(..., true)`; no `grant … on audit` beyond INSERT/SELECT (a migration touching `audit` grants is SEV1 per I-5a and the linter refuses it outright).

---

## 3. Permissions

### 3.1 Rules that change (all of them are new)

| # | Rule | Enforced where |
|---|---|---|
| P1 | `can(actor,'administer',{kind:'instance'})` ⇔ `role==='super_admin' && !viewAs` | `packages/contracts` + `/api/v1/admin` plugin preHandler + `notFoundHandler` |
| P2 | Any action on `{kind:'personal'}` ⇔ actor is the owner. No super_admin exception, no head exception, no view-as exception | `can()` + `user_owned` RLS policy (two independent layers) |
| P3 | `{kind:'department'|'department_child'}` ⇔ active membership in that department; `update`/`delete` on the department itself ⇔ `head` | `can()` + `department_owned` RLS |
| P4 | Under `viewAs`, every non-`read` action denies with `read_only_view_as` | `can()` + `not app.is_view_as()` in every write policy |
| P5 | Every route declares a permission or fails at boot | `authorize.ts` + route-table unit test |
| P6 | Every denial from an authenticated session writes `audit.events{action:'access.denied'}` with the route, the reason and both identities | `authorize.ts` |
| P7 | `actingFor` is honoured only from a verified grant row; a client-supplied value is ignored | `can()` (grantId required) + unit test with a forged header |

### 3.2 Field tiers for the personal data this epic introduces

`app.users` is the only table with personal data. Tiers (from `auth-permissions-security-compliance.md` §6, extended to this schema):

| Tier | Fields | Who reads | Logged |
|---|---|---|---|
| **public** | `given_name`, `family_name`, `patronymic`, `title`, `avatar_key` | any authenticated user in a shared department | no |
| **internal** | `login`, `status`, `last_login_at`, `locale`, `timezone` | self; head of a shared department; super_admin | no |
| **restricted** | `email` (and every future contact field) | self only; head or super_admin **only via an explicit endpoint**, and every such read writes `audit.private_reads` | **yes** |
| **secret** | `password_hash`, `csrf_hash`, `token_hash`, future `totp_secret_enc`, `recovery_codes_hash` | nobody. Never in any response, never in an audit `before`/`after`, never in a log | n/a |

Implementation: the tier is metadata on the schema, not on the row — `packages/db/src/tiers.ts` exports `USER_FIELD_TIER: Record<keyof User, Tier>`, and `packages/contracts` derives `publicUserSchema`, `internalUserSchema` from it. A unit test asserts every response schema in the OpenAPI document is a subset of the tier its endpoint declares, and that no schema anywhere includes a `secret` field name. Redaction of audit payloads uses the same map (H1.11).

**In EPIC-000 there is no endpoint that returns another person's `email`.** `audit.private_reads` and `tx.privateRead()` ship tested-but-unused, so EPIC-001's profile endpoints have nowhere to cut a corner.

Data localisation (Uzbek law, `uzbekistan-context.md` §42): all four tiers live in the single in-country Postgres. Nothing personal leaves the server: fonts, icons and illustrations are self-hosted (H8.2), there is no CDN, no analytics script, no external font or telemetry call. A Playwright test asserts every network request made by the shell is same-origin (mechanises H21.1 at the earliest possible moment).

### 3.3 Acting-for

`RequestContext.actingForUserId` is threaded from the HTTP layer to `withContext` to `audit.events.on_behalf_of` in this epic, so the column and the plumbing exist before any feature needs them (I-8). No endpoint sets it. `can()` requires `actingFor.grantId`; since no grants table exists, any value is rejected. The audit renderer always prints both identities (`actor_user_id` and `on_behalf_of`), and the audit unit test asserts a row with `on_behalf_of` set renders as "X acting for Y" rather than as "Y".

### 3.4 Admin namespace behaviour (AC-11)

```ts
// apps/api/src/modules/admin/index.ts
export default async function admin(app: FastifyInstance) {
  app.addHook('preHandler', requireSuperAdmin)          // runs before every route in this plugin
  app.setNotFoundHandler((req, reply) =>                 // /api/v1/admin/anything-unmatched
    requireSuperAdmin(req, reply).then(() => reply.code(404).send(problem('not_found', 404))))
  app.get('/instance', { config: { permission: { action: 'administer', subject: () => ({ kind: 'instance' }) } } }, …)
  app.get('/audit/verify', { config: { permission: { action: 'administer', subject: () => ({ kind: 'instance' }) } } }, …)
}
```

For a non-super-admin, **every** path under `/api/v1/admin` — existing or not — returns the identical 403 Problem body with an identical shape and no domain data; only a super admin can distinguish 403 from 404. Rate limiting is applied before the check so response timing is dominated by the constant-time path, and a unit test asserts the 403 body for an existing and a non-existing admin route is byte-identical.

The web `/admin` route renders the `NoPermissionState` (DESIGN §4) — client-side hiding of the nav entry is cosmetic only; the server response is what enforces (I-6). An e2e test asserts that a member deep-linking to `/admin` sees the no-permission state **and** that the network response carried no admin payload.

**Denial-audit DoS**: only authenticated sessions produce audit rows on denial; unauthenticated requests get 401 and a pino line. `@fastify/rate-limit` (Valkey-backed, keyed by session id then IP) caps an authenticated session at 100 req/min, which bounds audit-row growth to a known rate. Stated here so nobody "optimises" it into an UPDATE-based counter, which `audit.events` forbids.

---

## 4. Failure modes

Every row: what breaks, how we detect it, what we do about it.

**(a) Cross-department leak through connection pooling.** A plain `SET app.department_id` under PgBouncer transaction pooling leaks the previous request's setting onto the next request sharing the physical connection (`backend-architecture-and-multitenancy.md` §A8 — flagged there as "the single most security-critical detail").
*Detect:* the migrate-gate concurrency test runs 20 interleaved transactions from 4 simulated departments through PgBouncer with `default_pool_size=2` and asserts zero cross-reads; Semgrep rule `no-session-set` fails on any `SET ` not followed by `LOCAL` and any `set_config` with a third argument other than `true`.
*Mitigate:* transaction-local `set_config(..., true)` only; the Pool is module-private; `tx.raw()` asserts the GUC.

**(b) Audit chain corruption under concurrent inserts.** Two transactions read the same `prev_hash` → a fork in the chain that `verify_chain()` reports forever.
*Detect:* 500 rows from 20 connections then `verify_chain()` in the migrate gate.
*Mitigate:* `pg_advisory_xact_lock` in the BEFORE INSERT trigger. **Accepted cost:** audit inserts are serialised instance-wide. At the §0 scale target (200 departments × 300 people) audit write rate is ~10–50/s against a lock held for microseconds; k6 in EPIC-014 measures it. If it ever binds, the escape is per-department chains (`prev_hash` per `department_id`), which weakens global tamper-evidence — recorded in ADR-004 as the named, reversible fallback rather than discovered under load.

**(c) Partial failure: domain write commits, audit row does not (or vice versa).**
*Detect:* unit test — a handler that throws after `tx.audit()` leaves zero audit rows; a handler that succeeds leaves exactly one.
*Mitigate:* `tx.audit()` buffers and flushes inside the same transaction; there is no API to write an audit row on another connection (I-5).

**(d) Setup-token race — two operators open the URL at the same time → two super admins.**
*Detect:* a test firing two concurrent `POST /api/v1/setup/{token}`; exactly one 201, one 410.
*Mitigate:* consumption is `update app.setup_tokens set consumed_at = now() where id = $1 and consumed_at is null returning id`; zero rows ⇒ 410. The user insert is in the same transaction.

**(e) Cookie replay after logout.**
*Detect:* the security verifier's captured-cookie replay (AC-13) and a unit test.
*Mitigate:* no session cache anywhere; `revoked_at` in Postgres is checked on every request by the same indexed lookup that authenticates. See ADR-003 for why the Valkey mirror is deferred.

**(f) `pnpm start --demo` run twice, or run concurrently.**
*Detect:* the seed-idempotence test in the migrate gate; a test running two seeds concurrently.
*Mitigate:* `pg_advisory_lock(hashtext('devon.seed'))` for the duration of the seed + `app.seed_runs(name)` primary key + deterministic UUIDv5 ids + `on conflict do nothing`. Second run prints `demo seed already applied (checksum …) — 0 rows written` and exits 0.

**(g) Offline / flaky ministry wifi.**
*Detect:* Playwright with `context.setOffline(true)` on every route in `e2e/routes.json`; the `?__state=offline` forcing param for visual capture.
*Mitigate:* persisted TanStack Query cache renders last-seen data; a top-of-shell offline banner naming what happened with exactly one action ("Qayta urinish"); the only write in this epic (`PATCH /api/v1/me`) is queued with a visible pending badge and replayed on reconnect; destructive actions (none yet) refuse offline by policy. Never a silent failure, never an unbounded spinner (skeletons ≥1 s, progress beyond 10 s — DESIGN §4).

**(h) 20-ministry / 200-department tenant load.**
*Detect:* a seed profile `--demo --scale=large` creating 200 departments and 2 000 memberships; an e2e assertion that `/` issues ≤ 3 API requests and that `GET /api/v1/me` responds < 150 ms p95 at that size.
*Mitigate:* `me.memberships` is capped at 20 with a separate `membershipCount`; the department switcher is a server-side search endpoint from the first commit (EPIC-002 fills it); an ESLint rule bans a list handler without a `cursor` parameter; every `department_owned` index leads with `department_id`.

**(i) Uzbek and Russian text overflow.** Russian runs ~35 % longer than English; uz-Latn compounds (`Foydalanuvchilar roʻyxati`, `Axborot-tahlil boshqarmasi`) are longer still. This is what breaks AC-6.
*Detect:* a Playwright assertion at 390 px in uz-Latn **and** ru, for every element with `data-shell-label`: `el.scrollWidth <= el.clientWidth + 1`; plus `document.documentElement.scrollWidth <= window.innerWidth` (no horizontal scrollbar); plus a computed-style assertion that no shell element has `text-overflow: ellipsis`.
*Mitigate:* no `truncate` class anywhere in the shell; `min-width: 0` on every flex child; labels wrap; nav rows are two-line-capable; the sidebar is a Vaul drawer below 768 px. Name sorting uses `collate "uz-x-icu"` (§2.5).

**(j) Missing glyphs / tofu / wrong apostrophe.** A font subset that stops at Latin-1 renders `Oʻ` as `O` + box, and an ASCII `'` looks almost right while being the wrong character.
*Detect:* a Playwright test that measures, in the shipped font and in a forced-fallback font, the advance width of each of `Oʻ Gʻ ʼ ў ғ қ ҳ`; equal widths ⇒ substitution ⇒ fail. A second test asserts each codepoint's `document.fonts.check()` is true and that the shipped `woff2` `unicode-range` covers U+02B0–02FF, U+0400–04FF, U+0500–052F.
*Mitigate:* self-hosted subsets pinned to Latin Extended + Cyrillic + Cyrillic Supplement + Spacing Modifier Letters (DESIGN §2.3, H6.2); `normalizeUz()` on every text input save; a Storybook glyph page as the human-readable artefact.

**(k) Toolchain drift on a clean machine (AC-1).** Wrong Node, no pnpm, ports in use, Docker not running.
*Detect:* `pnpm setup` runs a preflight that prints Node / pnpm / Docker versions and the result of a port probe, and fails with an exact remedy line.
*Mitigate:* `engines.node` + `packageManager: "pnpm@<pinned>"` so corepack provisions the right pnpm; **`node setup.mjs` at the repo root does the same job for a machine that has only Node** (it shells corepack itself), so "only Node and Docker" is literally true; Compose maps host ports `55432`/`56379`/`58080` so an existing local Postgres or Redis cannot collide, all overridable in `.env`.
*Open ambiguity flagged for wp-pm, not escalated:* AC-1 names `pnpm setup` as the first command while the machine may have no `pnpm`. The design satisfies both readings (`corepack enable && pnpm setup`, or `node setup.mjs`), the README prints both, and neither is "installing a global tool". If the verifier reads it more strictly than that, it is an AC-CHANGE conversation, not a build failure.

**(l) Windows developer machine.** The maintainer runs Windows 11; CRLF, path separators and `VAR=x cmd` all break naïvely.
*Detect:* a CI job on `windows-latest` running `gate.mjs --profile fast`.
*Mitigate:* every script is `.mjs` invoked via `node`, never a shell one-liner; flags come from `process.argv`, never from inline env assignment; `.gitattributes` sets `* text=auto eol=lf`; Prettier `endOfLine: "lf"`.

**(m) Sentinel reachable from a container.** `host.docker.internal` resolves to the host's bridge address; a service bound to `0.0.0.0` would be reachable from every container.
*Detect:* a test that binds the sentinel and asserts `server.address().address === '127.0.0.1'`; an integration test issuing a valid signed command from a container on the bridge network and asserting 403; `ss -ltnp` output pasted as evidence.
*Mitigate:* explicit `listen({ host: '127.0.0.1' })` **and** an independent peer-address check on every request (either alone would be sufficient; both are cheap).

**(n) Replay window vs. clock skew on the sentinel.** A nonce file pruned faster than the freshness window lets an old command replay.
*Detect:* a unit test that sets the clock forward past the prune horizon and replays.
*Mitigate:* freshness window 60 s, nonce retention 300 s — retention strictly greater than the window, asserted by a test on the two constants.

---

## 5. Rollback path

### 5.1 Application

Deploy is `infra/docker-compose.yml` with images pinned **by digest** (H18.1). Rollback is:

```bash
git checkout <previous-tag> -- infra/docker-compose.yml
docker compose up -d --wait
```

This is loss-free **because every migration in this epic is CREATE-only**: the previous application version runs unchanged against the newer schema. That property is not a happy accident; `migration-lint.mjs` refuses any destructive statement outside a `*_contract.sql` file, so it stays true for every later epic that follows the expand → migrate → contract policy.

### 5.2 Database

There is no "down" migration and there never will be (I-15: applied migrations are never edited, and a down-migration is an edit by another name). Recovery paths, in order of preference:

1. **Roll the app back** (above). Extra tables and columns are inert.
2. **A new forward migration** that neutralises the problem (drop a bad index, relax a check). Never a rewrite of `0002`.
3. **PITR restore** via pgBackRest (configured in EPIC-000, drilled in EPIC-014): RPO ≤ 15 min from WAL archiving, RTO ≤ 4 h. `infra/README.md` carries the literal restore command list.

The `audit` schema is never restored *backwards* past the last anchor without recording the fact: the restore runbook's final step inserts an `audit.anchors` row noting the restore point, so a gap in the chain has a documented cause rather than looking like tampering.

### 5.3 Demo data

`pnpm --filter @devon/db seed:reset --demo` deletes only rows whose `id` is inside the demo UUIDv5 namespace and whose `seed_runs.name` matches, then deletes the `seed_runs` row. It refuses unless `DEVON_DEMO=1` and `NODE_ENV !== 'production'`. **Demo audit rows are not deleted** — `audit.events` has no delete path, by design (I-3/I-5a). This is documented in `infra/README.md` so it is not discovered as a bug.

### 5.4 Bootstrap and sentinel

- Leaked or lost setup URL: `pnpm --filter @devon/api setup:reissue` revokes every unconsumed token and issues one new one, writing `audit.events{action:'setup.token_reissued'}`.
- A super admin created in error: documented `psql` runbook step (lock the account, create a replacement via `setup:reissue`), with a manual `audit.events` insert recording who did it and why. There is no "delete the super admin" button, by design.
- Sentinel: `systemctl stop devon-sentinel`. It holds no data; stopping it removes capability, never state.

---

## 6. ADRs

Returned in `adr_markdown`, one file per decision, using `agentic/templates/adr.md`:

| ADR | Decision | Why it would surprise the next engineer |
|---|---|---|
| ADR-000 | Security baseline: OWASP ASVS 5.0 L2 + `agentic/HARDENING.md` as the gate | sets the bar and names what is *out* (no L3, no WAF in EPIC-000) |
| ADR-001 | Monorepo, exact pins, `@devon/*` scope, package-script parity | the package names are load-bearing for `gates.json` |
| ADR-002 | Tenancy = `department_id` + RLS + a four-class table registry; **no `tenant_id`** | contradicts CLAUDE.md's wording; the registry is a new mechanism |
| ADR-003 | Built-in sessions, Postgres as the sole revocation record, Valkey mirror deferred, `SameSite=Lax` | contradicts TECH-SPEC §2.1 and the research's `Strict` recommendation |
| ADR-004 | Immutable hash-chained audit: grants + triggers + advisory-locked chain | the serialised-writer cost is invisible until it isn't |
| ADR-010 | Tokens/theming: DTCG → Tailwind v4 `@theme`, Palette B, per-tenant override surface, self-hosted fonts | the font subset ranges are a correctness requirement, not a preference |
| ADR-011 | Pause/wipe: sentinel skeleton, loopback + ed25519 + nonce, `noop` only, no destructive code path in this epic | someone will otherwise "helpfully" add the wipe command early |
| ADR-012 | Four locales via config not gate-edit; `t('dotted.key')` wrapper over Paraglide; strengthen-only gate extension | the wrapper costs per-message tree-shaking on purpose |
| ADR-013 | Demo seed: checksum + deterministic ids for exact idempotence; data-driven demo chip; gate non-vacuity discipline | the chip being a DB column rather than an env var is the whole point |
| ADR-005/006/007/008/009 | **Deferred stubs**, each naming the epic that will decide it | TECH-SPEC §18 lists them for EPIC-000; writing them now would be inventing decisions nobody has made. Recorded as a deliberate, reasoned deviation rather than a silent omission. |

---

## 7. Work breakdown hints for `wp-lead`

### 7.1 Seams

The natural seam here is **toolchain → (schema ‖ tokens ‖ locales ‖ contracts ‖ infra) → api → web → e2e → demo → gate-proof**. Eleven items; W1 and W11 are the only serialisation points.

| Item | Title | Owner | Class | Covers | Depends on | Parallel-safe |
|---|---|---|---|---|---|---|
| W1 | Monorepo, `@devon/config`, pinned versions, `.env.example`, `setup.mjs`, CI workflow, `.gitattributes` | wp-devops | B | AC-1, AC-14 | — | no (root files) |
| W2 | `@devon/db`: schema, audit, RLS, tenancy registry, `withContext`, migrate:verify suite, migration linter | wp-backend | **C** | AC-9, AC-10, AC-14 | W1 | yes |
| W3 | `@devon/i18n`: four locales, `t()`, transliterator, `terms.json`→`TERMS.md`, `agentic/i18n.config.json`, check-i18n strengthening | wp-frontend | B | AC-3, AC-5 | W1 | yes |
| W4 | `@devon/ui`: tokens, primitives, state components, Storybook + glyph page, fonts | wp-ui | B | AC-6, AC-7 | W1 | yes |
| W5 | `@devon/contracts`: Zod schemas, `can()`, Problem, field tiers | wp-backend | B | AC-11 | W1 | yes |
| W6 | `@devon/api`: plugins, sessions, setup bootstrap, admin namespace, healthz/readyz, OpenAPI | wp-backend | **C** | AC-11, AC-12, AC-13 | W2, W5 | no |
| W7 | `@devon/web`: shell, router, locale switch, command palette, states, offline banner | wp-frontend | B | AC-4, AC-6, AC-7, AC-8 | W3, W4, W5 | no |
| W8 | `infra/`: Compose (profiles), Caddyfile, `infra/sentinel`, backup scripts, `infra/README.md` | wp-devops | **C** | AC-15, AC-1 | W1 | yes |
| W9 | `e2e/`: `routes.json`, Playwright projects, axe runner, screenshot script, state forcing, 390-px overflow + glyph tests | wp-frontend | B | AC-6, AC-7, AC-14 | W7 | no |
| W10 | `EPIC-000.demo`: seed framework, `seed_runs`, guards, demo chip wiring, `pnpm start --demo` | wp-backend | **C** | AC-1, AC-2 | W2, W6, W7 | no |
| W11 | `tools/gate-mutation` harness + one mutation per blocking gate + `docs/adr/` landing | wp-devops | B | AC-14 | all | no |

Parallel worktrees that will not conflict after W1 lands: **{W2, W3, W4, W5, W8}**. Their `touches` sets are disjoint by construction.

### 7.2 Shared-file ownership (the usual source of worktree conflicts)

| File | Sole owner | Everyone else |
|---|---|---|
| root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitattributes`, `tsconfig.base.json` | W1 | must not touch; declare needs in the handoff |
| `.env.example` | W1 (pre-seeded with the full variable list, §7.4) | must not touch |
| `agentic/i18n.config.json` | W3 | — |
| `packages/i18n/messages/*.json` | W3 creates; **W7 adds shell keys; W10 adds demo keys** — assign the message files to W3, W7, W10 explicitly and to nobody else | — |
| `e2e/routes.json` | W9 | — |
| `.github/workflows/ci.yml` | W1 | W11 may add the nightly release job only |
| `infra/docker-compose.yml` | W8 | — |
| `docs/adr/*.md` | W11 lands the files this design returns | — |

### 7.3 Handoff contract text (paste into each work item)

- **W1 → all:** "`pnpm -r --if-present <script>` must never be a no-op. Every package you create declares `typecheck`, `lint`, `test:unit`, `build`, even if the body is `tsc --noEmit -p .` / `eslint .` / `vitest run` / `echo built`. `packages/config/test/workspace-scripts.test.ts` enumerates `pnpm-workspace.yaml` and fails if any package is missing one."
- **W2 → W6, W10:** "`import { withContext, type Tx, type RequestContext } from '@devon/db'` is the only exported way to reach Postgres. The `Pool` is not exported. `tx.raw()` throws `TenancyContextMissing` outside `withContext`. `tx.audit(e)` flushes inside the same transaction. Every new table must be added to `TENANCY` in `packages/db/src/tenancy.ts` or the migrate gate fails."
- **W3 → W7, W10:** "`import { t, useT, LOCALES, LOCALE_LABEL, LOCALE_CHIP, formatDate, normalizeUz } from '@devon/i18n'`. Call sites use `t('shell.nav.board')` — the dotted-key form is mandatory because `agentic/scripts/check-i18n.mjs` only detects `t('…')`. Never call Paraglide's `m.*` in `apps/web`. Every key you add lands in all four files in the same commit."
- **W4 → W7:** "`<StateView kind={'empty'|'loading'|'error'|'forbidden'|'offline'} titleKey bodyKey action={{labelKey, onAction}} />` renders exactly one primary action (`data-primary`). Every shell label carries `data-shell-label` so the 390-px overflow test can find it. No `truncate`/`text-overflow: ellipsis` in `packages/ui/src/shell/**` — a lint rule enforces it."
- **W5 → W6, W7:** the `Actor`/`Subject`/`Decision` and `Problem` types in §1.5–1.6, verbatim.
- **W6 → W7, W9:** the OpenAPI path table in §1.7, verbatim, plus: "every route declares `config.permission` or the server refuses to boot."
- **W7 → W9:** "`e2e/routes.json` entries are `{path, name, auth, requires?}`. State forcing is `?__state=empty|loading|error|forbidden|offline`, compiled out unless `DEVON_E2E=1`. Screenshots must be named `<path with non-alnum → _>__<width>__<light|dark>__<uz|ru>.png` — `agentic/scripts/dod.mjs:34-49` reads exactly that."
- **W8 → W10:** "Compose starts only `postgres` and `valkey` by default; `caddy`, `minio`, `centrifugo`, `clamav`, `pgbackrest`, `glitchtip` sit behind `profiles:` and are not part of `pnpm setup`."

### 7.4 `.env.example` variable set (W1 pre-seeds all of it, so no later item edits the file)

```
NODE_ENV=development
DEVON_PUBLIC_URL=http://localhost:5173
API_PORT=3000
WEB_PORT=5173
LOG_LEVEL=info
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55432
POSTGRES_DB=devon
# All values below are non-production example/placeholder defaults for the throwaway local-dev
# Docker containers only (never reachable outside the dev machine); see the boot guard note below.
POSTGRES_SUPERUSER_PASSWORD=devon_local_dev_root         # example value, local dev only
POSTGRES_MIGRATOR_USER=devon_migrator
POSTGRES_MIGRATOR_PASSWORD=devon_local_dev_migrator      # example value, local dev only
POSTGRES_APP_USER=devon_app
POSTGRES_APP_PASSWORD=devon_local_dev_app                # example value, local dev only
DATABASE_URL=postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon                 # example, local dev only
MIGRATION_DATABASE_URL=postgres://devon_migrator:devon_local_dev_migrator@127.0.0.1:55432/devon  # example, local dev only
VALKEY_URL=redis://127.0.0.1:56379
SESSION_COOKIE_NAME=devon_sid
SESSION_IDLE_MINUTES=720
SESSION_ABSOLUTE_DAYS=30
CSRF_SECRET=devon_local_dev_csrf_secret_change_in_production   # example value, changeme in production
AUDIT_ANCHOR_PATH=./.data/audit-anchor.log
DEVON_SETUP_REMOTE=0
DEVON_DEMO=0
DEVON_E2E=0
SENTINEL_HOST=127.0.0.1
SENTINEL_PORT=8787
SENTINEL_PUBLIC_KEY=
```

Boot guard (H7.3, H17.1): config is parsed once with Zod at startup; when `NODE_ENV=production`, the process **refuses to start** if any value equals its checked-in local-dev default. `check-secrets.mjs` skips `.env.example` (line 9), so these placeholders are safe; `infra/docker-compose.yml` uses `${VAR}` only, which the same script's allow-list permits (line 22).

---

## 8. Frontend shell decisions that the ACs turn on

- **Locale switch, ≤ 2 clicks from any shell screen (AC-4).** Top bar, left of the avatar, always mounted: an `IconButton` showing a globe **plus the visible chip text** (`UZ` / `ЎЗ` / `RU` / `EN`). Click 1 opens a `DropdownMenu`; click 2 selects. Four items, each rendered in its own script. Persistence: `PATCH /api/v1/me {locale}` (survives a new session on the same account) + `localStorage` mirror (survives reload before `/me` resolves, so there is no flash of the default locale) + `<html lang>` and `dir`. Resolution order on boot: user record → localStorage → `Accept-Language` → `uz-Latn`. Every shell string comes from `t()`, so "English leakage in uz-Cyrl" is a missing key, which the i18n gate already fails on.
- **Command palette discoverability (AC-8).** The palette trigger is a *visible search field* in the top bar reading `Qidirish yoki buyruq…` with a `<Kbd>Ctrl K</Kbd>` rendered inside it, not a bare icon and not a hidden shortcut. Below 640 px it collapses to an icon with an `aria-label` and a tooltip. A first-time user's first guess for "change language" is a globe/`UZ` chip and for "search" is a search box; both are the actual affordances, which is the only honest way to pass a cold walkthrough.
- **States (AC-7).** One `StateView` primitive, five kinds, exactly one primary action each (`data-primary`), asserted by unit test. Forcing is `?__state=…` behind `DEVON_E2E`, dead-code-eliminated in the production build and verified absent by a bundle grep in `@devon/web build`. The error state shows a human sentence + one action (`Qayta urinish`) + a muted, copyable reference id in a `<details>` — **not** an HTTP status, not a stack. Flagged here so the reviewer and the fixer do not churn over whether a reference id counts as "a raw error code": it does not; it is the only way a civil servant can tell support which request failed.
- **390 px (AC-6).** Sidebar → Vaul drawer behind a hamburger; content max-width unset; no truncation anywhere; `min-width: 0` on flex children; touch targets ≥ 44 px. The overflow assertion in §4(i) is the gate, not a screenshot review.

---

## 9. One-command evidence producer per AC

Verifiers should never invent a procedure. Each of these is created by the item that owns the AC.

| AC | Command | Produces |
|---|---|---|
| AC-1 | `node setup.mjs && pnpm start --demo` then `pnpm --filter @devon/db counts` twice | clean-clone transcript + identical row-count tables |
| AC-2 | `pnpm --filter @devon/db seed:demo:matrix` | truth table of (NODE_ENV × flag) → allowed/refused, pasted |
| AC-3 | `pnpm --filter @devon/i18n break:ru \| break:uzc \| break:hardcoded && node agentic/scripts/check-i18n.mjs` | three failing runs + auto-revert |
| AC-4 | `pnpm --filter @devon/web test:e2e -- --grep @locale` | click counts + post-reload + new-session assertions |
| AC-5 | `pnpm --filter @devon/i18n terms:verify` | per-row source/quote validation + banned-word scan |
| AC-6 | `pnpm --filter @devon/web test:e2e -- --grep @390` and `--grep @glyphs` | overflow + font-substitution results |
| AC-7 | `pnpm --filter @devon/web shots` | every route × 5 forced states, named per `dod.mjs` |
| AC-8 | manual cold walkthrough (no script can prove this) | timed transcript, first two guesses recorded |
| AC-9 | `pnpm --filter @devon/db audit:prove` + `pnpm --filter @devon/db psql:app` | three denials, chain verify, tamper detection |
| AC-10 | `pnpm --filter @devon/db tenancy:report` + `migrate:verify` | table × class × policy × cross-read matrix |
| AC-11 | `pnpm --filter @devon/api admin:prove` | member session → 403 body, forged role → 403, deep link → no-permission, matching audit rows |
| AC-12 | `pnpm --filter @devon/api setup:prove` | first boot, consume, replay 410, second boot silent |
| AC-13 | `pnpm --filter @devon/api session:prove` | `Set-Cookie` header + post-logout replay 401 |
| AC-14 | `node agentic/scripts/gate.mjs --profile integration` + `pnpm gate:mutation --all` | `last-gate.json` + one deliberate defect per blocking gate |
| AC-15 | `pnpm --filter @devon/sentinel prove` | four break attempts + `ss -ltnp` + no-destructive-path grep |

## 10. What this design deliberately does not do

- No Keycloak, no OIDC, no OneID, no E-Imzo (decisions 4 and 10 override the research's Keycloak recommendation; ADR-003 records the divergence and its cost).
- No Valkey session store, no Centrifugo, no MinIO, no ClamAV, no sync engine, no CRDT.
- No `__Host-` cookie prefix (filed as `proposed` for EPIC-014 hardening; `devon_sid` with Secure/HttpOnly/Lax/Path=/ and no Domain satisfies H1.4 today).
- No registration, no 2FA, no profile, no password reset (EPIC-001), no departments beyond the two tables RLS needs (EPIC-002), no units (EPIC-003).
- No wipe or pause **execution** path anywhere, including in the sentinel (AC-15 disproof).
- No ADR-005/006/007/008/009 content — deferred stubs only, each naming its owning epic.

Anything discovered during BUILD that is not in the frozen criteria goes to `docs/03-plan/backlog.json` as `proposed`. It does not become an AC at adjudication.
