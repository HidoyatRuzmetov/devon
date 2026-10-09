// Real local Postgres + Fastify; every Telegram send is an injected local sink. No bot token,
// external Telegram, application AI, email, production state, or real accounts are involved.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatch, withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import type { ZodType } from 'zod'
import {
  eventSchema,
  eventListResponseSchema,
  pollListResponseSchema,
  carpoolListResponseSchema,
  itemListResponseSchema,
  photoListResponseSchema,
  commentListResponseSchema,
} from '../../src/modules/events/schemas.js'
import { recordTelegramRsvp } from '../../src/modules/events/telegram-rsvp.js'
import { isTelegramConfigured } from '../../src/modules/telegram/transport.js'
import { EventForbiddenError } from '../../src/modules/events/errors.js'
import {
  processEventGroupDeliveries,
  queueEventGroupNotifications,
} from '../../src/modules/events/telegram-delivery.js'
import {
  claimGroupDelivery,
  finishGroupDelivery,
} from '../../src/modules/events/telegram-delivery-repo.js'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let chatSequence = 0
beforeAll(async () => {
  const harness = await startHarness()
  db = harness.db
  server = harness.server
})
afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})
beforeEach(async () => {
  // Only this suite's freshly-created Testcontainers database; never the developer's database.
  await superuserQuery(db, 'delete from app.event_telegram_deliveries')
})

