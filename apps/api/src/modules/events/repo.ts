// Raw-SQL data access for the events module. `Tx.raw()` (`@devon/db`), never `Tx.drizzle` against a
// schema object -- `packages/db/src/schema/events.ts` exists for this module's own seed code (which
// lives inside `@devon/db` and can reach it by relative import); `@devon/db`'s `exports` map only
// opens its root barrel, and that barrel deliberately never re-exports a module's own schema file
// (MODULE-GUIDE.md "DB: schema"), so this is the sanctioned route from `apps/api` (MODULE-GUIDE.md
// "API modules": "never a direct `@devon/db` import from a route handler" -- this file *is* that one
// non-handler seam, exactly like `apps/api/src/db/repo.ts` for the foundation tables).
//
// Every function takes the already-open `Tx` (never opens a connection itself) and every write sets
// `department_id` from a parameter the caller derives from the actor's own session context -- never
// from client input -- because the RLS policy's `with check` only enforces that the row matches the
// connection's GUC, not that it matches any particular *value* a caller claims.
import { sql } from 'drizzle-orm'
import type { Tx } from '@devon/db'

export type EventRow = {
  id: string
  department_id: string
  title: string
  description: string | null
  category: string
  illustration_key: string
  starts_at: Date
  ends_at: Date
  timezone: string
  place: string | null
  place_url: string | null
  capacity: number | null
  waitlist_enabled: boolean
  rsvp_deadline: Date | null
  cost_note: string | null
  reminder_offsets_minutes: number[]
  organizer_user_id: string
  status: string
  updated_summary: string | null
  cancelled_at: Date | null
  cancelled_reason: string | null
  created_at: Date
  updated_at: Date
  version: number
  organizer_given_name: string
  organizer_family_name: string
}

const EVENT_SELECT = sql`
  select e.id, e.department_id, e.title, e.description, e.category, e.illustration_key,
         e.starts_at, e.ends_at, e.timezone, e.place, e.place_url, e.capacity, e.waitlist_enabled,
         e.rsvp_deadline, e.cost_note, e.reminder_offsets_minutes, e.organizer_user_id, e.status,
         e.updated_summary, e.cancelled_at, e.cancelled_reason, e.created_at, e.updated_at, e.version,
         u.given_name as organizer_given_name, u.family_name as organizer_family_name
  from app.events e
  join app.users u on u.id = e.organizer_user_id
`

export async function getEventRow(tx: Tx, eventId: string): Promise<EventRow | null> {
  const rows = await tx.raw<EventRow>(
    sql`${EVENT_SELECT} where e.id = ${eventId} and e.deleted_at is null`,
  )
  return rows[0] ?? null
}

export async function listEventRows(
  tx: Tx,
  opts: { from?: Date | undefined; to?: Date | undefined } = {},
): Promise<EventRow[]> {
  const from = opts.from ?? null
  const to = opts.to ?? null
  return tx.raw<EventRow>(sql`
    ${EVENT_SELECT}
    where e.deleted_at is null
      and (${from}::timestamptz is null or e.ends_at >= ${from})
      and (${to}::timestamptz is null or e.starts_at <= ${to})
    order by e.starts_at asc
  `)
}

/** The signed-in user's own combined calendar feed (TECH-SPEC §3.4: "ICS ... per person") -- every
 * event they RSVPed yes or maybe to, past or future, excluding cancelled events. */
export async function listMyIcsEvents(tx: Tx, userId: string): Promise<EventRow[]> {
  return tx.raw<EventRow>(sql`
    ${EVENT_SELECT}
    where e.deleted_at is null and e.status <> 'cancelled'
      and exists (
        select 1 from app.event_rsvps r
        where r.event_id = e.id and r.user_id = ${userId} and r.status in ('yes', 'maybe')
      )
    order by e.starts_at asc
  `)
}

export type NewEvent = {
  id: string
  departmentId: string
  organizerUserId: string
  title: string
  description: string | null
  category: string
  illustrationKey: string
  startsAt: Date
  endsAt: Date
  timezone: string
  place: string | null
  placeUrl: string | null
  capacity: number | null
  waitlistEnabled: boolean
  rsvpDeadline: Date | null
  costNote: string | null
  reminderOffsetsMinutes: number[]
}

