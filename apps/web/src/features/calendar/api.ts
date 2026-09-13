// Typed endpoint functions for the calendar feature (MODULE-GUIDE.md "Web features"). Every path
// matches `apps/api/src/modules/calendar/index.ts` and the `/push/*` family in
// `apps/api/src/modules/realtime/index.ts` exactly.
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import {
  addToCalendarSchema,
  agendaSchema,
  feedListSchema,
  feedSchema,
  pushKeySchema,
  pushSubscriptionListSchema,
  type FeedKind,
} from './schemas.js'

const voidSchema = z.object({}).loose()

// --- feeds -----------------------------------------------------------------------------------------

export function fetchFeeds() {
  return apiClient.get('/api/v1/calendar/feeds', feedListSchema)
}

export function createFeed(input: { kind: FeedKind; label: string }, csrfToken: string) {
  return apiClient.post('/api/v1/calendar/feeds', input, feedSchema, csrfToken)
}

export function rotateFeed(id: string, csrfToken: string) {
  return apiClient.post(`/api/v1/calendar/feeds/${id}/rotate`, {}, feedSchema, csrfToken)
}

export function revokeFeed(id: string, csrfToken: string) {
  return apiClient.delete(
    `/api/v1/calendar/feeds/${id}`,
    z.object({ revoked: z.boolean() }),
    csrfToken,
  )
}

// --- agenda ----------------------------------------------------------------------------------------

export function fetchAgenda(days: number) {
  return apiClient.get(`/api/v1/calendar/agenda?days=${days}`, agendaSchema)
}

// --- add to calendar -------------------------------------------------------------------------------

export function fetchAddToCalendarLinks(eventId: string, locale: string) {
  const params = new URLSearchParams({ eventId, locale })
  return apiClient.get(`/api/v1/calendar/add-links?${params.toString()}`, addToCalendarSchema)
}

// --- web push --------------------------------------------------------------------------------------

export function fetchPushKey() {
  return apiClient.get('/api/v1/push/key', pushKeySchema)
}

export function fetchPushDevices() {
  return apiClient.get('/api/v1/push/subscriptions', pushSubscriptionListSchema)
}

export type PushSubscribeInput = {
  endpoint: string
  keys: { p256dh: string; auth: string }
  browserLabel: string
  locale: string | null
}

export function registerPushSubscription(input: PushSubscribeInput, csrfToken: string) {
  return apiClient.post(
    '/api/v1/push/subscriptions',
    input,
    z.object({ id: z.string() }),
    csrfToken,
  )
}

export function unregisterPushSubscription(endpoint: string, csrfToken: string) {
  return apiClient.post(
    '/api/v1/push/unsubscribe',
    { endpoint },
    z.object({ removed: z.boolean() }),
    csrfToken,
  )
}

export { voidSchema }
