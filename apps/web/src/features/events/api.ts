// Typed endpoint functions for the events feature, built on `apiClient` (MODULE-GUIDE.md "Web
// features"). Every path matches `apps/api/src/modules/events/index.ts` exactly.
import { apiClient } from '../../lib/api-client.js'
import {
  carpoolDto,
  carpoolListSchema,
  commentDto,
  commentListSchema,
  eventListSchema,
  eventSchema,
  feedbackListSchema,
  icsResultSchema,
  itemDto,
  itemListSchema,
  pollDto,
  pollListSchema,
  photoDto,
  photoListSchema,
  rsvpListSchema,
  voidSchema,
  type CarpoolDto,
  type CommentDto,
  type EventDto,
  type ItemDto,
  type PhotoDto,
  type PollDto,
} from './schemas.js'

const BASE = '/api/v1/events'

export type EventRange = { from?: Date | undefined; to?: Date | undefined }

export function fetchEvents(range: EventRange = {}) {
  const params = new URLSearchParams()
  if (range.from) params.set('from', range.from.toISOString())
  if (range.to) params.set('to', range.to.toISOString())
  const qs = params.toString()
  return apiClient.get(`${BASE}${qs ? `?${qs}` : ''}`, eventListSchema)
}

export function fetchEvent(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}`, eventSchema)
}

export type CreateEventInput = {
  title: string
  description?: string | undefined
  category: string
  illustrationKey?: string | undefined
  startsAt: string
  endsAt: string
  place?: string | undefined
  placeUrl?: string | undefined
  capacity?: number | undefined
  waitlistEnabled?: boolean | undefined
  rsvpDeadline?: string | undefined
  costNote?: string | undefined
  reminderOffsetsMinutes?: number[] | undefined
}

export function createEvent(input: CreateEventInput, csrfToken: string) {
  return apiClient.post(BASE, input, eventSchema, csrfToken)
}

/** Unlike `CreateEventInput`, the API's `PATCH` body treats these fields as tri-state (server
 * `updateEventBodySchema`, apps/api/src/modules/events/schemas.ts): omitted means "leave as is",
 * `null` means "clear it". `Partial<CreateEventInput>` would only ever let a caller omit a field,
 * never explicitly clear one (e.g. removing a capacity limit or a place link on edit). */
export type UpdateEventInput = {
  title?: string | undefined
  description?: string | null | undefined
  category?: string | undefined
  illustrationKey?: string | undefined
  startsAt?: string | undefined
  endsAt?: string | undefined
  place?: string | null | undefined
  placeUrl?: string | null | undefined
  capacity?: number | null | undefined
  waitlistEnabled?: boolean | undefined
  rsvpDeadline?: string | null | undefined
  costNote?: string | null | undefined
  reminderOffsetsMinutes?: number[] | undefined
}

export function updateEvent(eventId: string, input: UpdateEventInput, csrfToken: string) {
  return apiClient.patch(`${BASE}/${eventId}`, input, eventSchema, csrfToken)
}

export function cancelEvent(eventId: string, reason: string, csrfToken: string) {
  return apiClient.post(`${BASE}/${eventId}/cancel`, { reason }, eventSchema, csrfToken)
}

export function submitRsvp(
  eventId: string,
  input: { status: string; guests: number; note?: string | undefined },
  csrfToken: string,
): Promise<EventDto> {
  return apiClient.post(`${BASE}/${eventId}/rsvp`, input, eventSchema, csrfToken)
}

export function fetchRsvps(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/rsvps`, rsvpListSchema)
}

export function fetchComments(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/comments`, commentListSchema)
}

export function addComment(eventId: string, body: string, csrfToken: string): Promise<CommentDto> {
  return apiClient.post(`${BASE}/${eventId}/comments`, { body }, commentDto, csrfToken)
}

export function deleteComment(eventId: string, commentId: string, csrfToken: string) {
  return apiClient.delete(`${BASE}/${eventId}/comments/${commentId}`, voidSchema, csrfToken)
}

export function fetchCarpools(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/carpools`, carpoolListSchema)
}

export type CarpoolInput = {
  seats: number
  departurePlace?: string | undefined
  departureAt?: string | undefined
  note?: string | undefined
}

export function createCarpool(
  eventId: string,
  input: CarpoolInput,
  csrfToken: string,
): Promise<CarpoolDto> {
  return apiClient.post(`${BASE}/${eventId}/carpools`, input, carpoolDto, csrfToken)
}

export function claimCarpoolSeat(
  eventId: string,
  carpoolId: string,
  seats: number,
  csrfToken: string,
) {
  return apiClient.post(
    `${BASE}/${eventId}/carpools/${carpoolId}/claim`,
    { seats },
    voidSchema,
    csrfToken,
  )
}

export function releaseCarpoolSeat(eventId: string, carpoolId: string, csrfToken: string) {
  return apiClient.delete(`${BASE}/${eventId}/carpools/${carpoolId}/claim`, voidSchema, csrfToken)
}

export function fetchItems(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/items`, itemListSchema)
}

export function addItem(
  eventId: string,
  input: { label: string; quantity: number },
  csrfToken: string,
): Promise<ItemDto> {
  return apiClient.post(`${BASE}/${eventId}/items`, input, itemDto, csrfToken)
}

export function claimItem(eventId: string, itemId: string, csrfToken: string) {
  return apiClient.post(`${BASE}/${eventId}/items/${itemId}/claim`, {}, voidSchema, csrfToken)
}

export function releaseItem(eventId: string, itemId: string, csrfToken: string) {
  return apiClient.delete(`${BASE}/${eventId}/items/${itemId}/claim`, voidSchema, csrfToken)
}

export function fetchPolls(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/polls`, pollListSchema)
}

export type PollInput = {
  kind: string
  question: string
  anonymous: boolean
  closesAt?: string | undefined
  options: Array<{ label: string; optionDate?: string | undefined }>
}

export function createPoll(eventId: string, input: PollInput, csrfToken: string): Promise<PollDto> {
  return apiClient.post(`${BASE}/${eventId}/polls`, input, pollDto, csrfToken)
}

export function voteOnPoll(
  eventId: string,
  pollId: string,
  optionIds: string[],
  csrfToken: string,
): Promise<PollDto> {
  return apiClient.post(
    `${BASE}/${eventId}/polls/${pollId}/vote`,
    { optionIds },
    pollDto,
    csrfToken,
  )
}

export function fetchPhotos(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/photos`, photoListSchema)
}

export function addPhoto(
  eventId: string,
  input: { url: string; caption?: string | undefined },
  csrfToken: string,
): Promise<PhotoDto> {
  return apiClient.post(`${BASE}/${eventId}/photos`, input, photoDto, csrfToken)
}

export function deletePhoto(eventId: string, photoId: string, csrfToken: string) {
  return apiClient.delete(`${BASE}/${eventId}/photos/${photoId}`, voidSchema, csrfToken)
}

export function fetchFeedback(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/feedback`, feedbackListSchema)
}

export function submitFeedback(
  eventId: string,
  input: { rating: number; comment?: string | undefined; anonymous: boolean },
  csrfToken: string,
) {
  return apiClient.post(`${BASE}/${eventId}/feedback`, input, voidSchema, csrfToken)
}

export function fetchEventIcs(eventId: string) {
  return apiClient.get(`${BASE}/${eventId}/ics`, icsResultSchema)
}

export function fetchMyIcs() {
  return apiClient.get(`${BASE}/ics/me`, icsResultSchema)
}