export async function insertEvent(tx: Tx, e: NewEvent): Promise<void> {
  await tx.raw(sql`
    insert into app.events
      (id, department_id, organizer_user_id, title, description, category, illustration_key,
       starts_at, ends_at, timezone, place, place_url, capacity, waitlist_enabled, rsvp_deadline,
       cost_note, reminder_offsets_minutes, status)
    values
      (${e.id}, ${e.departmentId}, ${e.organizerUserId}, ${e.title}, ${e.description}, ${e.category}::app.event_category,
       ${e.illustrationKey}, ${e.startsAt}, ${e.endsAt}, ${e.timezone}, ${e.place}, ${e.placeUrl},
       ${e.capacity}, ${e.waitlistEnabled}, ${e.rsvpDeadline}, ${e.costNote},
       ${e.reminderOffsetsMinutes}::int[], 'open')
  `)
}

export type EventPatch = {
  title: string
  description: string | null
  category: string
  illustrationKey: string
  startsAt: Date
  endsAt: Date
  timezone: string
  place: string | null
  placeUrl: string | null
  capacity: number | null
  waitlistEnabled: boolean
  rsvpDeadline: Date | null
  costNote: string | null
  reminderOffsetsMinutes: number[]
}

export async function updateEventFields(
  tx: Tx,
  eventId: string,
  patch: EventPatch,
  updatedSummaryJson: string | null,
  status: string,
): Promise<void> {
  await tx.raw(sql`
    update app.events set
      title = ${patch.title}, description = ${patch.description}, category = ${patch.category}::app.event_category,
      illustration_key = ${patch.illustrationKey}, starts_at = ${patch.startsAt}, ends_at = ${patch.endsAt},
      timezone = ${patch.timezone}, place = ${patch.place}, place_url = ${patch.placeUrl},
      capacity = ${patch.capacity}, waitlist_enabled = ${patch.waitlistEnabled},
      rsvp_deadline = ${patch.rsvpDeadline}, cost_note = ${patch.costNote},
      reminder_offsets_minutes = ${patch.reminderOffsetsMinutes}::int[],
      updated_summary = ${updatedSummaryJson}, status = ${status}::app.event_status,
      updated_at = now(), version = version + 1
    where id = ${eventId}
  `)
}

export async function setEventStatus(tx: Tx, eventId: string, status: string): Promise<void> {
  await tx.raw(sql`
    update app.events set status = ${status}::app.event_status, updated_at = now(), version = version + 1
    where id = ${eventId} and status not in ('cancelled', 'done')
  `)
}

/** Every user who RSVPed yes/maybe/waitlist -- the cancellation-notification audience (TECH-SPEC
 * §3.4: "cancellation notifies everyone who RSVPed"). */
export async function listRsvpedUserIds(tx: Tx, eventId: string): Promise<string[]> {
  const rows = await tx.raw<{ user_id: string }>(sql`
    select user_id from app.event_rsvps where event_id = ${eventId} and status <> 'no'
  `)
  return rows.map((r) => r.user_id)
}

export async function cancelEvent(tx: Tx, eventId: string, reason: string): Promise<void> {
  await tx.raw(sql`
    update app.events set status = 'cancelled', cancelled_at = now(), cancelled_reason = ${reason},
      updated_at = now(), version = version + 1
    where id = ${eventId}
  `)
}

// --- RSVPs -------------------------------------------------------------------------------------

export type RsvpCounts = { going_units: number; maybe_count: number; waitlist_count: number }

export async function getRsvpCounts(tx: Tx, eventId: string): Promise<RsvpCounts> {
  const rows = await tx.raw<RsvpCounts>(sql`
    select
      coalesce(sum(case when status = 'yes' then 1 + guests else 0 end), 0)::int as going_units,
      count(*) filter (where status = 'maybe')::int as maybe_count,
      count(*) filter (where status = 'waitlist')::int as waitlist_count
    from app.event_rsvps where event_id = ${eventId}
  `)
  return rows[0] ?? { going_units: 0, maybe_count: 0, waitlist_count: 0 }
}

