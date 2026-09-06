// Zod schemas for the events module (TECH-SPEC §3.4, §4). Kept inside the module's own folder --
// never added to `apps/api/src/schemas.ts` (MODULE-GUIDE.md: a module never edits a file another
// module also touches) -- and imported only by this module's own `index.ts`/`service.ts`.
import { z } from 'zod'

export const EVENT_CATEGORIES = [
  'team_building',
  'sports',
  'volunteering',
  'social',
  'training',
  'family',
  'other',
] as const
export const eventCategorySchema = z.enum(EVENT_CATEGORIES)
export type EventCategory = z.infer<typeof eventCategorySchema>

export const EVENT_STATUSES = ['draft', 'open', 'full', 'cancelled', 'done'] as const
export const eventStatusSchema = z.enum(EVENT_STATUSES)

export const RSVP_STATUSES = ['yes', 'no', 'maybe', 'waitlist'] as const
export const rsvpStatusSchema = z.enum(RSVP_STATUSES)

export const POLL_KINDS = ['date', 'single', 'multi'] as const
export const pollKindSchema = z.enum(POLL_KINDS)

/** Accepts any string `Date.parse` can read (ISO 8601 with offset, per every client in this
 * codebase) -- kept as a plain refinement rather than `z.string().datetime()` so a `+05:00` offset
 * (Asia/Tashkent, never UTC `Z`, in every user-facing timestamp -- TECH-SPEC §16) is never rejected. */
export const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'invalid_datetime' })

const summaryUser = z.object({
  id: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
})

/** One field an organiser's edit changed (`service.ts`'s `diffEvent`). Stored as JSON text in
 * `events.updated_summary` and re-parsed on read -- kept structured, never a pre-rendered English
 * sentence, so the frontend can localise field names and format dates/numbers per the viewer's own
 * locale (TECH-SPEC §16: every string through i18n). `field` is one of `eventSchema`'s own keys; the
 * web feature maps it to `t('events.diff.field.<field>')`. */
export const eventChangeSchema = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
})
export type EventChange = z.infer<typeof eventChangeSchema>

export const eventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: eventCategorySchema,
  illustrationKey: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  place: z.string().nullable(),
  placeUrl: z.string().nullable(),
  capacity: z.number().int().nullable(),
  waitlistEnabled: z.boolean(),
  rsvpDeadline: z.string().nullable(),
  costNote: z.string().nullable(),
  reminderOffsetsMinutes: z.array(z.number().int()),
  organizer: summaryUser,
  status: eventStatusSchema,
  updatedSummary: z.array(eventChangeSchema).nullable(),
  cancelledAt: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  goingCount: z.number().int(),
  maybeCount: z.number().int(),
  waitlistCount: z.number().int(),
  myRsvp: z
    .object({ status: rsvpStatusSchema, guests: z.number().int(), note: z.string().nullable() })
    .nullable(),
  canManage: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type EventDto = z.infer<typeof eventSchema>

export const eventListResponseSchema = z.object({ items: z.array(eventSchema) })

export const createEventBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).optional(),
    category: eventCategorySchema.default('other'),
    illustrationKey: z.string().max(64).default('team_building'),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    timezone: z.string().max(64).default('Asia/Tashkent'),
    place: z.string().max(300).optional(),
    placeUrl: z.string().url().max(2000).optional(),
    capacity: z.number().int().min(1).max(100000).optional(),
    waitlistEnabled: z.boolean().default(true),
    rsvpDeadline: isoDateTime.optional(),
    costNote: z.string().max(500).optional(),
    reminderOffsetsMinutes: z.array(z.number().int().min(1)).max(5).default([1440, 60]),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'ends_before_starts',
    path: ['endsAt'],
  })
export type CreateEventBody = z.infer<typeof createEventBodySchema>

export const updateEventBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    category: eventCategorySchema.optional(),
    illustrationKey: z.string().max(64).optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    timezone: z.string().max(64).optional(),
    place: z.string().max(300).nullable().optional(),
    placeUrl: z.string().url().max(2000).nullable().optional(),
    capacity: z.number().int().min(1).max(100000).nullable().optional(),
    waitlistEnabled: z.boolean().optional(),
    rsvpDeadline: isoDateTime.nullable().optional(),
    costNote: z.string().max(500).nullable().optional(),
    reminderOffsetsMinutes: z.array(z.number().int().min(1)).max(5).optional(),
  })
  .strict()
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>

export const cancelEventBodySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict()

export const rsvpBodySchema = z
  .object({
    status: rsvpStatusSchema,
    guests: z.number().int().min(0).max(20).default(0),
    note: z.string().max(500).optional(),
  })
  .strict()
export type RsvpBody = z.infer<typeof rsvpBodySchema>

