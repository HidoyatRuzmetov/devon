// In-memory implementation of `../../src/deps.ts`'s `Deps`, used by every unit test in this
// directory. Deliberately reimplements the *behaviour* this item's ACs care about (the setup-token
// race, session revocation, access-denied auditing) rather than delegating to Postgres, so the `unit`
// gate never needs Docker (see `test/vitest.config.ts`). The real, Postgres-backed implementation is
// `src/db/repo.ts`; it is proved separately by `setup:prove` / `session:prove` / `admin:prove`.
import { randomUUID, createHash } from 'node:crypto'
import { hashPassword } from '../../src/lib/password.js'
import type {
  Deps,
  CreatedSession,
  LoadedSession,
  ConsumeSetupTokenResult,
} from '../../src/deps.js'
import type {
  AuditCtx,
  InstanceSettingsRecord,
  MembershipRecord,
  SessionRecord,
  SetupInput,
  UserRecord,
} from '../../src/types.js'
import type { ChainVerification } from '@devon/db'

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

export type AuditEvent = {
  action: string
  subjectType: string
  subjectId: string | null
  actorUserId: string | null
  after?: unknown
}

export type FakeMembership = MembershipRecord & { userId: string; status: 'active' | 'removed' }

export type FakeState = {
  users: UserRecord[]
  sessions: (SessionRecord & { tokenHash: string; csrfHash: string })[]
  setupTokens: { id: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[]
  /** `listActiveMembershipsForUser`'s fake: every membership row for every user, `status` included so
   * a test can seed a removed membership too. Empty by default, matching a fresh account with no
   * department yet -- a test that needs a member sets this directly. Backs both `Actor.memberships`
   * (`buildActor`) and `GET /me`'s own `memberships` field -- `accounts-departments`' near-identical
   * `listMembershipsForUser` was folded into this single call while integrating that module alongside
   * `work` (this item's report has the full story). */
  memberships: FakeMembership[]
  auditEvents: AuditEvent[]
  /** EPIC-001: `userId`s with TOTP 2FA enabled -- a test opts a seeded user into the login-challenge
   * path (instead of an immediate session) by adding their id here. Empty by default: 2FA off. */
  twoFactorEnabled: Set<string>
  /** EPIC-001: raw login-challenge tokens issued by `createLoginChallenge`, keyed by token, so a test
   * exercising `POST /accounts/2fa/login-verify` can find which user a captured token belongs to. */
  loginChallenges: Map<string, { userId: string }>
  instanceSettings: InstanceSettingsRecord
  dbReady: boolean
  migrationsApplied: boolean
  /** Set by a test to force the very next `consumeSetupToken` call to observe zero rows on its
   * race-safe UPDATE, simulating a concurrent winner (AC-12's disproof: "a setup URL that works
   * twice"). */
  forceSetupRaceLoss: boolean
}

export function createFakeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    users: [],
    sessions: [],
    setupTokens: [],
    memberships: [],
    auditEvents: [],
    twoFactorEnabled: new Set(),
    loginChallenges: new Map(),
    instanceSettings: {
      isDemo: false,
      registrationOpen: true,
      maintenance: { enabled: false, message: null },
    },
    dbReady: true,
    migrationsApplied: true,
    forceSetupRaceLoss: false,
    ...overrides,
  }
}

