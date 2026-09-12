// Drizzle table definitions mirroring `migrations/1000_fields.sql` (v1.1 SPEC §5; MODULE-GUIDE.md
// "DB: schema"). Not re-exported from `schema/index.ts` on purpose -- this file is consumed directly
// by this package's own seed module (`src/seed/modules/fields.ts`); `apps/api/src/modules/fields`
// reaches the same tables through `Tx.raw()` hand-written SQL like every other module's `repo.ts`.
import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

/** One department-defined column, on people or on cards. `label`/`description` are jsonb maps keyed by
 * locale (`{ "uz-Latn": "Taʼlim", ... }`) rather than four columns, because the set of locales is a
 * product fact that may grow and a head may fill in only their own. */
export const fieldDefs = appSchema.table('field_defs', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  appliesTo: text('applies_to').notNull(),
  key: text('key').notNull(),
  label: jsonb('label').notNull().default({}),
  description: jsonb('description'),
  type: text('type').notNull(),
  options: jsonb('options').notNull().default([]),
  required: boolean('required').notNull().default(false),
  defaultValue: jsonb('default_value'),
  showInTable: boolean('show_in_table').notNull().default(true),
  showOnCardTile: boolean('show_on_card_tile').notNull().default(false),
  selfEditable: boolean('self_editable').notNull().default(true),
  visibleTo: text('visible_to').notNull().default('everyone'),
  sort: integer('sort').notNull().default(0),
  reminderDays: integer('reminder_days').notNull().default(3),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

/** One answer. `subjectId` is a card id, or the **membership** id for a person value;
 * `subjectUserId` carries the user that membership belongs to so RLS can answer "is this mine?"
 * without a sub-select, and `headOnly` mirrors the definition's visibility for the same reason. */
export const fieldValues = appSchema.table('field_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  defId: uuid('def_id').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: uuid('subject_id').notNull(),
  subjectUserId: uuid('subject_user_id'),
  headOnly: boolean('head_only').notNull().default(false),
  value: jsonb('value'),
  updatedByUserId: uuid('updated_by_user_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** "The head asked this person to fill this field." Resolved by the answer, never by a second ask. */
export const fieldRequests = appSchema.table('field_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  defId: uuid('def_id').notNull(),
  userId: uuid('user_id').notNull(),
  requestedByUserId: uuid('requested_by_user_id').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  remindedAt: timestamp('reminded_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})
