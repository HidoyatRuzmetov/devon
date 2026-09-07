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
