// Zod schemas for the notifications module's own routes (MODULE-GUIDE.md "API modules": "validate
// every body/params/query with Zod"). `LOCALES`/`localeSchema` are reused from the core
// `apps/api/src/schemas.ts` (an intra-package read, never an edit to that file) so this module's
// locale list can never drift from the rest of the API.
import { z } from 'zod'
import { localeSchema } from '../../schemas.js'

export const REASONS = [
  'assigned',
  'mentioned',
  'due',
  'updated',
  'rsvp',
  'poll',
  'decision',
  'digest',
  'system',
  /** v1.1 SPEC §5: the boshqarma boshligʻi asked this person to fill in a custom field. Its own
   * reason rather than `system` so a person can mute or route it separately, and so the Telegram
   * message can carry a "Toʻldirish" button instead of the generic "Ochish". */
  'field_request',
] as const
export type Reason = (typeof REASONS)[number]
export const reasonSchema = z.enum(REASONS)

export const CHANNELS = ['inapp', 'telegram', 'email'] as const
export type Channel = (typeof CHANNELS)[number]
export const channelSchema = z.enum(CHANNELS)

export const DIGEST_MODES = ['instant', 'daily', 'weekly', 'off'] as const
export type DigestMode = (typeof DIGEST_MODES)[number]
export const digestModeSchema = z.enum(DIGEST_MODES)

export const localizedTextSchema = z.object({
  'uz-Latn': z.string().min(1).max(2000),
  'uz-Cyrl': z.string().min(1).max(2000),
  ru: z.string().min(1).max(2000),
  en: z.string().min(1).max(2000),
})
export type LocalizedText = z.infer<typeof localizedTextSchema>

export const notificationSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  reason: reasonSchema,
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  title: localizedTextSchema,
  body: localizedTextSchema.nullable(),
  deepLink: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
  snoozedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type NotificationDto = z.infer<typeof notificationSchema>

export const notificationListSchema = z.object({
  items: z.array(notificationSchema).max(200),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
})

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z.enum(['inbox', 'archived', 'unread']).default('inbox'),
  reason: reasonSchema.optional(),
})

export const markManySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict()

export const snoozeBodySchema = z
  .object({
    minutes: z
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 14),
  })
  .strict()

export const prefRowSchema = z.object({
  reason: reasonSchema,
  channel: channelSchema,
  enabled: z.boolean(),
  digestMode: digestModeSchema,
})
export const prefsSchema = z.object({ items: z.array(prefRowSchema) })
export type PrefsDto = z.infer<typeof prefsSchema>

export const putPrefsSchema = z
  .object({
    items: z
      .array(
        prefRowSchema
          .omit({ digestMode: true })
          .extend({ digestMode: digestModeSchema.optional() })
          .superRefine((pref, ctx) => {
            // Email has no delivery adapter. Keep historical rows for a future adapter, but do
            // not accept a setting that cannot take effect. The in-app inbox is always available.
            if (pref.channel === 'email')
              ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Channel unavailable' })
            if (
              pref.channel === 'inapp' &&
              (!pref.enabled || (pref.digestMode && pref.digestMode !== 'instant'))
            )
              ctx.addIssue({
                code: 'custom',
                path: ['enabled'],
                message: 'Inbox is always enabled',
              })
            if (
              pref.channel === 'telegram' &&
              pref.digestMode &&
              (pref.reason === 'digest'
                ? !['daily', 'weekly', 'off'].includes(pref.digestMode)
                : pref.digestMode !== 'instant')
            )
              ctx.addIssue({
                code: 'custom',
                path: ['digestMode'],
                message: 'Unsupported delivery frequency',
              })
          }),
      )
      .min(1)
      .max(64),
  })
  .strict()

export const quietHoursSchema = z.object({
  startMinute: z.number().int().min(0).max(1439).nullable(),
  endMinute: z.number().int().min(0).max(1439).nullable(),
  includeWeekends: z.boolean().nullable(),
  effective: z.object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
    includeWeekends: z.boolean(),
    source: z.enum(['personal', 'department_default']),
  }),
})
export type QuietHoursDto = z.infer<typeof quietHoursSchema>

export const putQuietHoursSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(0).max(1439).nullable(),
    includeWeekends: z.boolean().nullable(),
  })
  .strict()

export const departmentSettingsSchema = z.object({
  departmentId: z.string().uuid(),
  quietStartMinute: z.number().int().min(0).max(1439),
  quietEndMinute: z.number().int().min(0).max(1439),
  quietWeekends: z.boolean(),
  groupConnectHeadOnly: z.boolean(),
})
export type DepartmentSettingsDto = z.infer<typeof departmentSettingsSchema>

export const putDepartmentSettingsSchema = z
  .object({
    quietStartMinute: z.number().int().min(0).max(1439).optional(),
    quietEndMinute: z.number().int().min(0).max(1439).optional(),
    quietWeekends: z.boolean().optional(),
    groupConnectHeadOnly: z.boolean().optional(),
  })
  .strict()

export const icsTokenParamsSchema = z.object({ token: z.string().min(16).max(200) })

export { localeSchema }