export type RsvpCountsForEventRow = {
  event_id: string
  going_units: number
  maybe_count: number
  waitlist_count: number
}

/** Batched, not one query per event in `listEventRows`'s result (TECH-SPEC §16 "no query in a
 * loop"). */
export async function getRsvpCountsForEvents(
  tx: Tx,
  eventIds: readonly string[],
): Promise<RsvpCountsForEventRow[]> {
  if (eventIds.length === 0) return []
  return tx.raw<RsvpCountsForEventRow>(sql`
    select event_id,
      coalesce(sum(case when status = 'yes' then 1 + guests else 0 end), 0)::int as going_units,
      count(*) filter (where status = 'maybe')::int as maybe_count,
      count(*) filter (where status = 'waitlist')::int as waitlist_count
    from app.event_rsvps where event_id = any(${eventIds}::uuid[]) group by event_id
  `)
}

export type MyRsvpForEventRow = {
  event_id: string
  status: string
  guests: number
  note: string | null
}

export async function getMyRsvpsForEvents(
  tx: Tx,
  eventIds: readonly string[],
  userId: string,
): Promise<MyRsvpForEventRow[]> {
  if (eventIds.length === 0) return []
  return tx.raw<MyRsvpForEventRow>(sql`
    select event_id, status, guests, note from app.event_rsvps
    where event_id = any(${eventIds}::uuid[]) and user_id = ${userId}
  `)
}

export type RsvpRow = { status: string; guests: number; note: string | null }

export async function getMyRsvp(tx: Tx, eventId: string, userId: string): Promise<RsvpRow | null> {
  const rows = await tx.raw<RsvpRow>(sql`
    select status, guests, note from app.event_rsvps where event_id = ${eventId} and user_id = ${userId}
  `)
  return rows[0] ?? null
}

export async function upsertRsvp(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    eventId: string
    userId: string
    status: string
    guests: number
    note: string | null
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.event_rsvps (id, department_id, event_id, user_id, status, guests, note, changed_at)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.userId},
            ${input.status}::app.event_rsvp_status, ${input.guests}, ${input.note}, now())
    on conflict (event_id, user_id) do update set
      status = excluded.status, guests = excluded.guests, note = excluded.note, changed_at = now()
  `)
}

export type RsvpListRow = {
  user_id: string
  given_name: string
  family_name: string
  status: string
  guests: number
  note: string | null
  changed_at: Date
}

export async function listRsvps(tx: Tx, eventId: string): Promise<RsvpListRow[]> {
  return tx.raw<RsvpListRow>(sql`
    select r.user_id, u.given_name, u.family_name, r.status, r.guests, r.note, r.changed_at
    from app.event_rsvps r join app.users u on u.id = r.user_id
    where r.event_id = ${eventId}
    order by (case r.status when 'yes' then 0 when 'maybe' then 1 when 'waitlist' then 2 else 3 end), r.changed_at asc
  `)
}

export async function listWaitlistedRsvps(
  tx: Tx,
  eventId: string,
): Promise<Array<{ id: string; units: number }>> {
  const rows = await tx.raw<{ id: string; guests: number }>(sql`
    select id, guests from app.event_rsvps
    where event_id = ${eventId} and status = 'waitlist'
    order by changed_at asc
  `)
  return rows.map((r) => ({ id: r.id, units: 1 + r.guests }))
}

export async function promoteRsvps(tx: Tx, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await tx.raw(sql`
    update app.event_rsvps set status = 'yes', changed_at = now() where id = any(${ids}::uuid[])
  `)
}

// --- Comments ------------------------------------------------------------------------------------

export type CommentRow = {
  id: string
  author_user_id: string
  given_name: string
  family_name: string
  body: string
  created_at: Date
}

export async function listComments(tx: Tx, eventId: string): Promise<CommentRow[]> {
  return tx.raw<CommentRow>(sql`
    select c.id, c.author_user_id, u.given_name, u.family_name, c.body, c.created_at
    from app.event_comments c join app.users u on u.id = c.author_user_id
    where c.event_id = ${eventId} and c.deleted_at is null
    order by c.created_at asc
  `)
}

export async function insertComment(
  tx: Tx,
  input: { id: string; departmentId: string; eventId: string; authorUserId: string; body: string },
): Promise<void> {
  await tx.raw(sql`
    insert into app.event_comments (id, department_id, event_id, author_user_id, body)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.authorUserId}, ${input.body})
  `)
}

export async function getCommentAuthor(tx: Tx, commentId: string): Promise<string | null> {
  const rows = await tx.raw<{ author_user_id: string }>(
    sql`select author_user_id from app.event_comments where id = ${commentId} and deleted_at is null`,
  )
  return rows[0]?.author_user_id ?? null
}

export async function softDeleteComment(tx: Tx, commentId: string): Promise<void> {
  await tx.raw(sql`update app.event_comments set deleted_at = now() where id = ${commentId}`)
}

// --- Carpools ------------------------------------------------------------------------------------

export type CarpoolRow = {
  id: string
  driver_user_id: string
  given_name: string
  family_name: string
  seats: number
  departure_place: string | null
  departure_at: Date | null
  note: string | null
  status: string
}

export async function listCarpools(tx: Tx, eventId: string): Promise<CarpoolRow[]> {
  return tx.raw<CarpoolRow>(sql`
    select c.id, c.driver_user_id, u.given_name, u.family_name, c.seats, c.departure_place,
           c.departure_at, c.note, c.status
    from app.carpools c join app.users u on u.id = c.driver_user_id
    where c.event_id = ${eventId}
    order by c.created_at asc
  `)
}

export async function insertCarpool(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    eventId: string
    driverUserId: string
    seats: number
    departurePlace: string | null
    departureAt: Date | null
    note: string | null
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.carpools (id, department_id, event_id, driver_user_id, seats, departure_place, departure_at, note)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.driverUserId}, ${input.seats},
            ${input.departurePlace}, ${input.departureAt}, ${input.note})
  `)
}

