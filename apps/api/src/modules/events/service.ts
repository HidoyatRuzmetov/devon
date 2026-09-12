// Orchestration for the events module: opens its own `withContext()` transaction per operation
// (MODULE-GUIDE.md "API modules" -- this is the one file in the module allowed to import `@devon/db`
// directly; route handlers in `index.ts` call only these functions), applies the business rules in
// `logic.ts`, and emits audit + domain events in the same transaction as the write that caused them
// (I-5, MODULE-GUIDE.md "Domain events").
import { randomUUID, createHash } from 'node:crypto'
import { withContext, type RequestContext, type Tx } from '@devon/db'
import { EventConflictError, EventForbiddenError, EventNotFoundError } from './errors.js'
import { buildIcs } from './ics.js'
import {
  average,
  diffEvent,
  eventStatusFromUnits,
  resolveYesRsvp,
  selectWaitlistPromotions,
  validatePollVote,
  type DiffableEvent,
} from './logic.js'
import * as repo from './repo.js'
import type {
  CarpoolDto,
  CommentDto,
  CreateEventBody,
  EventChange,
  EventDto,
  FeedbackDto,
  ItemDto,
  PollDto,
  RsvpDto,
  UpdateEventBody,
} from './schemas.js'

export type Actor = { userId: string; isHead: boolean; givenName: string; familyName: string }

function eventDiffable(e: repo.EventRow): DiffableEvent {
  return {
    title: e.title,
    startsAt: e.starts_at.toISOString(),
    endsAt: e.ends_at.toISOString(),
    place: e.place,
    placeUrl: e.place_url,
    capacity: e.capacity,
    costNote: e.cost_note,
    description: e.description,
  }
}

function requireManage(event: repo.EventRow, actor: Actor): void {
  if (event.organizer_user_id !== actor.userId && !actor.isHead) {
    throw new EventForbiddenError()
  }
}

function toEventDto(
  row: repo.EventRow,
  extra: {
    goingCount: number
    maybeCount: number
    waitlistCount: number
    myRsvp: { status: string; guests: number; note: string | null } | null
    canManage: boolean
  },
): EventDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as EventDto['category'],
    illustrationKey: row.illustration_key,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    timezone: row.timezone,
    place: row.place,
    placeUrl: row.place_url,
    capacity: row.capacity,
    waitlistEnabled: row.waitlist_enabled,
    rsvpDeadline: row.rsvp_deadline?.toISOString() ?? null,
    costNote: row.cost_note,
    reminderOffsetsMinutes: row.reminder_offsets_minutes,
    organizer: {
      id: row.organizer_user_id,
      givenName: row.organizer_given_name,
      familyName: row.organizer_family_name,
    },
    status: row.status as EventDto['status'],
    updatedSummary: row.updated_summary ? (JSON.parse(row.updated_summary) as EventChange[]) : null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledReason: row.cancelled_reason,
    goingCount: extra.goingCount,
    maybeCount: extra.maybeCount,
    waitlistCount: extra.waitlistCount,
    myRsvp: extra.myRsvp
      ? {
          status: extra.myRsvp.status as RsvpDto['status'],
          guests: extra.myRsvp.guests,
          note: extra.myRsvp.note,
        }
      : null,
    canManage: extra.canManage,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    version: row.version,
  }
}

function rsvpDeadlinePassed(event: repo.EventRow): boolean {
  return event.rsvp_deadline !== null && event.rsvp_deadline.getTime() < Date.now()
}

// --- Events ----------------------------------------------------------------------------------------

export async function listEvents(
  ctx: RequestContext,
  viewerUserId: string,
  isHead: boolean,
  range: { from?: Date | undefined; to?: Date | undefined },
): Promise<EventDto[]> {
  return withContext(ctx, async (tx) => {
    const rows = await repo.listEventRows(tx, range)
    const ids = rows.map((r) => r.id)
    const [counts, mine] = await Promise.all([
      repo.getRsvpCountsForEvents(tx, ids),
      repo.getMyRsvpsForEvents(tx, ids, viewerUserId),
    ])
    const countsById = new Map(counts.map((c) => [c.event_id, c]))
    const mineById = new Map(mine.map((m) => [m.event_id, m]))
    return rows.map((row) => {
      const c = countsById.get(row.id)
      const my = mineById.get(row.id) ?? null
      return toEventDto(row, {
        goingCount: c?.going_units ?? 0,
        maybeCount: c?.maybe_count ?? 0,
        waitlistCount: c?.waitlist_count ?? 0,
        myRsvp: my,
        canManage: row.organizer_user_id === viewerUserId || isHead,
      })
    })
  })
}

