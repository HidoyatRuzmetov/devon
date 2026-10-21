import { index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const app = pgSchema('app')

/** Upload authorizations are separate from quarantined bytes and expire when consumed. */
export const fileUploadApprovals = app.table(
  'file_upload_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    departmentId: uuid('department_id').notNull(),
    userId: uuid('user_id').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    status: text('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (t) => [index('file_upload_approvals_pending').on(t.status, t.createdAt)],
)
