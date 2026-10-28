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
let head: Session
let member: Session
let foreign: Session
let headId: string
let memberId: string
let foreignId: string
let partialProject: ProjectDTO

beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, {
    name: 'Analytics progress',
    slug: `progress-${randomUUID()}`,
  })
  const other = await seedDepartment(db, { name: 'Other', slug: `other-${randomUUID()}` })
  const users = await Promise.all([
    seedMember(db, department.id, { role: 'head' }),
    seedMember(db, department.id, { role: 'member' }),
    seedMember(db, other.id, { role: 'head' }),
  ])
  ;[headId, memberId, foreignId] = users.map((user) => user.id) as [string, string, string]
  ;[head, member, foreign] = (await Promise.all(
    users.map((user) => loginAs(server.baseUrl, user.login)),
  )) as [Session, Session, Session]

  partialProject = await createProject('Partial project')
  const completed = await createCard(partialProject.id)
  await checkedRequest(`/cards/${completed.id}`, 'PATCH', { status: 'done' })
  await checkedRequest(`/cards/${completed.id}`, 'PATCH', { status: 'archived' })
  const abandoned = await createCard(partialProject.id)
  await checkedRequest(`/cards/${abandoned.id}`, 'PATCH', { status: 'archived' })
  const deleted = await createCard(partialProject.id)
  await checkedRequest(`/cards/${deleted.id}`, 'PATCH', { status: 'done' })
  await checkedRequest(`/cards/${deleted.id}`, 'DELETE')

  const objective = await createCard(partialProject.id)
  // Legacy linked cards have project_scope=none; they still count as objective work.
  await superuserQuery(db, "update app.cards set project_scope = 'none' where id = $1", [
    objective.id,
  ])
  await addChecklist(objective.id, [true, false])
  const removed = await checkedRequest(`/cards/${objective.id}/checklist`, 'POST', {
    text: 'Removed checklist item',
  })
  const removedId = ((await removed.json()) as { id: string }).id
  await checkedRequest(`/cards/${objective.id}/checklist/${removedId}`, 'DELETE')
  const subjective = await createCard(partialProject.id, 'subjective')
  await addChecklist(subjective.id, [true, false, false, false])
})

afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

async function checkedRequest(path: string, method = 'GET', body?: unknown, session = head) {
  const headers = { ...session.headers }
  if (body === undefined) delete headers['content-type']
  const response = await fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  expect(response.status, `${method} ${path}`).toBeLessThan(300)
  return response
}

async function createProject(title: string, session = head, ownerUserId = headId) {
  const response = await checkedRequest(
    '/projects',
    'POST',
    { title, ownerUserId, members: session === head ? [headId, memberId] : [ownerUserId] },
    session,
  )
  return response.json() as Promise<ProjectDTO>
}

async function createCard(
  projectId: string,
  projectScope: 'objective' | 'subjective' = 'objective',
) {
  const response = await checkedRequest('/cards', 'POST', {
    title: 'Project work',
    projectId,
    projectScope,
  })
  return response.json() as Promise<{ id: string }>
}

async function addChecklist(cardId: string, done: boolean[]) {
  // Creates are sequential because each new checklist item's rank follows the preceding item.
  for (let index = 0; index < done.length; index++) {
    const response = await checkedRequest(`/cards/${cardId}/checklist`, 'POST', {
      text: `Step ${index + 1}`,
    })
    const item = (await response.json()) as { id: string }
    if (done[index]) {
      await checkedRequest(`/cards/${cardId}/checklist/${item.id}`, 'PATCH', { done: true })
    }
  }
}

async function progress(_filter = '', session = head) {
  const response = await checkedRequest('/projects', 'GET', undefined, session)
  const projects = (await response.json()) as ProjectDTO[]
  return projects.map((p) => ({
    id: p.id,
    progress: p.progress,
    totalTasks: p.objectiveTotal + p.subjectiveTotal,
    doneTasks: p.objectiveDone + p.subjectiveDone,
  }))
}

describe('consistent project progress in Home and Projects', () => {
  it('keeps task counts separate from milestone progress', async () => {
    const projects = (await (await checkedRequest('/projects')).json()) as ProjectDTO[]
    const detail = (await (
      await checkedRequest(`/projects/${partialProject.id}`)
    ).json()) as ProjectDTO
    expect(detail).toMatchObject({ objectiveTotal: 2, objectiveDone: 1, subjectiveTotal: 1 })
    expect(detail.progress).toBe(0)
    const analytics = (await progress()).find((project) => project.id === partialProject.id)!
    expect(analytics).toMatchObject({ totalTasks: 3, doneTasks: 1 })
    expect(analytics.progress).toBeCloseTo(detail.progress)
    expect(projects.find((project) => project.id === partialProject.id)?.progress).toBeCloseTo(
      analytics.progress,
    )
    expect(
      (await progress('', member)).find((project) => project.id === partialProject.id),
    ).toEqual(analytics)
  })

  it('uses milestones regardless of task completion or explicit project status', async () => {
    const milestoneProject = await createProject('Milestone project')
    const first = (await (
      await checkedRequest(`/projects/${milestoneProject.id}/milestones`, 'POST', {
        title: 'Discovery complete',
      })
    ).json()) as ProjectDTO
    await checkedRequest(`/projects/${milestoneProject.id}/milestones`, 'POST', {
      title: 'Ready for approval',
    })
    await checkedRequest(
      `/projects/${milestoneProject.id}/milestones/${first.milestones[0]!.id}`,
      'PATCH',
      {
        done: true,
      },
    )
    const emptyDone = await createProject('Empty done project')
    await checkedRequest(`/projects/${emptyDone.id}`, 'PATCH', { status: 'done' })
    const emptyActive = await createProject('Empty active project')
    const initial = await progress()
    expect(initial.find((project) => project.id === milestoneProject.id)?.progress).toBe(0.5)
    expect(initial.find((project) => project.id === emptyDone.id)).toMatchObject({
      totalTasks: 0,
      doneTasks: 0,
      progress: 0,
    })
    expect(initial.find((project) => project.id === emptyActive.id)?.progress).toBe(0)
    const actualTask = await createCard(milestoneProject.id)
    expect((await progress()).find((project) => project.id === milestoneProject.id)?.progress).toBe(
      0.5,
    )
    await checkedRequest(`/cards/${actualTask.id}`, 'DELETE')
    expect((await progress()).find((project) => project.id === milestoneProject.id)?.progress).toBe(
      0.5,
    )
    await checkedRequest(`/projects/${emptyActive.id}`, 'DELETE')
    expect((await progress()).some((project) => project.id === emptyActive.id)).toBe(false)
  })

  it('keeps the project list scoped to its department', async () => {
    const foreignProject = await createProject('Foreign project', foreign, foreignId)
    expect((await progress()).some((p) => p.id === foreignProject.id)).toBe(false)
    expect((await progress('', foreign)).some((p) => p.id === partialProject.id)).toBe(false)
  })
})