export async function getEvent(
  ctx: RequestContext,
  viewerUserId: string,
  isHead: boolean,
  eventId: string,
): Promise<EventDto> {
  return withContext(ctx, async (tx) => {
    const row = await repo.getEventRow(tx, eventId)
    if (!row) throw new EventNotFoundError()
    const [counts, my] = await Promise.all([
      repo.getRsvpCounts(tx, eventId),
      repo.getMyRsvp(tx, eventId, viewerUserId),
    ])
    return toEventDto(row, {
      goingCount: counts.going_units,
      maybeCount: counts.maybe_count,
      waitlistCount: counts.waitlist_count,
      myRsvp: my,
      canManage: row.organizer_user_id === viewerUserId || isHead,
    })
  })
}

export async function createEvent(
  ctx: RequestContext,
  actor: Actor,
  body: CreateEventBody,
): Promise<EventDto> {
  return withContext(ctx, async (tx) => {
    const id = randomUUID()
    await repo.insertEvent(tx, {
      id,
      departmentId: ctx.departmentId!,
      organizerUserId: actor.userId,
      title: body.title,
      description: body.description ?? null,
      category: body.category,
      illustrationKey: body.illustrationKey,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      timezone: body.timezone,
      place: body.place ?? null,
      placeUrl: body.placeUrl ?? null,
      capacity: body.capacity ?? null,
      waitlistEnabled: body.waitlistEnabled,
      rsvpDeadline: body.rsvpDeadline ? new Date(body.rsvpDeadline) : null,
      costNote: body.costNote ?? null,
      reminderOffsetsMinutes: body.reminderOffsetsMinutes,
    })
    await repo.rescheduleReminderJobs(tx, {
      eventId: id,
      departmentId: ctx.departmentId!,
      startsAt: new Date(body.startsAt),
      offsetsMinutes: body.reminderOffsetsMinutes,
      idFor: () => randomUUID(),
    })
    tx.audit({
      action: 'events.event_created',
      subjectType: 'event',
      subjectId: id,
      after: { title: body.title },
    })
    tx.emit({
      type: 'events.event.created',
      departmentId: ctx.departmentId,
      payload: {
        eventId: id,
        title: body.title,
        startsAt: body.startsAt,
        organizerUserId: actor.userId,
        actorUserId: actor.userId,
      },
    })
    const row = await repo.getEventRow(tx, id)
    return toEventDto(row!, {
      goingCount: 0,
      maybeCount: 0,
      waitlistCount: 0,
      myRsvp: null,
      canManage: true,
    })
  })
}

