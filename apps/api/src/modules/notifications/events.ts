// Domain-event intake (MODULE-GUIDE.md "Domain events": "subscribe to the event names other modules
// emit: define a small registry of expected events ... and handle unknown ones gracefully").
//
// No other module ships yet, so this registry is written against TECH-SPEC's own vocabulary for the
// modules it names (work/cards, events/polls, memberships, pages/decisions) -- every entry here is a
// documented *expectation*, not a hard schema: `payload` is `unknown` (`@devon/db`'s own contract,
// "a subscriber in a different module treats the payload as an untyped unknown it parses for itself"),
// so a future module's exact field names are read defensively, and anything that does not parse is
// skipped, never thrown -- the outbox worker retries a *throwing* handler up to 5 times and then
// abandons the row; a malformed-but-harmless payload should never eat those retries.
//
// The cross-module contract this module actually asks for is a single optional `notify` block inside
// a domain event's payload (documented here, not type-checked across the package boundary, exactly
// like the rest of this bus): `{ targetUserIds: string[], title: LocalizedText, body?: LocalizedText,
// deepLink?: string, subjectType?: string, subjectId?: string, eventAt?: string }`. An event with no
// `notify` block (or a malformed one) is still logged at debug level and otherwise ignored -- it is
// simply not yet something the inbox knows how to render, not an error.
import type { FastifyBaseLogger } from 'fastify'
import { subscribe, type EventHandler, type OutboxEventRecord } from '@devon/db'
import { notifyUser } from './notify.js'
import type { LocalizedText, Reason } from './schemas.js'

export const EVENT_REGISTRY: Readonly<Record<string, Reason>> = Object.freeze({
  'work.card.assigned': 'assigned',
  'work.card.comment.mentioned': 'mentioned',
  'work.card.due': 'due',
  'work.card.updated': 'updated',
  'work.card.comment.created': 'updated',
  'events.event.rsvp_reminder': 'rsvp',
  'events.event.updated': 'updated',
  'events.event.cancelled': 'updated',
  'events.poll.opened': 'poll',
  'events.poll.closing_soon': 'poll',
  'pages.decision.recorded': 'decision',
  'memberships.member.joined': 'system',
})

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isLocalizedText(v: unknown): v is LocalizedText {
  return (
    isRecord(v) &&
    typeof v['uz-Latn'] === 'string' &&
    typeof v['uz-Cyrl'] === 'string' &&
    typeof v['ru'] === 'string' &&
    typeof v['en'] === 'string'
  )
}

export type NotifyBlock = {
  targetUserIds: string[]
  title: LocalizedText
  body: LocalizedText | null
  deepLink: string | null
  subjectType: string | null
  subjectId: string | null
  eventAt: Date | null
}

/** Exported for `notifications.events.test.ts`: pure parsing, no DB, so the "handle unknown ones
 * gracefully" contract is unit-testable without a Postgres connection. */
export function parseNotifyBlock(payload: unknown): NotifyBlock | null {
  if (!isRecord(payload)) return null
  const notify = payload['notify']
  if (!isRecord(notify)) return null
  const targetUserIds = notify['targetUserIds']
  if (
    !Array.isArray(targetUserIds) ||
    targetUserIds.some((id) => typeof id !== 'string') ||
    targetUserIds.length === 0
  ) {
    return null
  }
  if (!isLocalizedText(notify['title'])) return null
  const eventAtRaw = notify['eventAt']
  const eventAt =
    typeof eventAtRaw === 'string' && !Number.isNaN(Date.parse(eventAtRaw))
      ? new Date(eventAtRaw)
      : null
  return {
    targetUserIds: targetUserIds as string[],
    title: notify['title'],
    body: isLocalizedText(notify['body']) ? notify['body'] : null,
    deepLink: typeof notify['deepLink'] === 'string' ? notify['deepLink'] : null,
    subjectType: typeof notify['subjectType'] === 'string' ? notify['subjectType'] : null,
    subjectId: typeof notify['subjectId'] === 'string' ? notify['subjectId'] : null,
    eventAt,
  }
}

/** One handler for every event type this process will ever see (`subscribe('*', ...)`) -- a lookup
 * table plus one `if`, rather than one `subscribe()` call per known type, so a type this module does
 * not yet recognise costs nothing beyond the lookup miss (MODULE-GUIDE.md "handle unknown ones
 * gracefully"). */
function makeHandler(log: FastifyBaseLogger): EventHandler {
  return async (event: OutboxEventRecord) => {
    const reason = EVENT_REGISTRY[event.type]
    if (!reason) {
      log.debug(
        { eventType: event.type },
        'notifications: ignoring an unrecognised domain event type',
      )
      return
    }
    const notify = parseNotifyBlock(event.payload)
    if (!notify) {
      log.debug(
        { eventType: event.type },
        'notifications: event matched the registry but carried no usable notify block',
      )
      return
    }

    // Sequential, not `Promise.all` (this file's convention mirrors `events-worker.ts`'s own reasoning
    // for its outer loop): each target's insert + delivery is independent, but running them one at a
    // time keeps one failing delivery from ever racing another target's write inside the same handler
    // invocation, and keeps a thrown error attributable to a single target.
    for (let i = 0; i < notify.targetUserIds.length; i += 1) {
      const userId = notify.targetUserIds[i]!
      // See this function's comment above (deliberately sequential so a failing delivery to one
      // target can never race another target's write, and stays attributable).
      // nosemgrep: query-in-loop
      await notifyUser(log, {
        userId,
        type: event.type,
        reason,
        subjectType: notify.subjectType ?? event.type.split('.')[1] ?? 'event',
        subjectId: notify.subjectId ?? null,
        departmentId: event.departmentId,
        title: notify.title,
        body: notify.body,
        deepLink: notify.deepLink,
        eventAt: notify.eventAt,
      })
    }
  }
}

/** Called once from `index.ts`'s plugin body (MODULE-GUIDE.md "Domain events": "subscribe at import
 * time, anywhere that runs once at boot") -- a plugin function body registered by `module-loader.ts`
 * runs exactly once per process, same guarantee `subscribe()` itself needs. */
export function registerNotificationEventSubscriptions(log: FastifyBaseLogger): () => void {
  return subscribe('*', makeHandler(log))
}
