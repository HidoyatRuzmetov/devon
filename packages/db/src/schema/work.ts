// Drizzle table definitions mirroring `migrations/0300_work_cards.sql` (TECH-SPEC §3.2, EPIC-004).
// Used by this module's own seed (`src/seed/modules/work.ts`) for typed inserts -- `apps/api`'s
// `work`/`projects` modules query these tables through hand-written `tx.raw()` SQL instead (they
// live in a different package, and `@devon/db`'s only export is `./src/index.ts` -- MODULE-GUIDE.md
// "DB: schema" is explicit that a module's tables are never re-exported through `schema/index.ts`).
//
// Every child table below carries its own `department_id`, denormalized from `cards.department_id`
// rather than reached through a join -- the same reason `memberships.department_id` is a plain
// column and not derived from `departments`: an RLS policy compares a column on the row being
// checked, never a sub-select against another table (`migrations/0005_rls.sql`'s own header comment).
import { sql } from 'drizzle-orm'
import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const appSchema = pgSchema('app')

export const cardKindEnum = appSchema.enum('card_kind', ['task', 'project_task'])
export const cardStatusEnum = appSchema.enum('card_status', ['active', 'done', 'archived'])
export const cardPriorityEnum = appSchema.enum('card_priority', [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
])
export const cardProjectScopeEnum = appSchema.enum('card_project_scope', [
  'none',
  'objective',
  'subjective',
])
export const cardSourceEnum = appSchema.enum('card_source', [
  'manual',
  'ai',
  'telegram',
  'template',
])
export const attachmentScanStatusEnum = appSchema.enum('attachment_scan_status', [
  'pending',
  'clean',
  'infected',
])
export const savedViewLayoutEnum = appSchema.enum('saved_view_layout', [
  'people_board',
  'table',
  'timeline',
  'calendar',
  'mine',
])

export const cards = appSchema.table('cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  kind: cardKindEnum('kind').notNull().default('task'),
  title: text('title').notNull(),
  // `{ format: 'markdown', text: string }` -- a plain-textarea-with-markdown description
  // (TECH-SPEC's own allowance: "a solid textarea with markdown for now" in place of Tiptap).
  description: jsonb('description'),
  assigneeUserId: uuid('assignee_user_id'),
  giverUserId: uuid('giver_user_id'),
  projectId: uuid('project_id'),
  projectScope: cardProjectScopeEnum('project_scope').notNull().default('none'),
  status: cardStatusEnum('status').notNull().default('active'),
  priority: cardPriorityEnum('priority').notNull().default('none'),
  startAt: timestamp('start_at', { withTimezone: true }),
  dueAt: timestamp('due_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  // Fractional index (`packages/contracts` has no opinion on the encoding; the web feature's
  // `lib/fractional.ts` generates/re-balances these) -- sortable as plain text, never renumbered on
  // insert (design intent: two concurrent drags never need to touch a third card's key).
  orderKey: text('order_key').notNull().default('a0'),
  labels: uuid('labels')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  watchers: uuid('watchers')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  links: jsonb('links').notNull().default([]),
  recurrence: jsonb('recurrence'),
  source: cardSourceEnum('source').notNull().default('manual'),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const cardChecklistItems = appSchema.table('card_checklist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  cardId: uuid('card_id').notNull(),
  parentItemId: uuid('parent_item_id'),
  text: text('text').notNull(),
  doneAt: timestamp('done_at', { withTimezone: true }),
  assigneeUserId: uuid('assignee_user_id'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  orderKey: text('order_key').notNull().default('a0'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const cardComments = appSchema.table('card_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  cardId: uuid('card_id').notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  body: jsonb('body').notNull(), // { format: 'markdown', text: string }
  mentions: uuid('mentions')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const cardActivity = appSchema.table('card_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  cardId: uuid('card_id').notNull(),
  actorUserId: uuid('actor_user_id'),
  kind: text('kind').notNull(), // 'created' | 'assigned' | 'status' | 'due' | 'comment' | 'link' | 'checklist' | ...
  data: jsonb('data').notNull().default({}),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
})

export const attachments = appSchema.table('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  subjectType: text('subject_type').notNull(), // 'card' (only subject this module produces today)
  subjectId: uuid('subject_id').notNull(),
  key: text('key').notNull(), // local-disk-adapter relative path today; a MinIO object key once presigned upload lands
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  scanStatus: attachmentScanStatusEnum('scan_status').notNull().default('pending'),
  thumbKey: text('thumb_key'),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
})

export const labels = appSchema.table(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    colour: text('colour').notNull().default('#6366f1'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('labels_department_name_key')
      .on(t.departmentId, t.name)
      .where(sql`deleted_at is null`),
  ],
)

export const savedViews = appSchema.table('saved_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  name: text('name').notNull(),
  filter: text('filter').notNull().default(''),
  layout: savedViewLayoutEnum('layout').notNull().default('people_board'),
  shared: boolean('shared').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
