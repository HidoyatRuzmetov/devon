// Typed endpoint functions for `/api/v1/admin/*` (MODULE-GUIDE.md "Web features"). Every query key
// used against these starts with `['admin', ...]` -- `lib/session.ts`'s `useLogoutMutation` already
// clears that whole prefix on sign-out (`queryClient.removeQueries({ queryKey: ['admin'] })`), written
// before this module existed, waiting for exactly this convention.
import { z } from 'zod'
import { localeSchema } from '@devon/i18n'
import { apiClient } from '../../lib/api-client.js'

const departmentStatusSchema = z.enum([
  'active',
  'paused_by_admin',
  'deletion_requested',
  'archived',
])

export const adminDepartmentRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: departmentStatusSchema,
  memberCount: z.number().int(),
  headName: z.string().nullable(),
  createdAt: z.string(),
})
export type AdminDepartmentRow = z.infer<typeof adminDepartmentRowSchema>

const adminDepartmentListSchema = z.object({
  departments: z.array(adminDepartmentRowSchema),
  nextCursor: z.string().nullable(),
})

export const adminDepartmentDetailSchema = adminDepartmentRowSchema.extend({
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  localeDefault: localeSchema,
})
export type AdminDepartmentDetail = z.infer<typeof adminDepartmentDetailSchema>

export function fetchAdminDepartments(params: {
  query?: string | undefined
  status?: string | undefined
  cursor?: string | undefined
}) {
  const qs = new URLSearchParams()
  if (params.query) qs.set('query', params.query)
  if (params.status) qs.set('status', params.status)
  if (params.cursor) qs.set('cursor', params.cursor)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiClient.get(`/api/v1/admin/departments${suffix}`, adminDepartmentListSchema)
}
export function fetchAdminDepartment(id: string) {
  return apiClient.get(`/api/v1/admin/departments/${id}`, adminDepartmentDetailSchema)
}
export function pauseDepartment(id: string, reason: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/departments/${id}/pause`, { reason }, z.void(), csrfToken)
}
export function resumeDepartment(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/departments/${id}/resume`, {}, z.void(), csrfToken)
}
export function archiveDepartment(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/departments/${id}/archive`, {}, z.void(), csrfToken)
}
export function restoreDepartment(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/departments/${id}/restore`, {}, z.void(), csrfToken)
}
export function startViewAs(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/departments/${id}/view-as`, {}, z.void(), csrfToken)
}
export function stopViewAs(csrfToken: string) {
  return apiClient.post('/api/v1/admin/view-as/stop', {}, z.void(), csrfToken)
}

const userStatusSchema = z.enum(['active', 'locked', 'deleted'])
const userRoleSchema = z.enum(['super_admin', 'head', 'member'])

export const adminUserRowSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
})
export type AdminUserRow = z.infer<typeof adminUserRowSchema>

const adminUserListSchema = z.object({
  users: z.array(adminUserRowSchema),
  nextCursor: z.string().nullable(),
})

export const adminUserDetailSchema = adminUserRowSchema.extend({
  email: z.string().nullable(),
  locale: localeSchema,
  mustChangePassword: z.boolean(),
  twoFactorEnabled: z.boolean(),
  lockedUntil: z.string().nullable(),
  memberships: z.array(
    z.object({
      departmentId: z.string().uuid(),
      departmentName: z.string(),
      role: z.enum(['head', 'member']),
    }),
  ),
})
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>

export function fetchAdminUsers(params: {
  query?: string | undefined
  status?: string | undefined
  role?: string | undefined
  cursor?: string | undefined
}) {
  const qs = new URLSearchParams()
  if (params.query) qs.set('query', params.query)
  if (params.status) qs.set('status', params.status)
  if (params.role) qs.set('role', params.role)
  if (params.cursor) qs.set('cursor', params.cursor)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiClient.get(`/api/v1/admin/accounts${suffix}`, adminUserListSchema)
}
export function fetchAdminUser(id: string) {
  return apiClient.get(`/api/v1/admin/accounts/${id}`, adminUserDetailSchema)
}
export function lockUser(id: string, reason: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/accounts/${id}/lock`, { reason }, z.void(), csrfToken)
}
export function unlockUser(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/accounts/${id}/unlock`, {}, z.void(), csrfToken)
}
export function forceTwoFactorReset(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/accounts/${id}/force-2fa-reset`, {}, z.void(), csrfToken)
}
export function anonymizeUser(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/admin/accounts/${id}/anonymize`, {}, z.void(), csrfToken)
}
const resetPasswordResultSchema = z.object({ temporaryPassword: z.string() })
export function resetUserPassword(id: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/accounts/${id}/reset-password`,
    {},
    resetPasswordResultSchema,
    csrfToken,
  )
}