export async function getCarpoolDriver(tx: Tx, carpoolId: string): Promise<string | null> {
  const rows = await tx.raw<{ driver_user_id: string }>(
    sql`select driver_user_id from app.carpools where id = ${carpoolId}`,
  )
  return rows[0]?.driver_user_id ?? null
}

export type CarpoolFullRow = CarpoolRow & { department_id: string; event_id: string }

export async function getCarpool(tx: Tx, carpoolId: string): Promise<CarpoolFullRow | null> {
  const rows = await tx.raw<CarpoolFullRow>(sql`
    select c.id, c.department_id, c.event_id, c.driver_user_id, u.given_name, u.family_name, c.seats,
           c.departure_place, c.departure_at, c.note, c.status
    from app.carpools c join app.users u on u.id = c.driver_user_id
    where c.id = ${carpoolId}
  `)
  return rows[0] ?? null
}

export type CarpoolSeatRow = {
  user_id: string
  given_name: string
  family_name: string
  seats_claimed: number
  status: string
}

export async function listCarpoolSeats(tx: Tx, carpoolId: string): Promise<CarpoolSeatRow[]> {
  return tx.raw<CarpoolSeatRow>(sql`
    select s.user_id, u.given_name, u.family_name, s.seats_claimed, s.status
    from app.carpool_seats s join app.users u on u.id = s.user_id
    where s.carpool_id = ${carpoolId}
    order by (case s.status when 'confirmed' then 0 else 1 end), s.claimed_at asc
  `)
}

export async function getConfirmedSeatUnits(tx: Tx, carpoolId: string): Promise<number> {
  const rows = await tx.raw<{ units: number }>(sql`
    select coalesce(sum(seats_claimed), 0)::int as units from app.carpool_seats
    where carpool_id = ${carpoolId} and status = 'confirmed'
  `)
  return rows[0]?.units ?? 0
}

export async function getMyCarpoolSeat(
  tx: Tx,
  carpoolId: string,
  userId: string,
): Promise<{ seats_claimed: number; status: string } | null> {
  const rows = await tx.raw<{ seats_claimed: number; status: string }>(sql`
    select seats_claimed, status from app.carpool_seats where carpool_id = ${carpoolId} and user_id = ${userId}
  `)
  return rows[0] ?? null
}

