// Drizzle table definitions mirroring `migrations/0301_work_projects.sql` (TECH-SPEC §3.2, EPIC-005).
// See `schema/work.ts`'s header for why apps/api reaches these tables through `tx.raw()` instead of
// importing this file.
import { sql } from 'drizzle-orm'
import { date, jsonb, pgSchema, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

export const projectStatusEnum = appSchema.enum('project_status', [
  'planning',
  'active',
  'on_hold',
  'done',
  'archived',
])

export const projects = appSchema.table('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  title: text('title').notNull(),
  description: jsonb('description'), // { format: 'markdown', text: string } | null
  colour: text('colour').notNull().default('#6366f1'),
  coverKey: text('cover_key'),
  ownerUserId: uuid('owner_user_id').notNull(),
  members: uuid('members')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  status: projectStatusEnum('status').notNull().default('planning'),
  startOn: date('start_on', { mode: 'string' }),
  targetOn: date('target_on', { mode: 'string' }),
  // [{ id, title, dueOn: string | null, doneAt: string | null }]
  milestones: jsonb('milestones').notNull().default([]),
  templateOf: text('template_of'), // set on the one built-in template row's clones ('onboarding-project' etc.)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
