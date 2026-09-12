// Zod schemas for the Telegram Mini App routes (MODULE-GUIDE.md "API modules": "validate every
// body/params/query with Zod"; v1.1 SPEC §9). The response shapes are re-declared as TypeScript
// types in `packages/contracts/src/miniapp.ts` so the Mini App client parses exactly what the server
// promises, the same way every other screen in this product does.
import { z } from 'zod'

export const miniappIdentitySchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    givenName: z.string(),
    familyName: z.string(),
    patronymic: z.string().nullable(),
    title: z.string().nullable(),
    locale: z.string(),
    avatarKey: z.string().nullable(),
  }),
  department: z
    .object({ id: z.string().uuid(), name: z.string() })
    .nullable(),
  /** The role **inside the active department** (I-8b: never `Actor.role`). */
  departmentRole: z.enum(['head', 'member']).nullable(),
  botUsername: z.string().nullable(),
  telegramLinked: z.boolean(),
  /** How this request was authenticated: a verified Telegram `initData`, or an ordinary web session
   * cookie (the documented local-development path -- see `miniapp.ts`'s header). */
  source: z.enum(['telegram', 'web_session']),
  /** `?startapp=<value>`, so the bot's buttons can open a specific screen. */
  startParam: z.string().nullable(),
  unreadCount: z.number().int(),
  /** SPEC §5's `fields` module is optional until its own package merges; the Mini App hides the
   * "Maydonlar" tab when this is false rather than showing a broken screen. */
  fieldsAvailable: z.boolean(),
})
export type MiniappIdentity = z.infer<typeof miniappIdentitySchema>

export const miniappSessionSchema = miniappIdentitySchema.extend({
  /** Echoed back on every state-changing request as `X-CSRF-Token` (the same double-submit pattern
   * `lib/csrf.ts` documents), so the Mini App never has to read `document.cookie`. */
  csrfToken: z.string(),
})

export const miniCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(['active', 'done', 'archived']),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  risk: z.enum(['none', 'at_risk', 'overdue']),
  dueAt: z.string().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  giverUserId: z.string().uuid().nullable(),
  projectTitle: z.string().nullable(),
  checklistTotal: z.number().int(),
  checklistDone: z.number().int(),
  commentCount: z.number().int(),
  canEdit: z.boolean(),
  version: z.number().int(),
})

export const miniPersonSchema = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  title: z.string().nullable(),
  unitName: z.string().nullable(),
  role: z.enum(['head', 'member']),
  openCards: z.number().int(),
  overdueCards: z.number().int(),
  doneLast7d: z.number().int(),
})

export const boardPeekSchema = z.object({
  mine: z.array(miniCardSchema),
  team: z.array(miniPersonSchema),
  departmentOpenCards: z.number().int(),
  departmentOverdueCards: z.number().int(),
})

/** `FieldValue` from `@devon/contracts` -- declared as a real union rather than `z.unknown()` so the
 * response serializer keeps the value instead of stripping an untyped key. */
export const fieldValueSchema = z.union([
  z.string().max(2000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
])

export const miniFieldSchema = z.object({
  defId: z.string(),
  key: z.string(),
  label: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()).nullable(),
  type: z.string(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.record(z.string(), z.string()),
      colorToken: z.string(),
    }),
  ),
  required: z.boolean(),
  selfEditable: z.boolean(),
  value: fieldValueSchema,
  requested: z.boolean(),
})

export const miniFieldsSchema = z.object({
  available: z.boolean(),
  items: z.array(miniFieldSchema),
})

export const setFieldBodySchema = z
  .object({
    // A custom field's value is `string | number | boolean | string[] | null` (contracts'
    // `FieldValue`); anything else is refused here rather than written into a jsonb column.
    value: fieldValueSchema,
  })
  .strict()

export const focusAlertBodySchema = z
  .object({
    kind: z.enum(['focus', 'short_break', 'long_break']),
    minutes: z.number().int().min(1).max(240),
  })
  .strict()

export const focusAlertResultSchema = z.object({
  sent: z.boolean(),
  reason: z.enum(['ok', 'not_linked', 'not_configured', 'muted', 'failed']),
})

export const setupChecklistSchema = z.object({
  botConfigured: z.boolean(),
  botUsername: z.string().nullable(),
  miniappUrl: z.string(),
  memberCount: z.number().int(),
  linkedMemberCount: z.number().int(),
  groupCount: z.number().int(),
  steps: z.array(
    z.object({
      id: z.enum([
        'bot_token',
        'bot_username',
        'menu_button',
        'link_self',
        'members_linked',
        'group_connected',
      ]),
      done: z.boolean(),
      /** Rendered as "3 / 12" next to the step when present. */
      progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
    }),
  ),
})
