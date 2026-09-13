// The realtime module's own endpoint functions, built on the shared `apiClient` exactly like every
// other feature's `api.ts` (MODULE-GUIDE.md "Web features"). Nothing here opens a socket; that is
// `client.ts`'s job.
import { z } from 'zod'
import { apiClient } from '../api-client.js'

export const realtimeConfigSchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  channels: z.object({
    personal: z.string(),
    department: z.string(),
    board: z.string(),
  }),
  ttlSeconds: z.number().int().positive(),
})
export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>

const tokenSchema = z.object({ token: z.string(), expiresAt: z.string() })

const presenceSchema = z.object({
  people: z.array(
    z.object({ userId: z.string(), name: z.string(), avatarKey: z.string().nullable() }),
  ),
  available: z.boolean(),
})
export type PresencePerson = z.infer<typeof presenceSchema>['people'][number]

export function fetchRealtimeConfig(): Promise<RealtimeConfig> {
  return apiClient.get('/api/v1/realtime/config', realtimeConfigSchema)
}

export function fetchConnectionToken(): Promise<string> {
  return apiClient.get('/api/v1/realtime/token', tokenSchema).then((r) => r.token)
}

export function fetchSubscriptionToken(channel: string): Promise<string> {
  return apiClient
    .post('/api/v1/realtime/subscribe-token', { channel }, tokenSchema)
    .then((r) => r.token)
}

export function fetchPresence(channel: string) {
  return apiClient.get(
    `/api/v1/realtime/presence?channel=${encodeURIComponent(channel)}`,
    presenceSchema,
  )
}

export type BoardSignalKind =
  | 'card_editing'
  | 'card_editing_stopped'
  | 'comment_typing'
  | 'card_viewing'

/** Ephemeral, fire-and-forget. The server is the publisher (it stamps the actor from the session),
 * so this is a POST rather than a client publish -- nobody can put a colleague's name on a signal. */
export function sendBoardSignal(kind: BoardSignalKind, cardId: string): Promise<unknown> {
  return apiClient.post(
    '/api/v1/realtime/signal',
    { kind, cardId },
    z.object({ delivered: z.boolean() }),
  )
}
