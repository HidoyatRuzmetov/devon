// Shared record shapes between the injected `Deps` seam (src/deps.ts), its real Postgres-backed
// implementation (src/db/repo.ts) and the in-memory fake used by unit tests
// (test/unit/fake-deps.ts). Deliberately plain data, no class instances, so a fake built from arrays
// is structurally identical to a row read back through Drizzle.
import type { Role } from '@devon/contracts'

export type UserRecord = {
  id: string
  login: string
  email: string | null
  passwordHash: string
  givenName: string
  familyName: string
  patronymic: string | null
  title: string | null
  avatarKey: string | null
  locale: string
  timezone: string
  role: Role
  status: 'active' | 'locked' | 'deleted'
  mustChangePassword: boolean
  lastLoginAt: Date | null
}

export type SessionRecord = {
  id: string
  userId: string
  createdAt: Date
  lastSeenAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revokedReason: string | null
}

export type InstanceSettingsRecord = {
  isDemo: boolean
  registrationOpen: boolean
  maintenance: { enabled: boolean; message: Record<string, string> | null }
}

export type AuditCtx = {
  requestId: string
  userId: string | null
  actorRole: Role | null
  actingForUserId: string | null
  ip: string
  userAgent: string
}

export type SetupInput = {
  login: string
  password: string
  givenName: string
  familyName: string
  patronymic?: string | undefined
  locale: string
}
