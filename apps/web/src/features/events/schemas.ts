// Response/request shapes for the events feature (MODULE-GUIDE.md "Web features": "Build your
// feature's own endpoint functions on this [apiClient], the same way every function in
// api-client.ts already does"). Mirrors `apps/api/src/modules/events/schemas.ts` structurally --
// the two packages share no types (web and api are separate deployables), so this is the
// intentional, small duplication every feature's own `api.ts` carries.
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
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

export const EVENT_STATUSES = ['draft', 'open', 'full', 'cancelled', 'done'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const RSVP_STATUSES = ['yes', 'no', 'maybe', 'waitlist'] as const
export type RsvpStatus = (typeof RSVP_STATUSES)[number]

export const POLL_KINDS = ['date', 'single', 'multi'] as const
export type PollKind = (typeof POLL_KINDS)[number]

const summaryUser = z.object({ id: z.string(), givenName: z.string(), familyName: z.string() })
export type SummaryUser = z.infer<typeof summaryUser>

const eventChange = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
})
export type EventChange = z.infer<typeof eventChange>

export const eventSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.enum(EVENT_CATEGORIES),
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
  status: z.enum(EVENT_STATUSES),
  updatedSummary: z.array(eventChange).nullable(),
  cancelledAt: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  goingCount: z.number().int(),
  maybeCount: z.number().int(),
  waitlistCount: z.number().int(),
  myRsvp: z
    .object({
      status: z.enum(RSVP_STATUSES),
      guests: z.number().int(),
      note: z.string().nullable(),
    })
    .nullable(),
  canManage: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
})
export type EventDto = z.infer<typeof eventSchema>
export const eventListSchema = z.object({ items: z.array(eventSchema) })

export const rsvpDto = z.object({
  userId: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  status: z.enum(RSVP_STATUSES),
  guests: z.number().int(),
  note: z.string().nullable(),
  changedAt: z.string(),
})
export type RsvpDto = z.infer<typeof rsvpDto>
export const rsvpListSchema = z.object({ items: z.array(rsvpDto) })

export const commentDto = z.object({
  id: z.string(),
  author: summaryUser,
  body: z.string(),
  createdAt: z.string(),
  canDelete: z.boolean(),
})
export type CommentDto = z.infer<typeof commentDto>
export const commentListSchema = z.object({ items: z.array(commentDto) })

export const carpoolSeatDto = z.object({
  userId: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  seatsClaimed: z.number().int(),
  status: z.enum(['confirmed', 'waitlist']),
})
export const carpoolDto = z.object({
  id: z.string(),
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
export const carpoolListSchema = z.object({ items: z.array(carpoolDto) })

export const itemDto = z.object({
  id: z.string(),
  label: z.string(),
  quantity: z.number().int(),
  claimedBy: summaryUser.nullable(),
  claimedByMe: z.boolean(),
})
export type ItemDto = z.infer<typeof itemDto>
export const itemListSchema = z.object({ items: z.array(itemDto) })

export const pollOptionResultDto = z.object({
  id: z.string(),
  label: z.string(),
  optionDate: z.string().nullable(),
  votes: z.number().int(),
  votedByMe: z.boolean(),
})
export const pollDto = z.object({
  id: z.string(),
  kind: z.enum(POLL_KINDS),
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
export const pollListSchema = z.object({ items: z.array(pollDto) })

export const photoDto = z.object({
  id: z.string(),
  url: z.string(),
  caption: z.string().nullable(),
  addedBy: summaryUser,
  createdAt: z.string(),
  canDelete: z.boolean(),
})
export type PhotoDto = z.infer<typeof photoDto>
export const photoListSchema = z.object({ items: z.array(photoDto) })

export const feedbackDto = z.object({
  id: z.string(),
  author: summaryUser.nullable(),
  rating: z.number().int(),
  comment: z.string().nullable(),
  createdAt: z.string(),
})
export type FeedbackDto = z.infer<typeof feedbackDto>
export const feedbackListSchema = z.object({
  items: z.array(feedbackDto),
  averageRating: z.number().nullable(),
  myFeedback: feedbackDto.nullable(),
})

export const icsResultSchema = z.object({ filename: z.string(), content: z.string() })

/** Every `204 No Content` response (`apiClient`'s `post`/`patch`/`delete` short-circuit before ever
 * calling `.parse()` on a 204) -- named here so every such call site reads the same way `login`/
 * `logout` already do in `lib/api-client.ts`. */
export const voidSchema = z.void()
