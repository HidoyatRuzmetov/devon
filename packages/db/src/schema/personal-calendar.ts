import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
const app = pgSchema('app')
export const personalCalendarEntries = app.table('personal_calendar_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  title: text('title').notNull(),
  notes: text('notes').notNull().default(''),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  allDay: boolean('all_day').notNull().default(false),
  remindAt: timestamp('remind_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})
export const personalCalendarReminders = app.table('personal_calendar_reminders', {
  entryId: uuid('entry_id').primaryKey(),
  userId: uuid('user_id').notNull(),
  fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
  entryVersion: integer('entry_version').notNull(),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }),
})