export async function upsertCarpoolSeat(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    carpoolId: string
    userId: string
    seatsClaimed: number
    status: string
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.carpool_seats (id, department_id, carpool_id, user_id, seats_claimed, status, claimed_at)
    values (${input.id}, ${input.departmentId}, ${input.carpoolId}, ${input.userId}, ${input.seatsClaimed},
            ${input.status}::app.carpool_seat_status, now())
    on conflict (carpool_id, user_id) do update set
      seats_claimed = excluded.seats_claimed, status = excluded.status, claimed_at = now()
  `)
}

export async function releaseCarpoolSeat(tx: Tx, carpoolId: string, userId: string): Promise<void> {
  await tx.raw(
    sql`delete from app.carpool_seats where carpool_id = ${carpoolId} and user_id = ${userId}`,
  )
}

export async function listWaitlistedCarpoolSeats(
  tx: Tx,
  carpoolId: string,
): Promise<Array<{ id: string; units: number }>> {
  const rows = await tx.raw<{ user_id: string; seats_claimed: number }>(sql`
    select user_id, seats_claimed from app.carpool_seats
    where carpool_id = ${carpoolId} and status = 'waitlist'
    order by claimed_at asc
  `)
  return rows.map((r) => ({ id: r.user_id, units: r.seats_claimed }))
}

export async function promoteCarpoolSeats(
  tx: Tx,
  carpoolId: string,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) return
  await tx.raw(sql`
    update app.carpool_seats set status = 'confirmed'
    where carpool_id = ${carpoolId} and user_id = any(${userIds}::uuid[])
  `)
}

// --- Items ("who brings what") --------------------------------------------------------------------

export type ItemRow = {
  id: string
  label: string
  quantity: number
  claimed_by_user_id: string | null
  claimed_given_name: string | null
  claimed_family_name: string | null
}

export async function listItems(tx: Tx, eventId: string): Promise<ItemRow[]> {
  return tx.raw<ItemRow>(sql`
    select i.id, i.label, i.quantity, i.claimed_by_user_id,
           u.given_name as claimed_given_name, u.family_name as claimed_family_name
    from app.event_items i left join app.users u on u.id = i.claimed_by_user_id
    where i.event_id = ${eventId}
    order by i.created_at asc
  `)
}

export async function insertItem(
  tx: Tx,
  input: { id: string; departmentId: string; eventId: string; label: string; quantity: number },
): Promise<void> {
  await tx.raw(sql`
    insert into app.event_items (id, department_id, event_id, label, quantity)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.label}, ${input.quantity})
  `)
}

/** Race-safe: only succeeds while nobody has claimed it yet (`where claimed_by_user_id is null`).
 * Returns `true` iff this call is the one that claimed it. */
export async function claimItem(tx: Tx, itemId: string, userId: string): Promise<boolean> {
  const rows = await tx.raw<{ id: string }>(sql`
    update app.event_items set claimed_by_user_id = ${userId}, claimed_at = now()
    where id = ${itemId} and claimed_by_user_id is null
    returning id
  `)
  return rows.length > 0
}

export async function releaseItem(tx: Tx, itemId: string, userId: string): Promise<boolean> {
  const rows = await tx.raw<{ id: string }>(sql`
    update app.event_items set claimed_by_user_id = null, claimed_at = null
    where id = ${itemId} and claimed_by_user_id = ${userId}
    returning id
  `)
  return rows.length > 0
}

// --- Polls -----------------------------------------------------------------------------------------

export type PollRow = {
  id: string
  department_id: string
  kind: string
  question: string
  anonymous: boolean
  closes_at: Date | null
  status: string
  created_by_user_id: string
  given_name: string
  family_name: string
}

export async function listPolls(tx: Tx, eventId: string): Promise<PollRow[]> {
  return tx.raw<PollRow>(sql`
    select p.id, p.department_id, p.kind, p.question, p.anonymous, p.closes_at, p.status,
           p.created_by_user_id, u.given_name, u.family_name
    from app.polls p join app.users u on u.id = p.created_by_user_id
    where p.event_id = ${eventId}
    order by p.created_at asc
  `)
}

export async function getPoll(tx: Tx, pollId: string): Promise<PollRow | null> {
  const rows = await tx.raw<PollRow>(sql`
    select p.id, p.department_id, p.kind, p.question, p.anonymous, p.closes_at, p.status,
           p.created_by_user_id, u.given_name, u.family_name
    from app.polls p join app.users u on u.id = p.created_by_user_id
    where p.id = ${pollId}
  `)
  return rows[0] ?? null
}

export async function insertPoll(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    eventId: string
    kind: string
    question: string
    anonymous: boolean
    closesAt: Date | null
    createdByUserId: string
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.polls (id, department_id, event_id, kind, question, anonymous, closes_at, created_by_user_id)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.kind}::app.poll_kind,
            ${input.question}, ${input.anonymous}, ${input.closesAt}, ${input.createdByUserId})
  `)
}

