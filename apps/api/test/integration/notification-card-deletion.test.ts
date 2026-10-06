import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, configurePool, withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import * as notifications from '../../src/modules/notifications/repo.js'
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
let owner: Session
let recipients: string[]
let departmentId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  configurePool(db.appUrl)
  const department = await seedDepartment(db, {
    name: 'Inbox deletion',
    slug: `inbox-${randomUUID()}`,
  })
  departmentId = department.id
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'head' }),
  ])
  recipients = users.map((user) => user.id)
  owner = await loginAs(server.baseUrl, users[0]!.login)
})

afterAll(async () => {
  await closePool()
  if (server && db) await stopHarness({ db, server })
})

async function createCard() {
  const response = await fetch(`${server.baseUrl}/api/v1/cards`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({ title: 'Retained card title' }),
  })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function notice(userId: string, cardId: string, archived = false) {
  const id = randomUUID()
  await superuserQuery(
    db,
    `insert into app.notifications (id, user_id, type, reason, subject_type, subject_id, department_id, title, deep_link, event_at, archived_at)
     values ($1, $2, 'work.card.due', 'due', 'card', $3, $4, '{"en":"Retained card title"}', '/work?card=' || $3, now(), case when $5 then now() else null end)`,
    [id, userId, cardId, departmentId, archived],
  )
  return id
}

describe('deleted card notification visibility', () => {
  it('hides retained titles from member/head inbox, archive, detail, counts, reminders and calendar without hiding live cards', async () => {
    const [deletedCard, liveCard] = await Promise.all([createCard(), createCard()])
    const ids = await Promise.all(
      recipients.map(async (userId) => ({
        userId,
        deleted: await notice(userId, deletedCard),
        archived: await notice(userId, deletedCard, true),
        live: await notice(userId, liveCard),
        liveArchived: await notice(userId, liveCard, true),
      })),
    )
    expect(
      (await notifications.listNotifications(recipients[0]!, { status: 'inbox', limit: 100 }))
        .items,
    ).toHaveLength(2)
    const deleteHeaders = { ...owner.headers }
    delete deleteHeaders['content-type']
    const removed = await fetch(`${server.baseUrl}/api/v1/cards/${deletedCard}`, {
      method: 'DELETE',
      headers: deleteHeaders,
    })
    expect(removed.status).toBe(204)
    await Promise.all(
      ids.map(async ({ userId, deleted, live, liveArchived }) => {
        const [inbox, archived, detail, counts, digest, due, calendar] = await Promise.all([
          notifications.listNotifications(userId, { status: 'inbox', limit: 100 }),
          notifications.listNotifications(userId, { status: 'archived', limit: 100 }),
          notifications.getNotificationById(userId, deleted),
          notifications.unreadCountsByReason(userId),
          notifications.countsByReasonSince(userId, new Date(0)),
          notifications.listDueNotificationsNeedingTelegram(userId),
          notifications.listUpcomingForIcs(userId),
        ])
        expect(inbox.items.map((row) => row.id)).toEqual([live])
        expect(inbox.unreadCount).toBe(1)
        expect(archived.items.map((row) => row.id)).toEqual([liveArchived])
        expect(detail).toBeNull()
        expect(counts.due).toBe(1)
        expect(digest.due).toBe(2)
        expect(due.map((row) => row.id)).toEqual([live])
        expect(calendar.map((row) => row.id).sort()).toEqual([live, liveArchived].sort())
      }),
    )
    const lateId = await notice(recipients[0]!, deletedCard)
    expect(await notifications.getNotificationById(recipients[0]!, lateId)).toBeNull()
    const retained = await superuserQuery<{ count: string }>(
      db,
      'select count(*)::text as count from app.notifications where subject_id = $1',
      [deletedCard],
    )
    expect(retained[0]?.count).toBe('5')
    const restored = await fetch(`${server.baseUrl}/api/v1/cards/${deletedCard}/undo-delete`, {
      method: 'POST',
      headers: owner.headers,
      body: '{}',
    })
    expect(restored.status).toBe(204)
    expect(await notifications.getNotificationById(recipients[0]!, ids[0]!.deleted)).not.toBeNull()
  })

  it('the privileged visibility helper reveals nothing about another user’s notification', async () => {
    const card = await createCard()
    const otherId = await notice(recipients[1]!, card)
    const rows = await withContext(
      {
        requestId: randomUUID(),
        userId: recipients[0]!,
        actorRole: 'member',
        departmentId: null,
        actingForUserId: null,
        viewAs: false,
        ip: '',
        userAgent: 'notification-deletion-test',
      },
      (tx) =>
        tx.raw<{ visible: boolean }>(
          sql`select app.notification_is_visible(${otherId}::uuid) as visible`,
        ),
    )
    expect(rows[0]?.visible).toBe(false)
  })
})
