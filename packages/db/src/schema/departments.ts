// Drizzle table definitions this module owns (MODULE-GUIDE.md "DB: schema"), mirroring
// `migrations/0100_accounts_departments.sql`'s `app.department_requests` and `app.join_attempts`. See
// `schema/accounts.ts` for why this file is not re-exported from `schema/index.ts` and why `apps/api`
// reaches these tables through `Tx.raw()` rather than a deep import.
import { boolean, inet, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const appSchema = pgSchema('app')

export const departmentRequestStatusEnum = appSchema.enum('department_request_status', [
  'pending',
  'approved',
  'rejected',
])

export const departmentRequests = appSchema.table('department_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterUserId: uuid('requester_user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  units: jsonb('units').notNull().default([]),
  locale: text('locale').notNull().default('uz-Latn'),
  status: departmentRequestStatusEnum('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by'),
  reason: text('reason'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdDepartmentId: uuid('created_department_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const joinAttempts = appSchema.table('join_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  joinKey: text('join_key'),
  departmentId: uuid('department_id'),
  ip: inet('ip'),
  userId: uuid('user_id'),
  ok: boolean('ok').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
})