export type PollOptionRow = {
  id: string
  label: string
  option_date: Date | null
  sort_order: number
}

export async function insertPollOptions(
  tx: Tx,
  pollId: string,
  departmentId: string,
  options: ReadonlyArray<{ id: string; label: string; optionDate: Date | null; sortOrder: number }>,
): Promise<void> {
  // Independent rows for the same brand-new poll -- Promise.all, not a for-of loop with an
  // await inside it (TECH-SPEC §16 "no query in a loop").
  await Promise.all(
    options.map((o) =>
      tx.raw(sql`
        insert into app.poll_options (id, department_id, poll_id, label, option_date, sort_order)
        values (${o.id}, ${departmentId}, ${pollId}, ${o.label}, ${o.optionDate}, ${o.sortOrder})
      `),
    ),
  )
}

export async function listPollOptions(tx: Tx, pollId: string): Promise<PollOptionRow[]> {
  return tx.raw<PollOptionRow>(sql`
    select id, label, option_date, sort_order from app.poll_options
    where poll_id = ${pollId} order by sort_order asc
  `)
}

export async function pollOptionIds(tx: Tx, pollId: string): Promise<string[]> {
  const rows = await tx.raw<{ id: string }>(
    sql`select id from app.poll_options where poll_id = ${pollId}`,
  )
  return rows.map((r) => r.id)
}

export type PollTallyRow = { option_id: string; votes: number }

export async function tallyPoll(tx: Tx, pollId: string): Promise<PollTallyRow[]> {
  return tx.raw<PollTallyRow>(sql`
    select option_id, count(*)::int as votes from app.poll_votes
    where poll_id = ${pollId} group by option_id
  `)
}

export async function myPollVoteOptionIds(
  tx: Tx,
  pollId: string,
  identity: { userId: string } | { voterHash: string },
): Promise<string[]> {
  const rows =
    'userId' in identity
      ? await tx.raw<{ option_id: string }>(
          sql`select option_id from app.poll_votes where poll_id = ${pollId} and user_id = ${identity.userId}`,
        )
      : await tx.raw<{ option_id: string }>(
          sql`select option_id from app.poll_votes where poll_id = ${pollId} and voter_hash = ${identity.voterHash}`,
        )
  return rows.map((r) => r.option_id)
}

export async function replacePollVotes(
  tx: Tx,
  input: {
    pollId: string
    departmentId: string
    identity: { userId: string } | { voterHash: string }
    optionIds: readonly string[]
    idFor: (optionId: string) => string
  },
): Promise<void> {
  if ('userId' in input.identity) {
    await tx.raw(
      sql`delete from app.poll_votes where poll_id = ${input.pollId} and user_id = ${input.identity.userId}`,
    )
  } else {
    await tx.raw(
      sql`delete from app.poll_votes where poll_id = ${input.pollId} and voter_hash = ${input.identity.voterHash}`,
    )
  }
  await Promise.all(
    input.optionIds.map((optionId) =>
      tx.raw(sql`
        insert into app.poll_votes (id, department_id, poll_id, option_id, user_id, voter_hash)
        values (${input.idFor(optionId)}, ${input.departmentId}, ${input.pollId}, ${optionId},
                ${'userId' in input.identity ? input.identity.userId : null},
                ${'voterHash' in input.identity ? input.identity.voterHash : null})
      `),
    ),
  )
}