export const adminAnalyticsSchema = z.object({
  generatedAt: z.string(),
  departments: z.object({
    total: z.number().int(),
    active: z.number().int(),
    paused: z.number().int(),
    archived: z.number().int(),
  }),
  people: z.object({
    total: z.number().int(),
    active: z.number().int(),
    locked: z.number().int(),
    deleted: z.number().int(),
    superAdmins: z.number().int(),
    heads: z.number().int(),
    members: z.number().int(),
  }),
  activity: z.object({
    cardsCreated30d: z.number().int(),
    cardsCompleted30d: z.number().int(),
    eventsCreated30d: z.number().int(),
    logins7d: z.number().int(),
    weeklyLogins: z.array(z.object({ weekStart: z.string(), count: z.number().int() })),
  }),
  aiSpend: z.object({
    available: z.boolean(),
    tokensThisMonth: z.number().int(),
    costUzsThisMonth: z.number().int(),
    byDepartment: z.array(
      z.object({
        departmentId: z.string().uuid(),
        departmentName: z.string(),
        tokens: z.number().int(),
      }),
    ),
  }),
})
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>
export function fetchAdminAnalytics() {
  return apiClient.get('/api/v1/admin/analytics', adminAnalyticsSchema)
}

export const auditEventRowSchema = z.object({
  seq: z.number().int(),
  id: z.string().uuid(),
  at: z.string(),
  actorUserId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  actorName: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  subjectTitle: z.string().nullable().optional(),
})
export type AuditEventRow = z.infer<typeof auditEventRowSchema>
const auditEventListSchema = z.object({
  events: z.array(auditEventRowSchema),
  nextCursor: z.number().int().nullable(),
})
/** `category` is one of `AUDIT_CATEGORIES` (`apps/api/.../schemas.ts`) or `'__other__'` -- the chip
 * filter that replaced the raw action-grammar text box (round2 SEV2). */
export function fetchAuditEvents(params: {
  category?: string | undefined
  cursor?: number | undefined
  from?: string | undefined
  to?: string | undefined
}) {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.cursor) qs.set('cursor', String(params.cursor))
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiClient.get(`/api/v1/admin/audit/events${suffix}`, auditEventListSchema)
}
export function auditExportUrl(
  category?: string,
  range?: { from?: string | undefined; to?: string | undefined },
): string {
  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  if (range?.from) qs.set('from', range.from)
  if (range?.to) qs.set('to', range.to)
  return `/api/v1/admin/audit/export${qs.size ? `?${qs.toString()}` : ''}`
}
export function fetchAuditExport(
  category?: string,
  range?: { from?: string | undefined; to?: string | undefined },
) {
  return apiClient.getBlob(auditExportUrl(category, range))
}

const chainVerificationSchema = z.object({
  ok: z.boolean(),
  rows: z.number().int(),
  firstBadSeq: z.number().int().nullable(),
  failure: z.enum(['row_hash_mismatch', 'prev_hash_mismatch']).nullable(),
})
export type ChainVerification = z.infer<typeof chainVerificationSchema>
export function fetchAuditVerify() {
  return apiClient.get('/api/v1/admin/audit/verify', chainVerificationSchema)
}

