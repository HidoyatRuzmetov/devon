import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appSchema } from './app.js'
export const workActionReceipts = appSchema.table('work_action_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  userId: uuid('user_id').notNull(),
  operationId: uuid('operation_id').notNull(),
  fingerprint: text('fingerprint').notNull(),
  result: jsonb('result').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
