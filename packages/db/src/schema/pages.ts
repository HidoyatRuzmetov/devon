// Drizzle table definitions mirroring `migrations/0700_analytics_pages.sql` (TECH-SPEC §3.5;
// MODULE-GUIDE.md "DB: schema"). Same reachability rule as `schema/analytics.ts`'s header: this file
// is for this package's own seed module (`src/seed/modules/pages.ts`); `apps/api/src/modules/pages`
// talks to these tables through `Tx.raw()` instead.
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

export const pageKindEnum = appSchema.enum('page_kind', [
  'how_we_work',
  'onboarding',
  'brief',
  'note',
])

/** A department page (TECH-SPEC §3.5): Tiptap JSON document in `blocks`, editable by any member,
 * versioned on every save (`page_versions` below carries the history; diff/restore reads it). */
export const pages = appSchema.table('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  kind: pageKindEnum('kind').notNull().default('note'),
  title: text('title').notNull(),
  // Tiptap's `JSONContent` document -- `{ type: 'doc', content: [...] }`. Validated for gross shape
  // and size in `apps/api/src/modules/pages/schemas.ts`, never element by element, the same posture
  // `personal_canvases.scene` already takes for a similarly open-ended editor payload.
  blocks: jsonb('blocks').notNull().default({ type: 'doc', content: [] }),
  createdByUserId: uuid('created_by_user_id').notNull(),
  updatedByUserId: uuid('updated_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

/** One snapshot per save (TECH-SPEC §3.5 "versions"). Never updated or deleted once written --
 * append-only, exactly like `card_activity` -- so "diff against version N" and "restore version N"
 * both read a row that can never have moved under them. */
export const pageVersions = appSchema.table('page_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  pageId: uuid('page_id').notNull(),
  title: text('title').notNull(),
  blocks: jsonb('blocks').notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * A checklist a head can turn on for new joiners (TECH-SPEC §3.5's "onboarding-lite"): `items` is
 * `[{ id, text, ownerRole: 'newcomer'|'head'|'buddy', sort }]`. Only `ownerRole: 'newcomer'` items
 * become the joining member's own personal tasks (`onboarding.ts`'s membership-joined subscriber) --
 * a `head`/`buddy` item is a reminder for someone else, shown on the template's own page, never
 * copied into anyone's personal workspace.
 */
export const onboardingTemplates = appSchema.table('onboarding_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  items: jsonb('items').notNull().default([]),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

/** Idempotency ledger for "a newcomer's join creates their onboarding checklist" (TECH-SPEC §3.5).
 * `departments.member.joined` can, in principle, be redelivered (the outbox worker retries a
 * *throwing* handler up to 5 times -- MODULE-GUIDE.md "Domain events"); a unique row per
 * (template, user) is what makes a redelivery, or a member leaving and rejoining, create the personal
 * tasks at most once rather than piling up duplicates. */
export const onboardingRuns = appSchema.table('onboarding_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  templateId: uuid('template_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdTaskCount: integer('created_task_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