// --- Photos ------------------------------------------------------------------------------------

export type PhotoRow = {
  id: string
  url: string
  caption: string | null
  added_by_user_id: string
  given_name: string
  family_name: string
  created_at: Date
}

export async function listPhotos(tx: Tx, eventId: string): Promise<PhotoRow[]> {
  return tx.raw<PhotoRow>(sql`
    select p.id, p.url, p.caption, p.added_by_user_id, u.given_name, u.family_name, p.created_at
    from app.event_photos p join app.users u on u.id = p.added_by_user_id
    where p.event_id = ${eventId}
    order by p.created_at asc
  `)
}

export async function insertPhoto(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    eventId: string
    url: string
    caption: string | null
    addedByUserId: string
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.event_photos (id, department_id, event_id, url, caption, added_by_user_id)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.url}, ${input.caption}, ${input.addedByUserId})
  `)
}

export async function getPhotoOwner(tx: Tx, photoId: string): Promise<string | null> {
  const rows = await tx.raw<{ added_by_user_id: string }>(
    sql`select added_by_user_id from app.event_photos where id = ${photoId}`,
  )
  return rows[0]?.added_by_user_id ?? null
}

export async function deletePhoto(tx: Tx, photoId: string): Promise<void> {
  await tx.raw(sql`delete from app.event_photos where id = ${photoId}`)
}

// --- Feedback ------------------------------------------------------------------------------------

export type FeedbackRow = {
  id: string
  user_id: string
  given_name: string
  family_name: string
  rating: number
  comment: string | null
  anonymous: boolean
  created_at: Date
}

export async function listFeedback(tx: Tx, eventId: string): Promise<FeedbackRow[]> {
  return tx.raw<FeedbackRow>(sql`
    select f.id, f.user_id, u.given_name, u.family_name, f.rating, f.comment, f.anonymous, f.created_at
    from app.event_feedback f join app.users u on u.id = f.user_id
    where f.event_id = ${eventId}
    order by f.created_at asc
  `)
}

export async function upsertFeedback(
  tx: Tx,
  input: {
    id: string
    departmentId: string
    eventId: string
    userId: string
    rating: number
    comment: string | null
    anonymous: boolean
  },
): Promise<void> {
  await tx.raw(sql`
    insert into app.event_feedback (id, department_id, event_id, user_id, rating, comment, anonymous)
    values (${input.id}, ${input.departmentId}, ${input.eventId}, ${input.userId}, ${input.rating}, ${input.comment}, ${input.anonymous})
    on conflict (event_id, user_id) do update set
      rating = excluded.rating, comment = excluded.comment, anonymous = excluded.anonymous
  `)
}

// --- Reminder jobs (no RLS -- see tenancy.ts) -----------------------------------------------------

export async function rescheduleReminderJobs(
  tx: Tx,
  input: {
    eventId: string
    departmentId: string
    startsAt: Date
    offsetsMinutes: readonly number[]
    idFor: (kind: string) => string
  },
): Promise<void> {
  await tx.raw(
    sql`delete from app.event_reminder_jobs where event_id = ${input.eventId} and fired_at is null`,
  )
  await Promise.all(
    input.offsetsMinutes.map((minutes) => {
      const kind = `offset_${minutes}`
      const fireAt = new Date(input.startsAt.getTime() - minutes * 60_000)
      return tx.raw(sql`
        insert into app.event_reminder_jobs (id, department_id, event_id, kind, fire_at)
        values (${input.idFor(kind)}, ${input.departmentId}, ${input.eventId}, ${kind}, ${fireAt})
        on conflict (event_id, kind) do update set fire_at = excluded.fire_at, fired_at = null
      `)
    }),
  )
}

export async function cancelReminderJobs(tx: Tx, eventId: string): Promise<void> {
  await tx.raw(
    sql`delete from app.event_reminder_jobs where event_id = ${eventId} and fired_at is null`,
  )
}
