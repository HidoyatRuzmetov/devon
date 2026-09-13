// "Anvar is editing this card", "Nodira is typing a comment" -- the ephemeral board signals, held in
// one module-level store rather than in each component that wants to read one.
//
// **Why a store and not a hook per card.** A board renders every card in the department, and each
// tile wants to know one thing: is anybody on *me*? If each tile called `useBoardSignals` it would
// hold its own copy of the whole signal list and its own 2-second expiry timer -- forty tiles, forty
// timers, forty re-renders on every heartbeat, to light up one badge. This store keeps one
// subscription, one timer and one list; a tile subscribes to its own card id and re-renders only
// when the answer for that id changes.
//
// Nothing here is persisted anywhere, by design. A signal is a fact about somebody's attention right
// now; one that outlives their attention is worse than none, because it teaches people to ignore the
// indicator. Eight seconds without a heartbeat and it is gone.
import * as React from 'react'
import { subscribeChannel, type RealtimeMessage } from './client.js'
import type { BoardSignalKind } from './api.js'

export type CardSignal = {
  userId: string
  name: string
  kind: Exclude<BoardSignalKind, 'card_editing_stopped'>
  at: number
}

/** How long a signal survives without a fresh heartbeat. The sender beats every 4 s
 * (`useSignalWhile`), so 8 s tolerates exactly one lost beat before the badge goes out. */
const SIGNAL_TTL_MS = 8000
const SWEEP_MS = 2000

type CardMap = ReadonlyMap<string, readonly CardSignal[]>

const EMPTY: readonly CardSignal[] = Object.freeze([])

let signals: CardSignal[] & { cardIds?: never } = []
let byCard: CardMap = new Map()
let channel: string | null = null
let unsubscribeChannelFn: (() => void) | null = null
let sweepTimer: number | null = null
let myUserId: string | null = null

const listeners = new Map<string, Set<() => void>>()
/** Signals are keyed by card id in `signals`; the store keeps them in a parallel array so the sweep
 * and the message handler share one source of truth. */
const cardIdOf = new WeakMap<CardSignal, string>()

function notify(cardIds: Iterable<string>): void {
  const seen = new Set<string>()
  for (const cardId of cardIds) {
    if (seen.has(cardId)) continue
    seen.add(cardId)
    const set = listeners.get(cardId)
    if (!set) continue
    for (const listener of set) listener()
  }
}

function rebuild(): void {
  const next = new Map<string, CardSignal[]>()
  for (const signal of signals) {
    const cardId = cardIdOf.get(signal)
    if (!cardId) continue
    const list = next.get(cardId)
    if (list) list.push(signal)
    else next.set(cardId, [signal])
  }
  byCard = next
}

function sweep(): void {
  const cutoff = Date.now() - SIGNAL_TTL_MS
  const survivors = signals.filter((s) => s.at > cutoff)
  if (survivors.length === signals.length) return
  const changed = signals.filter((s) => s.at <= cutoff).map((s) => cardIdOf.get(s) ?? '')
  signals = survivors
  rebuild()
  notify(changed)
  if (signals.length === 0) stopSweep()
}

function startSweep(): void {
  if (sweepTimer !== null) return
  sweepTimer = window.setInterval(sweep, SWEEP_MS)
}

function stopSweep(): void {
  if (sweepTimer === null) return
  window.clearInterval(sweepTimer)
  sweepTimer = null
}

function handle(message: RealtimeMessage): void {
  if (!message.type.startsWith('board.')) return
  const kind = message.type.slice('board.'.length) as BoardSignalKind
  const userId = typeof message.payload['userId'] === 'string' ? message.payload['userId'] : ''
  const cardId = typeof message.payload['cardId'] === 'string' ? message.payload['cardId'] : ''
  const name = typeof message.payload['name'] === 'string' ? message.payload['name'] : ''
  if (!userId || !cardId) return
  // A person does not need to be told they are editing the thing they are editing.
  if (myUserId && userId === myUserId) return
  // `card_viewing` is carried on the wire for presence-on-a-card, which no screen renders yet --
  // dropping it here rather than storing a signal nothing reads.
  if (kind === 'card_viewing') return

  const before = byCard.get(cardId) ?? EMPTY
  signals = signals.filter((s) => !(s.userId === userId && cardIdOf.get(s) === cardId))

  if (kind !== 'card_editing_stopped') {
    const signal: CardSignal = { userId, name, kind, at: Date.now() }
    cardIdOf.set(signal, cardId)
    signals.push(signal)
    startSweep()
  }

  rebuild()
  const after = byCard.get(cardId) ?? EMPTY
  if (before !== after) notify([cardId])
}

/**
 * Point the store at a board channel (and at the viewer, so their own signals are dropped).
 *
 * Called by `useCardSignalSource`, which the board shell mounts once. Re-pointing at the same
 * channel is a no-op; pointing at a different one drops everything, because a signal on the old
 * department's board means nothing on the new one.
 */
function setSource(nextChannel: string | null, viewerId: string | null): void {
  myUserId = viewerId
  if (nextChannel === channel) return
  unsubscribeChannelFn?.()
  unsubscribeChannelFn = null
  const cleared = [...byCard.keys()]
  signals = []
  byCard = new Map()
  stopSweep()
  notify(cleared)
  channel = nextChannel
  if (!nextChannel) return
  unsubscribeChannelFn = subscribeChannel(nextChannel, (message) => handle(message))
}

/** Mount once per board shell: keeps the store pointed at the right channel for as long as a work
 * screen is open, and tears the subscription down when the last one closes. */
export function useCardSignalSource(channelName: string | null, viewerId: string | null): void {
  React.useEffect(() => {
    setSource(channelName, viewerId)
    return () => setSource(null, null)
  }, [channelName, viewerId])
}

/**
 * Who is editing or commenting on this one card right now. Returns a stable empty array when nobody
 * is, so a tile that nobody is touching never re-renders because of this hook.
 */
export function useCardSignals(cardId: string): readonly CardSignal[] {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      let set = listeners.get(cardId)
      if (!set) {
        set = new Set()
        listeners.set(cardId, set)
      }
      set.add(onStoreChange)
      return () => {
        set.delete(onStoreChange)
        if (set.size === 0) listeners.delete(cardId)
      }
    },
    [cardId],
  )
  const getSnapshot = React.useCallback(() => byCard.get(cardId) ?? EMPTY, [cardId])
  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

/** Test-only: forget everything between cases. */
export function __resetSignalStoreForTests(): void {
  unsubscribeChannelFn?.()
  unsubscribeChannelFn = null
  channel = null
  signals = []
  byCard = new Map()
  listeners.clear()
  stopSweep()
  myUserId = null
}
