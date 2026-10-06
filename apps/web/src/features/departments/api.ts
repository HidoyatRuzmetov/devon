// Typed endpoint functions for `/api/v1/departments/*` (MODULE-GUIDE.md "Web features").
import { z } from 'zod'
import { FEATURE_KEYS, type FeatureKey } from '@devon/contracts'
import { apiClient } from '../../lib/api-client.js'

/** SPEC §7: the switch map the server resolves for us -- stored overrides already merged onto the
 * registry defaults, so nothing on this side needs to know what the defaults are. */
// `partialRecord`, not `record`: zod 4 makes a record over an enum key exhaustive, and the server
// answers a one-switch save with the whole resolved map but the request carries one key.
export const featureFlagsSchema = z.partialRecord(z.enum(FEATURE_KEYS), z.boolean())

export type UnitDraft = { name: string; colour?: string | undefined }

export const departmentRequestSchema = z.object({
  id: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  requesterName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  units: z.array(z.object({ name: z.string(), colour: z.string().optional() })),
  locale: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  createdDepartmentId: z.string().uuid().nullable(),
})
export type DepartmentRequest = z.infer<typeof departmentRequestSchema>
const requestListSchema = z.object({
  requests: z.array(departmentRequestSchema),
})

export function createDepartmentRequest(
  input: {
    name: string
    description?: string | undefined
    units: UnitDraft[]
    locale: string
  },
  csrfToken: string,
) {
  return apiClient.post(
    '/api/v1/departments/requests',
    input,
    z.object({ id: z.string().uuid() }),
    csrfToken,
  )
}

export function fetchMyRequests() {
  return apiClient.get('/api/v1/departments/requests/mine', requestListSchema)
}

export function fetchAllRequests(status?: 'pending' | 'approved' | 'rejected') {
  const qs = status ? `?status=${status}` : ''
  return apiClient.get(`/api/v1/departments/requests${qs}`, requestListSchema)
}

const approveResultSchema = z.object({
  departmentId: z.string().uuid(),
  joinKey: z.string(),
  joinPassword: z.string(),
})
export function approveRequest(id: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/requests/${id}/approve`,
    {},
    approveResultSchema,
    csrfToken,
  )
}
export function rejectRequest(id: string, reason: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/requests/${id}/reject`,
    { reason },
    z.void(),
    csrfToken,
  )
}

export const departmentDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  localeDefault: z.string(),
  status: z.enum(['active', 'paused_by_admin', 'deletion_requested', 'archived']),
  settings: z.object({
    allowSelfAssign: z.boolean(),
    allowStructureEdit: z.boolean(),
    joinRequiresApproval: z.boolean(),
    whoCanConnectTelegramGroup: z.enum(['everyone', 'head']),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
    features: featureFlagsSchema,
  }),
  myRole: z.enum(['head', 'member']),
  memberCount: z.number().int(),
})
export type DepartmentDetail = z.infer<typeof departmentDetailSchema>
const departmentListSchema = z.object({
  departments: z.array(departmentDetailSchema),
})

export function fetchMyDepartments() {
  return apiClient.get('/api/v1/departments/mine', departmentListSchema)
}
export function fetchDepartment(id: string) {
  return apiClient.get(`/api/v1/departments/${id}`, departmentDetailSchema)
}

export type SettingsPatch = Partial<{
  allowSelfAssign: boolean
  allowStructureEdit: boolean
  joinRequiresApproval: boolean
  whoCanConnectTelegramGroup: 'everyone' | 'head'
  quietHours: { start: string; end: string } | null
  name: string
  description: string | null
  emoji: string | null
  colour: string | null
  localeDefault: string
}>

export function patchDepartmentSettings(id: string, patch: SettingsPatch, csrfToken: string) {
  return apiClient.patch(`/api/v1/departments/${id}/settings`, patch, z.void(), csrfToken)
}