export async function updateEvent(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: UpdateEventBody,
): Promise<EventDto> {
  return withContext(ctx, async (tx) => {
    const before = await repo.getEventRow(tx, eventId)
    if (!before) throw new EventNotFoundError()
    requireManage(before, actor)

    const merged: repo.EventPatch = {
      title: body.title ?? before.title,
      description: body.description === undefined ? before.description : body.description,
      category: body.category ?? before.category,
      illustrationKey: body.illustrationKey ?? before.illustration_key,
      startsAt: body.startsAt ? new Date(body.startsAt) : before.starts_at,
      endsAt: body.endsAt ? new Date(body.endsAt) : before.ends_at,
      timezone: body.timezone ?? before.timezone,
      place: body.place === undefined ? before.place : body.place,
      placeUrl: body.placeUrl === undefined ? before.place_url : body.placeUrl,
      capacity: body.capacity === undefined ? before.capacity : body.capacity,
      waitlistEnabled: body.waitlistEnabled ?? before.waitlist_enabled,
      rsvpDeadline:
        body.rsvpDeadline === undefined
          ? before.rsvp_deadline
          : body.rsvpDeadline === null
            ? null
            : new Date(body.rsvpDeadline),
      costNote: body.costNote === undefined ? before.cost_note : body.costNote,
      reminderOffsetsMinutes: body.reminderOffsetsMinutes ?? before.reminder_offsets_minutes,
    }
    if (merged.endsAt.getTime() <= merged.startsAt.getTime()) {
      throw new EventConflictError('ends_before_starts')
    }

    const changes = diffEvent(eventDiffable(before), {
      title: merged.title,
      startsAt: merged.startsAt.toISOString(),
      endsAt: merged.endsAt.toISOString(),
      place: merged.place,
      placeUrl: merged.placeUrl,
      capacity: merged.capacity,
      costNote: merged.costNote,
      description: merged.description,
    })

    const counts = await repo.getRsvpCounts(tx, eventId)
    const nextStatus = eventStatusFromUnits(
      before.status as 'draft' | 'open' | 'full' | 'cancelled' | 'done',
      merged.capacity,
      counts.going_units,
    )

    await repo.updateEventFields(
      tx,
      eventId,
      merged,
      changes.length > 0 ? JSON.stringify(changes) : before.updated_summary,
      nextStatus,
    )

    const startsAtChanged = merged.startsAt.getTime() !== before.starts_at.getTime()
    const offsetsChanged =
      JSON.stringify(merged.reminderOffsetsMinutes) !==
      JSON.stringify(before.reminder_offsets_minutes)
    if (startsAtChanged || offsetsChanged) {
      await repo.rescheduleReminderJobs(tx, {
        eventId,
        departmentId: before.department_id,
        startsAt: merged.startsAt,
        offsetsMinutes: merged.reminderOffsetsMinutes,
        idFor: () => randomUUID(),
      })
    }

    if (changes.length > 0) {
      tx.audit({
        action: 'events.event_updated',
        subjectType: 'event',
        subjectId: eventId,
        before: eventDiffable(before),
        after: merged,
      })
      tx.emit({
        type: 'events.event.updated',
        departmentId: before.department_id,
        payload: { eventId, title: merged.title, changes, actorUserId: actor.userId },
      })
    }

    const row = await repo.getEventRow(tx, eventId)
    const my = await repo.getMyRsvp(tx, eventId, actor.userId)
    return toEventDto(row!, {
      goingCount: counts.going_units,
      maybeCount: counts.maybe_count,
      waitlistCount: counts.waitlist_count,
      myRsvp: my,
      canManage: true,
    })
  })
}

export async function cancelEvent(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  reason: string,
): Promise<EventDto> {
  return withContext(ctx, async (tx) => {
    const before = await repo.getEventRow(tx, eventId)
    if (!before) throw new EventNotFoundError()
    requireManage(before, actor)
    if (before.status === 'cancelled') throw new EventConflictError('already_cancelled')

    const rsvpedUserIds = await repo.listRsvpedUserIds(tx, eventId)
    await repo.cancelEvent(tx, eventId, reason)
    await repo.cancelReminderJobs(tx, eventId)

    tx.audit({
      action: 'events.event_cancelled',
      subjectType: 'event',
      subjectId: eventId,
      before: { status: before.status },
      after: { status: 'cancelled', reason },
    })
    tx.emit({
      type: 'events.event.cancelled',
      departmentId: before.department_id,
      payload: {
        eventId,
        title: before.title,
        reason,
        notifyUserIds: rsvpedUserIds,
        actorUserId: actor.userId,
      },
    })

    const row = await repo.getEventRow(tx, eventId)
    const counts = await repo.getRsvpCounts(tx, eventId)
    const my = await repo.getMyRsvp(tx, eventId, actor.userId)
    return toEventDto(row!, {
      goingCount: counts.going_units,
      maybeCount: counts.maybe_count,
      waitlistCount: counts.waitlist_count,
      myRsvp: my,
      canManage: true,
    })
  })
}

// --- RSVPs -----------------------------------------------------------------------------------------

