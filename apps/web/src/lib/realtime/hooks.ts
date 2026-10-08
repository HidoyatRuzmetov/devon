// React bindings for the one socket (`client.ts`). Every hook is safe to call on a screen that will
// never see a live update: with Centrifugo off they report `off`, subscribe to nothing and cost one
// `useEffect` that returns immediately.
import * as React from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMeQuery } from '../session.js'
import {
  ensureRealtimeConnection,
  onRealtimeStatus,
  realtimeChannels,
  realtimeStatus,
  subscribeChannel,
  subscribePresence,
  type PresenceMember,
  type RealtimeMessage,
  type RealtimeStatus,
} from './client.js'
import { sendBoardSignal, type BoardSignalKind } from './api.js'

export type { PresenceMember, RealtimeMessage, RealtimeStatus }

/** The live-connection state, for the one line of copy that tells a person whether they are seeing
 * the board as it changes or on a four-second refresh. */
export function useRealtimeStatus(): RealtimeStatus {
  const [status, setStatus] = React.useState<RealtimeStatus>(() => realtimeStatus())
  React.useEffect(() => onRealtimeStatus(setStatus), [])
  return status
}

/** True only when live updates are actually flowing -- what a screen checks before it turns its
 * polling interval off. */
export function useIsLive(): boolean {
  return useRealtimeStatus() === 'connected'
}

/** The three channels this session may join, resolved once by `GET /realtime/config`. `null` until
 * the connection has been attempted. */
export function useRealtimeChannels(): ReturnType<typeof realtimeChannels> {
  const status = useRealtimeStatus()
  return React.useMemo(() => realtimeChannels(), [status])
}

/** Subscribe a component to one channel. The handler is kept in a ref, so a caller may pass an
 * inline arrow without re-subscribing on every render. */
export function useChannel(
  channel: string | null | undefined,
  handler: (message: RealtimeMessage, channel: string) => void,
): void {
  const handlerRef = React.useRef(handler)
  handlerRef.current = handler
  React.useEffect(() => {
    if (!channel) return
    return subscribeChannel(channel, (message, ch) => handlerRef.current(message, ch))
  }, [channel])
}

/** Who else is looking at this channel right now, newest answer wins. Excludes the viewer: a person
 * does not need to be told they are here. */
export function usePresence(channel: string | null | undefined): PresenceMember[] {
  const [members, setMembers] = React.useState<PresenceMember[]>([])
  const meQuery = useMeQuery()
  const myId = meQuery.data?.user.id ?? null

  React.useEffect(() => {
    if (!channel) {
      setMembers([])
      return
    }
    return subscribePresence(channel, setMembers)
  }, [channel])

  return React.useMemo(() => members.filter((m) => m.userId !== myId), [members, myId])
}

export type EphemeralSignal = {
  userId: string
  cardId: string
  kind: BoardSignalKind
  at: number
}

/**
 * "Anvar is editing this card", "Nodira is typing a comment" -- board signals, kept for a few
 * seconds and then forgotten. Nothing is stored anywhere: an indicator that outlives the person's
 * attention is worse than none, because it teaches people to ignore it.
 */
