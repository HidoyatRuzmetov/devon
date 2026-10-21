import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'

export const aiConversations = appSchema.table('ai_conversations', {
  id: uuid('id').primaryKey(),
  departmentId: uuid('department_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  title: text('title').notNull().default(''),
  locale: text('locale').notNull(),
  messages: jsonb('messages').notNull().default([]),
  activeMessageId: uuid('active_message_id'),
  runToken: uuid('run_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
