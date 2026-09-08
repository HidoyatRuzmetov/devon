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

/** One active membership, joined with the department's display name -- what `buildActor()` needs for
 * `Actor.memberships` and what `GET /me` needs for its own `memberships` list (EPIC-004 note: EPIC-002
 * has not shipped a department-switching endpoint yet, so `listActiveMembershipsForUser`'s first
 * result is also `activeDepartmentId`'s source -- see `apps/api/src/lib/actor.ts`). */
export type MembershipRecord = {
  departmentId: string
  departmentName: string
  role: 'head' | 'member'
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

/** EPIC-001 storage plugin (TECH-SPEC §6): one row of `app.uploads` -- the bookkeeping side of a
 * presigned upload (`migrations/0101_accounts_uploads.sql` has the status vocabulary). `key` is the
 * server-chosen object key the bytes were uploaded under; the object itself lives in
 * `app.storage.store`, never here. */
export type UploadStatus =
  'pending' | 'rejected' | 'infected' | 'scan_failed' | 'finalized' | 'expired'

export type UploadRecord = {
  id: string
  userId: string
  purpose: 'avatar'
  key: string
  mime: string
  size: number
  status: UploadStatus
  error: string | null
  createdAt: Date
  expiresAt: Date
  finalizedAt: Date | null
}
