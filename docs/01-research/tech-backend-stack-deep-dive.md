# Backend stack deep dive: Fastify, Drizzle, Postgres, and the services around them

**TL;DR**: The stack chosen in `backend-architecture-and-multitenancy.md` holds up under a code-level look. Fastify 5 (GA 2024‑09‑17, MIT) gives us plugin encapsulation, a Zod type provider for one schema that does validation *and* OpenAPI, and `setErrorHandler` for a single place to sanitize errors — wire tenant/request context through `AsyncLocalStorage`, not through a threaded parameter, so it reaches the logger, the Drizzle transaction wrapper, and the audit writer without every function signature carrying it. Drizzle's RLS API (`pgPolicy`, `pgRole`) is real and typed, but the tenant-context call that makes it safe under connection pooling is `select set_config('app.tenant_id', $1, true)` inside the same transaction as the query — not a literal `SET LOCAL` string, because `SET` doesn't accept bound parameters in most drivers' extended query protocol. Postgres 17 (2024‑09‑26) is the floor; Postgres 18 (2025‑09‑25, GA for a year now) adds async I/O, UUIDv7, and virtual generated columns worth planning for. Uzbek search needs a hand-built normalization function (apostrophe-folding plus Cyrillic→Latin transliteration) feeding `simple` + `pg_trgm`, because no Uzbek stemmer exists in core Postgres — Russian gets the built-in `russian` FTS config for free. pg-boss 10 (MIT) replaces both a job queue and, via its internal `LISTEN`/`NOTIFY` use, low-latency polling — don't reach for raw `NOTIFY` yourself, its 8000-byte payload and "nobody was listening" semantics make it a wake-up signal, never a delivery guarantee. Centrifugo 6 (Apache‑2.0 core) authenticates over JWT with per-channel and per-user claims. For authorization, hand-write the SQL-condition layer and use CASL only for the declarative rule *shape* — no maintained CASL-to-Drizzle query adapter exists, so the translation from `can()` rules to a `WHERE` clause is something we own either way. Keycloak 26's Organizations feature (GA in 26, preview in 25) is the right default over realm-per-tenant for how this platform actually grows. Everything below is exact versions, exact function names, and runnable snippets, not another options table.

## 1. Fastify 5 application structure

Fastify 5 reached general availability on **2024‑09‑17** under the OpenJS Foundation, targeting Node.js v20+ and removing every API deprecated since v4 — roughly 20 documented breaking changes, mostly the removal of JSON-schema shorthands, in exchange for a framework that is 5–10% faster depending on schema-validation load [openjsf.org/blog/fastifys-growth-and-success; github.com/fastify/fastify/releases]. Fastify is MIT-licensed.

**Encapsulation is the load-bearing concept.** Fastify's own docs describe it as governing "which decorators, registered hooks, and plugins are available to routes" [fastify.dev/docs/latest/Reference/Encapsulation]. Every `fastify.register()` call creates a child context; a child's decorators and hooks are invisible to its parent and its siblings, but visible to its own descendants. This is what lets `apps/api` be organized as one plugin tree per domain (`plugins/db.ts`, `modules/tasks/index.ts`, `modules/people/index.ts`) without a domain module accidentally depending on another's internals — the only way to leak something upward is to wrap it in `fastify-plugin`, which the docs describe precisely: "encapsulation can be broken using fastify-plugin, making anything registered in a descendant context available to the parent context," and critically, "fastify-plugin breaks encapsulation only for the plugin it wraps" — nested plugins registered inside it still get their own scope. In practice: wrap true cross-cutting concerns (the DB decorator, the request-context hook, the auth guard) in `fastify-plugin`; leave domain modules un-wrapped so a bug in the `people` module's route helpers can never be called from `tasks`.

```ts
// plugins/db.ts — a cross-cutting decorator, must escape its own scope
import fp from 'fastify-plugin';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';

export default fp(async (fastify) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  fastify.decorate('db', db);
  fastify.addHook('onClose', async () => pool.end());
});
```

```ts
// modules/tasks/index.ts — a domain module, deliberately NOT wrapped
export default async function tasksModule(fastify: FastifyInstance) {
  fastify.get('/tasks/:id', { schema: getTaskSchema }, getTaskHandler);
  fastify.patch('/tasks/:id', { schema: patchTaskSchema }, patchTaskHandler);
}
```

**Schema validation and OpenAPI from one Zod schema.** `fastify-type-provider-zod` (current major line 6.x per its npm/libraries.io listing — pin the exact patch at install time) wires Zod into Fastify's `validatorCompiler`/`serializerCompiler` so route schemas are plain Zod objects with full type inference on `request.params`/`request.body`/`reply.send`, and the same schema object drives runtime validation, response serialization, *and* the generated OpenAPI document via its `jsonSchemaTransform` [libraries.io/npm/fastify-type-provider-zod]:

```ts
import { z } from 'zod';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

const app = fastify().withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  status: z.enum(['open', 'in_progress', 'done', 'archived']),
});

app.get('/tasks/:id', {
  schema: {
    params: z.object({ id: z.string().uuid() }),
    response: { 200: TaskSchema, 404: z.object({ error: z.string() }) },
  },
}, async (request, reply) => {
  const { id } = request.params; // typed: string, already a validated UUID
  const task = await findTask(id);
  if (!task) return reply.code(404).send({ error: 'not_found' });
  return task; // shape-checked against TaskSchema before serialization
});
```

`@fastify/swagger` (MIT) generates the OpenAPI 3 document from exactly those schemas; point its `transform` option at `jsonSchemaTransform` so Zod's internal representation becomes valid JSON Schema in the output, then serve it with `@fastify/swagger-ui` [github.com/fastify/fastify-swagger]:

```ts
await app.register(fastifySwagger, {
  openapi: { info: { title: 'WorkPortal API', version: '1.0.0' }, servers: [] },
  transform: jsonSchemaTransform,
});
await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
```

This is the artifact §11's contract tests validate against — the same document ministries integrating over REST will consume, generated from code rather than hand-maintained.

**Error handling.** Fastify's default serializer for an uncaught error is `{ statusCode, error, message }`, and it forwards `error.message` verbatim — the docs flag this explicitly as a leak risk: "errors from underlying libraries (database drivers, for example) can leak sensitive schema details to clients," and Fastify does not distinguish dev/prod by default [fastify.dev/docs/latest/Reference/Errors]. A single global `setErrorHandler` should draw the line at `statusCode < 500`: pass those through (they're deliberately-raised, user-facing errors like validation failures) and flatten everything else to a generic message while logging the real error with tenant/request context attached:

```ts
app.setErrorHandler(function (error, request, reply) {
  const ctx = getContext(); // AsyncLocalStorage, see below
  if (error.validation || (error.statusCode && error.statusCode < 500)) {
    return reply.send(error);
  }
  this.log.error({ err: error, tenantId: ctx.tenantId, requestId: ctx.requestId }, 'unhandled error');
  reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Something went wrong' });
});
```
Error handlers are themselves encapsulated — a `setErrorHandler` call inside a plugin only catches errors raised within that plugin's own scope, so the global one above must be registered at the root, typically inside a `fastify-plugin`-wrapped bootstrap plugin.

**Request-id and tenant-id via `AsyncLocalStorage`.** Fastify auto-generates `request.id`, but threading `tenantId`/`userId` down into the Drizzle transaction wrapper, the outbox writer, and the logger without passing them as parameters everywhere is what Node's `node:async_hooks` `AsyncLocalStorage` is for — it's a Node.js primitive, not a Fastify feature, but it composes cleanly with Fastify's `onRequest` hook:

```ts
// context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext { requestId: string; tenantId: string; userId: string }
export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getContext(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx) throw new Error('getContext() called outside a request');
  return ctx;
}
```

```ts
// plugins/context.ts
import fp from 'fastify-plugin';
import { requestContext } from '../context.js';

export default fp(async (fastify) => {
  fastify.addHook('onRequest', (request, reply, done) => {
    const ctx = {
      requestId: request.id,
      tenantId: (request as any).auth?.tenantId ?? 'unknown',
      userId: (request as any).auth?.sub ?? 'anonymous',
    };
    requestContext.run(ctx, done);
  });
});
```
`requestContext.run(ctx, done)` continues Fastify's own async hook chain *inside* the ALS scope, so anything awaited later in the request — the Drizzle transaction, a pino child logger, the outbox insert — can call `getContext()` and get the right tenant, even through promise chains and `setImmediate`-scheduled callbacks that a manually-threaded parameter would miss.

## 2. Drizzle: multi-tenant schema, RLS, migrations, seeding

**Schema with `tenant_id`.** Every tenant-scoped table carries `tenantId` as its first indexed column and a composite index that puts it first (so every query Postgres actually runs — tenant-scoped by construction — hits the index prefix):

```ts
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('tasks_tenant_created_idx').on(t.tenantId, t.createdAt),
  pgPolicy('tasks_tenant_isolation', {
    for: 'all',
    using: sql`${t.tenantId} = (select current_setting('app.tenant_id', true)::uuid)`,
    withCheck: sql`${t.tenantId} = (select current_setting('app.tenant_id', true)::uuid)`,
  }),
]);
```