export async function upsertRsvp(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: { status: string; guests: number; note?: string | undefined },
): Promise<EventDto> {
  const userId = actor.userId
  return withContext(ctx, async (tx) => {
    // Capacity is decided below by counting the existing `yes` units and comparing them to
    // `event.capacity`; without this lock two concurrent "yes" requests both read the pre-write
    // count and both seat themselves (the `concurrency-races` probe). Taken before the first read so
    // the count, the decision, the write and the waitlist promotion below are one indivisible step.
    await repo.lockEventForCapacity(tx, eventId)
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    if (event.status === 'cancelled' || event.status === 'done') {
      throw new EventConflictError('event_not_open')
    }
    if (rsvpDeadlinePassed(event) && body.status !== 'no') {
      throw new EventConflictError('rsvp_deadline_passed')
    }

    let finalStatus = body.status
    if (body.status === 'yes') {
      const existing = await repo.getMyRsvp(tx, eventId, userId)
      const previousUnits = existing?.status === 'yes' ? 1 + existing.guests : 0
      const counts = await repo.getRsvpCounts(tx, eventId)
      const currentGoingUnits = counts.going_units - previousUnits
      const result = resolveYesRsvp({
        capacity: event.capacity,
        waitlistEnabled: event.waitlist_enabled,
        currentGoingUnits,
        unitsNeeded: 1 + body.guests,
      })
      if (result.status === 'rejected') throw new EventConflictError('event_full')
      finalStatus = result.status
    }

    await repo.upsertRsvp(tx, {
      id: randomUUID(),
      departmentId: event.department_id,
      eventId,
      userId,
      status: finalStatus,
      guests: body.guests,
      note: body.note ?? null,
    })

    // Stepping away from a confirmed "yes" can free capacity for whoever is first on the waitlist.
    if (finalStatus !== 'yes') {
      const counts = await repo.getRsvpCounts(tx, eventId)
      if (event.capacity !== null) {
        const freeUnits = event.capacity - counts.going_units
        if (freeUnits > 0) {
          const waitlist = await repo.listWaitlistedRsvps(tx, eventId)
          const promoted = selectWaitlistPromotions(waitlist, freeUnits)
          await repo.promoteRsvps(tx, promoted)
        }
      }
    }

    const counts = await repo.getRsvpCounts(tx, eventId)
    const nextStatus = eventStatusFromUnits(
      event.status as 'draft' | 'open' | 'full' | 'cancelled' | 'done',
      event.capacity,
      counts.going_units,
    )
    if (nextStatus !== event.status) await repo.setEventStatus(tx, eventId, nextStatus)

    tx.audit({
      action: 'events.rsvp_changed',
      subjectType: 'event_rsvp',
      subjectId: eventId,
      after: { userId, status: finalStatus, guests: body.guests },
    })
    tx.emit({
      type: 'events.rsvp.changed',
      departmentId: event.department_id,
      payload: { eventId, userId, status: finalStatus, actorUserId: userId },
    })

    const row = await repo.getEventRow(tx, eventId)
    const my = await repo.getMyRsvp(tx, eventId, userId)
    return toEventDto(row!, {
      goingCount: counts.going_units,
      maybeCount: counts.maybe_count,
      waitlistCount: counts.waitlist_count,
      myRsvp: my,
      canManage: row!.organizer_user_id === userId || actor.isHead,
    })
  })
}

export async function listRsvps(ctx: RequestContext, eventId: string): Promise<RsvpDto[]> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const rows = await repo.listRsvps(tx, eventId)
    return rows.map((r) => ({
      userId: r.user_id,
      givenName: r.given_name,
      familyName: r.family_name,
      status: r.status as RsvpDto['status'],
      guests: r.guests,
      note: r.note,
      changedAt: r.changed_at.toISOString(),
    }))
  })
}

// --- Comments --------------------------------------------------------------------------------------

export async function listComments(
  ctx: RequestContext,
  viewerUserId: string,
  eventId: string,
): Promise<CommentDto[]> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const rows = await repo.listComments(tx, eventId)
    return rows.map((r) => ({
      id: r.id,
      author: { id: r.author_user_id, givenName: r.given_name, familyName: r.family_name },
      body: r.body,
      createdAt: r.created_at.toISOString(),
      canDelete: r.author_user_id === viewerUserId,
    }))
  })
}

export async function addComment(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: string,
): Promise<CommentDto> {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    const id = randomUUID()
    await repo.insertComment(tx, {
      id,
      departmentId: event.department_id,
      eventId,
      authorUserId: actor.userId,
      body,
    })
    tx.audit({ action: 'events.comment_created', subjectType: 'event_comment', subjectId: id })
    tx.emit({
      type: 'events.comment.created',
      departmentId: event.department_id,
      payload: { eventId, commentId: id, actorUserId: actor.userId },
    })
    return {
      id,
      author: { id: actor.userId, givenName: actor.givenName, familyName: actor.familyName },
      body,
      createdAt: new Date().toISOString(),
      canDelete: true,
    }
  })
}

export async function deleteComment(
  ctx: RequestContext,
  actor: Actor,
  commentId: string,
): Promise<void> {
  return withContext(ctx, async (tx) => {
    const authorUserId = await repo.getCommentAuthor(tx, commentId)
    if (!authorUserId) throw new EventNotFoundError()
    if (authorUserId !== actor.userId && !actor.isHead) throw new EventForbiddenError()
    await repo.softDeleteComment(tx, commentId)
    tx.audit({
      action: 'events.comment_deleted',
      subjectType: 'event_comment',
      subjectId: commentId,
    })
  })
}

// --- Carpools --------------------------------------------------------------------------------------

