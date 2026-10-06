// DB access for `/api/v1/accounts/*` (EPIC-001). Mirrors `apps/api/src/db/repo.ts`'s shape (every
// function opens its own `withContext()`) without editing that shared file -- MODULE-GUIDE.md "API
// modules": "Business logic goes through `app.devon.<method>()` ... never a direct `@devon/db` import
// from a route handler" describes the *pattern*, and this module's own repo file is exactly that
// pattern's own, additional implementation, called directly from `index.ts` instead of through a
// second `app.<name>` decorator this small a module does not need.
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withContext, type Tx } from '@devon/db'
import type { Role } from '@devon/contracts'
import { hashPassword, verifyPassword } from '../../lib/password.js'
import { generateToken, sha256Hex } from '../../lib/tokens.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { generateRecoveryCodes, generateTotpSecret, otpauthUri, verifyTotp } from './totp.js'
import type { AuditCtx, UserRecord } from '../../types.js'
import type { RegisterBody, PatchProfileBody } from './schemas.js'

const LOGIN_CHALLENGE_TTL_MINUTES = 10
const ACCOUNT_DELETION_GRACE_DAYS = 30
const LOCKOUT_THRESHOLD = 5
const LOCKOUT_MINUTES = 15

export class LoginTaken extends Error {}

/** Identity changes are self-service, while role and department remain management operations. */
export async function patchProfile(userId: string, patch: PatchProfileBody, ctx: AuditCtx) {
  try {
    return await withContext(toDbContext(ctx), async (tx) => {
      const rows = await tx.drizzle
        .update(schema.users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.users.id, userId))
        .returning()
      if (!rows[0]) return null
      tx.audit({
        action: 'accounts.profile_updated',
        subjectType: 'user',
        subjectId: userId,
        after: { fields: Object.keys(patch) },
      })
      tx.emit({ type: 'accounts.profile.updated', payload: { userId, fields: Object.keys(patch) } })
      return toUserRecord(rows[0])
    })
  } catch (err) {
    if (isUniqueViolation(err) || (err instanceof Error && isUniqueViolation(err.cause)))
      throw new LoginTaken()
    throw err
  }
}

function anonymousCtx(requestId = randomUUID()) {
  return {
    requestId,
    userId: null as string | null,
    actorRole: null as Role | null,
    departmentId: null as string | null,
    actingForUserId: null as string | null,
    viewAs: false,
    ip: '',
    userAgent: '',
  }
}

function toDbContext(ctx: AuditCtx) {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId: null as string | null,
    actingForUserId: ctx.actingForUserId,
    viewAs: false,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  }
}

function toUserRecord(row: typeof schema.users.$inferSelect): UserRecord {
  return {
    id: row.id,
    login: row.login,
    email: row.email,
    passwordHash: row.passwordHash,
    givenName: row.givenName,
    familyName: row.familyName,
    patronymic: row.patronymic,
    title: row.title,
    avatarKey: row.avatarKey,
    locale: row.locale,
    timezone: row.timezone,
    role: row.role as Role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
  }
}

