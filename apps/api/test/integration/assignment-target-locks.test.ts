// Real migrated Postgres. Direct repositories are the boundary used by background automations;
// fixtures use the superuser only to order concurrent removal/locking transactions deterministically.
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { systemContext } from '../../src/modules/automations/context.js'
import { createCard, patchCard, CardTargetUnavailableError } from '../../src/modules/work/repo.js'
import {
  insertNotification,
  systemAuditCtx,
  NotificationRecipientUnavailableError,
} from '../../src/modules/notifications/repo.js'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db
let server: Server
beforeAll(async () => {
  ;({ db, server } = await startHarness())
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

async function fixture() {
  const department = await seedDepartment(db, {
    name: 'Assignment lock QA',
    slug: `assign-${randomUUID()}`,
  })
  const head = await seedMember(db, department.id, { role: 'head' })
  const member = await seedMember(db, department.id, { role: 'member' })
  return { department, head, member, ctx: systemContext(department.id, head.id) }
}
async function transaction() {
  const client = new Client({ connectionString: db.superuserUrl })
  await client.connect()
  await client.query('begin')
  return client
}
// Wait on PostgreSQL's actual blocker relationship, not an assumed delay between JS promises.
async function blockedBy(blockerPid: number) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const rows = await superuserQuery<{ pid: number }>(
      db,
      'select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))',
      [blockerPid],
    )
    if (rows[0]) return rows[0].pid
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected real database lock waiter did not appear')
}
async function pid(client: Client) {
  return (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid
}
async function effects(departmentId: string) {
  return {
    cards: await superuserQuery(
      db,
      'select id,assignee_user_id,giver_user_id,version from app.cards where department_id=$1 order by id',
      [departmentId],
    ),
    audit: await superuserQuery(
      db,
      "select action,subject_id from audit.events where department_id=$1 and action like 'work.card_%' order by at,id",
      [departmentId],
    ),
    outbox: await superuserQuery(
      db,
      "select type,payload from app.outbox_events where department_id=$1 and type like 'work.card.%' order by created_at,id",
      [departmentId],
    ),
  }
}
const title = { 'uz-Latn': 'QA', 'uz-Cyrl': 'QA', ru: 'QA', en: 'QA' }
const cardDefaults = {
  description: undefined,
  kind: undefined,
  assigneeUserId: undefined,
  giverUserId: undefined,
  priority: undefined,
  startAt: undefined,
  dueAt: undefined,
  labels: undefined,
  links: undefined,
  projectId: undefined,
  projectScope: undefined,
  orderKey: undefined,
}
function notification(departmentId: string, userId: string) {
  return {
    departmentId,
    userId,
    type: 'automations.rule.ran',
    reason: 'system' as const,
    subjectType: 'card',
    subjectId: randomUUID(),
    title,
    requireActiveDepartmentMembership: true,
  }
}

describe('assignment and automation recipient transaction locks', () => {
  it('permits a head to lock another active member through application RLS and preserves historical unchanged/null references', async () => {
    const f = await fixture()
    const created = await createCard(f.ctx, {
      ...cardDefaults,
      departmentId: f.department.id,
      title: 'Named active colleague',
      createdByUserId: f.head.id,
      assigneeUserId: f.member.id,
      giverUserId: f.member.id,
    })
    expect(created.assigneeUserId).toBe(f.member.id)
    expect(created.giverUserId).toBe(f.member.id)
    const foreign = await seedDepartment(db, {
      name: 'Foreign assignment',
      slug: `foreign-${randomUUID()}`,
    })
    const outsider = await seedMember(db, foreign.id, { role: 'member' })
    const before = await effects(f.department.id)
    await expect(
      createCard(f.ctx, {
        ...cardDefaults,
        departmentId: f.department.id,
        title: 'Foreign',
        createdByUserId: f.head.id,
        assigneeUserId: outsider.id,
      }),
    ).rejects.toBeInstanceOf(CardTargetUnavailableError)
    await expect(
      patchCard(
        f.ctx,
        f.department.id,
        created.id,
        { giverUserId: outsider.id },
        created.version,
        f.head.id,
      ),
    ).rejects.toBeInstanceOf(CardTargetUnavailableError)
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [outsider.id])
    await expect(
      patchCard(
        f.ctx,
        f.department.id,
        created.id,
        { assigneeUserId: outsider.id },
        created.version,
        f.head.id,
      ),
    ).rejects.toBeInstanceOf(CardTargetUnavailableError)
    expect(await effects(f.department.id)).toEqual(before)
    const session = await loginAs(server.baseUrl, f.head.login)
    await superuserQuery(db, "update app.users set status='locked' where id=$1", [f.member.id])
    const invalidCreate = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ title: 'Locked active member', assigneeUserId: f.member.id }),
    })
    expect(invalidCreate.status).toBe(422)
    const invalidPatch = await fetch(`${server.baseUrl}/api/v1/cards/${created.id}`, {
      method: 'PATCH',
      headers: session.headers,
      body: JSON.stringify({
        assigneeUserId: f.head.id,
        labels: [randomUUID()],
        version: created.version,
      }),
    })
    expect(invalidPatch.status).toBe(422)
    expect(await effects(f.department.id)).toEqual(before)
    await superuserQuery(db, "update app.users set status='active' where id=$1", [f.member.id])
    await superuserQuery(
      db,
      "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
      [f.department.id, f.member.id],
    )
    const unchanged = await fetch(`${server.baseUrl}/api/v1/cards/${created.id}`, {
      method: 'PATCH',
      headers: session.headers,
      body: JSON.stringify({
        title: 'Historical attribution stays editable',
        assigneeUserId: f.member.id,
        giverUserId: f.member.id,
        version: created.version,
      }),
    })
    expect(unchanged.status).toBe(200)
    const updated = (await unchanged.json()) as { version: number }
    const cleared = await patchCard(
      f.ctx,
      f.department.id,
      created.id,
      { assigneeUserId: null, giverUserId: null },
      updated.version,
      f.head.id,
    )
    expect(cleared.ok && cleared.card.assigneeUserId).toBe(null)
    expect(cleared.ok && cleared.card.giverUserId).toBe(null)
  })

  it('rechecks membership after an in-flight removal before creating any card/audit/outbox', async () => {
    const f = await fixture()
    const removal = await transaction()
    try {
      await removal.query(
        "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
        [f.department.id, f.member.id],
      )
      const writing = createCard(f.ctx, {
        ...cardDefaults,
        departmentId: f.department.id,
        title: 'Removal wins',
        createdByUserId: f.head.id,
        assigneeUserId: f.member.id,
      }).then(
        () => 'accepted',
        (error: unknown) => error,
      )
      await blockedBy(await pid(removal))
      await removal.query('commit')
      expect(await writing).toBeInstanceOf(CardTargetUnavailableError)
      expect(await effects(f.department.id)).toEqual({ cards: [], audit: [], outbox: [] })
    } finally {
      await removal.query('rollback')
      await removal.end()
    }
  })

  it('rechecks a concurrently locked account before patching and leaves its version and side effects intact', async () => {
    const f = await fixture()
    const card = await createCard(f.ctx, {
      ...cardDefaults,
      departmentId: f.department.id,
      title: 'Account lock wins',
      createdByUserId: f.head.id,
    })
    const before = await effects(f.department.id)
    const locking = await transaction()
    try {
      await locking.query("update app.users set status='locked' where id=$1", [f.member.id])
      const writing = patchCard(
        f.ctx,
        f.department.id,
        card.id,
        { assigneeUserId: f.member.id },
        card.version,
        f.head.id,
      ).then(
        () => 'accepted',
        (error: unknown) => error,
      )
      await blockedBy(await pid(locking))
      await locking.query('commit')
      expect(await writing).toBeInstanceOf(CardTargetUnavailableError)
      expect(await effects(f.department.id)).toEqual(before)
    } finally {
      await locking.query('rollback')
      await locking.end()
    }
  })

  it('holds target eligibility until an accepted assignment commits, serializing a later removal behind the card write', async () => {
    const f = await fixture()
    const card = await createCard(f.ctx, {
      ...cardDefaults,
      departmentId: f.department.id,
      title: 'Assignment wins',
      createdByUserId: f.head.id,
    })
    const barrier = await transaction()
    const removal = await transaction()
    try {
      await barrier.query('select id from app.cards where id=$1 for update', [card.id])
      const writing = patchCard(
        f.ctx,
        f.department.id,
        card.id,
        { assigneeUserId: f.member.id },
        card.version,
        f.head.id,
      )
      const writerPid = await blockedBy(await pid(barrier))
      const removing = removal.query(
        "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
        [f.department.id, f.member.id],
      )
      await blockedBy(writerPid)
      await barrier.query('commit')
      const result = await writing
      expect(result.ok && result.card.assigneeUserId).toBe(f.member.id)
      await removing
      await removal.query('commit')
      const persisted = await effects(f.department.id)
      expect(persisted.audit.filter((row) => row['action'] === 'work.card_updated')).toHaveLength(1)
      expect(persisted.outbox.filter((row) => row['type'] === 'work.card.assigned')).toHaveLength(1)
    } finally {
      await barrier.query('rollback')
      await barrier.end()
      await removal.query('rollback')
      await removal.end()
    }
  })

  it('locks newly added labels against deletion but preserves unchanged historical labels', async () => {
    const f = await fixture()
    const label = (
      await superuserQuery<{ id: string }>(
        db,
        "insert into app.labels(department_id,name) values($1,'Historical label') returning id",
        [f.department.id],
      )
    )[0]!
    const historical = await createCard(f.ctx, {
      ...cardDefaults,
      departmentId: f.department.id,
      title: 'Historical label',
      createdByUserId: f.head.id,
      labels: [label.id],
    })
    const card = await createCard(f.ctx, {
      ...cardDefaults,
      departmentId: f.department.id,
      title: 'Label removal wins',
      createdByUserId: f.head.id,
    })
    const before = await effects(f.department.id)
    const deletion = await transaction()
    try {
      await deletion.query('update app.labels set deleted_at=now() where id=$1', [label.id])
      const writing = patchCard(
        f.ctx,
        f.department.id,
        card.id,
        { labels: [label.id] },
        card.version,
        f.head.id,
      ).then(
        () => 'accepted',
        (error: unknown) => error,
      )
      await blockedBy(await pid(deletion))
      await deletion.query('commit')
      expect(await writing).toBeInstanceOf(CardTargetUnavailableError)
      expect(await effects(f.department.id)).toEqual(before)
      const kept = await patchCard(
        f.ctx,
        f.department.id,
        historical.id,
        { title: 'Still editable', labels: [label.id] },
        historical.version,
        f.head.id,
      )
      expect(kept.ok && kept.card.labels).toEqual([label.id])
    } finally {
      await deletion.query('rollback')
      await deletion.end()
    }
  })

  it('creates a scoped automation inbox row only for an active account/member and rolls back rejected recipient side effects', async () => {
    const f = await fixture()
    const accepted = await insertNotification(
      systemAuditCtx(null),
      notification(f.department.id, f.member.id),
    )
    expect(accepted.departmentId).toBe(f.department.id)
    expect(
      await superuserQuery(db, 'select id from app.notifications where id=$1', [accepted.id]),
    ).toHaveLength(1)
    expect(
      await superuserQuery(
        db,
        "select id from audit.events where subject_id=$1 and action='notifications.created'",
        [accepted.id],
      ),
    ).toHaveLength(1)
    expect(
      await superuserQuery(
        db,
        "select id from app.outbox_events where payload->>'notificationId'=$1 and type='notifications.notification.created'",
        [accepted.id],
      ),
    ).toHaveLength(1)
    const before = await superuserQuery(db, 'select id from app.notifications where user_id=$1', [
      f.member.id,
    ])
    await expect(
      insertNotification(systemAuditCtx(null), notification(randomUUID(), f.member.id)),
    ).rejects.toBeInstanceOf(NotificationRecipientUnavailableError)
    const removal = await transaction()
    try {
      await removal.query(
        "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
        [f.department.id, f.member.id],
      )
      const writing = insertNotification(
        systemAuditCtx(null),
        notification(f.department.id, f.member.id),
      ).then(
        () => 'accepted',
        (error: unknown) => error,
      )
      await blockedBy(await pid(removal))
      await removal.query('commit')
      expect(await writing).toBeInstanceOf(NotificationRecipientUnavailableError)
      expect(
        await superuserQuery(db, 'select id from app.notifications where user_id=$1', [
          f.member.id,
        ]),
      ).toEqual(before)
      expect(
        await superuserQuery(
          db,
          "select id from audit.events where action='notifications.created' and actor_user_id=$1",
          [f.member.id],
        ),
      ).toHaveLength(1)
    } finally {
      await removal.query('rollback')
      await removal.end()
    }
  })

  it('holds automation recipient eligibility through inbox/audit/outbox commit before allowing a later removal', async () => {
    const f = await fixture()
    const barrier = await transaction()
    const removal = await transaction()
    try {
      // withContext flushes the notification's audit before committing the same transaction.
      // Blocking that flush proves membership locks survive the insert through final commit.
      await barrier.query('lock table audit.events in share mode')
      const writing = insertNotification(
        systemAuditCtx(null),
        notification(f.department.id, f.member.id),
      )
      const writerPid = await blockedBy(await pid(barrier))
      const removing = removal.query(
        "update app.memberships set status='removed' where department_id=$1 and user_id=$2",
        [f.department.id, f.member.id],
      )
      await blockedBy(writerPid)
      await barrier.query('commit')
      const accepted = await writing
      await removing
      await removal.query('commit')
      expect(
        await superuserQuery(db, 'select id from app.notifications where id=$1', [accepted.id]),
      ).toHaveLength(1)
      expect(
        await superuserQuery(
          db,
          "select id from audit.events where subject_id=$1 and action='notifications.created'",
          [accepted.id],
        ),
      ).toHaveLength(1)
      expect(
        await superuserQuery(
          db,
          "select id from app.outbox_events where payload->>'notificationId'=$1 and type='notifications.notification.created'",
          [accepted.id],
        ),
      ).toHaveLength(1)
    } finally {
      await barrier.query('rollback')
      await barrier.end()
      await removal.query('rollback')
      await removal.end()
    }
  })
})
