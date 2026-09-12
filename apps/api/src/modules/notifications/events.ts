// SPEC §11 -- domain-event intake. One `subscribe('*', ...)` handler that looks every outbox row up
// in `NOTIFICATION_REGISTRY` (`registry.ts`), resolves the subject and the recipients through
// `sources.ts`, and writes one inbox row per recipient, delivering to Telegram through the existing
// bot adapter under the recipient's own channel preferences and quiet hours (`delivery.ts`).
//
// What changed in v1.1 and why (STATE.md §7.1): the old registry was keyed on twelve invented event
// names, nine of which nothing emitted, and every handler additionally required a `notify` block
// inside the payload that no emitting module ever wrote -- so the outbox -> inbox path produced
// nothing at all, and the inbox was fed only by the three pg-boss jobs. The `notify`-block contract
// is gone: an event's payload carries ids, and this module resolves "who cares about this id" itself
// through the registry. That keeps the emitting modules free of notification concerns (the reason the
// bus exists) while making the mapping reviewable in one table.
//
// Failure policy is unchanged and deliberate: a payload this module cannot parse, or a subject that
// no longer exists, is logged and skipped, never thrown -- `events-worker.ts` retries a *throwing*
// handler five times and then abandons the row, and a deleted card must not eat those retries. A
// genuine infrastructure failure (Postgres down) still throws from `resolveEvent` and is retried.
import type { FastifyBaseLogger } from 'fastify'
import { subscribe, type EventHandler, type OutboxEventRecord } from '@devon/db'
import { notifyUser } from './notify.js'
import { NOTIFICATION_REGISTRY, specFor, type NotificationSpec } from './registry.js'
import { resolveEvent, type ResolvedEvent } from './sources.js'

export { NOTIFICATION_REGISTRY }

/** Every user id the spec's rules name, de-duplicated, with the actor removed (nobody is notified
 * about their own action) and any blank id dropped. Pure, so the fan-out rule is unit-testable. */
export function recipientsFor(spec: NotificationSpec, resolved: ResolvedEvent): string[] {
  const out = new Set<string>()
  for (const rule of spec.recipients) {
    for (const id of resolved.byRule[rule] ?? []) {
      if (id) out.add(id)
    }
  }
  if (resolved.facts.actorUserId) out.delete(resolved.facts.actorUserId)
  return [...out]
}

async function handle(log: FastifyBaseLogger, event: OutboxEventRecord): Promise<void> {
  const entry = NOTIFICATION_REGISTRY[event.type]
  if (!entry) {
    // Not an error at runtime -- a new module may ship an event before this table knows it. It *is*
    // a build error: `test/unit/notifications.registry.test.ts` fails when an emitted name is
    // missing here, so this branch only ever runs for an event emitted by code that is not in the
    // scan's path (a plugin, a migration-time backfill).
    log.warn({ eventType: event.type }, 'notifications: no registry entry for an emitted event')
    return
  }
  const spec = specFor(event.type)
  if (!spec) return // a `notify: false` entry -- deliberately silent, reason recorded in the table

  const resolved = await resolveEvent({
    eventType: event.type,
    source: spec.source,
    departmentId: event.departmentId,
    payload: event.payload,
  })
  if (!resolved) {
    log.debug(
      { eventType: event.type },
      'notifications: the subject of this event no longer exists -- nothing to notify about',
    )
    return
  }

  const recipients = recipientsFor(spec, resolved)
  if (recipients.length === 0) return

  const title = spec.title(resolved.facts)
  const body = spec.body(resolved.facts)
  const deepLink = spec.deepLink(resolved.facts)
  const eventAt = spec.carriesEventAt ? resolved.facts.at : null

  // Sequential, not `Promise.all` (the same reasoning `events-worker.ts`'s own drain loop documents,
  // and a plain indexed loop so the no-await-in-loop rule does not mistake it for the independent-
  // items case): each recipient's insert + Telegram delivery is independent, but running them one at
  // a time keeps one failing delivery from racing another recipient's write and keeps a thrown error
  // attributable to a single recipient. Recipient counts here are a department, not a mailing list.
  for (let i = 0; i < recipients.length; i += 1) {
    const userId = recipients[i]!
    // nosemgrep: query-in-loop -- see this loop's comment above.
    await notifyUser(log, {
      userId,
      type: event.type,
      reason: spec.reason,
      subjectType: spec.subjectType,
      subjectId: resolved.facts.subjectId,
      departmentId: event.departmentId,
      title,
      body,
      deepLink,
      eventAt,
    })
  }
}

function makeHandler(log: FastifyBaseLogger): EventHandler {
  return async (event: OutboxEventRecord) => {
    try {
      await handle(log, event)
    } catch (err) {
      // Rethrown deliberately: `events-worker.ts` records the message on the row and retries, which
      // is right for a transient database failure. The parse/missing-subject cases above return
      // before reaching here, so a retry storm can only be caused by real infrastructure trouble.
      log.error({ err, eventType: event.type }, 'notifications: failed to fan an event out')
      throw err
    }
  }
}

/** Called once from `index.ts`'s plugin body (MODULE-GUIDE.md "Domain events") -- a plugin
 * registration runs exactly once per process, the same guarantee `subscribe()` needs. */
export function registerNotificationEventSubscriptions(log: FastifyBaseLogger): () => void {
  return subscribe('*', makeHandler(log))
}