export function useBoardSignals(channel: string | null | undefined): {
  editing: Map<string, EphemeralSignal[]>
  typing: Map<string, EphemeralSignal[]>
} {
  const [signals, setSignals] = React.useState<EphemeralSignal[]>([])
  const meQuery = useMeQuery()
  const myId = meQuery.data?.user.id ?? null

  useChannel(channel, (message) => {
    if (!message.type.startsWith('board.')) return
    const kind = message.type.slice('board.'.length) as BoardSignalKind
    const userId = String(message.payload['userId'] ?? '')
    const cardId = String(message.payload['cardId'] ?? '')
    if (!userId || !cardId || userId === myId) return
    setSignals((current) => {
      const without = current.filter((s) => !(s.userId === userId && s.cardId === cardId))
      if (kind === 'card_editing_stopped') return without
      return [...without, { userId, cardId, kind, at: Date.now() }]
    })
  })

  // One timer for the whole set, not one per signal: a board with twenty colleagues on it must not
  // schedule twenty timeouts a second (H11.1, "timers cleared, bounded work").
  React.useEffect(() => {
    if (signals.length === 0) return
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 8000
      setSignals((current) => {
        const next = current.filter((s) => s.at > cutoff)
        return next.length === current.length ? current : next
      })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [signals.length])

  return React.useMemo(() => {
    const editing = new Map<string, EphemeralSignal[]>()
    const typing = new Map<string, EphemeralSignal[]>()
    for (const signal of signals) {
      const target = signal.kind === 'comment_typing' ? typing : editing
      target.set(signal.cardId, [...(target.get(signal.cardId) ?? []), signal])
    }
    return { editing, typing }
  }, [signals])
}

/**
 * Tells colleagues this person is editing a card (or typing a comment on it) while `active` is true,
 * and that they have stopped the moment it goes false or the component unmounts.
 *
 * Throttled to one call every four seconds. A signal is a heartbeat, not a keystroke log: the server
 * republishes it, the receivers keep it for eight seconds, so four is exactly often enough to stay
 * lit and rare enough that a long comment costs a handful of requests, not hundreds.
 */
export function useSignalWhile(
  kind: Exclude<BoardSignalKind, 'card_editing_stopped'>,
  cardId: string | null | undefined,
  active: boolean,
): void {
  const lastSent = React.useRef(0)
  React.useEffect(() => {
    if (!cardId || !active) return
    let cancelled = false
    const beat = () => {
      const now = Date.now()
      if (cancelled || now - lastSent.current < 4000) return
      lastSent.current = now
      void sendBoardSignal(kind, cardId).catch(() => {})
    }
    beat()
    const timer = window.setInterval(beat, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      lastSent.current = 0
      void sendBoardSignal('card_editing_stopped', cardId).catch(() => {})
    }
  }, [kind, cardId, active])
}

/** Query keys a live message invalidates. Kept as one table rather than scattered through the
 * features, so "which event refreshes what" is answerable in one place -- and so a feature that adds
 * an event name only has to add a row here. */
const INVALIDATIONS: ReadonlyArray<{
  match: RegExp
  keys: readonly (readonly string[])[]
}> = [
  {
    match: /^work\.(card|checklist|focus)\./,
    keys: [['work'], ['projects']],
  },
  { match: /^projects\./, keys: [['projects'], ['work', 'board']] },
  { match: /^events\./, keys: [['events']] },
  { match: /^structure\./, keys: [['structure']] },
  { match: /^pages\./, keys: [['pages']] },
  { match: /^departments\./, keys: [['departments'], ['people']] },
  { match: /^realtime\.canvas\./, keys: [['realtime', 'canvas-shares']] },
  { match: /^inbox\.notification\./, keys: [['inbox', 'notifications']] },
]

function invalidateFor(queryClient: QueryClient, type: string): void {
  // The last checklist mutation refetches committed state. A live echo during an optimistic
  // toggle must not overwrite the newer local state with an intermediate server response.
  if (
    (type.startsWith('work.') || type.startsWith('projects.')) &&
    queryClient.isMutating({ mutationKey: ['work', 'checklist'] }) > 0
  )
    return
  // The final local write refreshes all work/project surfaces. Fetching an earlier live echo while
  // a drag or pin is pending replaced the optimistic layout and made it snap back repeatedly.
  if (
    (type.startsWith('work.') || type.startsWith('projects.')) &&
    queryClient.isMutating({ mutationKey: ['work', 'card-write'] }) > 0
  )
    return
  for (const rule of INVALIDATIONS) {
    if (!rule.match.test(type)) continue
    for (const key of rule.keys) void queryClient.invalidateQueries({ queryKey: [...key] })
  }
}

/**
 * The bridge that makes every other screen live without any of them knowing about a socket: it joins
 * this person's department channel and their own inbox channel, and turns each publication into a
 * React Query invalidation.
 *
 * Mounted once per session from `features/calendar/manifest.tsx`'s `useSidebarCounts` -- the shell
 * calls every manifest's counts hook unconditionally on every render of the signed-in shell
 * (`features/registry.ts` documents why that is a stable hook position), which makes it the one
 * place a feature can run session-wide code without editing `app.tsx`. Said out loud here because it
 * is the only surprising line in this file.
 */
export function useRealtimeBridge(): void {
  const queryClient = useQueryClient()
  const meQuery = useMeQuery()
  const signedIn = meQuery.data != null
  const status = useRealtimeStatus()
  const channels = React.useMemo(() => realtimeChannels(), [status])

  useChannel(signedIn ? (channels?.department ?? null) : null, (message) => {
    invalidateFor(queryClient, message.type)
  })
  useChannel(signedIn ? (channels?.personal ?? null) : null, (message) => {
    invalidateFor(queryClient, message.type)
  })

  // Kick the connection off on the first render of a signed-in shell. `subscribeChannel` connects
  // lazily, but the channel names only exist once `/realtime/config` has answered -- so something
  // has to ask first.
  React.useEffect(() => {
    if (!signedIn) return
    void ensureRealtimeConnection()
    const reconnect = () => void ensureRealtimeConnection()
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [signedIn])

  // A failed initial config/token request must recover without requiring a page reload. The
  // WebSocket library handles normal transport reconnects; this also retries bootstrap failures.
  React.useEffect(() => {
    if (!signedIn || status !== 'error') return
    const timer = window.setTimeout(() => void ensureRealtimeConnection(), 20_000)
    return () => window.clearTimeout(timer)
  }, [signedIn, status])
}
