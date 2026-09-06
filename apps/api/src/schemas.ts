// Zod schemas for this item's endpoints (design.md §1.7). `@devon/api` does not depend on
// `@devon/i18n` (item handoff: this item depends only on EPIC-000.2/.5) so the four-locale id list is
// duplicated here as a literal tuple -- it is a frozen, load-bearing constant
// (`agentic/gates.json`'s `limits.locales`), not something either package "owns".
import { z } from 'zod'

export const LOCALES = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const localeSchema = z.enum(LOCALES)

/** `app.users.locale` is a plain `text` column with a four-way check constraint enforced at write time
 * (`setupBodySchema`/`patchMeSchema` only ever accept one of `LOCALES`); this cast documents that
 * invariant at the one seam where a DB-typed `string` needs to satisfy the narrower response schema,
 * without loosening the schema itself. */
export function asLocale(value: string): Locale {
  return value as Locale
}

export const instancePublicSchema = z.object({
  isDemo: z.boolean(),
  maintenance: z.object({
    enabled: z.boolean(),
    message: z.record(localeSchema, z.string()).nullable(),
  }),
  registrationOpen: z.boolean(),
  locales: z.array(localeSchema),
  defaultLocale: localeSchema,
  setupRequired: z.boolean(),
})
export type InstancePublic = z.infer<typeof instancePublicSchema>

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

export const meSchema = z.object({
  user: publicUserSchema, // NOTE: no `email` -- restricted tier, never on a list/self endpoint by default
  memberships: z
    .array(
      z.object({
        departmentId: z.string().uuid(),
        name: z.string(),
        role: z.enum(['head', 'member']),
      }),
    )
    .max(20),
  membershipCount: z.number().int(),
  activeDepartmentId: z.string().uuid().nullable(),
  actingForUserId: z.string().uuid().nullable(),
  instance: z.object({ isDemo: z.boolean(), maintenance: z.boolean() }),
  csrfToken: z.string(),
})
export type Me = z.infer<typeof meSchema>

export const patchMeSchema = z
  .object({
    locale: localeSchema.optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict()
export type PatchMe = z.infer<typeof patchMeSchema>

export const setupBodySchema = z
  .object({
    login: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[a-z0-9._-]+$/),
    password: z.string().min(12).max(256),
    givenName: z.string().min(1).max(100),
    familyName: z.string().min(1).max(100),
    patronymic: z.string().max(100).optional(),
    locale: localeSchema.default('uz-Latn'),
  })
  .strict()
export type SetupBody = z.infer<typeof setupBodySchema>

export const setupResultSchema = z.object({
  user: publicUserSchema,
})

export const loginBodySchema = z
  .object({
    login: z.string().min(1).max(256),
    password: z.string().min(1).max(256),
  })
  .strict()

export const chainVerificationSchema = z.object({
  ok: z.boolean(),
  checkedFrom: z.number().int(),
  checkedTo: z.number().int().nullable(),
  rows: z.number().int(),
  firstBadSeq: z.number().int().nullable(),
  failure: z.enum(['row_hash_mismatch', 'prev_hash_mismatch', 'gap']).nullable(),
})

export const adminInstanceSchema = z.object({
  isDemo: z.boolean(),
  registrationOpen: z.boolean(),
  userCount: z.number().int(),
})

export const readyzSchema = z.object({
  db: z.boolean(),
  valkey: z.boolean(),
  migrations: z.boolean(),
})
