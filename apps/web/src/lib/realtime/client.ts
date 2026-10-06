// The one WebSocket in the product (v1.1 SPEC §10, EPIC-018).
//
// A module singleton with reference counting, not a React context, for three reasons a provider
// could not give us:
//   * one socket per tab no matter how many screens want a channel -- the board, the card panel, the
//     inbox badge and a shared canvas all ride the same connection;
//   * nothing to mount. `app.tsx` is a file every v1.1 package would otherwise have to edit, and a
//     realtime layer that only works when somebody remembered to wrap the tree is a realtime layer
//     that silently stops working after a refactor;
//   * a hook can appear and disappear with a screen; `subscribe()` returns an unsubscribe, the last
//     unsubscribe drops the channel, and the last channel leaves the socket idle but open (opening a
//     WebSocket costs a round trip, and a person navigating between /work and /inbox would pay it
//     every time).
//
// `centrifuge` is loaded with a dynamic `import()` so it never lands in the initial bundle: a session
// that never opens a screen with live anything never downloads it (H4.4's shell budget).
//
// Everything here degrades to nothing. `GET /realtime/config` says `enabled:false` on a deployment
// with no Centrifugo -- the common case on a developer box -- and every hook then reports `off`, at
// which point the screens keep their polling fallbacks and say so in words.
import type { Centrifuge, ClientInfo, PublicationContext, Subscription } from 'centrifuge'
import {
  fetchConnectionToken,
  fetchRealtimeConfig,
  fetchSubscriptionToken,
  type RealtimeConfig,
} from './api.js'

export type RealtimeStatus = 'idle' | 'off' | 'connecting' | 'connected' | 'error'

export type RealtimeMessage = {
  type: string
  payload: Record<string, unknown>
  actorUserId?: string | null
  at?: string
}

export type PresenceMember = { userId: string; name: string; avatarKey: string | null }

type ChannelHandler = (message: RealtimeMessage, channel: string) => void
type PresenceHandler = (members: PresenceMember[]) => void

type ChannelEntry = {
  sub: Subscription | null
  handlers: Set<ChannelHandler>
  presenceHandlers: Set<PresenceHandler>
  /** Server-side subscriptions (the personal inbox channel, delivered through the connection token)
   * have no `Subscription` object: publications arrive on the client itself. */
  serverSide: boolean
}

const statusListeners = new Set<(status: RealtimeStatus) => void>()
const channels = new Map<string, ChannelEntry>()

let status: RealtimeStatus = 'idle'
let config: RealtimeConfig | null = null
let centrifuge: Centrifuge | null = null
let connecting: Promise<Centrifuge | null> | null = null
let generation = 0

function setStatus(next: RealtimeStatus): void {
  if (status === next) return
  status = next
  for (const listener of statusListeners) listener(next)
}

export function realtimeStatus(): RealtimeStatus {
  return status
}

export function realtimeChannels(): RealtimeConfig['channels'] | null {
  return config?.channels ?? null
}

export function onRealtimeStatus(listener: (status: RealtimeStatus) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function toMessage(data: unknown): RealtimeMessage | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (typeof record['type'] !== 'string') return null
  // `exactOptionalPropertyTypes` is on (TECH-SPEC §16): an optional property is either present with
  // a real value or absent entirely -- never present holding `undefined`. So `at` is spread in only
  // when the wire actually carried a string.
  const at = record['at']
  return {
    type: record['type'],
    payload: (record['payload'] as Record<string, unknown> | undefined) ?? {},
    actorUserId: (record['actorUserId'] as string | null | undefined) ?? null,
    ...(typeof at === 'string' ? { at } : {}),
  }
}

/**
 * Turn one publication into the message every screen sees.
 *
 * `info` is present only for a publication a *browser* sent (Centrifugo attaches the publishing
 * connection's own authenticated identity to it and omits it for server-API publishes). That is what
 * makes the one client-publishable namespace -- `canvas:`, for live cursors -- safe: the publisher's
 * user id and name are stamped by the broker from the connection token, never carried in the body,
 * so a participant cannot put a colleague's name on a cursor even though they can publish. The two
 * fields are merged into the payload here, once, rather than in every consumer.
 */
