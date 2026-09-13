// Channel naming and the one place a channel name is turned back into a permission question
// (v1.1 SPEC §10: "per-department channels authorised like `can()`").
//
// Pure: no Fastify, no database, no network -- so `test/unit/realtime.channels.test.ts` can assert
// every cell of the matrix (member, head, super admin, a stranger, view-as) without booting anything.
//
// Four channel families, and exactly four:
//
//   dept:<departmentId>      data that changed -- card moved/created/updated, project, event, so the
//                            client can invalidate the right query instead of polling. Every active
//                            member of that department reads it; nobody writes it from a browser.
//   board:<departmentId>     ephemeral board signals -- who is looking at the board (presence), who
//                            is editing which card, who is typing in which card's comments. Same
//                            audience as `dept:`; separate channel because presence should mean "on
//                            the board now", not "has the app open somewhere".
//   personal#<userId>        this person's inbox: a new notification, an unread-count change, a
//                            reminder. `#` is Centrifugo's user-limited boundary, so the server
//                            itself refuses a subscription whose token subject is anyone else --
//                            belt and braces on top of the check below.
//   canvas:<sharedCanvasId>  a canvas its owner published to a project or an event: live cursors and
//                            sticky-note sync. Never a private canvas (I-1) -- the id here is a
//                            `app.shared_canvases` row, which only exists because its owner made one.
//
// The channel *string* is never parsed anywhere else in the codebase; `parseChannel` below is the
// only parser, and every route that accepts a channel from a client runs it.
import { can, type Actor } from '@devon/contracts'

export const CHANNEL_NAMESPACES = ['dept', 'board', 'personal', 'canvas'] as const
export type ChannelNamespace = (typeof CHANNEL_NAMESPACES)[number]

export type ParsedChannel =
  | { namespace: 'dept'; departmentId: string }
  | { namespace: 'board'; departmentId: string }
  | { namespace: 'personal'; userId: string }
  | { namespace: 'canvas'; sharedCanvasId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function departmentChannel(departmentId: string): string {
  return `dept:${departmentId}`
}
export function boardChannel(departmentId: string): string {
  return `board:${departmentId}`
}
export function personalChannel(userId: string): string {
  return `personal#${userId}`
}
export function canvasChannel(sharedCanvasId: string): string {
  return `canvas:${sharedCanvasId}`
}

/** `null` for anything that is not one of the four families, with a real uuid in the right place.
 * A client that asks for `dept:*`, `dept:` or `admin:everything` gets the same `null` and therefore
 * the same 403 -- there is no "unknown namespace, allow it" branch. */
export function parseChannel(channel: string): ParsedChannel | null {
  if (channel.length > 128) return null
  const hashAt = channel.indexOf('#')
  if (hashAt !== -1) {
    const namespace = channel.slice(0, hashAt)
    const id = channel.slice(hashAt + 1)
    if (namespace !== 'personal' || !UUID.test(id)) return null
    return { namespace: 'personal', userId: id }
  }
  const colonAt = channel.indexOf(':')
  if (colonAt === -1) return null
  const namespace = channel.slice(0, colonAt)
  const id = channel.slice(colonAt + 1)
  if (!UUID.test(id)) return null
  if (namespace === 'dept') return { namespace: 'dept', departmentId: id }
  if (namespace === 'board') return { namespace: 'board', departmentId: id }
  if (namespace === 'canvas') return { namespace: 'canvas', sharedCanvasId: id }
  return null
}

export type ChannelDecision =
  | { allowed: true }
  | { allowed: false; reason: 'unknown_channel' | 'forbidden' | 'needs_lookup' }

/**
 * The synchronous half of the decision: everything `can()` can answer from the actor alone.
 *
 * `canvas:` deliberately returns `needs_lookup` rather than a verdict -- whether this person may
 * watch a shared canvas depends on the share row (which project or event it was published to) and on
 * that project's members / that event's participants, which is a database question. `index.ts` asks
 * it through `canvasAudience()` and never hands out a token before it has an answer. Returning a
 * third value instead of `false` keeps "I refuse" and "I have not decided yet" from looking alike.
 */
export function decideChannel(actor: Actor | null, parsed: ParsedChannel | null): ChannelDecision {
  if (!parsed) return { allowed: false, reason: 'unknown_channel' }
  if (!actor) return { allowed: false, reason: 'forbidden' }

  switch (parsed.namespace) {
    case 'dept':
    case 'board': {
      // Exactly the board's own read rule: any active member of that department, plus a super admin
      // holding a matching view-as lens (read-only, I-8a -- and these channels are read-only for
      // every browser by construction: publications come from the API, never from a client).
      const decision = can(actor, 'read', {
        kind: 'department_child',
        departmentId: parsed.departmentId,
      })
      return decision.allowed ? { allowed: true } : { allowed: false, reason: 'forbidden' }
    }
    case 'personal': {
      // I-1's shape: owner only, no head exception, no super-admin exception, ever. `can()` says the
      // same thing; it is spelled through `can()` rather than as an `===` so there is still exactly
      // one implementation of the rule (I-7).
      const decision = can(actor, 'read', { kind: 'personal', ownerUserId: parsed.userId })
      return decision.allowed ? { allowed: true } : { allowed: false, reason: 'forbidden' }
    }
    case 'canvas':
      return { allowed: false, reason: 'needs_lookup' }
  }
}
