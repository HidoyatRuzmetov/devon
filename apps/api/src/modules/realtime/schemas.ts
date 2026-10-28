// Zod for every realtime route (MODULE-GUIDE.md "API modules": never trust `req.body` raw). Kept in
// its own file so the route file reads as routes, and so the shapes can be imported by the unit
// tests without booting Fastify.
import { z } from 'zod'

export const realtimeConfigSchema = z.object({
  /** False whenever Centrifugo is not configured or not reachable from this API. The client renders
   * its "live updates are off, refreshing every few seconds instead" state and keeps polling. */
  enabled: z.boolean(),
  /** Browser-facing WebSocket URL, or `''` when disabled. */
  url: z.string(),
  /** Channels this person may join without asking again -- their own inbox channel and their active
   * department's data channel, both already authorised while building this response. */
  channels: z.object({
    personal: z.string(),
    department: z.string(),
    board: z.string(),
  }),
  /** Seconds until the connection token must be refreshed. */
  ttlSeconds: z.number().int().positive(),
})

export const tokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
})

export const subscribeTokenBodySchema = z.object({
  channel: z.string().min(1).max(128),
})

export const presenceQuerySchema = z.object({
  channel: z.string().min(1).max(128),
})

export const presenceResponseSchema = z.object({
  /** Empty (not an error) when Centrifugo is off: "nobody else is here" and "we cannot tell" look
   * the same to a person, and the honest difference is carried by `available`. */
  people: z.array(
    z.object({
      userId: z.string(),
      name: z.string(),
      avatarKey: z.string().nullable(),
    }),
  ),
  available: z.boolean(),
})

/** Ephemeral board signals a client asks the server to fan out. The server is the only publisher, so
 * a browser cannot forge "Anvar is editing this card" for somebody else: the actor is taken from the
 * session, never from the body. */
export const signalBodySchema = z.object({
  kind: z.enum(['card_editing', 'card_editing_stopped', 'comment_typing', 'card_viewing']),
  cardId: z.string().uuid(),
})

export const signalResponseSchema = z.object({ delivered: z.boolean() })

export const pushKeySchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string(),
})

export const pushSubscriptionBodySchema = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  browserLabel: z.string().max(120).default(''),
  locale: z.enum(['uz-Latn', 'uz-Cyrl', 'ru', 'en']).nullable().default(null),
})

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

export const pushUnsubscribeBodySchema = z.object({
  endpoint: z.string().url().max(1024),
})
