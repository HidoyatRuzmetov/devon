// The one seam between route handlers and Postgres. Every handler in `src/modules/**` receives its
// `Deps` through `app.devon` (see `src/app.ts`) and calls only these named operations -- never
// `@devon/db`'s `withContext` directly. That keeps two things true at once: production code goes
// through `@devon/db`'s `withContext` (I-1, I-5) exactly as the design mandates, and the `unit` gate
// (design.md, this item's test/vitest.config.ts) never needs Postgres or Testcontainers, because tests
// inject `test/unit/fake-deps.ts` instead of `src/db/repo.ts`'s real implementation.
import type { ChainVerification } from '@devon/db'
import type { Membership } from '@devon/contracts'
import type {
  AuditCtx,
  InstanceSettingsRecord,
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

  /**
   * Every active department this user belongs to (root-cause fix for `@devon/contracts`'s `can()`
   * `department_child` check, which was permanently `not_a_member` for every real request until this
   * existed -- see `src/lib/actor.ts`'s doc comment and this item's report for the full story: EPIC-002
   * owns `/me` and its own `memberships: []` stub, this seam only feeds `Actor.memberships`). Backed
   * by `app.memberships`'s additive `memberships_self_read` RLS policy (`migrations/0200_structure.sql`)
   * so it works before any per-request department context is chosen.
   */
  listActiveMembershipsForUser(userId: string): Promise<Membership[]>

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

  verifyAuditChain(): Promise<ChainVerification>
  checkDbReady(): Promise<boolean>
  checkMigrationsApplied(): Promise<boolean>
}
