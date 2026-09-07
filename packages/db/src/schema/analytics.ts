// Drizzle table definitions mirroring `migrations/0700_analytics_pages.sql` (TECH-SPEC §9, §3.5;
// MODULE-GUIDE.md "DB: schema"). Not re-exported from `schema/index.ts` on purpose (MODULE-GUIDE.md:
// "you do not add an `export *` line") -- this file is consumed directly by this package's own seed
// module (`src/seed/modules/analytics.ts`). `apps/api/src/modules/analytics` is a different package
// and reaches these same tables through `Tx.raw()` hand-written SQL instead, exactly like every other
// module's `repo.ts` (MODULE-GUIDE.md "API modules": "never a direct `@devon/db` import from a route
// handler").
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid, date } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

/**
 * One row per (department, calendar day). `metrics` is a small, fixed-shape jsonb snapshot --
 * `{ cardsCreated, cardsDone, cardsDoneOnTime, cardsOpenAtEnd, cardsOverdueAtEnd }` -- computed by
 * `apps/api/src/modules/analytics/aggregate.ts`'s `recomputeDay()`, called (a) nightly for every
 * department (TECH-SPEC §9: "precomputed nightly") and (b) inline, for *today's* row only, whenever a
 * `work.card.*` domain event arrives (TECH-SPEC §9: "refreshed on write for the current day" --
 * MODULE-GUIDE.md "Domain events"). `GET /analytics/summary`'s unfiltered path reads this table
 * (a handful of indexed rows) instead of re-scanning `app.cards`; a filtered request (person/unit/
 * project/label/status) still queries `app.cards` live, which stays well under the 100 ms target at
 * this table's per-department scale (TECH-SPEC §0: 100k cards *per instance*, not per department).
 */
export const analyticsDaily = appSchema.table('analytics_daily', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  day: date('day', { mode: 'string' }).notNull(),
  metrics: jsonb('metrics').notNull().default({}),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A filter-bar query (`packages/contracts`'s grammar) a member has named and can re-select later --
 * the analytics page's own saved-filters list, distinct from the board's `app.saved_views`
 * (`schema/work.ts`), which carries a board *layout*, not a reporting window. */
export const analyticsSavedFilters = appSchema.table('analytics_saved_filters', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  name: text('name').notNull(),
  query: text('query').notNull().default(''),
  sinceDays: integer('since_days').notNull().default(84), // 12 weeks, this page's own default window
  shared: boolean('shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

/** "Pin a chart to Home" (TECH-SPEC §9): one row per (viewer, chart). Department-owned for RLS's
 * sake, but every write is owner-scoped (0700's `analytics_pinned_charts_write` policy) -- a pin is
 * always "my Home", never something one member can plant on another's. */
export const analyticsPinnedCharts = appSchema.table('analytics_pinned_charts', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  chartKey: text('chart_key').notNull(), // one of ANALYTICS_CHART_KEYS (apps/api & apps/web schemas.ts)
  title: text('title').notNull(),
  filterQuery: text('filter_query').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