function deliver(channel: string, data: unknown, info?: ClientInfo): void {
  const entry = channels.get(channel)
  if (!entry) return
  const base = toMessage(data)
  if (!base) return
  const message: RealtimeMessage =
    info && info.user
      ? {
          ...base,
          actorUserId: info.user,
          payload: {
            ...base.payload,
            userId: info.user,
            name:
              typeof (info.connInfo as { name?: unknown } | undefined)?.name === 'string'
                ? (info.connInfo as { name: string }).name
                : '',
          },
        }
      : base
  for (const handler of entry.handlers) {
    try {
      handler(message, channel)
    } catch {
      // One screen's handler throwing must not stop the next screen's from running -- a live update
      // is a notification to several independent listeners, not a pipeline.
    }
  }
}

async function connect(): Promise<Centrifuge | null> {
  if (centrifuge) {
    if (centrifuge.state === 'disconnected') centrifuge.connect()
    return centrifuge
  }
  if (connecting) return connecting

  const attemptGeneration = generation
  const pending = (async () => {
    setStatus('connecting')
    try {
      const resolvedConfig = await fetchRealtimeConfig()
      if (generation !== attemptGeneration) return null
      config = resolvedConfig
    } catch {
      // Not signed in yet, or the API is unreachable. Neither is an error worth showing: the caller
      // is a background bridge, and the screens have their fallbacks.
      if (generation === attemptGeneration) setStatus('error')
      return null
    }
    if (!config.enabled || !config.url) {
      setStatus('off')
      connecting = null
      return null
    }

    const { Centrifuge: CentrifugeCtor } = await import('centrifuge')
    if (generation !== attemptGeneration) return null
    const client = new CentrifugeCtor(config.url, {
      // Re-asked on every reconnect and whenever the token expires, so a person removed from a
      // department stops receiving its channels within one token life (ten minutes) rather than
      // whenever they next reload.
      getToken: () => fetchConnectionToken(),
      // Defaults with the edges pulled in: a ministry box behind a flaky VPN should retry patiently,
      // not hammer.
      minReconnectDelay: 1000,
      maxReconnectDelay: 20_000,
      maxServerPingDelay: 10_000,
    })

    const updateStatus = (next: RealtimeStatus) => {
      if (generation === attemptGeneration) setStatus(next)
    }
    client.on('connected', () => updateStatus('connected'))
    client.on('connecting', () => updateStatus('connecting'))
    client.on('disconnected', () => updateStatus('error'))
    client.on('error', () => updateStatus('error'))
    // Server-side subscriptions (the personal inbox channel, named in the connection token) arrive
    // here rather than on a `Subscription`.
    client.on('publication', (ctx: PublicationContext & { channel: string }) => {
      deliver(ctx.channel, ctx.data, ctx.info)
    })

    centrifuge = client
    client.connect()
    return client
  })()
    .catch(() => {
      if (generation === attemptGeneration) {
        centrifuge?.disconnect()
        centrifuge = null
        setStatus('error')
      }
      return null
    })
    .finally(() => {
      if (connecting === pending) connecting = null
    })
  connecting = pending

  return connecting
}

function attachPresence(entry: ChannelEntry, sub: Subscription): void {
  const refresh = async () => {
    if (entry.presenceHandlers.size === 0) return
    try {
      const result = await sub.presence()
      const byUser = new Map<string, PresenceMember>()
      for (const client of Object.values(result.clients)) {
        const info = (client.connInfo ?? {}) as { name?: string; avatarKey?: string | null }
        const userId = client.user
        if (!userId || byUser.has(userId)) continue
        byUser.set(userId, {
          userId,
          name: info.name ?? '',
          avatarKey: info.avatarKey ?? null,
        })
      }
      const members = [...byUser.values()]
      for (const handler of entry.presenceHandlers) handler(members)
    } catch {
      // Presence is unavailable on a namespace without it, or while reconnecting. Callers render
      // "nobody else here", which is the honest reading of "we cannot tell".
    }
  }
  sub.on('subscribed', () => void refresh())
  sub.on('join', () => void refresh())
  sub.on('leave', () => void refresh())
}

