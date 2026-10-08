import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProjectDTO } from '../../src/modules/projects/schemas.js'
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
let colleague: Session
let head: Session
let foreign: Session
let ownerId: string
let colleagueId: string

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Project lifecycle',
    slug: `life-${randomUUID()}`,
  })
  const other = await seedDepartment(db, { name: 'Other', slug: `other-${randomUUID()}` })
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, other.id, { role: 'member' }),
  ])
  ownerId = users[0]!.id
  colleagueId = users[1]!.id
  ;[owner, colleague, head, foreign] = (await Promise.all(
    users.map((user) => loginAs(server.baseUrl, user.login)),
  )) as [Session, Session, Session, Session]
})
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

function request(path: string, method = 'GET', body?: unknown, session = owner) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function createProject(fromTemplate = false): Promise<ProjectDTO> {
  const res = await request(fromTemplate ? '/projects/from-template' : '/projects', 'POST', {
    title: 'Lifecycle project',
    ownerUserId: ownerId,
    members: [ownerId, colleagueId],
    ...(fromTemplate ? { templateKey: 'standard-project' } : {}),
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<ProjectDTO>
}
async function createCard(projectId: string) {
  const res = await request('/cards', 'POST', { title: 'Project task', projectId })
  expect(res.status).toBe(201)
  return res.json() as Promise<{ id: string; projectScope: string }>
}

describe('project lifecycle', () => {
  it('creates blank milestones even from starter template and persists a varied default colour', async () => {
    const projects = await Promise.all([createProject(), createProject(true)])
    for (const project of projects) {
      expect(project.milestones).toEqual([])
      const palette = ['#6366f1', '#d97706', '#0891b2', '#9333ea', '#db2777', '#2563eb']
      expect(project.colour).toBe(
        palette[Number.parseInt(project.id.slice(0, 8), 16) % palette.length],
      )
      const res = await request(`/projects/${project.id}`, 'PATCH', { title: 'Renamed' })
      expect(((await res.json()) as ProjectDTO).colour).toBe(project.colour)
    }
  })

  it('edits and removes chosen milestones without losing an audit record or allowing cross-project deletion', async () => {
    const project = await createProject()
    const other = await createProject()
    const created = await request(`/projects/${project.id}/milestones`, 'POST', {
      title: 'Team checkpoint',
    })
    const milestone = ((await created.json()) as ProjectDTO).milestones[0]!
    expect(
      (
        await request(`/projects/${project.id}/milestones/${milestone.id}`, 'PATCH', {
          title: '  ',
        })
      ).status,
    ).toBe(422)
    const updated = await request(
      `/projects/${project.id}/milestones/${milestone.id}`,
      'PATCH',
      { title: 'Reviewed', dueOn: '2027-02-02', done: true },
      colleague,
    )
    expect(((await updated.json()) as ProjectDTO).milestones[0]).toMatchObject({
      title: 'Reviewed',
      dueOn: '2027-02-02',
    })
    expect(
      (await request(`/projects/${other.id}/milestones/${milestone.id}`, 'DELETE')).status,
    ).toBe(404)
    expect(
      (
        await request(
          `/projects/${project.id}/milestones/${milestone.id}`,
          'DELETE',
          undefined,
          foreign,
        )
      ).status,
    ).toBe(404)
    const removed = await request(`/projects/${project.id}/milestones/${milestone.id}`, 'DELETE')
    expect(((await removed.json()) as ProjectDTO).milestones).toEqual([])
    const audit = await superuserQuery<{ before: { title: string } }>(
      db,
      "select before from audit.events where action = 'projects.milestone_deleted' and subject_id = $1",
      [project.id],
    )
    expect(audit[0]?.before.title).toBe('Reviewed')
  })

  it('rolls up partial checklist progress, completed and legacy-scoped tasks equally in list/detail, excluding deleted work', async () => {
    const project = await createProject()
    const [done, partial, deleted] = await Promise.all([
      createCard(project.id),
      createCard(project.id),
      createCard(project.id),
    ])
    expect(partial.projectScope).toBe('objective')
    await request(`/cards/${done.id}`, 'PATCH', { status: 'done' })
    await request(`/cards/${deleted.id}`, 'DELETE')
    await superuserQuery(db, "update app.cards set project_scope = 'none' where id = $1", [
      partial.id,
    ])
    const first = await request(`/cards/${partial.id}/checklist`, 'POST', { text: 'First step' })
    const item = (await first.json()) as { id: string }
    await request(`/cards/${partial.id}/checklist`, 'POST', { text: 'Second step' })
    await request(`/cards/${partial.id}/checklist/${item.id}`, 'PATCH', { done: true })
    const detail = (await (await request(`/projects/${project.id}`)).json()) as ProjectDTO
    const list = (await (await request('/projects')).json()) as ProjectDTO[]
    expect(detail.progress).toBe(0.75)
    expect(detail.objectiveTotal).toBe(2)
    expect(detail.objectiveDone).toBe(1)
    expect(list.find((p) => p.id === project.id)?.progress).toBe(0.75)
    await request(`/cards/${done.id}`, 'PATCH', { status: 'archived' })
    expect(((await (await request(`/projects/${project.id}`)).json()) as ProjectDTO).progress).toBe(
      0.75,
    )
  })

  it('uses completed milestones when no tasks exist, updates list/detail, and lets actual tasks take precedence', async () => {
    const project = await createProject()
    const added = await request(`/projects/${project.id}/milestones`, 'POST', {
      title: 'Discovery',
    })
    const first = ((await added.json()) as ProjectDTO).milestones[0]!
    const next = await request(`/projects/${project.id}/milestones`, 'POST', { title: 'Approval' })
    const second = ((await next.json()) as ProjectDTO).milestones.find(
      (item) => item.id !== first.id,
    )!
    const updated = await request(`/projects/${project.id}/milestones/${first.id}`, 'PATCH', {
      done: true,
    })
    expect(((await updated.json()) as ProjectDTO).progress).toBe(0.5)
    const listed = (await (await request('/projects')).json()) as ProjectDTO[]
    expect(listed.find((item) => item.id === project.id)?.progress).toBe(0.5)
    const card = await createCard(project.id)
    expect(((await (await request(`/projects/${project.id}`)).json()) as ProjectDTO).progress).toBe(
      0,
    )
    await request(`/cards/${card.id}`, 'DELETE')
    expect(((await (await request(`/projects/${project.id}`)).json()) as ProjectDTO).progress).toBe(
      0.5,
    )
    const removed = await request(`/projects/${project.id}/milestones/${first.id}`, 'DELETE')
    expect(((await removed.json()) as ProjectDTO).progress).toBe(0)
    const completed = await request(`/projects/${project.id}/milestones/${second.id}`, 'PATCH', {
      done: true,
    })
    expect(((await completed.json()) as ProjectDTO).progress).toBe(1)
  })

  it('uses the explicit done status for an otherwise empty project', async () => {
    const project = await createProject()
    expect(project.progress).toBe(0)
    const done = await request(`/projects/${project.id}`, 'PATCH', { status: 'done' })
    expect(done.status).toBe(200)
    expect(((await done.json()) as ProjectDTO).progress).toBe(1)
  })

  it('deletes owner/head projects and live child tasks atomically, retains audit, and only undoes its own cascade', async () => {
    const project = await createProject()
    const [live, previouslyDeleted] = await Promise.all([
      createCard(project.id),
      createCard(project.id),
    ])
    const noticeId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.notifications
      (id, user_id, type, reason, subject_type, subject_id, title)
      values ($1, $2, 'projects.project.created', 'assigned', 'project', $3,
        '{"en":"Retained project title","ru":"Retained project title","uz-Latn":"Retained project title","uz-Cyrl":"Retained project title"}')`,
      [noticeId, ownerId, project.id],
    )
    await request(`/cards/${previouslyDeleted.id}`, 'DELETE')
    expect((await request(`/projects/${project.id}`, 'DELETE', undefined, colleague)).status).toBe(
      403,
    )
    expect((await request(`/projects/${project.id}`, 'DELETE', undefined, foreign)).status).toBe(
      404,
    )
    expect(
      (
        await fetch(`${server.baseUrl}/api/v1/projects/${project.id}`, {
          method: 'DELETE',
          headers: { cookie: owner.cookie },
        })
      ).status,
    ).toBe(403)
    expect((await request(`/projects/${project.id}`, 'DELETE')).status).toBe(204)
    expect((await request(`/projects/${project.id}`)).status).toBe(404)
    const inbox = (await (await request('/notifications')).json()) as { items: { id: string }[] }
    expect(inbox.items.some((item) => item.id === noticeId)).toBe(false)
    expect((await request(`/cards/${live.id}`)).status).toBe(404)
    expect((await request(`/cards/${live.id}/undo-delete`, 'POST', {})).status).toBe(404)
    expect(
      (await request('/cards', 'POST', { title: 'Late task', projectId: project.id })).status,
    ).toBe(422)
    expect((await request(`/projects/${project.id}/undo-delete`, 'POST', {}, head)).status).toBe(
      404,
    )
    const retained = await superuserQuery<{ before: { title: string } }>(
      db,
      "select before from audit.events where action = 'projects.project_deleted' and subject_id = $1",
      [project.id],
    )
    expect(retained[0]?.before.title).toBe(project.title)
    expect((await request(`/projects/${project.id}/undo-delete`, 'POST', {})).status).toBe(204)
    expect((await request(`/cards/${live.id}`)).status).toBe(200)
    const restoredInbox = (await (await request('/notifications')).json()) as {
      items: { id: string }[]
    }
    expect(restoredInbox.items.some((item) => item.id === noticeId)).toBe(true)
    expect((await request(`/cards/${previouslyDeleted.id}`)).status).toBe(404)
    expect((await request(`/projects/${project.id}`, 'DELETE', undefined, head)).status).toBe(204)
    await superuserQuery(
      db,
      "update app.projects set deleted_at = now() - interval '31 seconds' where id = $1",
      [project.id],
    )
    expect((await request(`/projects/${project.id}/undo-delete`, 'POST', {}, head)).status).toBe(
      404,
    )
  })
})
