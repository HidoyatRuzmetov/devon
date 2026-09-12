// Zod schemas for `/api/v1/accounts/*` (EPIC-001). Kept inside this module rather than the shared
// `apps/api/src/schemas.ts` (MODULE-GUIDE.md: a module adds files, it does not edit one another module
// also edits) -- `localeSchema`/`asLocale` are the one thing genuinely worth importing from there
// rather than redeclaring, since `LOCALES` is documented as a frozen, load-bearing constant no package
// "owns" (see that file's own header comment).
import { z } from 'zod'
import { localeSchema, asLocale } from '../../schemas.js'
import type { UserRecord } from '../../types.js'

/** TECH-SPEC §2.1: "argon2id, >= 12 chars, breach-list check, no composition rules". The breach list
 * is a small, checked-in set of the most common leaked passwords worldwide (not a live HIBP lookup --
 * this instance is self-hosted, often air-gapped, per FEATURE-PLAN's refusals) -- catches the
 * overwhelming majority of "password12345"-style registrations without ever calling out to the
 * internet with a user's password (even k-anonymised). */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password123',
  'password1234',
  '123456789012',
  'qwertyuiop12',
  'letmein123456',
  'iloveyou1234',
  'admin1234567',
  'welcome12345',
  'password@123',
  '12345678901234',
  'qwerty123456',
  'football1234',
  'baseball1234',
  'dragon123456',
  'superman1234',
  'trustno112345',
  '123123123123',
  'abc123456789',
  'passw0rd12345',
  'zaq12wsx34ed',
])

export const passwordSchema = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(256)
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: 'password appears on a list of very common passwords',
  })

export const loginIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9._-]+$/, 'lowercase letters, digits, dot, dash, underscore only')

export const registerBodySchema = z
  .object({
    login: loginIdSchema,
    email: z.string().email().max(256).optional(),
    password: passwordSchema,
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    patronymic: z.string().max(100).optional(),
    title: z.string().max(150).optional(),
    locale: localeSchema.default('uz-Latn'),
    timezone: z.string().max(64).default('Asia/Tashkent'),
  })
  .strict()
export type RegisterBody = z.infer<typeof registerBodySchema>

const publicUserSchema = z.object({
  id: z.string().uuid(),
  login: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  locale: localeSchema,
  timezone: z.string(),
  role: z.enum(['super_admin', 'head', 'member']),
  mustChangePassword: z.boolean(),
})

export function toAccountPublicUser(user: UserRecord) {
  return {
    id: user.id,
    login: user.login,
    givenName: user.givenName,
    familyName: user.familyName,
    patronymic: user.patronymic,
    title: user.title,
    avatarKey: user.avatarKey,
    locale: asLocale(user.locale),
    timezone: user.timezone,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  }
}

export const registerResultSchema = z.object({ user: publicUserSchema, csrfToken: z.string() })

export const sessionViewSchema = z.object({
  id: z.string().uuid(),
  deviceLabel: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
})
export const sessionListSchema = z.object({ sessions: z.array(sessionViewSchema) })

export const totpEnrollResultSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
})

export const totpVerifyBodySchema = z.object({ code: z.string().length(6) }).strict()
export const totpVerifyResultSchema = z.object({ recoveryCodes: z.array(z.string()) })

export const totpDisableBodySchema = z.object({ password: z.string().min(1) }).strict()

export const twoFaLoginVerifyBodySchema = z
  .object({
    challengeToken: z.string().min(1),
    code: z.string().min(1), // 6-digit TOTP or an 11-char "xxxxx-xxxxx" recovery code
  })
  .strict()

export const changePasswordBodySchema = z
  .object({ currentPassword: z.string().min(1), newPassword: passwordSchema })
  .strict()

export const resetPasswordResultSchema = z.object({ temporaryPassword: z.string() })

export const deleteAccountResultSchema = z.object({ scheduledFor: z.string() })

export const accountStatusMessageSchema = z.object({ ok: z.boolean() })

export const sessionIdParamsSchema = z.object({ id: z.string().uuid() }).strict()
export const userIdParamsSchema = z.object({ userId: z.string().uuid() }).strict()

/** v1.1 SPEC §2.2: the login screen's one-click "ask my head to reset my password". Only the login
 * is taken -- no email, no phone, nothing that could be used to enumerate or to contact anyone. */
export const passwordResetRequestBodySchema = z
  .object({ login: z.string().min(1).max(64) })
  .strict()

// --- EPIC-001 photo upload (storage plugin, TECH-SPEC §2.1/§6) -----------------------------------

/** Declared up front so the presigned URL can be bound to a content type and the finalise step can
 * refuse anything that does not match it byte-for-byte (`lib/storage/image.ts`). The size ceiling
 * here mirrors the default `STORAGE_MAX_UPLOAD_BYTES`; the route re-checks against the live config. */
export const avatarUploadUrlBodySchema = z
  .object({
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  })
  .strict()
export type AvatarUploadUrlBody = z.infer<typeof avatarUploadUrlBodySchema>

export const avatarUploadUrlResultSchema = z.object({
  uploadId: z.string().uuid(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
})

export const avatarFinalizeBodySchema = z.object({ uploadId: z.string().uuid() }).strict()

export const avatarResultSchema = z.object({ user: publicUserSchema })

export const avatarImageParamsSchema = z
  .object({
    userId: z.string().uuid(),
    uploadId: z.string().uuid(),
    size: z.enum(['64', '128', '512']),
  })
  .strict()
