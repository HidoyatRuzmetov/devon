// Zod schemas for the telegram module's own routes (MODULE-GUIDE.md "API modules").
import { z } from 'zod'

export const GROUP_KINDS = [
  'events',
  'polls',
  'announcements',
  'weekly_summary',
  'deadlines',
] as const
export type GroupKind = (typeof GROUP_KINDS)[number]
export const groupKindSchema = z.enum(GROUP_KINDS)

export const linkStatusSchema = z.object({
  linked: z.boolean(),
  linkedAt: z.string().datetime().nullable(),
  mutedUntil: z.string().datetime().nullable(),
  botUsername: z.string().nullable(),
  configured: z.boolean(),
  available: z.boolean(),
  canConnectGroup: z.boolean(),
})

export const linkCodeSchema = z.object({
  code: z.string(),
  deepLink: z.string().nullable(),
  expiresAt: z.string().datetime(),
  qrDataUrl: z.string().nullable(),
})

export const muteBodySchema = z
  .object({
    minutes: z
      .number()
      .int()
      .min(0)
      .max(60 * 24 * 30),
  })
  .strict()

export const groupSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string(),
  title: z.string().nullable(),
  kinds: z.array(groupKindSchema),
  connectedAt: z.string().datetime(),
})
export const groupListSchema = z.object({ items: z.array(groupSchema) })

export const groupConnectCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.string().datetime(),
})

export const putGroupKindsSchema = z
  .object({ kinds: z.array(groupKindSchema).max(GROUP_KINDS.length) })
  .strict()

export const webhookParamsSchema = z.object({ secret: z.string().min(1) })
