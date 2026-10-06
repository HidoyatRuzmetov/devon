// Typed endpoint functions for `/api/v1/accounts/*` (MODULE-GUIDE.md "Web features"), built on the
// shared `apiClient` the same way every function in `src/lib/api-client.ts` already does.
import { z } from 'zod'
import { ApiError, apiClient } from '../../lib/api-client.js'
import type { Locale } from '@devon/i18n'

const profileSchema = z.object({
  login: z.string(),
  email: z.string().nullable(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
})
export type AccountProfile = z.infer<typeof profileSchema>
export function fetchProfile(): Promise<AccountProfile> {
  return apiClient.get('/api/v1/accounts/profile', profileSchema)
}
export function saveProfile(profile: AccountProfile, csrfToken: string): Promise<AccountProfile> {
  return apiClient.patch('/api/v1/accounts/profile', profile, profileSchema, csrfToken)
}

export type RegisterInput = {
  login: string
  email?: string | undefined
  password: string
  givenName: string
  familyName: string
  patronymic?: string | undefined
  title?: string | undefined
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
  return apiClient.post(
    '/api/v1/accounts/2fa/totp/verify',
    { code },
    totpVerifyResultSchema,
    csrfToken,
  )
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
  return apiClient.post(
    '/api/v1/accounts/delete',
    {},
    z.object({ scheduledFor: z.string() }),
    csrfToken,
  )
}
export function cancelAccountDeletion(csrfToken: string) {
  return apiClient.post('/api/v1/accounts/delete/cancel', {}, z.void(), csrfToken)
}

const resetPasswordResultSchema = z.object({ temporaryPassword: z.string() })
export function adminResetPassword(userId: string, csrfToken: string) {
  return apiClient.post(
    `/api/v1/accounts/${userId}/reset-password`,
    {},
    resetPasswordResultSchema,
    csrfToken,
  )
}

// --- Profile photo (EPIC-001, TECH-SPEC §2.1: "presigned upload, ClamAV, 512 px WebP variants") ----
// Three calls, one helper: `uploadAvatar()` runs presign -> PUT (straight to the presigned URL, via
// `apiClient.uploadFile`) -> finalise, and `avatarErrorKey()` turns whatever went wrong into the one
// message key a screen shows. The server owns the real limits (`STORAGE_MAX_UPLOAD_BYTES`, the MIME
// allow-list, magic-byte sniffing, the ClamAV verdict); the two client-side checks below only spare a
// user a round trip for the two mistakes they can see for themselves.

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp'
const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number]

export function isAvatarContentType(value: string): value is AvatarContentType {
  return (AVATAR_CONTENT_TYPES as readonly string[]).includes(value)
}

const avatarUploadUrlResultSchema = z.object({
  uploadId: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
})

export function requestAvatarUploadUrl(
  input: { contentType: AvatarContentType; size: number },
  csrfToken: string,
) {
  return apiClient.post(
    '/api/v1/accounts/avatar/upload-url',
    input,
    avatarUploadUrlResultSchema,
    csrfToken,
  )
}

const avatarResultSchema = z.object({ user: publicUserSchema })
export type AvatarResult = z.infer<typeof avatarResultSchema>

export function finalizeAvatar(uploadId: string, csrfToken: string) {
  return apiClient.post('/api/v1/accounts/avatar', { uploadId }, avatarResultSchema, csrfToken)
}

export function removeAvatar(csrfToken: string) {
  return apiClient.delete('/api/v1/accounts/avatar', csrfToken)
}

/** Thrown by `uploadAvatar` before any request is made, for the two things the browser can already
 * see are wrong. */
export class AvatarValidationError extends Error {
  constructor(public readonly reason: 'type' | 'tooLarge' | 'empty') {
    super(`avatar rejected: ${reason}`)
    this.name = 'AvatarValidationError'
  }
}

export type AvatarUploadStage = 'uploading' | 'scanning'

export async function uploadAvatar(
  file: File,
  csrfToken: string,
  onStage?: (stage: AvatarUploadStage) => void,
): Promise<AvatarResult> {
  if (!isAvatarContentType(file.type)) throw new AvatarValidationError('type')
  if (file.size === 0) throw new AvatarValidationError('empty')
  if (file.size > AVATAR_MAX_BYTES) throw new AvatarValidationError('tooLarge')
  onStage?.('uploading')
  const presigned = await requestAvatarUploadUrl(
    { contentType: file.type, size: file.size },
    csrfToken,
  )
  await apiClient.uploadFile(presigned.url, {
    method: presigned.method,
    headers: presigned.headers,
    body: file,
  })
  onStage?.('scanning')
  return finalizeAvatar(presigned.uploadId, csrfToken)
}

/** Every failure `uploadAvatar` can produce, as the one `accounts.photo.error.*` key to show. */
export function avatarErrorKey(err: unknown): string {
  if (err instanceof AvatarValidationError) {
    return err.reason === 'tooLarge' ? 'accounts.photo.error.tooLarge' : 'accounts.photo.error.type'
  }
  if (err instanceof ApiError) {
    if (err.status === 413) return 'accounts.photo.error.tooLarge'
    if (err.status === 503) return 'accounts.photo.error.unavailable'
    const code = err.errors[0]?.code
    if (code === 'infected') return 'accounts.photo.error.infected'
    if (code === 'too_large') return 'accounts.photo.error.tooLarge'
    if (err.status === 422) return 'accounts.photo.error.invalidImage'
  }
  return 'accounts.photo.error.generic'
}
