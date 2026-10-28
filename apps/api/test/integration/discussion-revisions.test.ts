import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  reconcileCommentNotifications,
  reconcileProjectCommentNotifications,
} from '../../src/modules/notifications/repo.js'
import { resolveEvent } from '../../src/modules/notifications/sources.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  loginAs,
  superuserQuery,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let departmentId: string
let ownerId: string
let colleagueId: string
let retainedId: string
let owner: Session
let colleague: Session
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Discussion revision QA', slug: `discussion-${randomUUID()}` })
  ).id
  const a = await seedMember(db, departmentId, { role: 'member' })
  const b = await seedMember(db, departmentId, { role: 'member' })
  ownerId = a.id
  colleagueId = b.id
  retainedId = (await seedMember(db, departmentId, { role: 'member' })).id
  owner = await loginAs(server.baseUrl, a.login)
  colleague = await loginAs(server.baseUrl, b.login)
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
async function request(session: Session, path: string, method = 'GET', body?: unknown) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(server.baseUrl + '/api/v1' + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function create(path: string, body: unknown) {
  const response = await request(owner, path, 'POST', body)
  expect(response.status, await response.clone().text()).toBe(201)
  return response.json() as Promise<{ id: string; version: number; options?: { id: string }[] }>
}

describe('comment revisions and historical event operations', () => {
  it('reconciles project mentions and handles delayed notifications after edits and deletion', async () => {
    const project = await create('/projects', {
      title: 'Project discussion',
      ownerUserId: ownerId,
      members: [ownerId, retainedId],
    })
    const base = `/projects/${project.id}/comments`
    const comment = await create(base, { text: 'Please review', mentions: [colleagueId] })
    const link = `/projects/view?id=${project.id}&tab=discussion#comment-${comment.id}`
    const removedNotice = randomUUID(),
      retainedNotice = randomUUID()
    await Promise.all(
      [
        [removedNotice, colleagueId],
        [retainedNotice, retainedId],
      ].map(([id, userId]) =>
        superuserQuery(
          db,
          `insert into app.notifications(id,user_id,department_id,type,reason,subject_type,subject_id,title,deep_link)
        values($1,$2,$3,'projects.project.commented','mentioned','project',$4,'{"en":"Comment"}'::jsonb,$5)`,
          [id, userId, departmentId, project.id, link],
        ),
      ),
    )
    expect(
      (
        await request(owner, `${base}/${comment.id}`, 'PATCH', {
          text: 'Corrected project decision',
          mentions: [],
          editedAt: null,
        })
      ).status,
    ).toBe(204)
    const event = (
      await superuserQuery(
        db,
        `select payload from app.outbox_events where type='projects.comment.updated' and payload->>'commentId'=$1`,
        [comment.id],
      )
    )[0]!
    await reconcileProjectCommentNotifications(
      departmentId,
      event['payload'] as Record<string, unknown>,
    )
    const notices = await superuserQuery(
      db,
      `select id,archived_at is not null as archived,body->>'en' as body from app.notifications where id=any($1::uuid[])`,
      [[removedNotice, retainedNotice]],
    )
    expect(notices.find((n) => n['id'] === removedNotice)?.['archived']).toBe(true)
    expect(notices.find((n) => n['id'] === retainedNotice)).toMatchObject({
      archived: false,
      body: 'Corrected project decision',
    })
    const delayed = await resolveEvent({
      eventType: 'projects.project.commented',
      source: 'project_comment',
      departmentId,
      payload: {
        projectId: project.id,
        commentId: comment.id,
        mentions: [colleagueId],
        actorUserId: ownerId,
      },
    })
    expect(delayed?.byRule.mentioned).toEqual([])
    expect((await request(owner, `${base}/${comment.id}`, 'DELETE')).status).toBe(204)
    await reconcileProjectCommentNotifications(
      departmentId,
      event['payload'] as Record<string, unknown>,
    )
    expect(
      (
        await superuserQuery(
          db,
          'select archived_at is not null as archived from app.notifications where id=$1',
          [retainedNotice],
        )
      )[0]?.['archived'],
    ).toBe(true)
    expect(
      await resolveEvent({
        eventType: 'projects.project.commented',
        source: 'project_comment',
        departmentId,
        payload: { projectId: project.id, commentId: comment.id, actorUserId: ownerId },
      }),
    ).toBeNull()
  })
  it('edits only an owned comment, rejects stale writes, and retires only its notifications', async () => {
    const card = await create('/cards', { title: 'Comment lifecycle', assigneeUserId: ownerId })
    const comment = await create(`/cards/${card.id}/comments`, {
      text: '@Colleague please review',
      mentions: [colleagueId, retainedId],
    })
    const link = `/work/card?id=${card.id}#comment-${comment.id}`
    const notificationId = randomUUID()
    const retainedNotificationId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.notifications(id,user_id,department_id,type,reason,subject_type,subject_id,title,deep_link)
      values($1,$2,$3,'work.card.commented','mentioned','card',$4,'{"en":"Comment"}'::jsonb,$5)`,
      [notificationId, colleagueId, departmentId, card.id, link],
    )
    await superuserQuery(
      db,
      `insert into app.notifications(id,user_id,department_id,type,reason,subject_type,subject_id,title,deep_link)
      values($1,$2,$3,'work.card.commented','mentioned','card',$4,'{"en":"Comment"}'::jsonb,$5)`,
      [retainedNotificationId, retainedId, departmentId, card.id, link],
    )
    const input = { text: 'Review scope corrected', mentions: [retainedId], editedAt: null }
    expect(
      (await request(colleague, `/cards/${card.id}/comments/${comment.id}`, 'PATCH', input)).status,
    ).toBe(403)
    expect(
      (await request(owner, `/cards/${card.id}/comments/${comment.id}`, 'PATCH', input)).status,
    ).toBe(204)
    expect(
      (await request(owner, `/cards/${card.id}/comments/${comment.id}`, 'PATCH', input)).status,
    ).toBe(409)
    const updated = (await (await request(owner, `/cards/${card.id}`)).json()) as {
      comments: { body: { text: string }; editedAt: string; mentions: string[] }[]
    }
    expect(updated.comments[0]).toMatchObject({
      body: { text: input.text },
      mentions: [retainedId],
    })
    expect(updated.comments[0]!.editedAt).toBeTruthy()
    const event = (
      await superuserQuery(
        db,
        `select payload from app.outbox_events where type='work.comment.updated' and payload->>'commentId'=$1`,
        [comment.id],
      )
    )[0]!
    await reconcileCommentNotifications(departmentId, event['payload'] as Record<string, unknown>)
    expect(
      (
        await superuserQuery(
          db,
          'select read_at is not null as read,archived_at is not null as archived from app.notifications where id=$1',
          [notificationId],
        )
      )[0],
    ).toEqual({ read: true, archived: true })
    expect(
      (
        await superuserQuery(
          db,
          "select read_at is not null as read,archived_at is not null as archived,body->>'en' as body from app.notifications where id=$1",
          [retainedNotificationId],
        )
      )[0],
    ).toEqual({ read: false, archived: false, body: input.text })
    const stale = await resolveEvent({
      eventType: 'work.card.commented',
      source: 'card_comment',
      departmentId,
      payload: {
        cardId: card.id,
        commentId: comment.id,
        mentions: [colleagueId],
        actorUserId: ownerId,
      },
    })
    expect(stale?.byRule.mentioned).toEqual([])
    expect(
      (await request(colleague, `/cards/${card.id}/comments/${comment.id}`, 'DELETE')).status,
    ).toBe(403)
    expect(
      (await request(owner, `/cards/${card.id}/comments/${comment.id}`, 'DELETE')).status,
    ).toBe(204)
    // Even a delayed edit event must see the deletion and retire retained recipients now.
    await reconcileCommentNotifications(departmentId, event['payload'] as Record<string, unknown>)
    expect(
      (
        await superuserQuery(
          db,
          'select read_at is not null as read,archived_at is not null as archived from app.notifications where id=$1',
          [retainedNotificationId],
        )
      )[0],
    ).toEqual({ read: true, archived: true })
    expect(
      await resolveEvent({
        eventType: 'work.card.commented',
        source: 'card_comment',
        departmentId,
        payload: {
          cardId: card.id,
          commentId: comment.id,
          mentions: [colleagueId],
          actorUserId: ownerId,
        },
      }),
    ).toBeNull()
    expect(
      (
        await superuserQuery(
          db,
          'select action from audit.events where subject_id=$1 order by at',
          [comment.id],
        )
      ).map((row) => row['action']),
    ).toContain('work.comment_edited')
  })
  it('permits shared page edits/deletion and safely validates typography', async () => {
    const page = await create('/pages', { title: 'Shared knowledge' })
    const blocks = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Readable',
              marks: [{ type: 'textSize', attrs: { size: 'large' } }],
            },
          ],
        },
      ],
    }
    expect(
      (await request(colleague, `/pages/${page.id}`, 'PATCH', { blocks, version: page.version }))
        .status,
    ).toBe(200)
    const unsafe = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Unsafe',
              marks: [{ type: 'textSize', attrs: { size: 'url(javascript:alert(1))' } }],
            },
          ],
        },
      ],
    }
    expect(
      (
        await request(colleague, `/pages/${page.id}`, 'PATCH', {
          blocks: unsafe,
          version: page.version + 1,
        })
      ).status,
    ).toBe(422)
    expect((await request(colleague, `/pages/${page.id}`, 'DELETE')).status).toBe(204)
    expect((await request(colleague, `/pages/${page.id}/restore`, 'POST', {})).status).toBe(204)
  })
  it('locks all reservation and planning changes after the actual end while discussion stays editable', async () => {
    const event = await create('/events', {
      title: 'Historical event',
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      capacity: 10,
    })
    const item = await create(`/events/${event.id}/items`, { label: 'Projector', quantity: 1 })
    const poll = await create(`/events/${event.id}/polls`, {
      kind: 'single',
      question: 'Room?',
      options: [{ label: 'A' }, { label: 'B' }],
    })
    expect(
      (await request(owner, `/events/${event.id}/rsvp`, 'POST', { status: 'yes', guests: 0 }))
        .status,
    ).toBe(200)
    const carpool = await create(`/events/${event.id}/carpools`, { seats: 3 })
    await superuserQuery(
      db,
      "update app.events set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
      [event.id],
    )
    const writes: [string, string, unknown?][] = [
      ['POST', `/events/${event.id}/rsvp`, { status: 'no', guests: 0 }],
      ['PATCH', `/events/${event.id}`, { title: 'Rewriting history' }],
      ['POST', `/events/${event.id}/cancel`, { reason: 'Too late' }],
      ['POST', `/events/${event.id}/items`, { label: 'Extra', quantity: 1 }],
      ['POST', `/events/${event.id}/items/${item.id}/claim`, {}],
      ['DELETE', `/events/${event.id}/items/${item.id}/claim`],
      [
        'POST',
        `/events/${event.id}/polls`,
        { kind: 'single', question: 'Later?', options: [{ label: 'A' }, { label: 'B' }] },
      ],
      ['POST', `/events/${event.id}/polls/${poll.id}/vote`, { optionIds: [poll.options![0]!.id] }],
      ['POST', `/events/${event.id}/carpools`, { seats: 1 }],
      ['PATCH', `/events/${event.id}/carpools/${carpool.id}`, { seats: 2 }],
      ['DELETE', `/events/${event.id}/carpools/${carpool.id}`],
      ['POST', `/events/${event.id}/carpools/${carpool.id}/claim`, { seats: 1 }],
      ['DELETE', `/events/${event.id}/carpools/${carpool.id}/claim`],
    ]
    for (const [method, path, body] of writes)
      expect((await request(owner, path, method, body)).status, path).toBe(409)
    const comment = await create(`/events/${event.id}/comments`, { body: 'Useful retrospective' })
    expect(
      (
        await request(colleague, `/events/${event.id}/comments/${comment.id}`, 'PATCH', {
          body: 'Changed by another person',
          editedAt: null,
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await request(owner, `/events/${event.id}/comments/${comment.id}`, 'PATCH', {
          body: 'Corrected retrospective',
          editedAt: null,
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await request(owner, `/events/${event.id}/comments/${comment.id}`, 'PATCH', {
          body: 'Stale overwrite',
          editedAt: null,
        })
      ).status,
    ).toBe(409)
    const comments = (await (await request(owner, `/events/${event.id}/comments`)).json()) as {
      items: { body: string; editedAt: string }[]
    }
    expect(comments.items[0]).toMatchObject({ body: 'Corrected retrospective' })
    expect(comments.items[0]!.editedAt).toBeTruthy()
    expect(
      (await request(owner, `/events/${event.id}/comments/${comment.id}`, 'DELETE')).status,
    ).toBe(204)
  })
})