export function createFakeDeps(state: FakeState): Deps {
  return {
    now: () => new Date(),

    async countUsers() {
      return state.users.filter((u) => u.status !== 'deleted').length
    },

    async getInstanceSettings(): Promise<InstanceSettingsRecord> {
      return state.instanceSettings
    },

    async findUserByLogin(login) {
      return state.users.find((u) => u.login === login) ?? null
    },

    async findUserById(id) {
      return state.users.find((u) => u.id === id) ?? null
    },

    async listActiveMembershipsForUser(userId) {
      return state.memberships
        .filter((m) => m.userId === userId && m.status === 'active')
        .map((m) => ({
          departmentId: m.departmentId,
          departmentName: m.departmentName,
          role: m.role,
        }))
    },

    async updateUserProfile(userId, patch, ctx) {
      const user = state.users.find((u) => u.id === userId)
      if (!user) throw new Error('user not found')
      const before = { locale: user.locale, timezone: user.timezone }
      if (patch.locale !== undefined) user.locale = patch.locale
      if (patch.timezone !== undefined) user.timezone = patch.timezone
      state.auditEvents.push({
        action: 'user.updated',
        subjectType: 'user',
        subjectId: userId,
        actorUserId: ctx.userId,
        after: { before, after: { locale: user.locale, timezone: user.timezone } },
      })
      return user
    },

    async ensureSetupToken() {
      if (state.users.length > 0) return null
      if (state.setupTokens.length > 0) return null
      const token = randomUUID() + randomUUID()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      state.setupTokens.push({
        id: randomUUID(),
        tokenHash: sha256Hex(token),
        expiresAt,
        consumedAt: null,
      })
      return { token, expiresAt }
    },

    async consumeSetupToken(rawToken, input: SetupInput, _ctx): Promise<ConsumeSetupTokenResult> {
      const tokenHash = sha256Hex(rawToken)
      const found = state.setupTokens.find(
        (t) => t.tokenHash === tokenHash && t.consumedAt === null,
      )
      if (!found || found.expiresAt.getTime() <= Date.now()) return { ok: false }

      if (state.forceSetupRaceLoss) {
        state.forceSetupRaceLoss = false
        return { ok: false }
      }

      found.consumedAt = new Date()
      const user: UserRecord = {
        id: randomUUID(),
        login: input.login,
        email: null,
        passwordHash: await hashPassword(input.password),
        givenName: input.givenName,
        familyName: input.familyName,
        patronymic: input.patronymic ?? null,
        title: null,
        avatarKey: null,
        locale: input.locale,
        timezone: 'Asia/Tashkent',
        role: 'super_admin',
        status: 'active',
        mustChangePassword: false,
        lastLoginAt: null,
      }
      state.users.push(user)
      state.auditEvents.push({
        action: 'setup.completed',
        subjectType: 'user',
        subjectId: user.id,
        actorUserId: null,
      })
      return { ok: true, user }
    },

    async createSession(userId, _meta, ctx): Promise<CreatedSession> {
      const rawToken = randomUUID() + randomUUID()
      const rawCsrf = randomUUID() + randomUUID()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const id = randomUUID()
      state.sessions.push({
        id,
        userId,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt,
        revokedAt: null,
        revokedReason: null,
        tokenHash: sha256Hex(rawToken),
        csrfHash: sha256Hex(rawCsrf),
      })
      state.auditEvents.push({
        action: 'session.created',
        subjectType: 'session',
        subjectId: id,
        actorUserId: ctx.userId,
      })
      return { sessionId: id, rawToken, rawCsrf, expiresAt }
    },

    async findSessionByToken(rawToken): Promise<LoadedSession | null> {
      const tokenHash = sha256Hex(rawToken)
      const session = state.sessions.find((s) => s.tokenHash === tokenHash)
      if (!session) return null
      if (session.revokedAt !== null) return null
      if (session.expiresAt.getTime() <= Date.now()) return null
      const user = state.users.find((u) => u.id === session.userId)
      if (!user || user.status !== 'active') return null
      return { session, user, csrfHash: session.csrfHash }
    },

    async touchSession(sessionId) {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) session.lastSeenAt = new Date()
    },

    async revokeSession(sessionId, reason, ctx) {
      const session = state.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.revokedAt = new Date()
        session.revokedReason = reason
      }
      state.auditEvents.push({
        action: 'session.revoked',
        subjectType: 'session',
        subjectId: sessionId,
        actorUserId: ctx.userId,
      })
    },

    async getTwoFactorStatus(userId) {
      return { enabled: state.twoFactorEnabled.has(userId) }
    },

    async createLoginChallenge(userId) {
      const token = randomUUID() + randomUUID()
      state.loginChallenges.set(token, { userId })
      return token
    },

    async recordAccessDenied(ctx: AuditCtx, info) {
      state.auditEvents.push({
        action: 'access.denied',
        subjectType: 'route',
        subjectId: info.route,
        actorUserId: ctx.userId,
        after: { reason: info.reason },
      })
    },

    async verifyAuditChain(): Promise<ChainVerification> {
      return { ok: true, firstBadSeq: null, failure: null, rowsChecked: state.auditEvents.length }
    },

    async checkDbReady() {
      return state.dbReady
    },

    async checkMigrationsApplied() {
      return state.migrationsApplied
    },
  }
}