export async function registerUser(input: RegisterBody, ctx: AuditCtx): Promise<UserRecord> {
  const passwordHash = await hashPassword(input.password)
  try {
    return await withContext(toDbContext(ctx), async (tx) => {
      const rows = await tx.drizzle
        .insert(schema.users)
        .values({
          login: input.login,
          email: input.email ?? null,
          passwordHash,
          givenName: input.givenName,
          familyName: input.familyName,
          patronymic: input.patronymic ?? null,
          title: input.title ?? null,
          locale: input.locale,
          timezone: input.timezone,
          role: 'member',
        })
        .returning()
      const user = toUserRecord(rows[0]!)
      await tx.raw(sql`insert into app.user_security (user_id) values (${user.id})`)
      tx.audit({
        action: 'accounts.registered',
        subjectType: 'user',
        subjectId: user.id,
        after: { login: user.login },
      })
      tx.emit({ type: 'accounts.user.registered', payload: { userId: user.id } })
      return user
    })
  } catch (err) {
    // `users_login_key` (migrations/0003_identity.sql) is the unique constraint a duplicate login
    // trips; Postgres error code 23505 is "unique_violation" regardless of which constraint fired, but
    // this insert has exactly one unique column, so any 23505 here is unambiguously a taken login.
    if (isUniqueViolation(err)) throw new LoginTaken()
    throw err
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

export type SessionView = {
  id: string
  deviceLabel: string | null
  ip: string | null
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
}

export async function listSessions(userId: string): Promise<SessionView[]> {
  return withContext(anonymousCtx(), async (tx) => {
    const rows = await tx.drizzle
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    return rows
      .filter((r) => r.expiresAt.getTime() > Date.now())
      .map((r) => ({
        id: r.id,
        deviceLabel: r.deviceLabel,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        expiresAt: r.expiresAt,
      }))
  })
}

/** Ownership-checked revoke (the shared `Deps.revokeSession` trusts its caller to have already
 * verified the session belongs to the actor -- exactly what every existing caller of it, `POST
 * /auth/logout`, already does for the current session alone). Returns `false` when `sessionId` does
 * not belong to `userId` (a 404, never a 403 that would confirm the id exists for someone else). */
export async function revokeOwnSession(
  userId: string,
  sessionId: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toDbContext(ctx), async (tx) => {
    const rows = await tx.drizzle
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)))
      .limit(1)
    if (rows.length === 0) return false
    await tx.drizzle
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'user_revoked' })
      .where(eq(schema.sessions.id, sessionId))
    tx.audit({ action: 'accounts.session_revoked', subjectType: 'session', subjectId: sessionId })
    return true
  })
}

/** "Sign out everywhere" (TECH-SPEC §2.1). `exceptSessionId` is intentionally always revoked too --
 * the request that triggered this one is not special-cased, matching the copy this ships ("every
 * device, including this one"). Returns the number of sessions revoked. */
export async function revokeAllSessions(userId: string, ctx: AuditCtx): Promise<number> {
  return withContext(toDbContext(ctx), async (tx) => {
    const rows = await tx.drizzle
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'sign_out_everywhere' })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id })
    tx.audit({
      action: 'accounts.sessions_revoked_all',
      subjectType: 'user',
      subjectId: userId,
      after: { count: rows.length },
    })
    return rows.length
  })
}

type UserSecurityRow = {
  userId: string
  totpSecretEnc: string | null
  totpEnabled: boolean
  recoveryCodesHash: string[]
  failedLoginCount: number
  lockedUntil: Date | null
}

async function selectUserSecurity(tx: Tx, userId: string): Promise<UserSecurityRow | null> {
  // `Tx.raw()` is a plain, un-schema'd SQL query -- drizzle's own column-level date mapping never
  // runs on it, so the node-postgres driver as drizzle configures it (`node-postgres/session.ts`)
  // hands back TIMESTAMPTZ columns as raw strings on this path, never a `Date` (confirmed in the
  // wild by `structure/repo.ts`'s identical bug: "assigned_at.toISOString is not a function").
  const rows = await tx.raw<{
    user_id: string
    totp_secret_enc: string | null
    totp_enabled: boolean
    recovery_codes_hash: string[] | null
    failed_login_count: number
    locked_until: Date | string | null
  }>(sql`select * from app.user_security where user_id = ${userId}`)
  const row = rows[0]
  if (!row) return null
  return {
    userId: row.user_id,
    totpSecretEnc: row.totp_secret_enc,
    totpEnabled: row.totp_enabled,
    recoveryCodesHash: row.recovery_codes_hash ?? [],
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until === null ? null : new Date(row.locked_until),
  }
}

export async function getTwoFactorStatus(userId: string): Promise<{ enabled: boolean }> {
  return withContext(anonymousCtx(), async (tx) => {
    const row = await selectUserSecurity(tx, userId)
    return { enabled: row?.totpEnabled ?? false }
  })
}

