// Zod schemas for `/api/v1/departments/*` (EPIC-002). See `modules/accounts/schemas.ts`'s header for
// why this lives inside the module rather than the shared `apps/api/src/schemas.ts`.
import { z } from 'zod'
import { FEATURE_KEYS } from '@devon/contracts'
import { localeSchema } from '../../schemas.js'

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** SPEC §7: the Imkoniyatlar switch keys, from the one registry both sides read. */
export const featureKeySchema = z.enum(FEATURE_KEYS)

/**
 * A map of switch keys to booleans. `z.partialRecord`, not `z.record`: in zod 4 a record over an
 * enum key is **exhaustive** -- `z.record(featureKeySchema, z.boolean())` rejects `{estimates:true}`
 * with "expected boolean, received undefined" for all ten other keys. The settings screen saves one
 * switch at a time (a settings page with eleven toggles and one Save button is how people lose
 * changes), so a partial map is the normal request, not an edge case. Unknown keys and non-boolean
 * values are still rejected.
 */
export const featureFlagsSchema = z.partialRecord(featureKeySchema, z.boolean())

export const unitDraftSchema = z
  .object({
    name: z.string().min(1).max(80),
    colour: z.string().regex(HEX_COLOUR).optional(),
  })
  .strict()

export const createDepartmentRequestBodySchema = z
  .object({
    name: z.string().min(2).max(120),
    description: z.string().max(2000).optional(),
    units: z.array(unitDraftSchema).max(50).default([]),
    locale: localeSchema.default('uz-Latn'),
  })
  .strict()
export type CreateDepartmentRequestBody = z.infer<typeof createDepartmentRequestBodySchema>

export const departmentRequestViewSchema = z.object({
  id: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  requesterName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  units: z.array(unitDraftSchema),
  locale: localeSchema,
  status: z.enum(['pending', 'approved', 'rejected']),
  reason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
  createdDepartmentId: z.string().uuid().nullable(),
})
export const departmentRequestListSchema = z.object({
  requests: z.array(departmentRequestViewSchema),
})

export const rejectRequestBodySchema = z.object({ reason: z.string().min(1).max(1000) }).strict()

export const departmentSettingsSchema = z.object({
  allowSelfAssign: z.boolean(),
  allowStructureEdit: z.boolean(),
  joinRequiresApproval: z.boolean(),
  whoCanConnectTelegramGroup: z.enum(['everyone', 'head']),
  quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
  /** SPEC §7 Imkoniyatlar: every switch resolved (stored value or the registry default), so the
   * client never has to know the defaults -- `useFeature(key)` reads this map and nothing else. */
  features: featureFlagsSchema,
})

export const patchDepartmentSettingsBodySchema = z
  .object({
    allowSelfAssign: z.boolean().optional(),
    allowStructureEdit: z.boolean().optional(),
    joinRequiresApproval: z.boolean().optional(),
    whoCanConnectTelegramGroup: z.enum(['everyone', 'head']).optional(),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
    name: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    emoji: z.string().max(8).nullable().optional(),
    colour: z.string().regex(HEX_COLOUR).nullable().optional(),
    localeDefault: localeSchema.optional(),
  })
  .strict()

export const departmentDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  localeDefault: localeSchema,
  status: z.enum(['active', 'paused_by_admin', 'deletion_requested', 'archived']),
  settings: departmentSettingsSchema,
  myRole: z.enum(['head', 'member']),
  memberCount: z.number().int(),
})
export const departmentListSchema = z.object({ departments: z.array(departmentDetailSchema) })

export const inviteViewSchema = z.object({
  joinKey: z.string().nullable(),
  // round2 critique #29: the client used to build this from `window.location.origin`, which is
  // correct behaviour on the demo box but the first thing a reviewer notices as "wrong" -- the
  // server already knows its own configured public origin (`DEVON_PUBLIC_URL`, the same value
  // `print-setup-url.ts`'s setup link and the Telegram deep links use), so it builds the join URL
  // once, here, and the client never guesses at it again. `null` exactly when `joinKey` is `null`
  // (no active invite to link to).
  joinUrl: z.string().nullable(),
  joinRequiresApproval: z.boolean(),
  hasPassword: z.boolean(),
})
export const inviteSecretSchema = z.object({
  joinKey: z.string(),
  password: z.string(),
})

export const setJoinPasswordBodySchema = z.object({ password: z.string().min(8).max(128) }).strict()
export const setJoinApprovalBodySchema = z.object({ joinRequiresApproval: z.boolean() }).strict()

export const joinPreviewSchema = z.object({
  name: z.string(),
  emoji: z.string().nullable(),
  colour: z.string().nullable(),
  joinRequiresApproval: z.boolean(),
})

export const joinBodySchema = z
  .object({
    key: z.string().min(6).max(32),
    password: z.string().min(1).max(128),
  })
  .strict()
export const joinResultSchema = z.object({
  departmentId: z.string().uuid(),
  status: z.enum(['active', 'pending_approval']),
})

export const memberViewSchema = z.object({
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
export const memberListSchema = z.object({ members: z.array(memberViewSchema) })

// --- v1.1 SPEC §2.2: the join-approval queue ------------------------------------------------------

export const joinRequestViewSchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  patronymic: z.string().nullable(),
  title: z.string().nullable(),
  avatarKey: z.string().nullable(),
  requestedAt: z.string(),
})
export const joinRequestListSchema = z.object({ requests: z.array(joinRequestViewSchema) })

// --- v1.1 SPEC §7: Imkoniyatlar ------------------------------------------------------------------

export const putFeaturesBodySchema = z.object({ features: featureFlagsSchema }).strict()

// --- v1.1 SPEC §2.2: the head resets a member's password ------------------------------------------

export const resetMemberPasswordResultSchema = z.object({
  /** Shown once, to the head, so they can read it out. Never stored in plain text, never mailed. */
  temporaryPassword: z.string(),
})

export const departmentIdParamsSchema = z.object({ id: z.string().uuid() }).strict()
export const memberParamsSchema = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict()
export const requestIdParamsSchema = z.object({ id: z.string().uuid() }).strict()
export const joinKeyParamsSchema = z.object({ key: z.string().min(1).max(32) }).strict()