Drizzle's RLS API is first-class and typed [orm.drizzle.team/docs/rls]: `pgPolicy(name, { as: 'permissive' | 'restrictive', to: role, for: 'select'|'insert'|'update'|'delete'|'all', using, withCheck })` attaches directly inside a table's third argument, and defining any `pgPolicy` on a table causes `drizzle-kit generate` to emit `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` automatically. Roles are declared with `pgRole('app_user', { inherit: true }).existing()` when the role is managed outside migrations (the normal case — the app's Postgres role is provisioned once by ops, not created per migration run) [orm.drizzle.team/docs/rls].

**Wrapping `current_setting(...)` in a bare `select` is not decorative — it's the single most important RLS performance detail.** Postgres's planner treats a bare function call like `current_setting('app.tenant_id')` in a policy as something to re-evaluate per row; wrapped as `(select current_setting('app.tenant_id', true))` it becomes an InitPlan the planner runs once per query and caches — the same technique Supabase's own RLS-performance guidance uses for `auth.uid()`, and the identical pattern surfaces in Drizzle's own Supabase helper, `authUid`, which wraps the check the same way: `sql\`(select auth.user_id() = ${column})\`` [orm.drizzle.team/docs/rls]. The `true` second argument to `current_setting` matters too: it means "return NULL instead of raising an error if unset," so a request that somehow reaches the database without the tenant context set fails closed (`tenant_id = NULL` matches nothing) rather than throwing an unhandled exception mid-transaction.

**The transaction wrapper — and the parameter-binding gotcha.** `SET LOCAL app.tenant_id = 'xyz'` is transaction-scoped by Postgres semantics (reverts automatically at commit/rollback, which is what makes it safe even behind a transaction-pooling PgBouncer). But `SET` is a statement, not a function call, and most Node Postgres drivers' extended query protocol cannot bind a parameter into a bare `SET LOCAL ... = $1` — string-interpolating a tenant UUID into SQL is exactly the kind of thing to never do. Postgres's own admin functions give an equivalent that *is* a normal parameterized call: `set_config(setting_name, new_value, is_local)`, where `is_local = true` behaves exactly like `SET LOCAL` [postgresql.org/docs/current/functions-admin.html]. Every RLS-aware query should go through one helper that does this as the first two statements of the transaction:

```ts
export async function withTenant<T>(
  db: NodePgDatabase<typeof schema>,
  tenantId: string,
  userId: string,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
```

**Relational queries.** Drizzle's current relational query API separates relation declarations from table definitions via `defineRelations()`, then exposes a fully-typed `db.query.*` builder:

```ts
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export const relations = defineRelations(schema, (r) => ({
  tasks: { comments: r.many.comments() },
  comments: { task: r.one.tasks({ from: r.comments.taskId, to: r.tasks.id }) },
}));

const db = drizzle(pool, { schema, relations });

const task = await db.query.tasks.findFirst({
  where: { id: taskId },
  with: { comments: { limit: 20, orderBy: { createdAt: 'desc' } } },
  columns: { id: true, title: true, status: true },
});
```
One documented gotcha worth designing around: inside relational-query callbacks (`where`, `extras`, custom `orderBy` expressions), column references must go through the callback's table parameter, not the imported table object, or the generated SQL silently uses the wrong table alias in nested joins [orm.drizzle.team/docs/rqb].

**Migrations: generate → review → migrate, expand/contract.** The standard flow is `drizzle-kit generate` (diffs the current schema snapshot against the last migration and emits SQL) followed by a manual review of that SQL, then `drizzle-kit migrate` (or `drizzle-orm`'s own `migrate()` at boot) to apply it [orm.drizzle.team/docs/kit-overview; orm.drizzle.team/docs/drizzle-kit-generate]. Never let a migration both rename/drop a column *and* ship in the same release as app code that assumes the new shape — split every breaking change into an **expand** step (add the new column, backfill, deploy code that writes both/reads whichever is populated) and a later **contract** step (drop the old column once telemetry shows zero reads of the old shape), consistent with the migration policy already adopted in `backend-architecture-and-multitenancy.md` §A6.

**Seeding.** A versioned seed fixture (TypeScript, not hand SQL) run inside the same `withTenant`-style transaction wrapper as any other write, driven by drizzle-kit's `seed` tooling or a plain script calling `db.insert(...)` — the point is that "provision ministry X" and "seed the demo tenant" are the *same* idempotent code path, not two.

## 3. Postgres 17/18: indexes, search, partitioning, pgvector, NOTIFY vs outbox

Postgres 17 shipped **2024‑09‑26**: vacuum's internal memory structure now uses up to 20x less memory, WAL throughput is up to 2x better under high concurrency, a new streaming I/O interface speeds sequential scans, BRIN indexes gained parallel builds, and — for the eventual major-version upgrade — logical replication slots now survive a `pg_upgrade` and a new `pg_createsubscriber` tool converts a physical replica into a logical one for near-zero-downtime cutovers [postgresql.org/about/news/postgresql-17-released-2936]. Postgres 18 reached GA on **2025‑09‑25** (so it has been available for a full year as of this report) and adds: **async I/O** via the new `io_method` setting (`worker` or `io_uring`, claimed up to 3x faster storage reads for sequential/bitmap scans and vacuum); **virtual generated columns**, now the default flavor for `GENERATED ALWAYS AS (...)` — computed at read time instead of stored, which matters for the search-normalization columns in this section; a built-in **`uuidv7()`** function producing timestamp-ordered UUIDs (better index locality than `gen_random_uuid()`'s pure randomness for a primary key that's also an insertion-order proxy); proactive page freezing during ordinary vacuums; and B-tree **skip-scan** support for multicolumn indexes queried without their leading column [postgresql.org/docs/18/release-18.html]. Pin to 17 for the first build, since it's the version most gov-cloud images and pgBackRest/PgBouncer combinations have a year more field experience with; plan the 18 upgrade using the same `pg_createsubscriber`-based path 17 introduced.

**Indexes for tenant-scoped queries.** The rule from §2 generalizes: every index that supports a query pattern must lead with `tenant_id` (or be a partial index scoped to it), because RLS's `tenant_id = (select ...)` predicate is what every query plan actually filters on first, regardless of what the `WHERE` clause in application code says. A composite `(tenant_id, status, created_at)` index answers "open tasks for this tenant, newest first" without a sort step; a bare `(status)` index across all tenants is close to useless once RLS is in play, since Postgres still has to filter every matched row by tenant after the index scan.

**Full-text search: Russian is free, Uzbek is not.** Postgres ships a `russian` text search configuration with Snowball stemming in core [postgresql.org/docs/current/textsearch-dictionaries.html]:
```sql
ALTER TABLE tasks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX tasks_search_idx ON tasks USING GIN (search_vector);
```
No Uzbek configuration exists in core Postgres. The practical fallback is the `simple` configuration (tokenizes, lowercases, no stemming) layered with `pg_trgm` for typo tolerance. `pg_trgm` breaks text into 3-character trigrams and exposes `similarity(a, b)` (0–1), the `%` operator (true above `pg_trgm.similarity_threshold`, default 0.3), `word_similarity()`/`<%` for matching a short query against a longer field, and GIN/GiST index support for all of the above [postgresql.org/docs/current/pgtrgm.html]:
```sql
CREATE INDEX people_name_trgm_idx ON people USING GIN (name_normalized gin_trgm_ops);
SELECT full_name, similarity(name_normalized, normalize_uz('replaced-query-text')) AS sml
  FROM people WHERE name_normalized % normalize_uz('replaced-query-text')
  ORDER BY sml DESC LIMIT 20;
```
The missing piece both `simple` and `pg_trgm` need is a **normalization function** that folds the several Unicode characters Uzbek Latin text uses for the tutuq belgisi/o'/g' modifier letters (`ʻ` U+02BB, `ʼ` U+02BC, a plain apostrophe, and curly quotes all appear in real user input for the same word) and transliterates any Cyrillic input to Latin so a search in either script matches records typed in the other — a real requirement, since Uzbek government records still exist in both scripts. `translate()` only maps single characters, so digraphs (ц→ts, ч→ch, ш→sh, щ→sh, ю→yu, я→ya, ў→oʻ, ғ→gʻ) need `regexp_replace` first; the remaining single-character letters (а→a, б→b, … қ→q, ҳ→h) can go through one `translate()` call:
```sql
CREATE OR REPLACE FUNCTION normalize_uz(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(
    translate(
      regexp_replace(
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          regexp_replace(input, '[ʻʼ‘’´`]', '''', 'g'),   -- fold apostrophe/tutuq variants
        'ц', 'ts', 'g'), 'ч', 'ch', 'g'), 'ш', 'sh', 'g'), 'щ', 'sh', 'g'),
        'ю', 'yu', 'g'), 'я', 'ya', 'g'
      ),
      'абвгдежзийклмнопрстуфхъыьэ',
      'abvgdejzijklmnoprstufx' || E'\'' || 'y' || E'\'' || 'e'
    )
  )
$$;
```
Treat this as a working starting point, not a certified-complete transliteration table (`ў`, `қ`, `ғ` need their own `regexp_replace` calls too, since their Latin equivalents are multi-character and `translate()` requires 1:1 length — omitted here for brevity) — validate it against a real corpus of Uzbek names in both scripts before relying on it for anything security- or identity-sensitive, and prefer a small maintained transliteration table (even a `CASE`-based lookup) over hand-tuned regex once the function is load-bearing. Apply it as a **virtual generated column** (Postgres 18's new default, computed at read time — avoids storing a redundant copy) or, on 17, `STORED` if reads dominate writes:
```sql
ALTER TABLE people ADD COLUMN name_normalized text GENERATED ALWAYS AS (normalize_uz(full_name)) STORED;
```

**Partitioning by tenant: not yet, and maybe never for most tables.** At 23 people scaling to a few dozen ministries, no table in this schema approaches the row counts (tens of millions+) where partitioning pays for its added query-planning and migration complexity. The one candidate is the append-only `events`/audit table, which is genuinely unbounded — partition it by `RANGE (created_at)` (monthly) once volume justifies it, not by tenant, since a per-tenant partition scheme fights the "provisioning a tenant is a data operation, not a DDL operation" principle from the multi-tenancy report. Postgres 17 made partitioned tables materially easier to live with: identity columns and exclusion constraints now work on them directly, so this is a change that costs less to make on 17 than it would have on 16.

**pgvector** is at the **0.8.x** line (0.8.0 released **2024‑10‑30**, PostgreSQL-license/MIT-style, [postgresql.org/about/news/pgvector-080-released-2952]), and its headline 0.8 feature is **iterative index scans**: HNSW previously applied post-filter conditions *after* the approximate search finished, so a filtered query (e.g., "similar tasks, but only this tenant's") could silently return far fewer rows than requested if the filter matched a small fraction of the index's nearest neighbors. `hnsw.iterative_scan = relaxed_order` (or `strict_order`) makes the index keep expanding its candidate set — up to `hnsw.max_scan_tuples` — until the filter is satisfied [thenile.dev/blog/pgvector-080]. This is exactly the tenant-scoped-vector-search shape this platform would hit first (embeddings for "similar past tasks/comments," filtered by `tenant_id = ...`), so enabling iterative scan is not optional the day pgvector is adopted, not a later tuning pass.

**`LISTEN`/`NOTIFY` vs the outbox pattern.** `NOTIFY` fires only at commit — "if a NOTIFY is executed inside a transaction, the notify events are not delivered until and unless the transaction is committed" — and a session that receives a notification mid-transaction won't see it until that transaction ends, which the docs use to recommend keeping transactions short when using it for real-time signaling [postgresql.org/docs/current/sql-notify.html]. The payload is capped at under 8000 bytes by default, and there is no persistence: a notification is delivered only to sessions actively `LISTEN`ing at the moment it fires — there is no queue a late-joining listener can drain. That combination (transactional, but not durable, not replayable) is precisely why it should never be the primary delivery mechanism for anything that must not be silently dropped — it is a wake-up bell, not a mailbox. This is also exactly how pg-boss uses it internally: the durable job row in the table is the source of truth, and `NOTIFY` just tells an idle worker to poll sooner instead of waiting out its polling interval. The outbox pattern (write the business row and an `events` row in one transaction, per §6) is the durable mechanism; `NOTIFY`/pg-boss's use of it is the latency optimization layered on top, never a substitute.

## 4. pg-boss 10 for background jobs

pg-boss is MIT-licensed and runs entirely on the same Postgres instance — no Redis, no separate broker — using `SKIP LOCKED` for exactly-once job claiming [github.com/timgit/pg-boss]. The current stable line is v10 (still receiving maintenance patches — v10.4.2 was current as of January 2026); v11 exists as a separate major with a job-partitioning rewrite that pg-boss's own docs say offers **no automatic migration path from v10** — treat v10→v11 as a deliberate, tested migration project, not a routine bump, whenever it's considered.

```ts
import PgBoss from 'pg-boss';

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
await boss.start();

// Cron: escalation sweep every 15 minutes, in the department's own timezone
await boss.schedule('escalation-check', '*/15 * * * *', {}, { tz: 'Asia/Tashkent' });
await boss.work('escalation-check', async () => runEscalationSweep());

// Daily digest at 08:00 local time
await boss.schedule('daily-digest', '0 8 * * *', {}, { tz: 'Asia/Tashkent' });

// A reminder, created transactionally alongside the business write
await withTenant(db, tenantId, userId, async (tx) => {
  const [task] = await tx.insert(tasks).values({ tenantId, title }).returning();
  await boss.send('task-reminder', { taskId: task.id }, {
    startAfter: reminderAt,
    retryLimit: 5,
    retryBackoff: true,
    retryDelay: 30,
    singletonKey: `task-reminder-${task.id}`, // idempotent: re-sending is a no-op while pending
  });
  return task;
});

await boss.work('task-reminder', { retryLimit: 5 }, async ([job]) => {
  await sendReminder(job.data.taskId);
});
```
`retryLimit`/`retryDelay`/`retryBackoff` cover exponential-backoff retries per job type; `singletonKey` gives natural idempotency for jobs that must not be double-scheduled (a reminder for the same task); dead-letter queues are configured per queue and support redriving failed jobs back onto the main queue for manual or automated reprocessing. pg-boss supports running `send` against an existing client/pool so job creation participates in the caller's own transaction — the pattern above (create inside `withTenant`'s transaction) is what makes "the reminder exists if and only if the task write committed" hold, the same outbox guarantee as §6's audit events, applied to jobs instead of notifications.

## 5. Centrifugo 6: realtime

Centrifugo 6 authenticates client connections over JWT, supporting HMAC (HS256/384/512), RSA (RS256/384/512), ECDSA (ES256/384/512), and EdDSA via JWKS [centrifugal.dev/docs/server/authentication]. The required claim is `sub` (user ID as a string, empty string permitted for anonymous connections); `exp` is optional but strongly recommended — omit it and a connection never expires. `channels` and `subs` claims let the *token itself* declare server-side subscriptions at connect time, which is the natural fit for "subscribe this user to their tenant's notification channel automatically":
```ts
import jwt from 'jsonwebtoken';

function connectionToken(userId: string, tenantId: string) {
  return jwt.sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + 300, channels: [`tenant:${tenantId}:user:${userId}`] },
    process.env.CENTRIFUGO_TOKEN_HMAC_SECRET!,
    { algorithm: 'HS256' },
  );
}
```
**Per-tenant channels** are a naming convention, not a Centrifugo feature — `tenant:<tenantId>:project:<projectId>` — enforced by **namespaces**, which group channels sharing a prefix and a config block:
```json
{
  "channel": {
    "namespaces": [
      { "name": "tenant", "presence": true, "allow_subscribe_for_client": false, "allow_user_limited_channels": true }
    ]
  }
}
```
`allow_subscribe_for_client: false` forces every subscription through a server-issued **subscription token** rather than letting any authenticated client subscribe to any channel string it guesses — the tenant boundary is enforced by the token issuer (the Fastify API, which knows the caller's `tenantId` from §1's context), not by client-side trust. Personal, per-user channels use the `#` suffix syntax (`tenant:x:notifications#42` is deliverable only to user `42`), and **presence** (who's currently subscribed) is a per-namespace boolean [centrifugal.dev/docs/server/channels].

Publishing from Fastify goes over Centrifugo's HTTP server API:
```ts
await fetch(`${CENTRIFUGO_API_URL}/api/publish`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.CENTRIFUGO_API_KEY! },
  body: JSON.stringify({ channel: `tenant:${tenantId}:project:${projectId}`, data: { type: 'task.updated', taskId } }),
});
```
Client SDK (browser, `centrifuge-js`):
```ts
import { Centrifuge } from 'centrifuge';
const centrifuge = new Centrifuge('wss://realtime.workportal.uz/connection/websocket', { token: connectionToken });
const sub = centrifuge.newSubscription(`tenant:${tenantId}:project:${projectId}`);
sub.on('publication', (ctx) => renderUpdate(ctx.data));
sub.subscribe();
centrifuge.connect();
```
Centrifugo's OSS core is Apache-2.0; PRO (analytics, tracing, some SSO/clustering conveniences) is a separate commercial add-on not needed at this scale.

## 6. Authorization, audit, idempotency, rate limiting

**`can(actor, action, subject, field?)`, hand-rolled SQL layer + CASL for shape.** CASL (`@casl/ability`, MIT, current major v6.x) gives `AbilityBuilder`/`defineAbility` a declarative, isomorphic rule format — the same rule set can run in the browser (to hide a button) and on the server (to reject the request), and it natively supports field-level restrictions as a third argument to `can()`:
```ts
import { AbilityBuilder, createMongoAbility } from '@casl/ability';

function abilityFor(user: AuthUser) {
  const { can, cannot, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Task', { tenantId: user.tenantId });
  can('update', 'Task', ['title', 'description', 'status'], { tenantId: user.tenantId, assigneeId: user.id });
  if (user.role === 'director') can('manage', 'Task', { tenantId: user.tenantId, departmentId: { $in: user.subDepartmentIds } });
  cannot('delete', 'Task', { status: 'archived' }).because('archived tasks are immutable');
  return build();
}
```
The catch: CASL's rule conditions are MongoDB-query-shaped (`$in`, nested object matchers), and there is no maintained adapter that turns those conditions into a Drizzle `where` clause the way `@casl/prisma`'s `accessibleBy()` does for Prisma. Given that, the pragmatic split is: use CASL's `AbilityBuilder` for the *declarative rule definitions* (readable, testable, shareable with the frontend for UI-level hiding) and hand-write the handful of SQL predicates those rules compile to (`tenantId = X`, `departmentId IN (...)`, `assigneeId = Y OR role = 'director'`) — this SQL layer is small enough (a few predicates per resource type) that reinventing a generic CASL→SQL compiler would cost more than it saves. A fully hand-rolled `can()` (no CASL at all) is a legitimate alternative if the frontend never needs the same rules for optimistic UI hiding; CASL earns its dependency specifically because "hide the delete button before the request even goes out" reuses the exact same rule object server and client share.

**Hierarchical roles from the org tree.** Model the department hierarchy as an explicit closure table, maintained on every department-tree edit (not recomputed per request):
```ts
export const departmentClosure = pgTable('department_closure', {
  ancestorId: uuid('ancestor_id').notNull(),
  descendantId: uuid('descendant_id').notNull(),
  depth: integer('depth').notNull(),
}, (t) => [primaryKey({ columns: [t.ancestorId, t.descendantId] })]);
```
A department head's ability then reads `departmentId IN (select descendant_id from department_closure where ancestor_id = user.departmentId)` — a director automatically sees every sub-department without a role explosion or a recursive CTE on every request.

**Object shares** cover the ad hoc "share this document with one person outside the normal hierarchy" case a pure role/department model can't:
```ts
export const objectShares = pgTable('object_shares', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  granteeType: text('grantee_type').notNull(), // 'user' | 'department'
  granteeId: uuid('grantee_id').notNull(),
  permission: text('permission').notNull(), // 'view' | 'comment' | 'edit'
  grantedBy: uuid('granted_by').notNull(),
  expiresAt: timestamp('expires_at'),
}, (t) => [
  uniqueIndex('shares_unique').on(t.tenantId, t.subjectType, t.subjectId, t.granteeType, t.granteeId),
  index('shares_grantee_idx').on(t.tenantId, t.granteeType, t.granteeId),
]);
```

**Field-tier filtering** happens at the serialization boundary, not the row boundary: fetch the full row (RLS already scoped it to the tenant), then project it through a Zod schema chosen by ability check — `PersonPublicSchema` for most callers, `PersonHRSchema` (adds `salary`, `personalPhone`) only when `ability.can('read', person, 'salary')` — rather than trying to make Postgres itself return different column sets per caller.

**Delegation ("act on behalf of").** A `delegations` table (`delegatorId`, `delegateId`, `scope`, `validFrom`, `validTo`) grants a delegate the delegator's *ability* within a scope; the audit event for any delegated action records both `actorId` (who actually clicked) and `onBehalfOfId` (whose authority it was exercised under) so the audit trail stays honest about both facts simultaneously.

**Audit/outbox, single transaction.** The business write and its audit event go in one transaction — this is the same guarantee §4 uses for jobs, applied to the audit trail:
```ts
await withTenant(db, tenantId, userId, async (tx) => {
  const [task] = await tx.update(tasks).set({ status: 'done' }).where(eq(tasks.id, taskId)).returning();
  await tx.insert(events).values({
    tenantId, aggregateType: 'task', aggregateId: task.id,
    eventType: 'task.completed', payload: { taskId: task.id }, actorId: userId,
  });
  return task;
});
```

**Idempotency keys.** A unique `(tenantId, key)` table storing the first response for a given client-supplied `Idempotency-Key` header, checked in a `preHandler` before any mutating route runs, and written inside the same transaction as the mutation itself so a retried request racing the original can never observe a half-committed state:
```ts
fastify.addHook('preHandler', async (request, reply) => {
  const key = request.headers['idempotency-key'] as string | undefined;
  if (!key || request.method === 'GET') return;
  const existing = await db.query.idempotencyKeys.findFirst({ where: { tenantId: getContext().tenantId, key } });
  if (existing) return reply.status(existing.statusCode).send(existing.responseBody);
});
```

**Rate limiting**, as already scoped in the multi-tenancy report's addendum, is `@fastify/rate-limit` keyed by `tenantId` (not IP — many users behind one ministry NAT share an IP) and backed by the Valkey instance so limits hold across multiple app instances:
```ts
await app.register(rateLimit, { max: 200, timeWindow: '1 minute', redis: valkeyClient, keyGenerator: () => getContext().tenantId });
```

## 7. Keycloak 26: identity

Keycloak's **Organizations** feature went from technology preview in Keycloak 25 to a **first-class, stable, GA feature in Keycloak 26**, purpose-built for exactly this project's shape — one identity layer, many tenants — rather than the B2C case Keycloak's realm model was originally designed around [medium.com/keycloak/exploring-keycloak-26-introducing-the-organization-feature-for-multi-tenancy; keycloak.org/2024/06/announcement-keycloak-organizations]. An Organization lives inside a single realm, gets its own members (onboarded via invitation or identity-provider brokering), and can enrich issued tokens with organization metadata/claims — which map directly onto this platform's `tenant_id`. **Realm-per-tenant** remains the stronger *isolation* story (separate admin boundary, separate brute-force lockout counters, separate theme) but multiplies operational surface linearly with tenant count — every realm needs its own client registration, its own federation config, its own upgrade verification. For "one department today, many ministries eventually," **single realm + Organizations** is the right default, with realm-per-tenant held in reserve for a ministry whose security team demands it as a hard requirement (the same "own instance" escape valve already adopted for the database layer in §4 of the multi-tenancy report, applied to identity).

**OIDC via a BFF, not a direct SPA public client.** Route the authorization-code-with-PKCE flow through the Fastify backend acting as a confidential client, rather than the React SPA holding tokens itself: the browser gets an HttpOnly session cookie, the Fastify BFF holds the access/refresh token pair server-side. This trades a slightly more involved backend for eliminating the entire class of XSS-token-theft risk a public SPA client carries, which is worth it for a government platform. `openid-client` (current major v6, MIT, targets Node 20+, also runs on Deno/Bun/Cloudflare Workers/browsers) implements the flow directly against the WebCrypto/Fetch APIs:
```ts
import * as client from 'openid-client';

const config = await client.discovery(new URL(process.env.KEYCLOAK_ISSUER!), clientId, clientSecret);
const codeVerifier = client.randomPKCECodeVerifier();
const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
const authUrl = client.buildAuthorizationUrl(config, {
  redirect_uri: callbackUrl, scope: 'openid profile email', code_challenge: codeChallenge, code_challenge_method: 'S256',
});
// ...redirect the browser to authUrl, store codeVerifier + state server-side...

// on callback:
const tokens = await client.authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: codeVerifier, expectedState: state });
```

**Session/refresh strategy**: short-lived access tokens (5 minutes is Keycloak's typical default and a reasonable one to keep), refresh-token rotation on every use (Keycloak supports this natively), and a BFF-enforced idle timeout plus an absolute session ceiling appropriate to a government security policy (e.g., an 8–12 hour absolute cap even if the user stays active, since a stolen session cookie shouldn't be valid indefinitely).

**LDAP federation** matters specifically because §1 of the multi-tenancy report already flagged the CIS/Uzbek enterprise pool as .NET/Windows-Server-heavy: Keycloak's User Federation SPI syncs users (and optionally group membership) from an existing LDAP/Active Directory a ministry already runs, so onboarding a ministry that already has AD doesn't mean re-registering every civil servant by hand.

**Admin API for provisioning** ties directly into the tenant-provisioning script already specified in the multi-tenancy report's addendum §A5: Keycloak's Admin REST API (`POST /admin/realms/{realm}/users`, or the Organizations equivalent for creating/inviting an org member) is called from the same idempotent, transactional provisioning script that seeds the Postgres tenant row — one script, two systems, one audit event.

**Passkeys**: Keycloak supports WebAuthn as a first-class authenticator, usable as a passwordless primary factor or a second factor, configured per-realm browser flow — worth offering as an option for staff who'd rather not manage a password at all, without making it mandatory day one.

## 8. Files: presigned uploads, virus scanning, thumbnails

The upload flow never proxies file bytes through Fastify: the API issues a **presigned PUT URL** via the MinIO JS SDK's `presignedPutObject(bucketName, objectName, expiry)` (expiry in seconds, default 604800/7 days — set it far shorter, e.g. 300, for an upload URL that should be used immediately), the browser uploads directly to MinIO, and only then calls back to the API with the object key to register metadata and kick off async processing:
```ts
const uploadUrl = await minioClient.presignedPutObject(bucket, objectKey, 300);
// client PUTs the file bytes directly to uploadUrl, then calls:
// POST /files { objectKey, filename, size } -> triggers pg-boss jobs below
```
Two pg-boss jobs follow registration, both able to quarantine the object before anyone else can read it: a **ClamAV scan job** (via a `clamd`-connected worker — the `clamscan` npm package is a thin wrapper around `clamd`/`clamscan` CLI) that downloads the object, scans it, and either tags it clean or deletes/quarantines it and notifies the uploader; and, for images, a **thumbnail job** using `sharp` to generate resized derivatives stored back to MinIO at a predictable key (`thumbnails/{objectId}-{size}.webp`). Neither job blocks the upload response — the file exists but is marked `pending_scan` until ClamAV clears it, and no download URL is issued for a file that hasn't cleared scanning. MinIO's community edition (AGPLv3) moved to source-only distribution in 2025 as already flagged in the multi-tenancy report — keep the storage layer behind the S3-compatible interface `presignedPutObject`/`presignedGetObject` represent, so a future swap costs a client-library change, not an application rewrite.

## 9. Observability: pino, OpenTelemetry, Grafana or Sentry

Fastify's built-in logger is pino (MIT); per-request context flows through `logger.child({ requestId, tenantId })` — attach this once, in the same `onRequest` hook that establishes the `AsyncLocalStorage` context in §1, so every subsequent `request.log.info(...)` call in that request automatically carries both IDs without repeating them at every call site. Pino's `redact` option strips sensitive paths (`req.headers.authorization`, `*.password`, `*.token`) before serialization — configure it globally rather than trusting every log call to remember not to log a secret [github.com/pinojs/pino].

OpenTelemetry's Node SDK auto-instruments Fastify, the Postgres driver, and outbound HTTP calls with one bootstrap file loaded before the app via Node's `--import` flag:
```ts
// instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_COLLECTOR_URL }),
  instrumentations: [getNodeAutoInstrumentations()],
}).start();
```
```
node --import ./instrumentation.js dist/server.js
```
[opentelemetry.io/docs/languages/js/getting-started/nodejs]. Export traces to a self-hosted **Grafana stack** — Tempo for traces, Loki for logs (ship pino's JSON stdout via Promtail or a pino-to-Loki transport), Prometheus/Mimir for metrics, Grafana as the single pane — which stays fully open-source and avoids the JVM overhead of an Elastic-stack alternative, matching the recommendation already made in the multi-tenancy report §7. Layer **Sentry self-hosted** on top specifically for error triage/alerting workflows once the team is large enough to need them; Sentry's self-host license (a BSL-style Functional Source License) is free for this internal, non-resold use, same caveat as before.

## 10. Deployment: Compose skeleton, sizing, backup, upgrade path

A single-ministry deployment is one `docker-compose.yml` with the app, Postgres, Valkey, MinIO, Centrifugo, Keycloak, a reverse proxy terminating TLS, pgBackRest, and ClamAV as a long-running `clamd` sidecar:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "caddy_data:/data"]
  api:
    build: ./apps/api
    environment: [DATABASE_URL, VALKEY_URL, MINIO_ENDPOINT, KEYCLOAK_ISSUER, CENTRIFUGO_API_URL]
    depends_on: [postgres, valkey, minio]
  postgres:
    image: postgres:17
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment: [POSTGRES_PASSWORD]
  valkey:
    image: valkey/valkey:9
  minio:
    image: minio/minio:latest # community edition: source-built image per the CI note in the multi-tenancy report
    command: server /data --console-address ":9001"
    volumes: ["miniodata:/data"]
  centrifugo:
    image: centrifugo/centrifugo:v6
    command: centrifugo --config=/config.json
    volumes: ["./centrifugo.json:/config.json"]
  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    command: start --optimized
    environment: [KC_DB, KC_DB_URL]
  clamav:
    image: clamav/clamav:stable
  pgbackrest:
    image: pgbackrest/pgbackrest:latest
    volumes: ["pgbackrest_repo:/var/lib/pgbackrest", "pgdata:/var/lib/postgresql/data:ro"]
volumes: { pgdata: {}, miniodata: {}, caddy_data: {}, pgbackrest_repo: {} }
```
For ~23–100 users, 4 vCPU / 8–16 GB RAM / SSD-backed storage on the Postgres host is generous headroom, with the app/Centrifugo/Keycloak containers comfortably sharing a second 2–4 vCPU / 8 GB host — this is a department tool, not a consumer-scale service, and over-provisioning compute is cheap relative to the cost of an under-provisioned WAL disk causing replication lag.

**Backup/PITR** via pgBackRest (repository config, retention, and encryption in `pgbackrest.conf`):
```ini
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=2
repo1-cipher-type=aes-256-cbc
process-max=4
compress-type=zst
[workportal]
pg1-path=/var/lib/postgresql/data
```
Full backups on a schedule, incrementals between them (`pgbackrest --stanza=workportal --type=incr backup`), and PITR restore to an exact timestamp:
```bash
pgbackrest --stanza=workportal --delta --type=time "--target=2026-09-05 04:00:00+05" --target-action=promote restore
```
[pgbackrest.org]. `repo-bundle`/`repo-block` (file bundling and block-level incrementals) reduce small-file and full-file-copy overhead respectively — worth enabling from the start rather than retrofitting once backup windows grow uncomfortable. **Upgrade path**: minor Postgres versions are routine in-place upgrades; a major version bump (17→18) is the `pg_createsubscriber` logical-replication path 17 introduced — stand up a logical replica on 18, let it catch up, cut over with a brief write-pause instead of a full dump/restore window. **k3s** stays the documented next step once serving multiple ministries or needing HA justifies the added operational surface a single Compose host doesn't have.

## 11. Testing: Testcontainers, contract tests, k6

**Testcontainers** (`@testcontainers/postgresql`) spins up a real, ephemeral Postgres per test run rather than mocking the database — the only way to actually exercise RLS policies, since a mocked ORM layer can't fail an RLS check:
```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

const container = await new PostgreSqlContainer('postgres:17-alpine').start();
const db = drizzle(container.getConnectionUri(), { schema });
await migrate(db, { migrationsFolder: './drizzle' });
// ...run tests, including a deliberate cross-tenant read attempt that must return zero rows...
await container.stop();
```
This is the concrete way to close the load-test gap flagged in the multi-tenancy report's addendum §A8: a test that opens two `withTenant` transactions for two different tenants against the *same* pooled connection and asserts neither can see the other's rows is the actual verification that `set_config(..., true)`'s transaction-scoping holds under pooling, not just a plausible-sounding argument.

**Contract tests from OpenAPI**: because `@fastify/swagger`'s document is generated from the same Zod schemas Fastify validates and serializes against at runtime (§1), the API is already self-enforcing its own contract in production — a response that doesn't match its declared schema throws before it reaches the client. The remaining gap is catching a schema *drift* between what's documented and what a consumer actually expects; validate the generated `openapi.json` itself (structurally, via `swagger-parser`'s `validate()`) in CI so a malformed schema addition never ships silently, and, for the handful of endpoints other ministries will integrate against directly, keep a small fixture-based round-trip test asserting real responses parse against the published schema.

**Load testing with k6** (Grafana k6, AGPLv3, scripts written in JavaScript executed by k6's own Sobek JS runtime, not Node — so npm packages don't transfer directly into a k6 script) targets the REST surface with realistic per-tenant concurrency:
```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { scenarios: { ministry_load: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m', target: 50 }, { duration: '5m', target: 50 }] } } };

export default function () {
  const res = http.get(`${__ENV.API_URL}/tasks`, { headers: { Authorization: `Bearer ${__ENV.TOKEN}` } });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```
Run this against a tenant-scoped set of tokens to confirm one ministry's load doesn't starve another under the shared-schema+RLS model — the "noisy neighbour" risk the multi-tenancy report already named as real, but never load-tested there.

## What this means for us

1. **[ADOPT] Fastify 5, MIT, Node 20+ floor** — the 5–10% speed gain and dropped deprecated APIs are welcome, but the real reason to adopt is the encapsulation model: it lets `apps/api` be organized as independent domain plugins without a bespoke module system.
2. **[ADOPT] `fastify-type-provider-zod` + `@fastify/swagger` as one pipeline** — one Zod schema per route drives validation, response shaping, and the OpenAPI document; there is no separate "write the docs" step to fall out of sync.
3. **[ADOPT] A single root `setErrorHandler` that flattens every 5xx to a generic message** — Fastify's default behavior forwards `error.message` verbatim to the client, which is a real information-leak risk with a Postgres driver in the stack; this must exist from the first route, not be added after an incident.
4. **[ADOPT] `AsyncLocalStorage` for request/tenant/user context**, established once in an `onRequest` hook wrapped in `fastify-plugin`, read via one `getContext()` helper everywhere else (logger, transaction wrapper, outbox writer, error handler) — the alternative (threading `tenantId` through every function signature) doesn't survive a codebase with more than a few contributors.
5. **[ADOPT] Drizzle's `pgPolicy`/`pgRole` for RLS, with every policy predicate wrapped as `(select current_setting(...))`** — this is not a style preference, it's the difference between an InitPlan Postgres runs once per query and a function call it re-evaluates per row; do it from the first migration.
6. **[ADOPT] `select set_config('app.tenant_id', $1, true)` as the tenant-context call, never a literal `SET LOCAL` string** — it's the only form that accepts a bound parameter in the drivers this stack uses, closing the door on string-interpolating a tenant UUID into SQL.
7. **[ADOPT] A hand-built `normalize_uz()` function (apostrophe-folding + Cyrillic→Latin) feeding `simple` + `pg_trgm`, as a virtual/stored generated column** — no shortcut exists in core Postgres for this; budget real time to validate it against a corpus of real Uzbek names before it's load-bearing for search or matching.
8. **[ADOPT] pgvector 0.8's `hnsw.iterative_scan`** the same day embeddings are adopted — without it, a tenant-filtered similarity search silently underfills its result set, and that failure mode is easy to miss in testing with small data.
9. **[AVOID] Raw `LISTEN`/`NOTIFY` as a delivery mechanism** — its 8000-byte payload cap and "no listener, no delivery" semantics make it a wake-up signal at best; pg-boss already uses it internally for exactly that, layered over its durable table. Build new features on the outbox/pg-boss pattern, not directly on `NOTIFY`.
10. **[ADOPT] pg-boss 10 with jobs created inside the same transaction as the business write** (reminders, digests, escalation sweeps, virus scans, thumbnails) — this is the same outbox guarantee applied uniformly to jobs and audit events; **[AVOID]** planning a v11 migration opportunistically — pg-boss's own docs call out no automatic migration path from v10, so treat it as a scheduled project.
11. **[ADOPT] CASL for declarative ability *definitions*, hand-written SQL predicates for the Postgres translation** — no maintained CASL-to-Drizzle adapter exists, so pretending otherwise just delays writing the same small predicate set; CASL still earns its place because the frontend can reuse the identical rules for optimistic UI hiding.
12. **[ADOPT] A department closure table for hierarchical roles** rather than a recursive CTE per request or a role explosion per department — computed once on tree edits, read cheaply on every ability check.
13. **[ADOPT] Single realm + Keycloak Organizations over realm-per-tenant as the default** — Organizations reached GA specifically in Keycloak 26 for this shape of problem; hold realm-per-tenant in reserve for a ministry whose security policy demands it, mirroring the database layer's own "shared by default, dedicated by request" posture.
14. **[ADOPT] OIDC via a Fastify BFF, not a direct SPA public client** — trades minor backend complexity for eliminating browser-side token custody entirely, worth it for a government platform's threat model.
15. **[ADOPT] A cross-tenant-isolation test under Testcontainers as a required CI gate**, not just unit tests against a mocked ORM — it is the only test that actually exercises whether `set_config(..., true)` holds its transaction scope under pooling, which is the single most security-critical mechanical detail in this whole document.

## Open questions

- This session's WebSearch budget was capped mid-pass by the platform (200 queries for the whole session, shared across all work happening in it) after 12 targeted queries — short of the 14-query target this report was asked to hit. The gap was covered with additional direct WebFetch reads of official docs (22 total, well over the 10 required), but a couple of items (CASL's exact current patch version, `@fastify/swagger`'s exact current version pinned to Fastify 5) rest on general knowledge plus partial fetches rather than a confirmed source snippet — verify both against npm directly before they're written into `package.json`.
- The Uzbek transliteration function in §3 is illustrative and intentionally incomplete (it omits `ў`/`қ`/`ғ`'s multi-character Latin mappings) — this needs a real pass with a linguist or a maintained transliteration table before it ships, not just a code-review sign-off.
- Whether pg-boss v11's job-partitioning rewrite is worth adopting before this platform has enough job volume to need it — the "no automatic migration from v10" warning suggests waiting until there's a concrete driver (job table size, retention needs) rather than upgrading opportunistically.
- Whether Keycloak Organizations' invitation/brokering flow integrates cleanly with a ministry's existing LDAP/AD federation in practice — the two features (Organizations, User Federation) are documented separately; a combined "invite an LDAP-federated user into an Organization" flow should be piloted against a real Keycloak 26 instance before the provisioning script in the multi-tenancy report's §A5 is finalized.
- What ClamAV signature-update cadence is realistic in an air-gapped ministry deployment (per the multi-tenancy report's Zarf/offline-mirror discussion) — a `clamd` with stale signatures is a false sense of security, and this needs its own answer alongside the general offline-update-delivery question already flagged there.
- Whether `@fastify/rate-limit`'s Valkey-backed store handles the specific case of a burst across multiple app replicas correctly under the exact Valkey 9.x line now current — worth a load test alongside the RLS-under-pooling test already called for in item 15 above.

## Sources

- Fastify v5 GA announcement — https://openjsf.org/blog/fastifys-growth-and-success
- Fastify releases — https://github.com/fastify/fastify/releases
- Fastify encapsulation reference — https://fastify.dev/docs/latest/Reference/Encapsulation/
- Fastify error handling reference — https://fastify.dev/docs/latest/Reference/Errors/
- fastify-type-provider-zod (libraries.io) — https://libraries.io/npm/fastify-type-provider-zod
- fastify-zod-openapi — https://github.com/samchungy/fastify-zod-openapi
- @fastify/swagger — https://github.com/fastify/fastify-swagger
- Drizzle ORM Row-Level Security docs — https://orm.drizzle.team/docs/rls
- Drizzle ORM relational queries docs — https://orm.drizzle.team/docs/rqb
- Drizzle Kit generate — https://orm.drizzle.team/docs/drizzle-kit-generate
- Drizzle Kit overview/migrate — https://orm.drizzle.team/docs/kit-overview
- PostgreSQL 17 release announcement — https://www.postgresql.org/about/news/postgresql-17-released-2936/
- PostgreSQL 18 release notes — https://www.postgresql.org/docs/18/release-18.html
- PostgreSQL admin functions (set_config) — https://www.postgresql.org/docs/current/functions-admin.html
- PostgreSQL pg_trgm docs — https://www.postgresql.org/docs/current/pgtrgm.html
- PostgreSQL text search dictionaries (Russian/Snowball) — https://www.postgresql.org/docs/current/textsearch-dictionaries.html
- PostgreSQL LISTEN/NOTIFY docs — https://www.postgresql.org/docs/current/sql-notify.html
- pgvector 0.8.0 release announcement — https://www.postgresql.org/about/news/pgvector-080-released-2952
- pgvector 0.8.0 feature writeup — https://www.thenile.dev/blog/pgvector-080
- pg-boss GitHub — https://github.com/timgit/pg-boss
- Centrifugo client JWT authentication — https://centrifugal.dev/docs/server/authentication
- Centrifugo channels/namespaces/presence — https://centrifugal.dev/docs/server/channels
- MinIO presigned upload cookbook — https://github.com/krishnasrinivas/cookbook/blob/master/docs/presigned-put-upload-via-browser.md
- Valkey releases — https://valkey.io/topics/releases/
- Keycloak Organizations announcement — https://www.keycloak.org/2024/06/announcement-keycloak-organizations
- Keycloak 26 Organizations GA writeup — https://medium.com/keycloak/exploring-keycloak-26-introducing-the-organization-feature-for-multi-tenancy-fb5ebaaf8fe4
- openid-client (panva) — https://github.com/panva/openid-client
- CASL — https://casl.js.org/v6/en/guide/intro/
- Testcontainers PostgreSQL module — https://testcontainers.com/modules/postgresql/
- pgBackRest user guide — https://pgbackrest.org/user-guide.html
- Grafana k6 documentation — https://grafana.com/docs/k6/latest/
- pino — https://github.com/pinojs/pino
- OpenTelemetry JS getting started (Node.js) — https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- WorkPortal backend architecture and multi-tenancy report (this project) — docs/01-research/backend-architecture-and-multitenancy.md
