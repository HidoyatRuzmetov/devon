// Drizzle table definitions this module owns (MODULE-GUIDE.md "DB: schema"), mirroring
// `migrations/0900_admin_wipe_sentinel.sql`'s `app.wipe_requests` and `app.sentinel_keys`. Not
// re-exported from `schema/index.ts` (MODULE-GUIDE.md: "you do not add an `export *` line") -- these
// exist for this package's own tooling (tests, seed scaffolding); `apps/api`'s admin module reaches
// both tables through `Tx.raw()` instead, exactly like `schema/accounts.ts`'s tables already do.
import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

const appSchema = pgSchema('app')

export const wipeRequestStatusEnum = appSchema.enum('wipe_request_status', [
  'pending_verification',
  'countdown',
  'cancelled',
  'executing',
  'completed',
  'failed',
])

/**
 * TECH-SPEC §11 "wipe switch": one row per attempt, from the typed confirmation phrase through the
 * 60-second countdown to the sentinel's own report of what happened. `phrase` is stored so a UI reload
 * during the countdown can re-render the exact phrase the operator already typed (never re-derived
 * from a live department count, which could change mid-countdown); the confirmation itself (password +
 * optional 2FA) is verified once, synchronously, in `startWipe` -- no verifier secret is ever persisted
 * here.
 */
export const wipeRequests = appSchema.table('wipe_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  initiatedByUserId: uuid('initiated_by_user_id').notNull(),
  phrase: text('phrase').notNull(),
  status: wipeRequestStatusEnum('status').notNull().default('countdown'),
  countdownSeconds: integer('countdown_seconds').notNull().default(60),
  countdownEndsAt: timestamp('countdown_ends_at', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByUserId: uuid('cancelled_by_user_id'),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  sentinelResponse: text('sentinel_response'),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Singleton-per-row keyring for the sentinel's ed25519 keypair (TECH-SPEC §11 + ADR-014: the sentinel
 * holds only the *public* key, in `/etc/devon/sentinel.conf`; the private key signs the command this
 * console sends and never leaves this database, let alone the browser). `publicKeyB64` is plain text
 * -- a public key is not a secret, and is shown to the operator persistently (`GET /admin/sentinel/
 * status`), not behind a "shown once" ceremony -- while `privateKeyEnc` (AES-256-GCM, `modules/admin/
 * crypto.ts`, derived from the existing `CSRF_SECRET` so this needs no new `.env` entry) is the only
 * sensitive column here. `active` ensures exactly one keypair is ever used to sign an outgoing
 * command; rotating creates a new row and deactivates the previous one rather than overwriting it, so
 * a mid-rotation race can never sign with a half-written key.
 */
export const sentinelKeys = appSchema.table('sentinel_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicKeyB64: text('public_key_b64').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  active: boolean('active').notNull().default(true),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
})
