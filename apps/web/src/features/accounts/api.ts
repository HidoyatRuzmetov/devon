// Typed endpoint functions for `/api/v1/accounts/*` (MODULE-GUIDE.md "Web features"), built on the
// shared `apiClient` the same way every function in `src/lib/api-client.ts` already does.
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import type { Locale } from '@devon/i18n'

export type RegisterInput = {
  login: string
  email?: string
  password: string
  givenName: string
  familyName: string
  patronymic?: string
  title?: string
  locale: Locale
  timezone: string
}

const publicUserSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  role: z.enum(['super_admin', 'head', 'member']),
  mustChangePassword: z.boolean(),
})

const registerResultSchema = z.object({ user: publicUserSchema, csrfToken: z.string() })

export function registerAccount(input: RegisterInput) {
  return apiClient.post('/api/v1/accounts/register', input, registerResultSchema)
}

const sessionViewSchema = z.object({
  id: z.string().uuid(),
  deviceLabel: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
})
export type SessionView = z.infer<typeof sessionViewSchema>
const sessionListSchema = z.object({ sessions: z.array(sessionViewSchema) })

export function fetchSessions() {
  return apiClient.get('/api/v1/accounts/sessions', sessionListSchema)
}

export function revokeSession(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/accounts/sessions/${id}/revoke`, {}, z.void(), csrfToken)
}

export function revokeAllSessions(csrfToken: string) {
  return apiClient.post('/api/v1/accounts/sessions/revoke-all', {}, z.void(), csrfToken)
}

const twoFactorStatusSchema = z.object({ ok: z.boolean() })
export function fetchTwoFactorStatus() {
  return apiClient.get('/api/v1/accounts/2fa', twoFactorStatusSchema)
}

const totpEnrollResultSchema = z.object({ secret: z.string(), otpauthUri: z.string() })
export function enrollTotp(csrfToken: string) {
  return apiClient.post('/api/v1/accounts/2fa/totp/enroll', {}, totpEnrollResultSchema, csrfToken)
}

const totpVerifyResultSchema = z.object({ recoveryCodes: z.array(z.string()) })
export function verifyTotpEnroll(code: string, csrfToken: string) {
  return apiClient.post('/api/v1/accounts/2fa/totp/verify', { code }, totpVerifyResultSchema, csrfToken)
}

export function disableTotp(password: string, csrfToken: string) {
  return apiClient.post('/api/v1/accounts/2fa/disable', { password }, z.void(), csrfToken)
}

export function changePassword(currentPassword: string, newPassword: string, csrfToken: string) {
  return apiClient.post(
    '/api/v1/accounts/password/change',
    { currentPassword, newPassword },
    z.void(),
    csrfToken,
  )
}

const deleteResultSchema = z.object({ scheduledFor: z.string() }).nullable()
export function fetchDeletionStatus() {
  return apiClient.get('/api/v1/accounts/delete/status', deleteResultSchema)
}
export function requestAccountDeletion(csrfToken: string) {
  return apiClient.post('/api/v1/accounts/delete', {}, z.object({ scheduledFor: z.string() }), csrfToken)
}
export function cancelAccountDeletion(csrfToken: string) {
  return apiClient.post('/api/v1/accounts/delete/cancel', {}, z.void(), csrfToken)
}

const resetPasswordResultSchema = z.object({ temporaryPassword: z.string() })
export function adminResetPassword(userId: string, csrfToken: string) {
  return apiClient.post(`/api/v1/accounts/${userId}/reset-password`, {}, resetPasswordResultSchema, csrfToken)
}
