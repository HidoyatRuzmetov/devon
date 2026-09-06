// The real, Postgres-backed implementation of `../deps.ts`'s `Deps` interface. Every function opens
// its own `withContext()` transaction (design.md §1.8) except `consumeSetupToken`, which must -- by
// the design's own disproof for AC-12's setup race -- perform the token consumption and the new user's
// insert inside the SAME transaction.
import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { schema, withContext, type RequestContext, type Tx } from '@devon/db'
import type { Role } from '@devon/contracts'
import { hashPassword } from '../lib/password.js'
import { generateToken, sha256Hex } from '../lib/tokens.js'
import {
  createLoginChallenge as accountsCreateLoginChallenge,
  getTwoFactorStatus as accountsGetTwoFactorStatus,
} from '../modules/accounts/repo.js'
import type { Deps, CreatedSession, LoadedSession, ConsumeSetupTokenResult } from '../deps.js'
import type { AuditCtx, InstanceSettingsRecord, MembershipRecord, UserRecord } from '../types.js'

const SESSION_ABSOLUTE_DAYS = 30
const SETUP_TOKEN_TTL_HOURS = 24

function anonymousCtx(): RequestContext {
  return {
    requestId: randomUUID(),
    userId: null,
    actorRole: null,
    departmentId: null,
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: '',
  }
}

/** No department chosen yet (unlike `toDbContext`, which always carries one it already knows) --
 * only `app.user_id` is set, which is exactly what `app.memberships`'s additive `memberships_self_read`
 * policy (`migrations/0200_structure.sql`) keys on. See `listActiveMembershipsForUser` below. */
function selfCtx(userId: string): RequestContext {
  return {
    requestId: randomUUID(),
    userId,
    actorRole: null,
    departmentId: null,
    actingForUserId: null,
    viewAs: false,
    ip: '',
    userAgent: '',
  }
}