export async function enrollTotp(
  userId: string,
  login: string,
  csrfSecret: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const secret = generateTotpSecret()
  const encrypted = encryptSecret(secret, csrfSecret)
  await withContext(anonymousCtx(), async (tx) => {
    // Pending, not yet enabled: `verifyTotpEnroll` flips `totp_enabled` only after the first code
    // proves the authenticator app was actually set up correctly (never enabled on the strength of
    // "the server generated a secret" alone).
    // Upsert, not a plain UPDATE: an UPDATE against a user with no `app.user_security` row yet (the
    // demo seed's users, or any account created before its creator inserted the row) silently
    // matched zero rows, so enrol returned a secret the later `verifyTotpEnroll` could never find.
    await tx.raw(
      sql`insert into app.user_security (user_id, totp_secret_enc, totp_enabled)
          values (${userId}, ${encrypted}, false)
          on conflict (user_id) do update
            set totp_secret_enc = excluded.totp_secret_enc, totp_enabled = false, updated_at = now()`,
    )
  })
  return { secret, otpauthUri: otpauthUri(secret, login) }
}

export async function verifyTotpEnroll(
  userId: string,
  code: string,
  csrfSecret: string,
  ctx: AuditCtx,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false }> {
  return withContext(toDbContext(ctx), async (tx) => {
    const row = await selectUserSecurity(tx, userId)
    if (!row?.totpSecretEnc) return { ok: false }
    const secret = decryptSecret(row.totpSecretEnc, csrfSecret)
    if (!verifyTotp(secret, code)) return { ok: false }

    const recoveryCodes = generateRecoveryCodes()
    const hashes = recoveryCodes.map((c) => sha256Hex(c))
    // `sql.param()`, not a bare `${hashes}`: drizzle's `sql` tag expands a plain array into a
    // parenthesized value list (`($1, $2, ...)`), which Postgres rejects here as "expression is of
    // type record" against the `text[]` column (`notifications/repo.ts`'s `markRead` documents the
    // same trap). A single bound parameter is serialised by node-postgres as a real array literal.
    await tx.raw(
      sql`update app.user_security
          set totp_enabled = true, recovery_codes_hash = ${sql.param(hashes)}::text[], updated_at = now()
          where user_id = ${userId}`,
    )
    tx.audit({ action: 'accounts.2fa_enabled', subjectType: 'user', subjectId: userId })
    return { ok: true, recoveryCodes }
  })
}

export async function disableTotp(
  userId: string,
  password: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toDbContext(ctx), async (tx) => {
    const userRows = await tx.drizzle
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
    const ok = userRows[0] && (await verifyPassword(userRows[0].passwordHash, password))
    if (!ok) return false
    await tx.raw(
      sql`update app.user_security
          set totp_enabled = false, totp_secret_enc = null, recovery_codes_hash = '{}', updated_at = now()
          where user_id = ${userId}`,
    )
    tx.audit({ action: 'accounts.2fa_disabled', subjectType: 'user', subjectId: userId })
    return true
  })
}

/** After a password check succeeds during login, this is the "second factor pending" handoff (never a
 * full session -- see `migrations/0100_accounts_departments.sql`'s `app.login_challenges` header). */
export async function createLoginChallenge(userId: string): Promise<string> {
  const rawToken = generateToken()
  const expiresAt = new Date(Date.now() + LOGIN_CHALLENGE_TTL_MINUTES * 60 * 1000)
  await withContext(anonymousCtx(), async (tx) => {
    await tx.raw(
      sql`insert into app.login_challenges (user_id, token_hash, expires_at)
          values (${userId}, ${sha256Hex(rawToken)}, ${expiresAt})`,
    )
  })
  return rawToken
}