async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Local event QA',
    slug: `event-qa-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const member = await seedMember(db, department.id, { role: 'member' })
  const headSession = await loginAs(server.baseUrl, head.login)
  const memberSession = await loginAs(server.baseUrl, member.login)
  const event = await createEvent(headSession)
  return { department, head, member, headSession, memberSession, event }
}

async function createEvent(session: Session, overrides: Record<string, unknown> = {}) {
  const response = await post('/api/v1/events', session, {
    title: 'Local event consistency',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    ...overrides,
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}
function post(path: string, session: Session, body: unknown = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify(body),
  })
}
function remove(path: string, session: Session) {
  return fetch(`${server.baseUrl}${path}`, {
    method: 'DELETE',
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
    },
  })
}
async function read<T>(path: string, session: Session, schema: ZodType<T>): Promise<T> {
  const response = await fetch(`${server.baseUrl}${path}`, { headers: session.headers })
  expect(response.status).toBe(200)
  return schema.parse(await response.json())
}
async function group(departmentId: string, kinds = ['events']) {
  const id = randomUUID()
  const chatId = String(-1000000000000 - ++chatSequence)
  await superuserQuery(
    db,
    'insert into app.telegram_groups (id, department_id, chat_id, kinds) values ($1,$2,$3,$4)',
    [id, departmentId, chatId, kinds],
  )
  return { id, chatId }
}
async function source(eventId: string) {
  const rows = await superuserQuery(
    db,
    "select id, type, department_id, payload, created_at from app.outbox_events where type='events.event.created' and payload->>'eventId'=$1 order by created_at desc limit 1",
    [eventId],
  )
  const row = rows[0]!
  return {
    id: row['id'] as string,
    type: row['type'] as string,
    departmentId: row['department_id'] as string,
    payload: row['payload'],
    createdAt: new Date(row['created_at'] as string),
    attempts: 0,
  }
}

describe('durable event group delivery to a local sink', () => {
  it('queues only subscribed same-department groups and retries only the failed target', async () => {
    const f = await fixture()
    const first = await group(f.department.id)
    const second = await group(f.department.id)
    await group(f.department.id, ['weekly_summary'])
    const foreign = await seedDepartment(db, {
      name: 'Foreign local department',
      slug: `foreign-${randomUUID()}`,
    })
    await group(foreign.id)
    const outbox = await source(f.event.id)
    expect(isTelegramConfigured()).toBe(false)
    // Exercise the real plugin's outbox subscription, not merely the queue helper in isolation.
    // The app is configured for test with all integrations absent; no external send is possible.
    expect(await dispatch(outbox)).toEqual({ ok: true })
    expect(await superuserQuery(db, 'select id from app.event_telegram_deliveries')).toHaveLength(2)
    expect(await queueEventGroupNotifications(outbox)).toBe(0)
    const sink = vi.fn(async (chat: string) =>
      chat === second.chatId
        ? { ok: false as const, error: 'Local fault' }
        : { ok: true as const, messageId: 123 },
    )
    expect(await processEventGroupDeliveries(20, sink, () => true)).toEqual({
      sent: 1,
      skipped: 0,
      failed: 1,
    })
    const receipts = await superuserQuery(
      db,
      'select group_id,status,attempts from app.event_telegram_deliveries order by group_id',
    )
    expect(receipts.find((row) => row['group_id'] === first.id)?.['status']).toBe('sent')
    expect(receipts.find((row) => row['group_id'] === second.id)?.['status']).toBe('pending')
    await superuserQuery(
      db,
      "update app.event_telegram_deliveries set next_attempt_at=now() where status='pending'",
    )
    const retrySink = vi.fn().mockResolvedValue({ ok: true, messageId: 456 })
    expect(await processEventGroupDeliveries(20, retrySink, () => true)).toEqual({
      sent: 1,
      skipped: 0,
      failed: 0,
    })
    expect(retrySink).toHaveBeenCalledOnce()
    expect(retrySink).toHaveBeenCalledWith(
      second.chatId,
      expect.stringContaining(`/events?event=${f.event.id}`),
    )
    expect(await queueEventGroupNotifications(outbox)).toBe(0)
    expect(await processEventGroupDeliveries(20, retrySink, () => true)).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    })
    const ownCtx = {
      requestId: randomUUID(),
      userId: f.member.id,
      actorRole: 'member' as const,
      departmentId: foreign.id,
      actingForUserId: null,
      viewAs: false,
      ip: '',
      userAgent: 'local-event-qa',
    }
    expect(
      await withContext(ownCtx, (tx) => tx.raw(sql`select id from app.event_telegram_deliveries`)),
    ).toEqual([])
    expect(
      await withContext({ ...ownCtx, userId: f.head.id, departmentId: f.department.id }, (tx) =>
        tx.raw(sql`select id from app.event_telegram_deliveries`),
      ),
    ).toHaveLength(2)
    expect(
      await withContext(
        { ...ownCtx, actorRole: 'super_admin', departmentId: f.department.id, viewAs: true },
        (tx) => tx.raw(sql`select id from app.event_telegram_deliveries`),
      ),
    ).toEqual([])
  })

  it('uses independent atomic leases, rejects stale acknowledgments and reclaims a crashed worker', async () => {
    const f = await fixture()
    await group(f.department.id)
    await group(f.department.id)
    await queueEventGroupNotifications(await source(f.event.id))
    const [first, second] = await Promise.all([claimGroupDelivery(), claimGroupDelivery()])
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!.id).not.toBe(second!.id)
    expect(await claimGroupDelivery()).toBeNull()
    await finishGroupDelivery(
      { ...first!, lease_token: randomUUID() },
      { status: 'sent', messageId: 1 },
    )
    expect(
      (
        await superuserQuery(db, 'select status from app.event_telegram_deliveries where id=$1', [
          first!.id,
        ])
      )[0]?.['status'],
    ).toBe('pending')
    await superuserQuery(
      db,
      "update app.event_telegram_deliveries set leased_until=now()-interval '1 second' where id=$1",
      [first!.id],
    )
    const recovered = await claimGroupDelivery()
    expect(recovered?.id).toBe(first!.id)
    expect(recovered?.lease_token).not.toBe(first!.lease_token)
    expect(recovered?.attempts).toBe(2)
    await finishGroupDelivery(recovered!, { status: 'sent', messageId: 2 })
    await finishGroupDelivery(second!, { status: 'sent', messageId: 3 })
  })

  it('retains paused deliveries and skips disconnected groups or deleted events', async () => {
    const f = await fixture()
    const connected = await group(f.department.id)
    await queueEventGroupNotifications(await source(f.event.id))
    await superuserQuery(db, "update app.departments set status='paused_by_admin' where id=$1", [
      f.department.id,
    ])
    const sink = vi.fn().mockResolvedValue({ ok: true, messageId: 123 })
    expect(await processEventGroupDeliveries(20, sink, () => true)).toEqual({
      sent: 0,
      skipped: 0,
      failed: 0,
    })
    expect(sink).not.toHaveBeenCalled()
    expect(
      (await superuserQuery(db, 'select attempts,status from app.event_telegram_deliveries'))[0],
    ).toMatchObject({ attempts: 0, status: 'pending' })
    await superuserQuery(db, "update app.departments set status='active' where id=$1", [
      f.department.id,
    ])
    await superuserQuery(db, 'update app.telegram_groups set disconnected_at=now() where id=$1', [
      connected.id,
    ])
    expect(await processEventGroupDeliveries(20, sink, () => true)).toEqual({
      sent: 0,
      skipped: 1,
      failed: 0,
    })
    await group(f.department.id)
    const next = await createEvent(f.headSession)
    await queueEventGroupNotifications(await source(next.id))
    await superuserQuery(db, 'update app.events set deleted_at=now() where id=$1', [next.id])
    expect(await processEventGroupDeliveries(20, sink, () => true)).toEqual({
      sent: 0,
      skipped: 1,
      failed: 0,
    })
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('RSVP persistence independently read through the website API', () => {
  it('persists the bot-boundary choice, preserves guests/notes and refuses revoked membership', async () => {
    const f = await fixture()
    expect(
      (
        await post(`/api/v1/events/${f.event.id}/rsvp`, f.memberSession, {
          status: 'yes',
          guests: 2,
          note: 'Local synthetic note',
        })
      ).status,
    ).toBe(200)
    await recordTelegramRsvp(f.member.id, f.department.id, f.event.id, 'yes')
    const detail = await read(`/api/v1/events/${f.event.id}`, f.memberSession, eventSchema)
    expect(detail.myRsvp).toEqual({ status: 'yes', guests: 2, note: 'Local synthetic note' })
    expect(detail.goingCount).toBe(3)
    const list = await read('/api/v1/events', f.memberSession, eventListResponseSchema)
    expect(list.items.find((event) => event.id === f.event.id)?.myRsvp?.status).toBe('yes')
    await recordTelegramRsvp(f.member.id, f.department.id, f.event.id, 'maybe')
    expect(
      (await read(`/api/v1/events/${f.event.id}`, f.memberSession, eventSchema)).maybeCount,
    ).toBe(1)
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where user_id=$1 and department_id=$2",
      [f.member.id, f.department.id],
    )
    await expect(
      recordTelegramRsvp(f.member.id, f.department.id, f.event.id, 'yes'),
    ).rejects.toBeInstanceOf(EventForbiddenError)
    expect(
      (
        await superuserQuery(
          db,
          'select status from app.event_rsvps where event_id=$1 and user_id=$2',
          [f.event.id, f.member.id],
        )
      )[0]?.['status'],
    ).toBe('maybe')
  })
})

describe('nested event controls mutate only their actual parent event', () => {
  it('rejects wrong-parent vote, seat/item claims and photo/comment deletion without changing records', async () => {
    const f = await fixture()
    const other = await createEvent(f.headSession)
    const own = `/api/v1/events/${f.event.id}`
    const wrong = `/api/v1/events/${other.id}`
    const poll = (await (
      await post(`${own}/polls`, f.headSession, {
        kind: 'single',
        question: 'Local option?',
        options: [{ label: 'One' }, { label: 'Two' }],
      })
    ).json()) as { id: string; options: { id: string }[] }
    const carpool = (await (await post(`${own}/carpools`, f.headSession, { seats: 3 })).json()) as {
      id: string
    }
    const item = (await (
      await post(`${own}/items`, f.headSession, { label: 'Local drinks', quantity: 2 })
    ).json()) as { id: string }
    const photo = (await (
      await post(`${own}/photos`, f.headSession, { url: 'https://example.test/local-photo.png' })
    ).json()) as { id: string }
    const comment = (await (
      await post(`${own}/comments`, f.headSession, { body: 'Local comment' })
    ).json()) as { id: string }
    expect(
      (
        await post(`${wrong}/polls/${poll.id}/vote`, f.memberSession, {
          optionIds: [poll.options[0]!.id],
        })
      ).status,
    ).toBe(404)
    expect(
      (await post(`${wrong}/carpools/${carpool.id}/claim`, f.memberSession, { seats: 1 })).status,
    ).toBe(404)
    expect((await post(`${wrong}/items/${item.id}/claim`, f.memberSession)).status).toBe(404)
    expect((await remove(`${wrong}/photos/${photo.id}`, f.headSession)).status).toBe(404)
    expect((await remove(`${wrong}/comments/${comment.id}`, f.headSession)).status).toBe(404)
    expect(
      (await read(`${own}/polls`, f.memberSession, pollListResponseSchema)).items[0]!.totalVotes,
    ).toBe(0)
    expect(
      (await read(`${own}/carpools`, f.memberSession, carpoolListResponseSchema)).items[0]!
        .seatsClaimed,
    ).toBe(0)
    expect(
      (await read(`${own}/items`, f.memberSession, itemListResponseSchema)).items[0]!.claimedBy,
    ).toBeNull()
    expect(
      (await read(`${own}/photos`, f.headSession, photoListResponseSchema)).items,
    ).toHaveLength(1)
    expect(
      (await read(`${own}/comments`, f.headSession, commentListResponseSchema)).items,
    ).toHaveLength(1)
    expect(
      (await post(`${own}/carpools/${carpool.id}/claim`, f.memberSession, { seats: 1 })).status,
    ).toBe(204)
    expect((await post(`${own}/items/${item.id}/claim`, f.memberSession)).status).toBe(204)
    expect((await remove(`${wrong}/carpools/${carpool.id}/claim`, f.memberSession)).status).toBe(
      404,
    )
    expect((await remove(`${wrong}/items/${item.id}/claim`, f.memberSession)).status).toBe(404)
    expect(
      (await read(`${own}/carpools`, f.memberSession, carpoolListResponseSchema)).items[0]!
        .seatsClaimed,
    ).toBe(1)
    expect(
      (await read(`${own}/items`, f.memberSession, itemListResponseSchema)).items[0]!.claimedByMe,
    ).toBe(true)
  })
})
