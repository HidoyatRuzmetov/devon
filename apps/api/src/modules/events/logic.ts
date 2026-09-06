// Pure business-logic helpers for the events module -- no I/O, unit-tested directly
// (`apps/api/test/unit/events/logic.test.ts`) without a database. `service.ts` is the only caller.
import type { EventChange } from './schemas.js'

export type DiffableEvent = {
  title: string
  startsAt: string
  endsAt: string
  place: string | null
  placeUrl: string | null
  capacity: number | null
  costNote: string | null
  description: string | null
}

const DIFF_FIELDS: ReadonlyArray<keyof DiffableEvent> = [
  'title',
  'startsAt',
  'endsAt',
  'place',
  'placeUrl',
  'capacity',
  'costNote',
  'description',
]

/** The organiser-update diff summary (TECH-SPEC §3.4 `updated_summary`, "what changed, for
 * notifications"). Structured, never a pre-rendered sentence, so every locale can format it
 * (`schemas.ts`'s `eventChangeSchema`). Returns `[]` when nothing user-facing changed -- the caller
 * decides whether an empty diff still counts as "updated" for audit purposes. */
export function diffEvent(before: DiffableEvent, after: DiffableEvent): EventChange[] {
  const changes: EventChange[] = []
  for (const field of DIFF_FIELDS) {
    const b = before[field]
    const a = after[field]
    if (b === a) continue
    changes.push({
      field,
      before: b === null || b === undefined ? null : String(b),
      after: a === null || a === undefined ? null : String(a),
    })
  }
  return changes
}

export type RsvpCapacityResult =
  | { status: 'yes' }
  | { status: 'waitlist' }
  /** Capacity is full and waitlisting is off -- `service.ts` maps this to a 409. */
  | { status: 'rejected' }

/** Whether a "yes" RSVP (worth `unitsNeeded` = 1 + guests seats) fits, should waitlist, or must be
 * rejected. `currentGoingUnits` excludes the requesting user's own prior "yes" units when this is an
 * update to an existing RSVP (the caller subtracts those first) -- otherwise a person re-confirming
 * their own spot would see it as already taken. */
export function resolveYesRsvp(opts: {
  capacity: number | null
  waitlistEnabled: boolean
  currentGoingUnits: number
  unitsNeeded: number
}): RsvpCapacityResult {
  if (opts.capacity === null) return { status: 'yes' }
  const remaining = opts.capacity - opts.currentGoingUnits
  if (remaining >= opts.unitsNeeded) return { status: 'yes' }
  return opts.waitlistEnabled ? { status: 'waitlist' } : { status: 'rejected' }
}

/** `events.status` (`draft`/`cancelled`/`done` are never touched here -- only the capacity-derived
 * `open`/`full` pair changes as RSVPs come and go). */
export function eventStatusFromUnits(
  currentStatus: 'draft' | 'open' | 'full' | 'cancelled' | 'done',
  capacity: number | null,
  goingUnits: number,
): 'draft' | 'open' | 'full' | 'cancelled' | 'done' {
  if (currentStatus === 'cancelled' || currentStatus === 'done' || currentStatus === 'draft') {
    return currentStatus
  }
  if (capacity !== null && goingUnits >= capacity) return 'full'
  return 'open'
}

/**
 * FIFO promotion (RSVP waitlist and carpool-seat waitlist alike: both are "N units against a shared
 * capacity" problems). Walks the waitlist in arrival order and promotes whoever fits next, stopping at
 * the first entry that does not -- a strict queue, never gap-filling a later, smaller party ahead of
 * an earlier, larger one still waiting for room.
 */
export function selectWaitlistPromotions(
  waitlist: ReadonlyArray<{ id: string; units: number }>,
  freedUnits: number,
): string[] {
  const promoted: string[] = []
  let remaining = freedUnits
  for (const entry of waitlist) {
    if (entry.units <= remaining) {
      promoted.push(entry.id)
      remaining -= entry.units
    } else {
      break
    }
  }
  return promoted
}

/** Poll-kind vote shape: `single`/`date` accept exactly one option id, `multi` accepts 1..N distinct
 * ids that all belong to the poll. Returns an error message key (never thrown here -- pure) or `null`
 * when the vote is well-formed for this poll. */
export function validatePollVote(
  kind: 'date' | 'single' | 'multi',
  optionIds: readonly string[],
  validOptionIds: ReadonlySet<string>,
): string | null {
  const unique = new Set(optionIds)
  if (unique.size !== optionIds.length) return 'duplicate_option'
  for (const id of unique) {
    if (!validOptionIds.has(id)) return 'unknown_option'
  }
  if ((kind === 'single' || kind === 'date') && unique.size !== 1) return 'single_choice_required'
  return null
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
}
