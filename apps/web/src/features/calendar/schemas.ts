// Zod mirrors of the calendar/push responses (MODULE-GUIDE.md "Web features": the client validates
// what it receives, it does not trust it). Every shape here matches
// `apps/api/src/modules/calendar/schemas.ts` and the push shapes in
// `apps/api/src/modules/realtime/schemas.ts` exactly.
import { z } from 'zod'

export const feedKindSchema = z.enum(['all', 'events', 'tasks'])
export type FeedKind = z.infer<typeof feedKindSchema>

export const feedSchema = z.object({
  id: z.string(),
  kind: feedKindSchema,
  label: z.string(),
  url: z.string(),
  webcalUrl: z.string(),
  caldavUrl: z.string(),
  createdAt: z.string(),
  rotatedAt: z.string().nullable(),
  lastAccessedAt: z.string().nullable(),
  accessCount: z.number().int(),
})
export type FeedDto = z.infer<typeof feedSchema>

export const feedListSchema = z.object({ items: z.array(feedSchema) })

export const agendaItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['event', 'card']),
  title: z.string(),
  place: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  deepLink: z.string(),
  status: z.string(),
})
export type AgendaItem = z.infer<typeof agendaItemSchema>

export const agendaSchema = z.object({ items: z.array(agendaItemSchema) })

export const addToCalendarSchema = z.object({
  google: z.string(),
  outlook: z.string(),
  office365: z.string(),
  yahoo: z.string(),
  ics: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
})
export type AddToCalendarLinks = z.infer<typeof addToCalendarSchema>

export const pushKeySchema = z.object({ enabled: z.boolean(), publicKey: z.string() })
export type PushKey = z.infer<typeof pushKeySchema>

export const pushSubscriptionListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      browserLabel: z.string(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
    }),
  ),
})
export type PushDevice = z.infer<typeof pushSubscriptionListSchema>['items'][number]
