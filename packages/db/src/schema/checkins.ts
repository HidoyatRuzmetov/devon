import { date, integer, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'

export const checkinCycles = appSchema.table('checkin_cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  checkinDeadline: timestamp('checkin_deadline', { withTimezone: true }).notNull(),
  checkoutDeadline: timestamp('checkout_deadline', { withTimezone: true }).notNull(),
  checkinLockedAt: timestamp('checkin_locked_at', { withTimezone: true }),
  checkoutLockedAt: timestamp('checkout_locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const checkinEntries = appSchema.table('checkin_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  cycleId: uuid('cycle_id').notNull(),
  checklistItemId: uuid('checklist_item_id').notNull(),
  cardId: uuid('card_id').notNull(),
  memberUserId: uuid('member_user_id').notNull(),
  memberName: text('member_name').notNull(),
  unitId: uuid('unit_id'),
  unitName: text('unit_name'),
  unitColour: smallint('unit_colour'),
  cardTitle: text('card_title').notNull(),
  projectId: uuid('project_id'),
  projectTitle: text('project_title'),
  text: text('text').notNull(),
  state: text('state').notNull().default('pending'),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
})
export const checkinReminders = appSchema.table('checkin_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  cycleId: uuid('cycle_id').notNull(),
  phase: text('phase').notNull(),
  chatId: text('chat_id').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
  attempts: integer('attempts').notNull().default(0),
})