function toCarpoolDto(
  c: repo.CarpoolRow,
  passengers: repo.CarpoolSeatRow[],
  viewerUserId: string,
  isHead: boolean,
): CarpoolDto {
  const seatsClaimed = passengers
    .filter((p) => p.status === 'confirmed')
    .reduce((sum, p) => sum + p.seats_claimed, 0)
  return {
    id: c.id,
    driver: { id: c.driver_user_id, givenName: c.given_name, familyName: c.family_name },
    seats: c.seats,
    seatsClaimed,
    departurePlace: c.departure_place,
    departureAt: c.departure_at?.toISOString() ?? null,
    note: c.note,
    status: c.status as CarpoolDto['status'],
    passengers: passengers.map((p) => ({
      userId: p.user_id,
      givenName: p.given_name,
      familyName: p.family_name,
      seatsClaimed: p.seats_claimed,
      status: p.status as 'confirmed' | 'waitlist',
    })),
    canManage: c.driver_user_id === viewerUserId || isHead,
  }
}

export async function listCarpools(
  ctx: RequestContext,
  viewerUserId: string,
  isHead: boolean,
  eventId: string,
): Promise<CarpoolDto[]> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const carpools = await repo.listCarpools(tx, eventId)
    const seatsByCarpool = await Promise.all(carpools.map((c) => repo.listCarpoolSeats(tx, c.id)))
    return carpools.map((c, i) => toCarpoolDto(c, seatsByCarpool[i]!, viewerUserId, isHead))
  })
}

export async function createCarpool(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: {
    seats: number
    departurePlace?: string | undefined
    departureAt?: string | undefined
    note?: string | undefined
  },
): Promise<CarpoolDto> {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    const id = randomUUID()
    await repo.insertCarpool(tx, {
      id,
      departmentId: event.department_id,
      eventId,
      driverUserId: actor.userId,
      seats: body.seats,
      departurePlace: body.departurePlace ?? null,
      departureAt: body.departureAt ? new Date(body.departureAt) : null,
      note: body.note ?? null,
    })
    tx.audit({ action: 'events.carpool_created', subjectType: 'carpool', subjectId: id })
    tx.emit({
      type: 'events.carpool.created',
      departmentId: event.department_id,
      payload: { eventId, carpoolId: id, actorUserId: actor.userId },
    })
    const carpools = await repo.listCarpools(tx, eventId)
    const created = carpools.find((c) => c.id === id)!
    return toCarpoolDto(created, [], actor.userId, actor.isHead)
  })
}

export async function claimCarpoolSeat(
  ctx: RequestContext,
  actor: Actor,
  carpoolId: string,
  seats: number,
): Promise<void> {
  return withContext(ctx, async (tx) => {
    // Same aggregate invariant as RSVP capacity ("confirmed seats may not exceed `carpool.seats`"),
    // same remedy: serialise every seat decision for this one carpool so the read below cannot see a
    // count another in-flight claim is about to invalidate (the `concurrency-races` probe).
    await repo.lockCarpoolForSeats(tx, carpoolId)
    const carpool = await repo.getCarpool(tx, carpoolId)
    if (!carpool) throw new EventNotFoundError()
    if (carpool.status === 'cancelled') throw new EventConflictError('carpool_cancelled')
    if (carpool.driver_user_id === actor.userId) {
      throw new EventConflictError('driver_cannot_claim_own_offer')
    }

    const existing = await repo.getMyCarpoolSeat(tx, carpoolId, actor.userId)
    const previousUnits = existing?.status === 'confirmed' ? existing.seats_claimed : 0
    const confirmedUnits = (await repo.getConfirmedSeatUnits(tx, carpoolId)) - previousUnits
    const remaining = carpool.seats - confirmedUnits
    const status = seats <= remaining ? 'confirmed' : 'waitlist'

    await repo.upsertCarpoolSeat(tx, {
      id: randomUUID(),
      departmentId: carpool.department_id,
      carpoolId,
      userId: actor.userId,
      seatsClaimed: seats,
      status,
    })

    tx.audit({
      action: 'events.carpool_seat_claimed',
      subjectType: 'carpool',
      subjectId: carpoolId,
    })
    tx.emit({
      type: 'events.carpool.seat_claimed',
      departmentId: carpool.department_id,
      payload: {
        carpoolId,
        eventId: carpool.event_id,
        userId: actor.userId,
        status,
        actorUserId: actor.userId,
      },
    })
  })
}