// Structured -- see the matching comment in apps/api/src/modules/admin/schemas.ts. `code` is looked
// up as `admin.console.health.detail.<code>` and `params` interpolated by the caller (health-screen.tsx).
const healthDetailSchema = z
  .object({
    code: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .nullable()

const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down', 'not_configured']),
  detail: healthDetailSchema,
  latencyMs: z.number().int().nullable(),
})
export const adminHealthSchema = z.object({
  checkedAt: z.string(),
  db: healthCheckSchema,
  queue: healthCheckSchema,
  storage: healthCheckSchema,
  telegram: healthCheckSchema,
  ai: healthCheckSchema,
  backups: healthCheckSchema,
})
export type AdminHealth = z.infer<typeof adminHealthSchema>
export type HealthCheck = z.infer<typeof healthCheckSchema>
export function fetchAdminHealth() {
  return apiClient.get('/api/v1/admin/health', adminHealthSchema)
}

const maintenanceMessageSchema = z.record(localeSchema, z.string())
export const maintenanceStateSchema = z.object({
  enabled: z.boolean(),
  message: maintenanceMessageSchema.nullable(),
})
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>
export function fetchMaintenance() {
  return apiClient.get('/api/v1/admin/maintenance', maintenanceStateSchema)
}
export function patchMaintenance(
  input: { enabled: boolean; message: Record<string, string> | null },
  csrfToken: string,
) {
  return apiClient.patch('/api/v1/admin/maintenance', input, z.void(), csrfToken)
}
export function patchRegistration(open: boolean, csrfToken: string) {
  return apiClient.patch('/api/v1/admin/registration', { open }, z.void(), csrfToken)
}

const adminInstanceSchema = z.object({
  isDemo: z.boolean(),
  registrationOpen: z.boolean(),
  userCount: z.number().int(),
})
export type AdminInstance = z.infer<typeof adminInstanceSchema>
export function fetchAdminInstanceDetail() {
  return apiClient.get('/api/v1/admin/instance', adminInstanceSchema)
}

const sentinelStatusSchema = z.object({
  hasActiveKey: z.boolean(),
  publicKeyB64: z.string().nullable(),
  createdAt: z.string().nullable(),
})
export type SentinelStatus = z.infer<typeof sentinelStatusSchema>
export function fetchSentinelStatus() {
  return apiClient.get('/api/v1/admin/sentinel/status', sentinelStatusSchema)
}
const sentinelKeyResultSchema = z.object({ publicKeyB64: z.string() })
export function rotateSentinelKey(csrfToken: string) {
  return apiClient.post('/api/v1/admin/sentinel/rotate-key', {}, sentinelKeyResultSchema, csrfToken)
}

const wipeStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['countdown', 'cancelled', 'executing', 'completed', 'failed']),
    countdownEndsAt: z.string(),
    phrase: z.string(),
    failureReason: z.string().nullable(),
  })
  .nullable()
export type WipeStatus = z.infer<typeof wipeStatusSchema>
export function fetchWipeStatus() {
  return apiClient.get('/api/v1/admin/wipe/status', wipeStatusSchema)
}
const wipeStartResultSchema = z.object({
  id: z.string().uuid(),
  countdownEndsAt: z.string(),
  countdownSeconds: z.number().int(),
})
export function startWipe(
  input: { phrase: string; password: string; totpCode?: string | undefined },
  csrfToken: string,
) {
  return apiClient.post('/api/v1/admin/wipe/start', input, wipeStartResultSchema, csrfToken)
}
export function cancelWipe(csrfToken: string) {
  return apiClient.post('/api/v1/admin/wipe/cancel', {}, z.void(), csrfToken)
}
export function executeWipe(csrfToken: string) {
  return apiClient.post('/api/v1/admin/wipe/execute', {}, z.void(), csrfToken)
}