export async function consumeLoginChallenge(
  rawToken: string,
  code: string,
  csrfSecret: string,
): Promise<{ ok: true; userId: string } | { ok: false; reason: 'invalid' | 'locked' }> {
  const tokenHash = sha256Hex(rawToken)
  return withContext(anonymousCtx(), async (tx) => {
    const rows = await tx.raw<{ id: string; user_id: string; expires_at: Date | string }>(
      sql`select id, user_id, expires_at from app.login_challenges
          where token_hash = ${tokenHash} and consumed_at is null`,
    )
    const found = rows[0]
    if (!found || new Date(found.expires_at).getTime() <= Date.now())
      return { ok: false, reason: 'invalid' }

    const security = await selectUserSecurity(tx, found.user_id)
    if (security?.lockedUntil && security.lockedUntil.getTime() > Date.now()) {
      return { ok: false, reason: 'locked' }
    }

    let matched = false
    if (security?.totpSecretEnc && security.totpEnabled) {
      const secret = decryptSecret(security.totpSecretEnc, csrfSecret)
      matched = verifyTotp(secret, code)
    }
    if (!matched && security) {
      const codeHash = sha256Hex(code.trim().toLowerCase())
      const idx = security.recoveryCodesHash.indexOf(codeHash)
      if (idx !== -1) {
        matched = true
        const remaining = security.recoveryCodesHash.filter((_, i) => i !== idx)
        await tx.raw(
          sql`update app.user_security
              set recovery_codes_hash = ${sql.param(remaining)}::text[], updated_at = now()
              where user_id = ${found.user_id}`,
        )
      }
    }

    if (!matched) {
      const nextCount = (security?.failedLoginCount ?? 0) + 1
      const lockedUntil =
        nextCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null
      await tx.raw(
        sql`update app.user_security
            set failed_login_count = ${nextCount}, locked_until = coalesce(${lockedUntil}, locked_until), updated_at = now()
            where user_id = ${found.user_id}`,
      )
      tx.audit({
        action: 'accounts.2fa_challenge_failed',
        subjectType: 'user',
        subjectId: found.user_id,
      })
      return { ok: false, reason: 'invalid' }
    }

    await tx.raw(sql`update app.login_challenges set consumed_at = now() where id = ${found.id}`)
    await tx.raw(
      sql`update app.user_security set failed_login_count = 0, locked_until = null, updated_at = now()
          where user_id = ${found.user_id}`,
    )
    tx.audit({
      action: 'accounts.2fa_challenge_passed',
      subjectType: 'user',
      subjectId: found.user_id,
    })
    return { ok: true, userId: found.user_id }
  })
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ctx: AuditCtx,
): Promise<boolean> {
  return withContext(toDbContext(ctx), async (tx) => {
    const rows = await tx.drizzle
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
    if (!rows[0] || !(await verifyPassword(rows[0].passwordHash, currentPassword))) return false
    const passwordHash = await hashPassword(newPassword)
    await tx.drizzle
      .update(schema.users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
    tx.audit({ action: 'accounts.password_changed', subjectType: 'user', subjectId: userId })
    return true
  })
}

/** Super-admin-only password reset (TECH-SPEC §2.1: "temporary password, forced change at next
 * login"). The caller (`index.ts`) has already checked `{kind:'instance'}` before this runs. */
export async function adminResetPassword(userId: string, ctx: AuditCtx): Promise<string> {
  const temporaryPassword = `${generateToken().slice(0, 16)}Aa1!`
  const passwordHash = await hashPassword(temporaryPassword)
  await withContext(toDbContext(ctx), async (tx) => {
    await tx.drizzle
      .update(schema.users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
    // A password reset invalidates every existing session -- a stolen session must not survive a
    // deliberate credential reset any more than a stolen password should.
    await tx.drizzle
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'password_reset' })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    tx.audit({
      action: 'accounts.password_reset_by_admin',
      subjectType: 'user',
      subjectId: userId,
    })
  })
  return temporaryPassword
}