export async function releaseCarpoolSeat(
  ctx: RequestContext,
  actor: Actor,
  carpoolId: string,
): Promise<void> {
  return withContext(ctx, async (tx) => {
    // Releasing frees units and promotes from the waitlist -- the same aggregate the claim path
    // guards, so it takes the same lock (a release racing a claim would otherwise over-promote).
    await repo.lockCarpoolForSeats(tx, carpoolId)
    const carpool = await repo.getCarpool(tx, carpoolId)
    if (!carpool) throw new EventNotFoundError()
    const existing = await repo.getMyCarpoolSeat(tx, carpoolId, actor.userId)
    const wasConfirmed = existing?.status === 'confirmed'
    await repo.releaseCarpoolSeat(tx, carpoolId, actor.userId)

    if (wasConfirmed) {
      const confirmedUnits = await repo.getConfirmedSeatUnits(tx, carpoolId)
      const freeUnits = carpool.seats - confirmedUnits
      if (freeUnits > 0) {
        const waitlist = await repo.listWaitlistedCarpoolSeats(tx, carpoolId)
        const promoted = selectWaitlistPromotions(waitlist, freeUnits)
        await repo.promoteCarpoolSeats(tx, carpoolId, promoted)
      }
    }

    tx.audit({
      action: 'events.carpool_seat_released',
      subjectType: 'carpool',
      subjectId: carpoolId,
    })
  })
}

// --- Items ("who brings what") ----------------------------------------------------------------------

function toItemDto(row: repo.ItemRow, viewerUserId: string): ItemDto {
  return {
    id: row.id,
    label: row.label,
    quantity: row.quantity,
    claimedBy: row.claimed_by_user_id
      ? {
          id: row.claimed_by_user_id,
          givenName: row.claimed_given_name ?? '',
          familyName: row.claimed_family_name ?? '',
        }
      : null,
    claimedByMe: row.claimed_by_user_id === viewerUserId,
  }
}

export async function listItems(
  ctx: RequestContext,
  viewerUserId: string,
  eventId: string,
): Promise<ItemDto[]> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const rows = await repo.listItems(tx, eventId)
    return rows.map((r) => toItemDto(r, viewerUserId))
  })
}

export async function addItem(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: { label: string; quantity: number },
): Promise<ItemDto> {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    const id = randomUUID()
    await repo.insertItem(tx, {
      id,
      departmentId: event.department_id,
      eventId,
      label: body.label,
      quantity: body.quantity,
    })
    tx.audit({
      action: 'events.item_added',
      subjectType: 'event_item',
      subjectId: id,
      after: { label: body.label, quantity: body.quantity, addedByUserId: actor.userId },
    })
    return { id, label: body.label, quantity: body.quantity, claimedBy: null, claimedByMe: false }
  })
}

export async function claimItem(
  ctx: RequestContext,
  actor: Actor,
  itemId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const claimed = await repo.claimItem(tx, itemId, actor.userId)
    if (claimed) {
      tx.audit({ action: 'events.item_claimed', subjectType: 'event_item', subjectId: itemId })
    }
    return claimed
  })
}

export async function releaseItem(
  ctx: RequestContext,
  actor: Actor,
  itemId: string,
): Promise<boolean> {
  return withContext(ctx, async (tx) => {
    const released = await repo.releaseItem(tx, itemId, actor.userId)
    if (released) {
      tx.audit({ action: 'events.item_unclaimed', subjectType: 'event_item', subjectId: itemId })
    }
    return released
  })
}

// --- Polls -----------------------------------------------------------------------------------------

function voterHashFor(pollId: string, userId: string): string {
  return createHash('sha256').update(`${pollId}:${userId}`).digest('hex')
}

async function pollToDto(
  tx: Tx,
  poll: repo.PollRow,
  viewerUserId: string,
  isHead: boolean,
): Promise<PollDto> {
  const [options, tally] = await Promise.all([
    repo.listPollOptions(tx, poll.id),
    repo.tallyPoll(tx, poll.id),
  ])
  const votesByOption = new Map(tally.map((t) => [t.option_id, t.votes]))
  const myVoteIds = new Set(
    await repo.myPollVoteOptionIds(
      tx,
      poll.id,
      poll.anonymous
        ? { voterHash: voterHashFor(poll.id, viewerUserId) }
        : { userId: viewerUserId },
    ),
  )
  return {
    id: poll.id,
    kind: poll.kind as PollDto['kind'],
    question: poll.question,
    anonymous: poll.anonymous,
    closesAt: poll.closes_at?.toISOString() ?? null,
    status: poll.status as PollDto['status'],
    createdBy: {
      id: poll.created_by_user_id,
      givenName: poll.given_name,
      familyName: poll.family_name,
    },
    totalVotes: tally.reduce((sum, t) => sum + t.votes, 0),
    options: options.map((o) => ({
      id: o.id,
      label: o.label,
      optionDate: o.option_date?.toISOString() ?? null,
      votes: votesByOption.get(o.id) ?? 0,
      votedByMe: myVoteIds.has(o.id),
    })),
    canManage: poll.created_by_user_id === viewerUserId || isHead,
  }
}