export function requestDepartmentDeletion(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/departments/${id}/deletion-request`, {}, z.void(), csrfToken)
}

const inviteViewSchema = z.object({
  joinKey: z.string().nullable(),
  // The server's own configured public origin (round2 critique #29) -- never built from
  // `window.location.origin` on this side.
  joinUrl: z.string().nullable(),
  joinRequiresApproval: z.boolean(),
  hasPassword: z.boolean(),
})
export type InviteView = z.infer<typeof inviteViewSchema>
export function fetchInvite(id: string) {
  return apiClient.get(`/api/v1/departments/${id}/invite`, inviteViewSchema)
}
export function rotateJoinKey(id: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/invite/rotate-key`,
    {},
    z.object({ joinKey: z.string() }),
    csrfToken,
  )
}
export function rotateJoinPassword(id: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/invite/rotate-password`,
    {},
    z.object({ password: z.string() }),
    csrfToken,
  )
}
export function setJoinPassword(id: string, password: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/invite/password`,
    { password },
    z.void(),
    csrfToken,
  )
}
export function setJoinApproval(id: string, joinRequiresApproval: boolean, csrfToken: string) {
  return apiClient.patch(
    `/api/v1/departments/${id}/invite/approval`,
    { joinRequiresApproval },
    z.void(),
    csrfToken,
  )
}

const joinPreviewSchema = z.object({
  name: z.string(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  joinRequiresApproval: z.boolean(),
})
export function fetchJoinPreview(key: string) {
  return apiClient.get(`/api/v1/departments/join/${encodeURIComponent(key)}`, joinPreviewSchema)
}

const joinResultSchema = z.object({
  departmentId: z.string().uuid(),
  status: z.enum(['active', 'pending_approval']),
})
export function joinDepartment(key: string, password: string, csrfToken: string) {
  return apiClient.post('/api/v1/departments/join', { key, password }, joinResultSchema, csrfToken)
}

const memberSchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  role: z.enum(['head', 'member']),
  status: z.enum(['active', 'pending_approval', 'removed']),
  joinedAt: z.string(),
})
export type Member = z.infer<typeof memberSchema>
const memberListSchema = z.object({ members: z.array(memberSchema) })

export function fetchMembers(id: string) {
  return apiClient.get(`/api/v1/departments/${id}/members`, memberListSchema)
}
export function removeMember(id: string, userId: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/members/${userId}/remove`,
    {},
    z.void(),
    csrfToken,
  )
}
export function leaveDepartment(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/departments/${id}/leave`, {}, z.void(), csrfToken)
}
export function transferHeadship(id: string, userId: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/members/${userId}/transfer-headship`,
    {},
    z.void(),
    csrfToken,
  )
}

// --- v1.1 SPEC §2.2: the join-approval queue -------------------------------------------------------

const joinRequestSchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  requestedAt: z.string(),
})
export type JoinRequest = z.infer<typeof joinRequestSchema>
const joinRequestListSchema = z.object({
  requests: z.array(joinRequestSchema),
})

export function fetchJoinRequests(id: string) {
  return apiClient.get(`/api/v1/departments/${id}/join-requests`, joinRequestListSchema)
}

/** `approve` / `reject` are the decision; `undo` puts it back in the queue, which is what the toast's
 * "Bekor qilish" calls (DESIGN.md: undo over confirm). */
export function decideJoinRequest(
  id: string,
  userId: string,
  decision: 'approve' | 'reject' | 'undo',
  csrfToken: string,
) {
  return apiClient.post(
    `/api/v1/departments/${id}/join-requests/${userId}/${decision}`,
    {},
    z.void(),
    csrfToken,
  )
}

// --- v1.1 SPEC §7: Imkoniyatlar --------------------------------------------------------------------

export function putFeatures(
  id: string,
  features: Partial<Record<FeatureKey, boolean>>,
  csrfToken: string,
) {
  return apiClient.put(
    `/api/v1/departments/${id}/features`,
    { features },
    z.object({ features: featureFlagsSchema }),
    csrfToken,
  )
}

// --- v1.1 SPEC §2.2: the head resets a member's password -------------------------------------------

export function resetMemberPassword(id: string, userId: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/departments/${id}/members/${userId}/reset-password`,
    {},
    z.object({ temporaryPassword: z.string() }),
    csrfToken,
  )
}