export async function requestAccountDeletion(userId: string, ctx: AuditCtx): Promise<Date> {
  const scheduledFor = new Date(Date.now() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)
  await withContext(toDbContext(ctx), async (tx) => {
    await tx.raw(
      sql`insert into app.account_deletion_requests (user_id, scheduled_for)
          select ${userId}, ${scheduledFor}
          where not exists (
            select 1 from app.account_deletion_requests
            where user_id = ${userId} and completed_at is null and cancelled_at is null
          )`,
    )
    tx.audit({
      action: 'accounts.deletion_requested',
      subjectType: 'user',
      subjectId: userId,
      after: { scheduledFor: scheduledFor.toISOString() },
    })
  })
  return scheduledFor
}

export async function cancelAccountDeletion(userId: string, ctx: AuditCtx): Promise<boolean> {
  return withContext(toDbContext(ctx), async (tx) => {
    const rows = await tx.raw<{ id: string }>(
      sql`update app.account_deletion_requests set cancelled_at = now()
          where user_id = ${userId} and completed_at is null and cancelled_at is null
          returning id`,
    )
    if (rows.length === 0) return false
    tx.audit({ action: 'accounts.deletion_cancelled', subjectType: 'user', subjectId: userId })
    return true
  })
}

export async function getPendingDeletion(userId: string): Promise<Date | null> {
  return withContext(anonymousCtx(), async (tx) => {
    const rows = await tx.raw<{ scheduled_for: Date | string }>(
      sql`select scheduled_for from app.account_deletion_requests
          where user_id = ${userId} and completed_at is null and cancelled_at is null
          order by requested_at desc limit 1`,
    )
    const scheduledFor = rows[0]?.scheduled_for
    return scheduledFor === undefined ? null : new Date(scheduledFor)
  })
}

/**
 * v1.1 SPEC §2.2 / WALKTHROUGH-FINDINGS §2.5 -- "Parolni tiklashni soʻrash" on the login screen.
 *
 * Until v1.1 the login screen told people to ask their boshqarma boshligʻi, and the head had no way
 * to reset anything (the reset route was super-admin-only), so every forgotten password in every
 * department escalated to the single ministry super admin. The head can reset now
 * (`departments/repo.ts`'s `resetMemberPassword`); this is the other half -- the one click that
 * tells the head there is someone to reset.
 *
 * Deliberately tells the caller nothing about what it found. A response that differed between "no
 * such login" and "asked your head" would be a username oracle against a government directory, so
 * the route answers 202 either way and this function silently does nothing for an unknown login.
 * The flood guard is the route's rate limit plus the dedupe below: one open request per person per
 * day, so holding the button down produces one notification rather than two hundred.
 */
export async function requestPasswordResetByLogin(login: string, ctx: AuditCtx): Promise<void> {
  await withContext(
    { ...anonymousCtx(), requestId: ctx.requestId, actorRole: 'super_admin' as Role },
    async (tx) => {
      const users = await tx.raw<{ id: string }>(
        sql`select id from app.users
          where login = ${login} and deleted_at is null and status = 'active'`,
      )
      const user = users[0]
      if (!user) return

      const recent = await tx.raw<{ n: number }>(
        sql`select count(*)::int as n from app.outbox_events
          where type = 'accounts.password_reset.requested'
            and payload->>'userId' = ${user.id}
            and created_at > now() - interval '1 day'`,
      )
      if ((recent[0]?.n ?? 0) > 0) return

      const memberships = await tx.raw<{ department_id: string }>(
        sql`select department_id from app.memberships
          where user_id = ${user.id} and status = 'active' and deleted_at is null`,
      )
      tx.audit({
        action: 'accounts.password_reset_requested',
        subjectType: 'user',
        subjectId: user.id,
        after: { departments: memberships.length },
      })
      // One event per department: the notification registry's `head` rule resolves against the
      // event's own department, and a person who sits in two boshqarma should reach both heads.
      // `tx.emit` buffers a row inside the open transaction -- this is not a query in a loop.
      for (let i = 0; i < memberships.length; i += 1) {
        tx.emit({
          type: 'accounts.password_reset.requested',
          departmentId: memberships[i]!.department_id,
          payload: { userId: user.id },
        })
      }
    },
  )
}