function toDbContext(ctx: AuditCtx): RequestContext {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    actorRole: ctx.actorRole,
    departmentId: null,
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

async function selectUserById(tx: Tx, id: string): Promise<UserRecord | null> {
  const rows = await tx.drizzle
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
    .limit(1)
  return rows[0] ? toUserRecord(rows[0]) : null
}

export function createRepo(): Deps {
  return {
    now: () => new Date(),

    async countUsers() {
      return withContext(anonymousCtx(), async (tx) => {
        const rows = await tx.raw<{ count: number }>(
          sql`select count(*)::int as count from app.users where deleted_at is null`,
        )
        return rows[0]?.count ?? 0
      })
    },

    async getInstanceSettings(): Promise<InstanceSettingsRecord> {
      return withContext(anonymousCtx(), async (tx) => {
        const rows = await tx.drizzle
          .select()
          .from(schema.instanceSettings)
          .where(eq(schema.instanceSettings.id, 1))
          .limit(1)
        const row = rows[0]
        if (!row)
          return {
            isDemo: false,
            registrationOpen: true,
            maintenance: { enabled: false, message: null },
          }
        const maintenance = row.maintenance as {
          enabled?: boolean
          message?: Record<string, string> | null
        }
        return {
          isDemo: row.isDemo,
          registrationOpen: row.registrationOpen,
          maintenance: { enabled: !!maintenance.enabled, message: maintenance.message ?? null },
        }
      })
    },

    async findUserByLogin(login) {
      return withContext(anonymousCtx(), async (tx) => {
        const rows = await tx.drizzle
          .select()
          .from(schema.users)
          .where(and(eq(schema.users.login, login), isNull(schema.users.deletedAt)))
          .limit(1)
        return rows[0] ? toUserRecord(rows[0]) : null
      })
    },

    async findUserById(id) {
      return withContext(anonymousCtx(), (tx) => selectUserById(tx, id))
    },

    async listActiveMembershipsForUser(userId): Promise<MembershipRecord[]> {
      // No department chosen yet for this request (unlike `toDbContext`, which always carries one it
      // already knows) -- only `app.user_id` is set, which is exactly what `app.memberships`'s (and
      // `app.departments`'s) additive self-read policies key on (`memberships_read_own` in
      // `migrations/0100_accounts_departments.sql`, `memberships_self_read`/`departments_self_read` in
      // `migrations/0200_structure.sql` -- all three narrowly "my own rows, any department", combined
      // with the base policies by Postgres's permissive-OR semantics). `anonymousCtx()` would not work
      // here: its `userId: null` means `app.current_user_id()` is null inside the transaction, so every
      // one of those `user_id = app.current_user_id()` policies would reject every row.
      return withContext(selfCtx(userId), async (tx) => {
        const rows = await tx.raw<{ department_id: string; department_name: string; role: string }>(
          sql`select m.department_id, d.name as department_name, m.role
              from app.memberships m
              join app.departments d on d.id = m.department_id
              where m.user_id = ${userId}
                and m.status = 'active'
                and m.deleted_at is null
                and d.deleted_at is null
              order by m.joined_at asc, m.id asc`,
        )
        return rows.map((r) => ({
          departmentId: r.department_id,
          departmentName: r.department_name,
          role: r.role as 'head' | 'member',
        }))
      })
    },

    async updateUserProfile(userId, patch, ctx) {
      return withContext(toDbContext(ctx), async (tx) => {
        const before = await selectUserById(tx, userId)
        if (!before) throw new Error('updateUserProfile: user not found')
        const updates: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() }
        if (patch.locale !== undefined) updates.locale = patch.locale
        if (patch.timezone !== undefined) updates.timezone = patch.timezone
        const rows = await tx.drizzle
          .update(schema.users)
          .set(updates)
          .where(eq(schema.users.id, userId))
          .returning()
        const after = toUserRecord(rows[0]!)
        tx.audit({
          action: 'user.updated',
          subjectType: 'user',
          subjectId: userId,
          before: { locale: before.locale, timezone: before.timezone },
          after: { locale: after.locale, timezone: after.timezone },
        })
        return after
      })
    },

    async ensureSetupToken() {
      return withContext(anonymousCtx(), async (tx) => {
        const userCountRows = await tx.raw<{ count: number }>(
          sql`select count(*)::int as count from app.users where deleted_at is null`,
        )
        if ((userCountRows[0]?.count ?? 0) > 0) return null

        const existing = await tx.drizzle
          .select({ id: schema.setupTokens.id })
          .from(schema.setupTokens)
          .limit(1)
        if (existing.length > 0) return null // design.md §5.4: recovery is `setup:reissue`, never a silent re-print.

        const token = generateToken()
        const tokenHash = sha256Hex(token)
        const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 60 * 60 * 1000)
        await tx.drizzle.insert(schema.setupTokens).values({
          tokenHash,
          expiresAt,
          issuedReason: 'first_boot',
        })
        tx.audit({ action: 'setup.token_issued', subjectType: 'setup_token', subjectId: null })
        return { token, expiresAt }
      })
    },

    async consumeSetupToken(rawToken, input, ctx): Promise<ConsumeSetupTokenResult> {
      const tokenHash = sha256Hex(rawToken)
      return withContext(toDbContext(ctx), async (tx): Promise<ConsumeSetupTokenResult> => {
        const tokenRows = await tx.drizzle
          .select({ id: schema.setupTokens.id, expiresAt: schema.setupTokens.expiresAt })
          .from(schema.setupTokens)
          .where(
            and(eq(schema.setupTokens.tokenHash, tokenHash), isNull(schema.setupTokens.consumedAt)),
          )
          .limit(1)
        const found = tokenRows[0]
        if (!found || found.expiresAt.getTime() <= Date.now()) return { ok: false }

        const passwordHash = await hashPassword(input.password)
        const userRows = await tx.drizzle
          .insert(schema.users)
          .values({
            login: input.login,
            passwordHash,
            givenName: input.givenName,
            familyName: input.familyName,
            patronymic: input.patronymic ?? null,
            locale: input.locale,
            role: 'super_admin',
          })
          .returning()
        const user = toUserRecord(userRows[0]!)

        // Race-safe consumption (design.md §4(d)): zero rows updated means another concurrent request
        // won the race between our SELECT above and this UPDATE -- roll back and report 410. Both the
        // consumption and the user insert are inside this one transaction.
        const consumed = await tx.raw<{ id: string }>(
          sql`update app.setup_tokens set consumed_at = now(), consumed_by_user_id = ${user.id}
              where id = ${found.id} and consumed_at is null
              returning id`,
        )
        if (consumed.length === 0) {
          throw new SetupTokenLostRace()
        }

        tx.audit({
          action: 'setup.completed',
          subjectType: 'user',
          subjectId: user.id,
          after: { login: user.login, role: user.role },
        })
        return { ok: true, user }
      }).catch((err: unknown): ConsumeSetupTokenResult => {
        if (err instanceof SetupTokenLostRace) return { ok: false }
        throw err
      })
    },

    async createSession(userId, meta, ctx): Promise<CreatedSession> {
      const rawToken = generateToken()
      const rawCsrf = generateToken()
      const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000)
      const sessionId = await withContext(toDbContext(ctx), async (tx) => {
        const rows = await tx.drizzle
          .insert(schema.sessions)
          .values({
            userId,
            tokenHash: sha256Hex(rawToken),
            csrfHash: sha256Hex(rawCsrf),
            ip: meta.ip || null,
            userAgent: meta.userAgent || null,
            expiresAt,
          })
          .returning({ id: schema.sessions.id })
        tx.audit({ action: 'session.created', subjectType: 'session', subjectId: rows[0]!.id })
        return rows[0]!.id
      })
      return { sessionId, rawToken, rawCsrf, expiresAt }
    },

    async findSessionByToken(rawToken): Promise<LoadedSession | null> {
      const tokenHash = sha256Hex(rawToken)
      return withContext(anonymousCtx(), async (tx) => {
        const rows = await tx.drizzle
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.tokenHash, tokenHash))
          .limit(1)
        const row = rows[0]
        if (!row) return null
        if (row.revokedAt !== null) return null
        if (row.expiresAt.getTime() <= Date.now()) return null
        const user = await selectUserById(tx, row.userId)
        if (!user || user.status !== 'active') return null
        return {
          session: {
            id: row.id,
            userId: row.userId,
            createdAt: row.createdAt,
            lastSeenAt: row.lastSeenAt,
            expiresAt: row.expiresAt,
            revokedAt: row.revokedAt,
            revokedReason: row.revokedReason,
          },
          user,
          csrfHash: row.csrfHash,
        }
      })
    },

    async touchSession(sessionId) {
      await withContext(anonymousCtx(), async (tx) => {
        await tx.drizzle
          .update(schema.sessions)
          .set({ lastSeenAt: new Date() })
          .where(eq(schema.sessions.id, sessionId))
      })
    },

    async revokeSession(sessionId, reason, ctx) {
      await withContext(toDbContext(ctx), async (tx) => {
        await tx.drizzle
          .update(schema.sessions)
          .set({ revokedAt: new Date(), revokedReason: reason })
          .where(eq(schema.sessions.id, sessionId))
        tx.audit({
          action: 'session.revoked',
          subjectType: 'session',
          subjectId: sessionId,
          after: { reason },
        })
      })
    },

    async recordAccessDenied(ctx, info) {
      await withContext(toDbContext(ctx), async (tx) => {
        tx.audit({
          action: 'access.denied',
          subjectType: 'route',
          subjectId: info.route,
          after: { reason: info.reason },
        })
      })
    },

    async verifyAuditChain() {
      return withContext(anonymousCtx(), async (tx) => {
        const rows = await tx.raw<{
          ok: boolean
          first_bad_seq: number | string | null
          failure: 'row_hash_mismatch' | 'prev_hash_mismatch' | null
          rows_checked: number | string
        }>(sql`select * from audit.verify_chain(1, null)`)
        const row = rows[0]
        if (!row) return { ok: true, firstBadSeq: null, failure: null, rowsChecked: 0 }
        return {
          ok: row.ok,
          firstBadSeq: row.first_bad_seq === null ? null : Number(row.first_bad_seq),
          failure: row.failure,
          rowsChecked: Number(row.rows_checked),
        }
      })
    },

    async getTwoFactorStatus(userId) {
      return accountsGetTwoFactorStatus(userId)
    },

    async createLoginChallenge(userId) {
      return accountsCreateLoginChallenge(userId)
    },

    async checkDbReady() {
      try {
        await withContext(anonymousCtx(), (tx) => tx.raw(sql`select 1`))
        return true
      } catch {
        return false
      }
    },

    async checkMigrationsApplied() {
      try {
        await withContext(anonymousCtx(), (tx) => tx.raw(sql`select 1 from app.users limit 1`))
        return true
      } catch {
        return false
      }
    },
  }
}

class SetupTokenLostRace extends Error {}
