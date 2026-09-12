// The server half of realtime: this API publishes to Centrifugo's HTTP API, and browsers only ever
// listen. Nothing a browser sends can become a publication without passing through a route here
// first, which is what makes "the client only hides, the server decides" true for live updates too.
//
// Every call is bounded and breakered (H8.1: "timeouts and circuit breakers ... every outbound call
// has a timeout"). Centrifugo being down must be invisible to the product: a failed publish is
// logged at debug and swallowed, because the data is already committed and every screen still has
// its polling/refetch fallback. A realtime message is a nicety; losing one is never an error a
// person should see.
import { CircuitBreaker, CircuitOpenError } from '../../lib/resilience/circuit-breaker.js'
import { withTimeout } from '../../lib/resilience/timeout.js'
import { canPublish, realtimeConfig, type RealtimeConfig } from './config.js'

/** Per-process, like every other breaker in this API (`lib/resilience/registry.ts`'s own note on why
 * that is correct). Deliberately not added to that shared registry: this module ships by adding
 * files, and the admin health screen's breaker list is another package's surface. */
const breaker = new CircuitBreaker({
  name: 'centrifugo',
  failureThreshold: 5,
  resetTimeoutMs: 20_000,
})

export type RealtimeEvent = {
  /** What happened, in the same `<module>.<noun>.<verb>` vocabulary the outbox uses, so a client
   * switch statement and a server subscription read alike. */
  type: string
  /** Ids and counts only. A publication is delivered to every subscriber of a channel, so it carries
   * no field a `can()` check would have narrowed per person -- the client re-fetches through the
   * ordinary, authorised endpoint when it needs content (v1.1 SPEC §10). */
  payload: Record<string, unknown>
  /** Who caused it, so a client can ignore the echo of its own optimistic update. */
  actorUserId?: string | null
  at?: string
}

type Logger = { debug: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }

let logger: Logger | null = null

export function setRealtimeLogger(log: Logger): void {
  logger = log
}

async function callCentrifugo(
  method: string,
  body: unknown,
  cfg: RealtimeConfig,
): Promise<unknown> {
  const base = cfg.CENTRIFUGO_API_URL.replace(/\/$/, '')
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Centrifugo v6 accepts the API key as a header; it never travels to a browser.
      'X-API-Key': cfg.CENTRIFUGO_API_KEY,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`centrifugo ${method}: HTTP ${res.status}`)
  const json = (await res.json()) as { error?: { code: number; message: string } }
  if (json.error) throw new Error(`centrifugo ${method}: ${json.error.message}`)
  return json
}

async function guarded<T>(label: string, fn: () => Promise<T>, cfg: RealtimeConfig): Promise<T> {
  return breaker.execute(() => withTimeout(fn(), cfg.CENTRIFUGO_TIMEOUT_MS, label))
}

/** Fire-and-forget publish. Returns `true` when Centrifugo accepted it, `false` for every "not
 * configured / down / timed out" case -- callers use the boolean for metrics and health, never to
 * fail a request. */
export async function publish(channel: string, event: RealtimeEvent): Promise<boolean> {
  const cfg = realtimeConfig()
  if (!canPublish(cfg)) return false
  const data = { ...event, at: event.at ?? new Date().toISOString() }
  try {
    await guarded('centrifugo.publish', () => callCentrifugo('publish', { channel, data }, cfg), cfg)
    return true
  } catch (err) {
    logger?.debug(
      { err: err instanceof Error ? err.message : String(err), channel, type: event.type },
      'realtime: publish failed (the write itself is committed; clients fall back to refetch)',
    )
    return false
  }
}

/** One publication to several channels in one round trip (Centrifugo's `broadcast`). Used by the
 * outbox subscriber, which often has to tell a department channel and several personal channels
 * about the same row -- never a `publish()` per recipient in a loop (I-14's spirit: no N calls where
 * the dependency offers one). */
export async function broadcast(
  channels: readonly string[],
  event: RealtimeEvent,
): Promise<boolean> {
  const cfg = realtimeConfig()
  if (!canPublish(cfg) || channels.length === 0) return false
  const data = { ...event, at: event.at ?? new Date().toISOString() }
  try {
    await guarded(
      'centrifugo.broadcast',
      () => callCentrifugo('broadcast', { channels: [...channels], data }, cfg),
      cfg,
    )
    return true
  } catch (err) {
    logger?.debug(
      { err: err instanceof Error ? err.message : String(err), count: channels.length },
      'realtime: broadcast failed',
    )
    return false
  }
}

export type PresenceEntry = { userId: string; name: string; avatarKey: string | null }

/** Who is currently subscribed to a channel, asked of Centrifugo rather than tracked here (it is the
 * only component that knows, and it already keeps this in Valkey). One entry per *person*, not per
 * tab: two browser tabs are one colleague on the board. */
export async function presence(channel: string): Promise<PresenceEntry[] | null> {
  const cfg = realtimeConfig()
  if (!canPublish(cfg)) return null
  try {
    const result = (await guarded(
      'centrifugo.presence',
      () => callCentrifugo('presence', { channel }, cfg),
      cfg,
    )) as {
      result?: {
        presence?: Record<
          string,
          { user?: string; conn_info?: { name?: string; avatarKey?: string | null } }
        >
      }
    }
    const byUser = new Map<string, PresenceEntry>()
    for (const client of Object.values(result.result?.presence ?? {})) {
      const userId = client.user ?? ''
      if (!userId || byUser.has(userId)) continue
      byUser.set(userId, {
        userId,
        name: client.conn_info?.name ?? '',
        avatarKey: client.conn_info?.avatarKey ?? null,
      })
    }
    return [...byUser.values()]
  } catch (err) {
    if (err instanceof CircuitOpenError) return null
    logger?.debug(
      { err: err instanceof Error ? err.message : String(err), channel },
      'realtime: presence lookup failed',
    )
    return null
  }
}

/** Tells everyone watching a channel that it is over. Used when a canvas share is revoked: the
 * watchers leave immediately instead of at their next reload, and their subscription token is
 * refused the moment it expires (`CENTRIFUGO_TOKEN_TTL_SECONDS`, ten minutes) because the share row
 * is gone by then. Deliberately a publication rather than Centrifugo's own `unsubscribe` API, which
 * needs a user id per call and would be one HTTP round trip per watcher. */
export async function publishChannelClosed(channel: string, reason: string): Promise<boolean> {
  return publish(channel, { type: 'realtime.channel.closed', payload: { reason } })
}

export function realtimeBreakerSnapshot() {
  return breaker.snapshot()
}