export async function listPolls(
  ctx: RequestContext,
  viewerUserId: string,
  isHead: boolean,
  eventId: string,
): Promise<PollDto[]> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const polls = await repo.listPolls(tx, eventId)
    // H3.1: each poll's DTO is independent of every other poll's -- Promise.all, not a for loop with
    // an await per iteration (2-3 queries per poll: options, tally, my-votes).
    return Promise.all(polls.map((poll) => pollToDto(tx, poll, viewerUserId, isHead)))
  })
}

export async function createPoll(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: {
    kind: string
    question: string
    anonymous: boolean
    closesAt?: string | undefined
    options: ReadonlyArray<{ label: string; optionDate?: string | undefined }>
  },
): Promise<PollDto> {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    const id = randomUUID()
    await repo.insertPoll(tx, {
      id,
      departmentId: event.department_id,
      eventId,
      kind: body.kind,
      question: body.question,
      anonymous: body.anonymous,
      closesAt: body.closesAt ? new Date(body.closesAt) : null,
      createdByUserId: actor.userId,
    })
    await repo.insertPollOptions(
      tx,
      id,
      event.department_id,
      body.options.map((o, i) => ({
        id: randomUUID(),
        label: o.label,
        optionDate: o.optionDate ? new Date(o.optionDate) : null,
        sortOrder: i,
      })),
    )
    tx.audit({ action: 'events.poll_created', subjectType: 'poll', subjectId: id })
    tx.emit({
      type: 'events.poll.created',
      departmentId: event.department_id,
      payload: { eventId, pollId: id, actorUserId: actor.userId },
    })
    const poll = await repo.getPoll(tx, id)
    return pollToDto(tx, poll!, actor.userId, actor.isHead)
  })
}

export async function voteOnPoll(
  ctx: RequestContext,
  actor: Actor,
  pollId: string,
  optionIds: readonly string[],
): Promise<PollDto> {
  return withContext(ctx, async (tx) => {
    const poll = await repo.getPoll(tx, pollId)
    if (!poll) throw new EventNotFoundError()
    if (poll.status === 'closed' || (poll.closes_at && poll.closes_at.getTime() < Date.now())) {
      throw new EventConflictError('poll_closed')
    }
    const validIds = await repo.pollOptionIds(tx, pollId)
    const error = validatePollVote(
      poll.kind as 'date' | 'single' | 'multi',
      optionIds,
      new Set(validIds),
    )
    if (error) throw new EventConflictError(error)

    await repo.replacePollVotes(tx, {
      pollId,
      departmentId: poll.department_id,
      identity: poll.anonymous
        ? { voterHash: voterHashFor(pollId, actor.userId) }
        : { userId: actor.userId },
      optionIds,
      idFor: () => randomUUID(),
    })

    tx.audit({ action: 'events.poll_voted', subjectType: 'poll', subjectId: pollId })
    return pollToDto(tx, poll, actor.userId, actor.isHead)
  })
}

// --- Photos ----------------------------------------------------------------------------------------

export async function listPhotos(ctx: RequestContext, viewerUserId: string, eventId: string) {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const rows = await repo.listPhotos(tx, eventId)
    return rows.map((r) => ({
      id: r.id,
      url: r.url,
      caption: r.caption,
      addedBy: { id: r.added_by_user_id, givenName: r.given_name, familyName: r.family_name },
      createdAt: r.created_at.toISOString(),
      canDelete: r.added_by_user_id === viewerUserId,
    }))
  })
}

export async function addPhoto(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: { url: string; caption?: string | undefined },
) {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    const id = randomUUID()
    await repo.insertPhoto(tx, {
      id,
      departmentId: event.department_id,
      eventId,
      url: body.url,
      caption: body.caption ?? null,
      addedByUserId: actor.userId,
    })
    tx.audit({ action: 'events.photo_added', subjectType: 'event_photo', subjectId: id })
    return {
      id,
      url: body.url,
      caption: body.caption ?? null,
      addedBy: { id: actor.userId, givenName: actor.givenName, familyName: actor.familyName },
      createdAt: new Date().toISOString(),
      canDelete: true,
    }
  })
}

