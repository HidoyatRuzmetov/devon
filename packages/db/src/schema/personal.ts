// Drizzle table definitions for the personal workspace (TECH-SPEC §3.3, MODULE-GUIDE.md "DB: schema")
// mirroring `migrations/0500_personal.sql`. Owner-only, no `department_id` anywhere in this file --
// I-1: nothing here is ever visible to a head or the super admin's view-as, not even in aggregate.
//
// Not re-exported from `schema/index.ts` on purpose (MODULE-GUIDE.md: "you do not add an `export *`
// line to `schema/index.ts`") -- this file is consumed directly by
// `packages/db/src/seed/modules/personal.ts` (`import * as schema from '../../schema/personal.js'`).
// `apps/api/src/modules/personal` is a different package (`@devon/api` imports only from `@devon/db`'s
// public barrel, which does not carry this file) and therefore talks to these tables through
// `Tx.raw()` with hand-written SQL instead, exactly like `apps/api/src/db/repo.ts`'s `countUsers`
// already does for a table that *is* in the shared map.
import { boolean, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'

export const pomodoroSessionKindEnum = appSchema.enum('pomodoro_session_kind', [
  'focus',
  'short_break',
  'long_break',
])

export const personalTasks = appSchema.table('personal_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  parentId: uuid('parent_id'),
  title: text('title').notNull(),
  doneAt: timestamp('done_at', { withTimezone: true }),
  notes: text('notes'),
  sort: integer('sort').notNull().default(0),
  estimateMin: integer('estimate_min'),
  // Opaque reference to `app.cards.id` (the department board, a different module) -- id only, no FK
  // (TECH-SPEC §3.3: "link a personal task to a department card (id only)"). Cross-module references
  // in this system are never foreign keys: the two tables live in schemas owned by different modules
  // built independently, and a personal task must remain valid even if its linked card is later
  // deleted from a department the owner has since left.
  linkedCardId: uuid('linked_card_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const pomodoroSettings = appSchema.table('pomodoro_settings', {
  userId: uuid('user_id').primaryKey(),
  focusMin: integer('focus_min').notNull().default(25),
  shortBreakMin: integer('short_break_min').notNull().default(5),
  longBreakMin: integer('long_break_min').notNull().default(15),
  cyclesBeforeLong: integer('cycles_before_long').notNull().default(4),
  sound: text('sound').notNull().default('chime'),
  notifications: boolean('notifications').notNull().default(true),
  autoStart: boolean('auto_start').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pomodoroSessions = appSchema.table('pomodoro_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  kind: pomodoroSessionKindEnum('kind').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  completed: boolean('completed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