async function ensureChannel(channel: string): Promise<ChannelEntry> {
  let entry = channels.get(channel)
  if (!entry) {
    entry = {
      sub: null,
      handlers: new Set(),
      presenceHandlers: new Set(),
      // `personal#<id>` is subscribed by the connection token itself, server-side: the answer to
      // "may I read my own inbox" cannot be anything but yes, so it does not deserve a round trip.
      serverSide: channel.startsWith('personal#'),
    }
    channels.set(channel, entry)
  }
  if (entry.sub) return entry

  const client = await connect()
  if (!client || entry.serverSide || channels.get(channel) !== entry) return entry
  if (entry.sub) return entry

  const sub =
    client.getSubscription(channel) ??
    client.newSubscription(channel, {
      // One `can()` call per channel, on the server, moments before the token is minted -- and again
      // on every token refresh, so losing access ends the subscription rather than freezing it.
      getToken: () => fetchSubscriptionToken(channel),
    })
  sub.on('publication', (ctx: PublicationContext) => deliver(channel, ctx.data, ctx.info))
  attachPresence(entry, sub)
  entry.sub = sub
  sub.subscribe()
  return entry
}

/** Open the connection (and therefore resolve `/realtime/config`) without subscribing to anything.
 * The session-wide bridge calls this once so the channel names are known before any screen asks for
 * them; everything else connects lazily through `subscribeChannel`. */
export async function ensureRealtimeConnection(): Promise<void> {
  await connect()
}

/**
 * Listen to one channel. Returns the unsubscribe; the last listener leaving takes the subscription
 * down with it, so a screen that is closed stops costing a socket's worth of traffic.
 */
export function subscribeChannel(channel: string, handler: ChannelHandler): () => void {
  if (!channel) return () => {}
  let cancelled = false
  let entryRef: ChannelEntry | null = null

  void ensureChannel(channel).then((entry) => {
    if (cancelled) return
    entryRef = entry
    entry.handlers.add(handler)
  })

  return () => {
    cancelled = true
    const entry = entryRef ?? channels.get(channel)
    if (!entry) return
    entry.handlers.delete(handler)
    if (entry.handlers.size === 0 && entry.presenceHandlers.size === 0) {
      entry.sub?.unsubscribe()
      if (entry.sub) centrifuge?.removeSubscription(entry.sub)
      channels.delete(channel)
    }
  }
}

/** Watch who is present on a channel. Same lifetime rules as `subscribeChannel`. */
export function subscribePresence(channel: string, handler: PresenceHandler): () => void {
  if (!channel) return () => {}
  let cancelled = false
  let entryRef: ChannelEntry | null = null

  void ensureChannel(channel).then((entry) => {
    if (cancelled) return
    entryRef = entry
    entry.presenceHandlers.add(handler)
    if (entry.sub?.state === 'subscribed') {
      void entry.sub
        .presence()
        .then((result) => {
          const byUser = new Map<string, PresenceMember>()
          for (const client of Object.values(result.clients)) {
            const info = (client.connInfo ?? {}) as { name?: string; avatarKey?: string | null }
            if (!client.user || byUser.has(client.user)) continue
            byUser.set(client.user, {
              userId: client.user,
              name: info.name ?? '',
              avatarKey: info.avatarKey ?? null,
            })
          }
          handler([...byUser.values()])
        })
        .catch(() => {})
    }
  })

  return () => {
    cancelled = true
    const entry = entryRef ?? channels.get(channel)
    if (!entry) return
    entry.presenceHandlers.delete(handler)
    if (entry.handlers.size === 0 && entry.presenceHandlers.size === 0) {
      entry.sub?.unsubscribe()
      if (entry.sub) centrifuge?.removeSubscription(entry.sub)
      channels.delete(channel)
    }
  }
}

/**
 * The one thing a browser is allowed to publish: a cursor or a sticky-note nudge on a canvas its
 * owner shared (`canvas:` is the only namespace with `allow_publish_for_subscriber`). Everything
 * else goes through the API so the actor cannot be forged -- and even here Centrifugo stamps the
 * publication with the connection's own `info`, so a participant cannot pretend to be a colleague.
 */
export async function publishToCanvas(
  channel: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!channel.startsWith('canvas:')) return
  const entry = await ensureChannel(channel)
  if (!entry.sub || entry.sub.state !== 'subscribed') return
  try {
    await entry.sub.publish(data)
  } catch {
    // A cursor that does not arrive is a cursor nobody misses.
  }
}

/** Sign-out, or a department switch: drop everything and start clean on the next subscription. */
export function resetRealtime(): void {
  generation++
  for (const [, entry] of channels) {
    entry.sub?.unsubscribe()
    if (entry.sub) centrifuge?.removeSubscription(entry.sub)
  }
  channels.clear()
  centrifuge?.disconnect()
  centrifuge = null
  config = null
  connecting = null
  setStatus('idle')
}
