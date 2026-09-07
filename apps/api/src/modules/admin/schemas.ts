// Zod schemas for `/api/v1/admin/*`'s own routes (MODULE-GUIDE.md: modules keep their route schemas
// in their own file; `../../schemas.js` is only the two the foundation already shared this module,
// `adminInstanceSchema`/`chainVerificationSchema`, left untouched).
import { z } from 'zod'
import { localeSchema } from '../../schemas.js'

export const departmentIdParamsSchema = z.object({ id: z.string().uuid() }).strict()
export const userIdParamsSchema = z.object({ id: z.string().uuid() }).strict()

const departmentStatusSchema = z.enum([
  'active',
  'paused_by_admin',
  'deletion_requested',
  'archived',
])

export const adminDepartmentListQuerySchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    status: departmentStatusSchema.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

export const adminDepartmentRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  status: departmentStatusSchema,
  memberCount: z.number().int(),
  headName: z.string().nullable(),
  createdAt: z.string(),
})
export const adminDepartmentListSchema = z.object({
  departments: z.array(adminDepartmentRowSchema),
  nextCursor: z.string().nullable(),
})

export const adminDepartmentDetailSchema = adminDepartmentRowSchema.extend({
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  localeDefault: localeSchema,
})

export const pauseDepartmentBodySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict()

const userStatusSchema = z.enum(['active', 'locked', 'deleted'])
const userRoleSchema = z.enum(['super_admin', 'head', 'member'])

export const adminUserListQuerySchema = z
  .object({
    query: z.string().trim().max(200).optional(),
    status: userStatusSchema.optional(),
    role: userRoleSchema.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()

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
export const adminUserListSchema = z.object({
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

export const lockUserBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict()

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

export const auditEventQuerySchema = z
  .object({
    action: z.string().trim().max(100).optional(),
    actorUserId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    cursor: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()

export const auditEventRowSchema = z.object({
  seq: z.number().int(),
  id: z.string().uuid(),
  at: z.string(),
  actorUserId: z.string().uuid().nullable(),
  actorRole: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
})
export const auditEventListSchema = z.object({
  events: z.array(auditEventRowSchema),
  nextCursor: z.number().int().nullable(),
})

export const chainVerificationDetailSchema = z.object({
  ok: z.boolean(),
  rows: z.number().int(),
  firstBadSeq: z.number().int().nullable(),
  failure: z.enum(['row_hash_mismatch', 'prev_hash_mismatch']).nullable(),
})

// Structured rather than a pre-built English sentence (round2 SEV1: "0 pending event(s)" rendered
// verbatim in the uz/ru console, "(s)" plural and all) -- the web layer looks `code` up as
// `admin.console.health.detail.<code>` and interpolates `params` itself, so every locale controls its
// own wording (and its own pluralisation) instead of inheriting whatever the server happened to build.
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

export const maintenanceMessageSchema = z.record(localeSchema, z.string().max(2000))
export const maintenanceStateSchema = z.object({
  enabled: z.boolean(),
  message: maintenanceMessageSchema.nullable(),
})
export const patchMaintenanceBodySchema = z
  .object({ enabled: z.boolean(), message: maintenanceMessageSchema.nullable() })
  .strict()

export const patchRegistrationBodySchema = z.object({ open: z.boolean() }).strict()

export const sentinelStatusSchema = z.object({
  hasActiveKey: z.boolean(),
  publicKeyB64: z.string().nullable(),
  createdAt: z.string().nullable(),
})
export const sentinelKeyResultSchema = z.object({ publicKeyB64: z.string() })

export const startWipeBodySchema = z
  .object({
    phrase: z.string().trim().min(1),
    password: z.string().min(1),
    totpCode: z.string().trim().max(10).optional(),
  })
  .strict()

export const wipeStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['countdown', 'cancelled', 'executing', 'completed', 'failed']),
    countdownEndsAt: z.string(),
    phrase: z.string(),
    failureReason: z.string().nullable(),
  })
  .nullable()

export const wipeStartResultSchema = z.object({
  id: z.string().uuid(),
  countdownEndsAt: z.string(),
  countdownSeconds: z.number().int(),
})