export const rsvpDto = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  status: rsvpStatusSchema,
  guests: z.number().int(),
  note: z.string().nullable(),
  changedAt: z.string(),
})
export type RsvpDto = z.infer<typeof rsvpDto>
export const rsvpListResponseSchema = z.object({ items: z.array(rsvpDto) })

export const commentBodySchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict()
export const commentDto = z.object({
  id: z.string().uuid(),
  author: summaryUser,
  body: z.string(),
  createdAt: z.string(),
  canDelete: z.boolean(),
})
export type CommentDto = z.infer<typeof commentDto>
export const commentListResponseSchema = z.object({ items: z.array(commentDto) })

export const carpoolBodySchema = z
  .object({
    seats: z.number().int().min(1).max(20),
    departurePlace: z.string().max(300).optional(),
    departureAt: isoDateTime.optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
export const carpoolClaimBodySchema = z
  .object({ seats: z.number().int().min(1).max(20).default(1) })
  .strict()
export const carpoolSeatDto = z.object({
  userId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  seatsClaimed: z.number().int(),
  status: z.enum(['confirmed', 'waitlist']),
})
export type CarpoolSeatDto = z.infer<typeof carpoolSeatDto>
export const carpoolDto = z.object({
  id: z.string().uuid(),
  driver: summaryUser,
  seats: z.number().int(),
  seatsClaimed: z.number().int(),
  departurePlace: z.string().nullable(),
  departureAt: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'cancelled']),
  passengers: z.array(carpoolSeatDto),
  canManage: z.boolean(),
})
export type CarpoolDto = z.infer<typeof carpoolDto>
export const carpoolListResponseSchema = z.object({ items: z.array(carpoolDto) })

export const itemBodySchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(100).default(1),
  })
  .strict()
export const itemDto = z.object({
  id: z.string().uuid(),
  label: z.string(),
  quantity: z.number().int(),
  claimedBy: summaryUser.nullable(),
  claimedByMe: z.boolean(),
})
export type ItemDto = z.infer<typeof itemDto>
export const itemListResponseSchema = z.object({ items: z.array(itemDto) })

export const pollBodySchema = z
  .object({
    kind: pollKindSchema,
    question: z.string().trim().min(1).max(300),
    anonymous: z.boolean().default(false),
    closesAt: isoDateTime.optional(),
    options: z
      .array(
        z.object({ label: z.string().trim().min(1).max(200), optionDate: isoDateTime.optional() }),
      )
      .min(2)
      .max(10),
  })
  .strict()
  .refine((v) => v.kind !== 'date' || v.options.every((o) => o.optionDate !== undefined), {
    message: 'date_poll_requires_option_dates',
    path: ['options'],
  })
export const pollVoteBodySchema = z
  .object({ optionIds: z.array(z.string().uuid()).min(1).max(10) })
  .strict()

export const pollOptionResultDto = z.object({
  id: z.string().uuid(),
  label: z.string(),
  optionDate: z.string().nullable(),
  votes: z.number().int(),
  votedByMe: z.boolean(),
})
export type PollOptionResultDto = z.infer<typeof pollOptionResultDto>
export const pollDto = z.object({
  id: z.string().uuid(),
  kind: pollKindSchema,
  question: z.string(),
  anonymous: z.boolean(),
  closesAt: z.string().nullable(),
  status: z.enum(['open', 'closed']),
  createdBy: summaryUser,
  totalVotes: z.number().int(),
  options: z.array(pollOptionResultDto),
  canManage: z.boolean(),
})
export type PollDto = z.infer<typeof pollDto>
export const pollListResponseSchema = z.object({ items: z.array(pollDto) })

export const photoBodySchema = z
  .object({ url: z.string().url().max(2000), caption: z.string().max(300).optional() })
  .strict()
export const photoDto = z.object({
  id: z.string().uuid(),
  url: z.string(),
  caption: z.string().nullable(),
  addedBy: summaryUser,
  createdAt: z.string(),
  canDelete: z.boolean(),
})
export type PhotoDto = z.infer<typeof photoDto>
export const photoListResponseSchema = z.object({ items: z.array(photoDto) })

export const feedbackBodySchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional(),
    anonymous: z.boolean().default(false),
  })
  .strict()
export const feedbackDto = z.object({
  id: z.string().uuid(),
  author: summaryUser.nullable(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
})
export type FeedbackDto = z.infer<typeof feedbackDto>
export const feedbackListResponseSchema = z.object({
  items: z.array(feedbackDto),
  averageRating: z.number().nullable(),
  myFeedback: feedbackDto.nullable(),
})

export const icsResponseSchema = z.object({ filename: z.string(), content: z.string() })
