// Zod for the calendar module (MODULE-GUIDE.md "API modules").
import { z } from 'zod'

export const feedKindSchema = z.enum(['all', 'events', 'tasks'])
export const localeSchema = z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en'])

export const feedSchema = z.object({
  id: z.string(),
  kind: feedKindSchema,
  label: z.string(),
  /** The full subscription URL, relative to this deployment's own origin. The secret is part of it:
   * this is the one response that carries it, it goes only to the person it belongs to, and the
   * screen that shows it says out loud that anyone holding the link can read the calendar. */
  url: z.string(),
  webcalUrl: z.string(),
  caldavUrl: z.string(),
  createdAt: z.string(),
  rotatedAt: z.string().nullable(),
  lastAccessedAt: z.string().nullable(),
  accessCount: z.number().int(),
})

export const feedListSchema = z.object({ items: z.array(feedSchema) })

export const createFeedBodySchema = z.object({
  kind: feedKindSchema.default('all'),
  label: z.string().trim().max(60).default(''),
})

export const icsQuerySchema = z.object({
  locale: localeSchema.optional(),
  /** Minutes before an item to place a `VALARM`; `0` means none. Kept in the URL so a person can
   * subscribe twice -- once with alarms on the phone, once silent on the desktop. */
  alarm: z.coerce.number().int().min(0).max(1440).optional(),
})

export const agendaQuerySchema = z.object({
  /** How far ahead to look. Bounded so "my calendar" can never become an unbounded scan. */
  days: z.coerce.number().int().min(1).max(120).default(30),
})

export const agendaSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['event', 'card']),
      title: z.string(),
      place: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      deepLink: z.string(),
      status: z.string(),
    }),
  ),
})

export const addToCalendarQuerySchema = z.object({
  eventId: z.string().uuid(),
  locale: localeSchema.optional(),
})

export const addToCalendarSchema = z.object({
  google: z.string(),
  outlook: z.string(),
  office365: z.string(),
  yahoo: z.string(),
  /** Same-origin `.ics` download for Apple Calendar and everything else. */
  ics: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
})
