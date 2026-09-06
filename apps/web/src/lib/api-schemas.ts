// Response shapes for the endpoints this item's shell calls (design.md §1.7). `@devon/contracts`
// deliberately carries no DTO schemas in this epic (design.md §1.1/§1.2: it ships only `can()`, the
// RFC 9457 `Problem` shape, and the field-tier vocabulary -- see `packages/contracts/src/index.ts`),
// so `apps/api/src/schemas.ts` is these endpoints' only other Zod definition, and it is not a
// package apps/web may import from (a different app, no `exports` map, and outside this item's
// DOES NOT: "does not modify packages/contracts"). These schemas are this item's own copy of the
// documented OpenAPI shape (design.md §1.7), validated at the fetch boundary so a response is never
// trusted as `any` -- never hand-written past what `zod` derives.
import { z } from 'zod'
import { problemSchema } from '@devon/contracts'
import { localeSchema } from '@devon/i18n'

export { problemSchema }
export type { Problem } from '@devon/contracts'

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
  id: z.string(),
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
export type PublicUser = z.infer<typeof publicUserSchema>

export const meSchema = z.object({
  user: publicUserSchema,
  memberships: z.array(
    z.object({ departmentId: z.string(), name: z.string(), role: z.enum(['head', 'member']) }),
  ),
  membershipCount: z.number().int(),
  activeDepartmentId: z.string().nullable(),
  actingForUserId: z.string().nullable(),
  instance: z.object({ isDemo: z.boolean(), maintenance: z.boolean() }),
  csrfToken: z.string(),
})
export type Me = z.infer<typeof meSchema>

export const setupResultSchema = z.object({ user: publicUserSchema })

export const readyzSchema = z.object({
  db: z.boolean(),
  valkey: z.boolean(),
  migrations: z.boolean(),
})
export type Readyz = z.infer<typeof readyzSchema>

export const adminInstanceSchema = z.object({
  isDemo: z.boolean(),
  registrationOpen: z.boolean(),
  userCount: z.number().int(),
})
export type AdminInstance = z.infer<typeof adminInstanceSchema>