export async function deletePhoto(
  ctx: RequestContext,
  actor: Actor,
  photoId: string,
): Promise<void> {
  return withContext(ctx, async (tx) => {
    const ownerId = await repo.getPhotoOwner(tx, photoId)
    if (!ownerId) throw new EventNotFoundError()
    if (ownerId !== actor.userId && !actor.isHead) throw new EventForbiddenError()
    await repo.deletePhoto(tx, photoId)
    tx.audit({ action: 'events.photo_deleted', subjectType: 'event_photo', subjectId: photoId })
  })
}

// --- Feedback ----------------------------------------------------------------------------------------

export async function listFeedback(
  ctx: RequestContext,
  viewerUserId: string,
  eventId: string,
): Promise<{ items: FeedbackDto[]; averageRating: number | null; myFeedback: FeedbackDto | null }> {
  return withContext(ctx, async (tx) => {
    // H1.2 (object-level access control): every `add*` below already refuses an event the caller
    // cannot see, but the `list*` children answered 200 with an empty array instead -- RLS emptied
    // the child query, so nothing leaked, yet the endpoint still reported success for another
    // department's event id and disagreed with its own parent route's 404. One missing predicate in
    // a child query away from being a real leak; refused here instead, at the same place and with
    // the same error as every write.
    if (!(await repo.getEventRow(tx, eventId))) throw new EventNotFoundError()
    const rows = await repo.listFeedback(tx, eventId)
    const items: FeedbackDto[] = rows.map((r) => ({
      id: r.id,
      author: r.anonymous
        ? null
        : { id: r.user_id, givenName: r.given_name, familyName: r.family_name },
      rating: r.rating,
      comment: r.comment,
      createdAt: r.created_at.toISOString(),
    }))
    const mine = rows.find((r) => r.user_id === viewerUserId)
    return {
      items,
      averageRating: average(rows.map((r) => r.rating)),
      myFeedback: mine
        ? {
            id: mine.id,
            author: mine.anonymous
              ? null
              : { id: mine.user_id, givenName: mine.given_name, familyName: mine.family_name },
            rating: mine.rating,
            comment: mine.comment,
            createdAt: mine.created_at.toISOString(),
          }
        : null,
    }
  })
}

export async function submitFeedback(
  ctx: RequestContext,
  actor: Actor,
  eventId: string,
  body: { rating: number; comment?: string | undefined; anonymous: boolean },
): Promise<void> {
  return withContext(ctx, async (tx) => {
    const event = await repo.getEventRow(tx, eventId)
    if (!event) throw new EventNotFoundError()
    await repo.upsertFeedback(tx, {
      id: randomUUID(),
      departmentId: event.department_id,
      eventId,
      userId: actor.userId,
      rating: body.rating,
      comment: body.comment ?? null,
      anonymous: body.anonymous,
    })
    tx.audit({ action: 'events.feedback_submitted', subjectType: 'event', subjectId: eventId })
  })
}

// --- ICS export --------------------------------------------------------------------------------------

export async function exportEventIcs(
  ctx: RequestContext,
  eventId: string,
): Promise<{ filename: string; content: string }> {
  return withContext(ctx, async (tx) => {
    const row = await repo.getEventRow(tx, eventId)
    if (!row) throw new EventNotFoundError()
    const content = buildIcs(
      [
        {
          id: row.id,
          title: row.title,
          description: row.description,
          place: row.place,
          placeUrl: row.place_url,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at.toISOString(),
          status: row.status as 'draft' | 'open' | 'full' | 'cancelled' | 'done',
        },
      ],
      row.title,
    )
    return { filename: `${row.id}.ics`, content }
  })
}

export async function exportMyIcs(
  ctx: RequestContext,
  userId: string,
): Promise<{ filename: string; content: string }> {
  return withContext(ctx, async (tx) => {
    const rows = await repo.listMyIcsEvents(tx, userId)
    const content = buildIcs(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        place: row.place,
        placeUrl: row.place_url,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        status: row.status as 'draft' | 'open' | 'full' | 'cancelled' | 'done',
      })),
      'Mening tadbirlarim',
    )
    return { filename: 'mening-tadbirlarim.ics', content }
  })
}
