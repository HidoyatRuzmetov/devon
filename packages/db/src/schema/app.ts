// Drizzle table definitions mirroring `migrations/0003_identity.sql` and `migrations/0004_departments.sql`.
// These exist for typed query-building through `Tx.drizzle` (TECH-SPEC §1.8). They are NOT the source
// of migrations -- the hand-authored SQL is -- so every column here must be kept in structural parity
// with the SQL by a maker who changes one; `test/tenancy.registry.test.ts` asserts that parity against
// a live, migrated database rather than trusting either side blindly.
import { sql } from 'drizzle-orm'
import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { citext } from './pg-types.js'

export const appSchema = pgSchema('app')

export const userRoleEnum = appSchema.enum('user_role', ['super_admin', 'head', 'member'])
export const userStatusEnum = appSchema.enum('user_status', ['active', 'locked', 'deleted'])
export const departmentStatusEnum = appSchema.enum('department_status', [
  'active',
  'paused_by_admin',
  'deletion_requested',
  'archived',
])
export const membershipRoleEnum = appSchema.enum('membership_role', ['head', 'member'])
export const membershipStatusEnum = appSchema.enum('membership_status', [
  'active',
  'pending_approval',
  'removed',
])

export const users = appSchema.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  login: citext('login').notNull(),
  email: citext('email'),
  passwordHash: text('password_hash').notNull(),
  givenName: text('given_name').notNull(),
  familyName: text('family_name').notNull(),
  patronymic: text('patronymic'),
  title: text('title'),
  avatarKey: text('avatar_key'),
  locale: text('locale').notNull().default('uz-Latn'),
  timezone: text('timezone').notNull().default('Asia/Tashkent'),
  role: userRoleEnum('role').notNull().default('member'),
  status: userStatusEnum('status').notNull().default('active'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})

export const sessions = appSchema.table('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  csrfHash: text('csrf_hash').notNull(),
  deviceLabel: text('device_label'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
})

export const setupTokens = appSchema.table('setup_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedByUserId: uuid('consumed_by_user_id'),
  issuedReason: text('issued_reason').notNull().default('first_boot'),
})

export const instanceSettings = appSchema.table('instance_settings', {
  id: integer('id').primaryKey().default(1),
  isDemo: boolean('is_demo').notNull().default(false),
  registrationOpen: boolean('registration_open').notNull().default(true),
  maintenance: jsonb('maintenance').notNull().default({ enabled: false }),
  limits: jsonb('limits'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
})

export const seedRuns = appSchema.table('seed_runs', {
  name: text('name').primaryKey(),
  checksum: text('checksum').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  rowsWritten: integer('rows_written').notNull(),
})

export const idempotencyKeys = appSchema.table(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    route: text('route').notNull(),
    userId: uuid('user_id'),
    requestHash: text('request_hash'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key, t.route] })],
)

export const departments = appSchema.table(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: citext('slug').notNull(),
    description: text('description'),
    emoji: text('emoji'),
    colour: text('colour'),
    localeDefault: text('locale_default').notNull().default('uz-Latn'),
    timezone: text('timezone').notNull().default('Asia/Tashkent'),
    settings: jsonb('settings').notNull().default({}),
    status: departmentStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('departments_slug_key')
      .on(t.slug)
      .where(sql`deleted_at is null`),
  ],
)

export const memberships = appSchema.table('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: membershipRoleEnum('role').notNull().default('member'),
  titleOverride: text('title_override'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
  status: membershipStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
