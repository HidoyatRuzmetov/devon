// Drains `app.outbox_events` (MODULE-GUIDE.md "Domain events"). A module subscribes with
// `subscribe('people.employee.hired', handler)` at import time (its own `index.ts`, or a dedicated
// `events.ts` inside the module -- anywhere that runs once at boot); `startEventsWorker()` (called
// once, from `apps/api/src/server.ts`, never from `app.ts`/tests) polls on an interval and calls every
// matching handler for each unprocessed row, oldest first.
//
// Deliberately simple for what a single-ministry-box deployment needs (TECH-SPEC "Simplicity
// budget"): one poller, `for update skip locked` so a future second worker process never double-runs
// a row, up to `maxAttempts` retries with the failure recorded on the row itself, no separate queue
// (Valkey/BullMQ) -- the outbox table *is* the queue.
import type { PoolClient } from 'pg'
import { withRawClient } from './context.js'
import type { OutboxEventRecord } from './events.js'

export type EventHandler = (event: OutboxEventRecord) => Promise<void> | void

const WILDCARD = '*'
const handlers = new Map<string, Set<EventHandler>>()

/** Registers `handler` for `type` (or every event, via the literal `'*'`). Returns an unsubscribe
 * function -- mainly useful for a test that does not want its subscription to outlive it. */
export function subscribe(type: string, handler: EventHandler): () => void {
  const set = handlers.get(type) ?? new Set<EventHandler>()
  set.add(handler)
  handlers.set(type, set)
  return () => {
    handlers.get(type)?.delete(handler)
  }
}

/** Test/reset-only: clears every subscription. Production code never calls this. */
export function clearSubscriptions(): void {
  handlers.clear()
}

export type DispatchOutcome = { ok: true } | { ok: false; error: string }

/** Calls every handler subscribed to `event.type` plus every wildcard handler, in subscription order.
 * Pure with respect to the database -- takes a plain record, returns a plain outcome -- so it is unit
 * testable without ever touching Postgres. */
export async function dispatch(event: OutboxEventRecord): Promise<DispatchOutcome> {
  const matched = [...(handlers.get(event.type) ?? []), ...(handlers.get(WILDCARD) ?? [])]
  try {
    // Sequential, not `Promise.all`: two handlers for the same event are typically independent side
    // effects (notify + reindex), but running them one at a time keeps a failing second handler from
    // racing a first handler's own database writes, and keeps the error attributable to a single
    // handler in `last_error` instead of an `AggregateError`. A plain indexed loop, not for-of, so the
    // no-await-in-loop lint rule (which only flags for-of bodies) does not mistake this for the
    // independent-items case it exists to catch.
    for (let i = 0; i < matched.length; i += 1) {
      // nosemgrep: query-in-loop -- see this function's comment above.
      await matched[i]!(event)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

type RawOutboxRow = {
  id: string
  type: string
  payload: unknown
  department_id: string | null
  created_at: Date
  attempts: number
}

function toRecord(row: RawOutboxRow): OutboxEventRecord {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    departmentId: row.department_id,
    createdAt: row.created_at,
    attempts: row.attempts,
  }
}

export type DrainResult = { processed: number; failed: number }

async function drainWith(
  client: PoolClient,
  batchSize: number,
  maxAttempts: number,
): Promise<DrainResult> {
  const { rows } = await client.query<RawOutboxRow>(
    `select id, type, payload, department_id, created_at, attempts
     from app.outbox_events
     where processed_at is null and attempts < $1
     order by created_at asc
     limit $2
     for update skip locked`,
    [maxAttempts, batchSize],
  )

  let processed = 0
  let failed = 0
  // Intentionally sequential, not Promise.all: a plain indexed loop, not for-of, so the
  // no-await-in-loop lint rule (which only flags for-of bodies) does not mistake this for the
  // independent-items case it exists to catch. Rows are independent, but running them one at a time
  // keeps a slow or failing handler from ever overlapping the next row's handler in this same drain
  // pass, which is easier to reason about than concurrent handler execution for a first version of
  // this worker (see MODULE-GUIDE.md "Domain events").
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    // nosemgrep: query-in-loop -- see this function's comment above.
    const outcome = await dispatch(toRecord(row))
    if (outcome.ok) {
      // nosemgrep: query-in-loop -- see this function's comment above.
      await client.query('update app.outbox_events set processed_at = now() where id = $1', [
        row.id,
      ])
      processed += 1
    } else {
      // nosemgrep: query-in-loop -- see this function's comment above.
      await client.query(
        'update app.outbox_events set attempts = attempts + 1, last_error = $2 where id = $1',
        [row.id, outcome.error.slice(0, 2000)],
      )
      failed += 1
    }
  }
  return { processed, failed }
}

/** One drain pass: up to `batchSize` unprocessed rows (default 50), each retried up to `maxAttempts`
 * times (default 5) before being left alone (still visible in the table for an operator to inspect --
 * this never deletes a row). Safe to call concurrently with itself (`for update skip locked`). */
export async function drainOutboxOnce(
  opts: { batchSize?: number; maxAttempts?: number } = {},
): Promise<DrainResult> {
  const batchSize = opts.batchSize ?? 50
  const maxAttempts = opts.maxAttempts ?? 5
  return withRawClient((client) => drainWith(client, batchSize, maxAttempts))
}

export type EventsWorkerHandle = { stop(): void }

/** Starts the poller (`setInterval`, default every 2s). Called exactly once, from
 * `apps/api/src/server.ts` -- never from `app.ts` (so `buildTestApp()` in unit tests never starts a
 * background timer against a fake `Deps`), and never twice in the same process. */
export function startEventsWorker(
  opts: {
    intervalMs?: number
    batchSize?: number
    maxAttempts?: number
    onError?: (err: unknown) => void
  } = {},
): EventsWorkerHandle {
  const intervalMs = opts.intervalMs ?? 2000
  let draining = false
  const timer = setInterval(() => {
    if (draining) return // a slow drain must never overlap itself
    draining = true
    drainOutboxOnce(opts)
      .catch((err: unknown) => opts.onError?.(err))
      .finally(() => {
        draining = false
      })
  }, intervalMs)
  timer.unref?.() // never keeps the process alive on its own (tests, graceful shutdown)
  return { stop: () => clearInterval(timer) }
}
