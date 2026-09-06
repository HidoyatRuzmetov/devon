// Drizzle table definitions this module owns (MODULE-GUIDE.md "DB: schema"), mirroring
// `migrations/0100_accounts_departments.sql`'s `app.user_security` and `app.login_challenges`. Not
// re-exported from `schema/index.ts` (MODULE-GUIDE.md: "you do not add an `export *` line") -- these
// exist for this package's own seed modules (`src/seed/modules/accounts.ts`), which import this file
// by relative path the same way `schema/app.ts` already is. `apps/api` never deep-imports this file
// (its `@devon/db` dependency resolves only `.` per `package.json`'s `exports` map); its own repo code
// reaches these tables through `Tx.raw()` instead, exactly like the existing `verifyAuditChain`/
// `checkMigrationsApplied` functions in `apps/api/src/db/repo.ts` already do for tables outside the
// typed `schema` barrel.
import { boolean, integer, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { hexBytea } from './pg-types.js'

const appSchema = pgSchema('app')

export const userSecurity = appSchema.table('user_security', {
  userId: uuid('user_id').primaryKey(),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  recoveryCodesHash: text('recovery_codes_hash').array().notNull().default([]),
  telegramUserId: text('telegram_user_id'), // bigint on the DB side; kept as text here (no bigint math needed client-side)
  telegramLinkCode: text('telegram_link_code'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const loginChallenges = appSchema.table(
  'login_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    tokenHash: hexBytea('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('login_challenges_token_hash_key').on(t.tokenHash)],
)

export const accountDeletionRequests = appSchema.table('account_deletion_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})
