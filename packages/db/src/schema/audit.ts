// Drizzle table definitions mirroring `migrations/0002_audit.sql`. Read-oriented: the application role
// only ever INSERTs (via `Tx.audit()` / `Tx.privateRead()` in `../audit.ts`) and SELECTs (an audit
// viewer, a later epic). Nothing here can express the append-only triggers or the hash chain -- those
// live in SQL and are proven by `test/audit.immutability.test.ts`, not by this file.
import { bigint, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { bytea, inet } from './pg-types.js'

export const auditSchema = pgSchema('audit')

export const events = auditSchema.table('events', {
  seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  id: uuid('id').notNull().defaultRandom(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorRole: text('actor_role'),
  onBehalfOf: uuid('on_behalf_of'),
  departmentId: uuid('department_id'),
  action: text('action').notNull(),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  prevHash: bytea('prev_hash').notNull(),
  rowHash: bytea('row_hash').notNull(),
})

export const privateReads = auditSchema.table('private_reads', {
  seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  viewerUserId: uuid('viewer_user_id').notNull(),
  viewerRole: text('viewer_role'),
  subjectUserId: uuid('subject_user_id').notNull(),
  fields: text('fields').array().notNull(),
  departmentId: uuid('department_id'),
  requestId: text('request_id'),
})

export const anchors = auditSchema.table('anchors', {
  seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  headSeq: bigint('head_seq', { mode: 'number' }).notNull(),
  headHash: bytea('head_hash').notNull(),
  writtenTo: text('written_to').notNull(),
})
