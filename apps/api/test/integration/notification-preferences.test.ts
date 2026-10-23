import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
import {
  unreadCountsByReason,
  countsByReasonSince,
  insertNotification,
  systemAuditCtx,
  listNotifications,
  getNotificationById,
  listDueNotificationsNeedingTelegram,
  markAllRead,
  listUpcomingForIcs,
} from '../../src/modules/notifications/repo.js'

let db: Db
let server: Server
let session: Session
let userId: string
let departmentId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Delivery preferences',
    slug: `prefs-${randomUUID()}`,
  })
  departmentId = department.id
  const user = await seedMember(db, department.id, { role: 'member' })
  userId = user.id
  session = await loginAs(server.baseUrl, user.login)
  await superuserQuery(
    db,
    `insert into app.notification_prefs (user_id, reason, channel, enabled, digest_mode) values ($1, 'digest', 'email', true, 'weekly'), ($1, 'due', 'inapp', false, 'off')`,
    [userId],
  )
})

afterAll(async () => {
  if (server && db) await stopHarness({ db, server })
})

async function preferences() {
  const response = await fetch(`${server.baseUrl}/api/v1/notifications/prefs`, {
    headers: { cookie: session.cookie },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    items: Array<{
      reason: string
      channel: string
      enabled: boolean
      digestMode: string
    }>
  }
}
async function save(row: {
  reason: string
  channel: string
  enabled: boolean
  digestMode: string
}) {
  return fetch(`${server.baseUrl}/api/v1/notifications/prefs`, {
    method: 'PUT',
    headers: session.headers,
    body: JSON.stringify({ items: [row] }),
  })
}

describe('usable notification preferences', () => {
  it('counts real profile updates but excludes old summaries from personal and department digest inputs', async () => {
    const other = await seedDepartment(db, {
      name: 'Unrelated work',
      slug: `unrelated-${randomUUID()}`,
    })
    const cardId = randomUUID()
    const otherCardId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'member')`,
      [randomUUID(), other.id, userId],
    )
    await superuserQuery(
      db,
      `insert into app.cards (id, department_id, title, created_by_user_id, assignee_user_id) values ($1, $2, 'First department task', $3, $3), ($4, $5, 'Other department task', $3, $3)`,
      [cardId, departmentId, userId, otherCardId, other.id],
    )
    await superuserQuery(
      db,
      `insert into app.notifications (user_id, type, reason, subject_type, title, department_id, subject_id) values ($1, 'notifications.digest.daily', 'digest', 'digest', '{"en":"Old daily summary"}', $2, null), ($1, 'notifications.digest.weekly', 'digest', 'digest', '{"en":"Old weekly summary"}', $2, null), ($1, 'fields.value.filled', 'digest', 'person', '{"en":"Profile updated"}', $2, null), ($1, 'work.card.assigned', 'assigned', 'card', '{"en":"Assignment"}', $2, $4), ($1, 'work.card.assigned', 'assigned', 'card', '{"en":"Other department assignment"}', $3, $5), ($1, 'personal.task.due', 'due', 'personal_task', '{"en":"Private reminder"}', null, null)`,
      [userId, departmentId, other.id, cardId, otherCardId],
    )
    expect(await unreadCountsByReason(userId)).toEqual({
      digest: 1,
      assigned: 2,
      due: 1,
    })
    expect(await countsByReasonSince(userId, new Date(0))).toEqual({
      digest: 1,
      assigned: 2,
      due: 1,
    })
    expect(await countsByReasonSince(userId, new Date(0), departmentId)).toEqual({
      digest: 1,
      assigned: 1,
    })
    expect(await countsByReasonSince(userId, new Date(0), other.id)).toEqual({
      assigned: 1,
    })
  })
  it('includes every reason, honors stored in-app choices, and preserves stored email rows', async () => {
    const { items } = await preferences()
    expect(
      items.find((p) => p.reason === 'field_request' && p.channel === 'telegram'),
    ).toBeDefined()
    expect(items.find((p) => p.reason === 'due' && p.channel === 'inapp')).toMatchObject({
      enabled: false,
      digestMode: 'instant',
    })
    expect(items.find((p) => p.reason === 'digest' && p.channel === 'email')).toMatchObject({
      enabled: true,
      digestMode: 'weekly',
    })
  })

  it('rejects unsupported new settings without changing historical email preferences', async () => {
    const unavailable = [
      { reason: 'due', channel: 'email', enabled: true, digestMode: 'instant' },
      { reason: 'due', channel: 'inapp', enabled: true, digestMode: 'weekly' },
      {
        reason: 'due',
        channel: 'telegram',
        enabled: true,
        digestMode: 'weekly',
      },
      {
        reason: 'digest',
        channel: 'telegram',
        enabled: true,
        digestMode: 'instant',
      },
    ]
    const results = await Promise.all(unavailable.map(save))
    expect(results.map((response) => response.status)).toEqual([422, 422, 422, 422])
    expect(
      (await preferences()).items.find((p) => p.reason === 'digest' && p.channel === 'email'),
    ).toMatchObject({ enabled: true, digestMode: 'weekly' })
  })

  it('persists functional instant, daily, weekly and off Telegram choices independently', async () => {
    expect(
      (
        await save({
          reason: 'field_request',
          channel: 'telegram',
          enabled: true,
          digestMode: 'instant',
        })
      ).status,
    ).toBe(200)
    const modes = ['daily', 'weekly', 'off']
    for (let i = 0; i < modes.length; i += 1) {
      const digestMode = modes[i]!
      expect(
        (
          await save({
            reason: 'digest',
            channel: 'telegram',
            enabled: digestMode !== 'off',
            digestMode,
          })
        ).status,
      ).toBe(200)
      expect(
        (await preferences()).items.find((p) => p.reason === 'digest' && p.channel === 'telegram'),
      ).toMatchObject({ digestMode, enabled: digestMode !== 'off' })
    }
  })

  it('mutes only future app delivery, retains existing unread history, and keeps Telegram payload and retries', async () => {
    const cardId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.cards (id, department_id, title, created_by_user_id, assignee_user_id) values ($1, $2, 'Independent channels', $3, $3)`,
      [cardId, departmentId, userId],
    )
    const notice = () =>
      insertNotification(systemAuditCtx(userId), {
        userId,
        departmentId,
        type: 'work.card.due',
        reason: 'due',
        subjectType: 'card',
        subjectId: cardId,
        eventAt: new Date(Date.now() + 86_400_000),
        title: {
          en: 'Due soon',
          ru: 'Скоро срок',
          'uz-Latn': 'Muddat yaqin',
          'uz-Cyrl': 'Муддат яқин',
        },
      })
    expect(
      (
        await save({
          reason: 'due',
          channel: 'inapp',
          enabled: true,
          digestMode: 'instant',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await save({
          reason: 'due',
          channel: 'telegram',
          enabled: true,
          digestMode: 'instant',
        })
      ).status,
    ).toBe(200)
    const old = await notice()
    expect(
      (
        await save({
          reason: 'due',
          channel: 'inapp',
          enabled: false,
          digestMode: 'instant',
        })
      ).status,
    ).toBe(200)
    const before = await listNotifications(userId, {
      status: 'unread',
      limit: 200,
    })
    const muted = await notice()
    const after = await listNotifications(userId, {
      status: 'unread',
      limit: 200,
    })
    expect(after.unreadCount).toBe(before.unreadCount)
    expect(after.items.map((n) => n.id)).toContain(old.id)
    expect(after.items.map((n) => n.id)).not.toContain(muted.id)
    expect(
      (await preferences()).items.find((p) => p.reason === 'due' && p.channel === 'telegram'),
    ).toMatchObject({ enabled: true, digestMode: 'instant' })
    expect(await getNotificationById(userId, muted.id)).toMatchObject({
      id: muted.id,
    })
    expect((await listDueNotificationsNeedingTelegram(userId)).map((n) => n.id)).toContain(muted.id)
    expect((await listUpcomingForIcs(userId)).map((n) => n.id)).toContain(muted.id)
    const stranger = await seedMember(db, departmentId, { role: 'member' })
    expect(await getNotificationById(stranger.id, muted.id)).toBeNull()
    expect((await listUpcomingForIcs(stranger.id)).map((n) => n.id)).not.toContain(muted.id)
    expect(
      (await listNotifications(stranger.id, { status: 'inbox', limit: 200 })).items.map(
        (n) => n.id,
      ),
    ).not.toContain(muted.id)
    await markAllRead(systemAuditCtx(userId), userId)
    expect(await getNotificationById(userId, old.id)).toMatchObject({
      readAt: expect.any(Date),
    })
    expect(await getNotificationById(userId, muted.id)).toMatchObject({
      readAt: null,
    })
    expect(
      (
        await save({
          reason: 'due',
          channel: 'inapp',
          enabled: true,
          digestMode: 'instant',
        })
      ).status,
    ).toBe(200)
    const resumed = await notice()
    const inbox = await listNotifications(userId, {
      status: 'inbox',
      limit: 200,
    })
    expect(inbox.items.map((n) => n.id)).toContain(resumed.id)
    expect(inbox.items.map((n) => n.id)).not.toContain(muted.id)
    const events = await superuserQuery<{ payload: { inappVisible: boolean } }>(
      db,
      `select payload from app.outbox_events where type = 'notifications.notification.created' and payload->>'notificationId' = $1`,
      [muted.id],
    )
    expect(events[0]?.payload.inappVisible).toBe(false)
  })
})
