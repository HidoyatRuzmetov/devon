// Drizzle table definitions for the AI module (TECH-SPEC §8, MODULE-GUIDE.md "DB: schema") mirroring
// `migrations/0800_ai.sql`. Both tables are department-owned (I-1 is not in play here: no feature ever
// persists prompt/response content -- see `apps/api/src/modules/ai/repo.ts`'s header for why traces
// carry token counts and cost only, never text).
//
// Not re-exported from `schema/index.ts` on purpose (MODULE-GUIDE.md: "you do not add an `export *`
// line to `schema/index.ts`") -- consumed directly by `packages/db/src/seed/modules/ai.ts`
// (`import * as schema from '../../schema/ai.js'`); `apps/api/src/modules/ai` talks to these tables
// through `Tx.raw()`, exactly like every other module's own repo.
import { boolean, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'

export const aiTraceStatusEnum = appSchema.enum('ai_trace_status', [
  'ok',
  'empty_after_retry',
  'schema_invalid_after_retry',
  'provider_error',
  'blocked_budget',
  'blocked_flag',
])

/** One row per department -- created lazily on first read with defaults (same "singleton settings
 * row, upserted on first touch" shape as `app.pomodoro_settings`, just department- instead of
 * user-keyed). `budgetUzs = 0` means "no budget configured yet", which `@devon/ai`'s `checkBudget`
 * treats as an implicit hard stop (never an accidental unlimited default). */
export const aiDepartmentSettings = appSchema.table('ai_department_settings', {
  departmentId: uuid('department_id').primaryKey(),
  budgetUzsPerMonth: integer('budget_uzs_per_month').notNull().default(0),
  softCapPct: integer('soft_cap_pct').notNull().default(80),
  /** `{ [feature: string]: boolean }` -- every `AiFeature` defaults to `false` (TECH-SPEC §8: "off by
   * default until the golden-set gate is green") whenever a key is absent, never assumed `true`. */
  flags: jsonb('flags').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Per-call metering only -- deliberately no `prompt`/`response`/`input`/`output` column exists on
 * this table, anywhere, ever (TECH-SPEC §8: "reasoning_content never shown or stored beyond token
 * counts", extended here to the whole call: a `plan_sprint` trace must never carry a trace of what
 * someone's personal to-do list said, even though the call itself was billed to a department). */
export const aiTraces = appSchema.table('ai_traces', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  userId: uuid('user_id').notNull(),
  feature: text('feature').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  costUzs: integer('cost_uzs').notNull().default(0),
  latencyMs: integer('latency_ms').notNull().default(0),
  retried: boolean('retried').notNull().default(false),
  status: aiTraceStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * AI L2 (EPIC-016, migration 0810). One row per indexed thing -- a card, a comment, a page, an event
 * -- carrying the text search actually runs over, plus an OPTIONAL embedding.
 *
 * The `tsv` generated column and the `embedding` column are two backends over one table, on purpose:
 * `tsv` is always populated by Postgres itself, so keyword and trigram search work on any deployment;
 * `embedding` is written by a sidecar job only when `@devon/ai`'s runtime probe finds that this
 * GLM endpoint actually serves `/v1/embeddings`. Neither the schema nor the queries change when the
 * answer flips -- only which WHERE clause the search repo picks.
 *
 * `tsv` and `embedding` are deliberately absent from this Drizzle definition: a `tsvector` generated
 * column is never written by application code (Postgres computes it), and `vector(1024)` has no
 * Drizzle column type in the version pinned here. Both are read and written through `Tx.raw()` in
 * `apps/api/src/modules/ai/search-repo.ts`, which is how every other module's non-trivial SQL works
 * in this codebase.
 */
export const aiSearchDocuments = appSchema.table('ai_search_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  /** `'card' | 'comment' | 'page' | 'event'` -- plain text, see the migration's comment for why. */
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  title: text('title').notNull().default(''),
  body: text('body').notNull().default(''),
  embeddingModel: text('embedding_model'),
  /** sha256 of title+body when the embedding was written -- the sidecar's "has this changed" test. */
  contentHash: text('content_hash').notNull().default(''),
  embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The head's department briefing, cached one row per department per Tashkent day
 * (`migrations/1900_ai_briefings.sql`, v1.1 recapture report §1a #23).
 *
 * `catch_up` at department scope measured 78.8 s, 112 s and 276 s against the ministry's GLM in one
 * afternoon. A browser cannot wait on that, and the 75 s budget the fix round set below the
 * feature's own floor turned every run into a timeout. So the briefing is computed by a pg-boss job
 * and *read* from here: the tile shows the cached answer and the time it was generated, and
 * "Yangilash" enqueues a new run rather than opening a four-minute request.
 *
 * `output` is the validated `catch_up` payload -- the grounding validator runs before this row is
 * written, so a cached briefing is never less checked than a live one was.
 */
export const aiBriefings = appSchema.table('ai_briefings', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  /** Tashkent calendar day, `YYYY-MM-DD` -- the same key `analytics_daily` uses. */
  day: text('day').notNull(),
  locale: text('locale').notNull().default('uz-Latn'),
  /** `'queued' | 'running' | 'ready' | 'failed'` -- the job lifecycle, see the migration. */
  status: text('status').notNull().default('queued'),
  output: jsonb('output'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  error: text('error'),
  latencyMs: integer('latency_ms'),
  requestedByUserId: uuid('requested_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
