// The one seam between route handlers and Postgres. Every handler in `src/modules/**` receives its
// `Deps` through `app.devon` (see `src/app.ts`) and calls only these named operations -- never
// `@devon/db`'s `withContext` directly. That keeps two things true at once: production code goes
// through `@devon/db`'s `withContext` (I-1, I-5) exactly as the design mandates, and the `unit` gate
// (design.md, this item's test/vitest.config.ts) never needs Postgres or Testcontainers, because tests
// inject `test/unit/fake-deps.ts` instead of `src/db/repo.ts`'s real implementation.
import type { ChainVerification } from '@devon/db'
import type {
  AuditCtx,
  InstanceSettingsRecord,
  MembershipRecord,
  SessionRecord,
  SetupInput,
  UserRecord,
} from './types.js'

export type CreatedSession = {
  sessionId: string
  rawToken: string
  rawCsrf: string
  expiresAt: Date
}

export type LoadedSession = {
  session: SessionRecord
  user: UserRecord
  csrfHash: string
}

export type ConsumeSetupTokenResult = { ok: true; user: UserRecord } | { ok: false }

export type Deps = {
  now(): Date

  countUsers(): Promise<number>
  getInstanceSettings(): Promise<InstanceSettingsRecord>

  findUserByLogin(login: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>

  /** Every active (`memberships.status = 'active'`, department not soft-deleted) department
   * membership for `userId`, department-name joined in -- root-cause fix for `@devon/contracts`'s
   * `can()` `department_child` check, which was permanently `not_a_member` for every real request
   * until this existed (`src/lib/actor.ts`'s doc comment has the full story), and also `GET /me`'s
   * only source of membership rows (folded in while integrating this module alongside `accounts-
   * departments`, which had its own, near-identical `listMembershipsForUser` -- see this item's
   * report). Backed by `app.memberships`'s additive `memberships_read_own`/`memberships_self_read`
   * RLS policies (`migrations/0100_accounts_departments.sql`, `migrations/0200_structure.sql`) so it
   * works before any per-request department context is chosen. Ordered so the first row is a stable
   * "default active department" until a real switcher lands (`joined_at` ascending, ties by id). */
  listActiveMembershipsForUser(userId: string): Promise<MembershipRecord[]>

  updateUserProfile(
    userId: string,
    patch: { locale?: string | undefined; timezone?: string | undefined },
    ctx: AuditCtx,
  ): Promise<UserRecord>

  /** Boot-time only (design.md §4(d), AC-12). Returns the raw URL token the caller should print, or
   * `null` when a super admin already exists or a setup token row already exists (design.md §5.4: a
   * lost token is recovered via a dedicated reissue path, never a silent re-print, because only the
   * hash survives a restart). */
  ensureSetupToken(): Promise<{ token: string; expiresAt: Date } | null>

  /** Race-safe consumption (design.md §4(d)): the `update ... where consumed_at is null returning id`
   * and the new user's insert happen in the same transaction. Exactly one concurrent caller ever
   * observes `{ ok: true }` for a given token. */
  consumeSetupToken(
    rawToken: string,
    input: SetupInput,
    ctx: AuditCtx,
  ): Promise<ConsumeSetupTokenResult>

  createSession(
    userId: string,
    meta: { ip: string; userAgent: string },
    ctx: AuditCtx,
  ): Promise<CreatedSession>
  findSessionByToken(rawToken: string): Promise<LoadedSession | null>
  touchSession(sessionId: string): Promise<void>
  revokeSession(sessionId: string, reason: string, ctx: AuditCtx): Promise<void>

  recordAccessDenied(ctx: AuditCtx, info: { route: string; reason: string }): Promise<void>

  /** EPIC-001: whether `userId` has TOTP 2FA enabled -- `POST /auth/login` (a core, pre-EPIC-001
   * route) consults this to decide between starting a session immediately and starting a login
   * challenge instead (`createLoginChallenge`). Kept on `Deps`, not a direct import of
   * `modules/accounts/repo.js`'s DB-backed function, so `test/unit/fake-deps.ts` can fake it --
   * `auth/index.ts` is core code exercised by `test/unit/session.test.ts`, which never touches
   * Postgres (this file's own header comment). */
  getTwoFactorStatus(userId: string): Promise<{ enabled: boolean }>

  /** EPIC-001: starts a short-lived (10 min) login challenge for a password-verified user whose
   * account has 2FA enabled, returning the raw challenge token `POST /auth/login` hands back to the
   * client for `POST /accounts/2fa/login-verify` to consume. See `getTwoFactorStatus`'s comment for
   * why this is on `Deps` rather than a direct cross-module repo import. */
  createLoginChallenge(userId: string): Promise<string>

  verifyAuditChain(): Promise<ChainVerification>
  checkDbReady(): Promise<boolean>
  checkMigrationsApplied(): Promise<boolean>
}
