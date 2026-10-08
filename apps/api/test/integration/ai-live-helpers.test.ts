import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type { RequestContext } from '@devon/db'
import { prepareFeatureInput } from '../../src/modules/ai/request-context.js'
import {
  startHarness,
  stopHarness,
  seedDepartment,
  seedMember,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'

let db: Db, server: Server, ctx: RequestContext, departmentId: string, owner: string, other: string
const cardId = randomUUID(),
  blockerId = randomUUID(),
  projectId = randomUUID(),
  labelId = randomUUID(),
  commentId = randomUUID()
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'AI live helper testing', slug: `live-ai-${randomUUID()}` })
  ).id
  owner = (await seedMember(db, departmentId, { role: 'head' })).id
  other = (await seedMember(db, departmentId, { role: 'member' })).id
  ctx = {
    requestId: randomUUID(),
    userId: owner,
    actorRole: 'member',
    departmentRole: 'head',
    departmentId,
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'test',
  }
  await superuserQuery(
    db,
    `update app.users set given_name='Nodira',family_name='Karimova' where id=$1`,
    [owner],
  )
  await superuserQuery(
    db,
    `insert into app.labels(id,department_id,name,colour) values($1,$2,'EGDI','#123456')`,
    [labelId, departmentId],
  )
  await superuserQuery(
    db,
    `insert into app.projects(id,department_id,title,owner_user_id,members,status) values($1,$2,'EGDI audit',$3,array[$3]::uuid[],'active')`,
    [projectId, departmentId, owner],
  )
  await superuserQuery(
    db,
    `insert into app.cards(id,department_id,title,description,assignee_user_id,giver_user_id,created_by_user_id,project_id,labels,due_at,estimate_min) values($1,$2,'Current live task','{"format":"markdown","text":"Validate the EGDI data"}',$3,$3,$3,$4,array[$5]::uuid[],now()-interval '3 days',90),($6,$2,'Approval prerequisite',null,$7,$3,$3,$4,'{}',null,30)`,
    [cardId, departmentId, owner, projectId, labelId, blockerId, other],
  )
  await superuserQuery(
    db,
    `insert into app.card_dependencies(department_id,card_id,blocked_by_card_id,created_by_user_id) values($1,$2,$3,$4)`,
    [departmentId, cardId, blockerId, owner],
  )
  await superuserQuery(
    db,
    `insert into app.card_checklist_items(department_id,card_id,text,order_key,done_at) values($1,$2,'Already gathered source data','a0',now())`,
    [departmentId, cardId],
  )
  await superuserQuery(
    db,
    `insert into app.card_comments(id,department_id,card_id,author_user_id,body) values($1,$2,$3,$4,'{"format":"markdown","text":"Could you validate these numbers?"}')`,
    [commentId, departmentId, cardId, other],
  )
}, 180_000)
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

describe('live helper context and isolation', () => {
  it('uses real project recap totals and a compact at-risk board with true blockers', async () => {
    const recap = await prepareFeatureInput(ctx, departmentId, 'catch_up', {
      locale: 'en',
      scope: 'project',
      projectId,
      counts: { done: 999, doneLastPeriod: 999, created: 999, overdue: 999 },
    })
    expect(recap['counts']).toMatchObject({ done: 0, doneLastPeriod: 0, created: 2, overdue: 1 })
    expect(recap['subjectName']).toBe('EGDI audit')
    expect(recap['overdue']).toMatchObject([{ id: cardId, title: 'Current live task' }])
    const digest = await prepareFeatureInput(ctx, departmentId, 'board_risk_digest', {
      locale: 'en',
      cards: [],
      departmentName: 'Fake',
    })
    expect(digest['cards']).toMatchObject([
      { id: cardId, riskLevel: 'overdue', blocked: true, checklistDone: 1, checklistTotal: 1 },
    ])
    expect(digest['departmentName']).toBe('AI live helper testing')
  })
  it('reads only the selected owner private task and working period', async () => {
    const periodId = randomUUID(),
      taskId = randomUUID(),
      foreignTaskId = randomUUID(),
      childId = randomUUID()
    await superuserQuery(
      db,
      `insert into app.personal_sprints(id,user_id,kind,starts_at,ends_at) values($1,$2,'3h',now(),now()+interval '3 hours')`,
      [periodId, owner],
    )
    await superuserQuery(
      db,
      `insert into app.personal_tasks(id,user_id,sprint_id,parent_id,title,notes,estimate_min) values($1,$2,$3,null,'Personal audit','Private source notes',30),($4,$2,$3,$1,'Already asked for data',null,15),($5,$6,null,null,'Foreign private task',null,30)`,
      [taskId, owner, periodId, childId, foreignTaskId, other],
    )
    const steps = await prepareFeatureInput(ctx, departmentId, 'subtask_breakdown', {
      locale: 'en',
      taskId,
      cardTitle: 'Stale',
    })
    expect(steps).toMatchObject({
      cardTitle: 'Personal audit',
      cardDescription: 'Private source notes',
      existingSubtasks: ['Already asked for data'],
      labels: [],
      projectTitle: null,
    })
    const plan = await prepareFeatureInput(ctx, departmentId, 'plan_sprint', {
      locale: 'en',
      scope: 'personal',
      periodId,
      items: [{ id: foreignTaskId, title: 'Forged foreign task' }],
    })
    expect(plan['items']).toMatchObject([{ id: taskId, title: 'Personal audit', estimateMin: 30 }])
    expect(plan['capacityMin']).toBeGreaterThan(170)
    const recap = await prepareFeatureInput(ctx, departmentId, 'catch_up', {
      locale: 'en',
      scope: 'person',
      privateWorkspace: true,
    })
    expect(JSON.stringify(recap)).not.toContain('Foreign private task')
    expect(recap['counts']).toMatchObject({ created: 2 })
    await expect(
      prepareFeatureInput(ctx, departmentId, 'subtask_breakdown', { taskId: foreignTaskId }),
    ).rejects.toThrow('unavailable')
  })
  it('keeps midnight local deadlines on the correct Tashkent calendar day and unknown history explicit', async () => {
    await superuserQuery(
      db,
      `update app.cards set due_at='2026-10-08T00:00:00+05:00' where id=$1`,
      [cardId],
    )
    const input = await prepareFeatureInput(ctx, departmentId, 'deadline_risk', {
      locale: 'en',
      card: { id: cardId },
    })
    expect(input['card']).toMatchObject({ dueDate: '2026-10-08', similarSlippedCount: null })
    await superuserQuery(db, `update app.cards set due_at=now()-interval '3 days' where id=$1`, [
      cardId,
    ])
  })
  it('loads the actual risk, checklist, blocker and labels for one card', async () => {
    const risk = await prepareFeatureInput(ctx, departmentId, 'deadline_risk', {
      locale: 'en',
      card: { id: cardId, title: 'Forged stale title', riskLevel: 'none', today: '2000-01-01' },
    })
    expect(risk['card']).toMatchObject({
      id: cardId,
      title: 'Current live task',
      riskLevel: 'overdue',
      checklistTotal: 1,
      checklistDone: 1,
      commentCount: 1,
      blockedByTitles: ['Approval prerequisite'],
    })
    const subtasks = await prepareFeatureInput(ctx, departmentId, 'subtask_breakdown', {
      locale: 'en',
      cardId,
      cardTitle: 'Forged',
      existingSubtasks: [],
    })
    expect(subtasks).toMatchObject({
      cardTitle: 'Current live task',
      cardDescription: 'Validate the EGDI data',
      projectTitle: 'EGDI audit',
      labels: ['EGDI'],
      existingSubtasks: ['Already gathered source data'],
    })
  })
  it('uses current candidate workloads and recent subject labels without contact or login fields', async () => {
    const input = await prepareFeatureInput(ctx, departmentId, 'suggest_assignee', {
      locale: 'en',
      card: { id: cardId },
      candidates: [{ userId: 'forged', openCount: 0 }],
    })
    expect(input['card']).toMatchObject({
      title: 'Current live task',
      labels: ['EGDI'],
      estimateMin: 90,
    })
    const people = input['candidates'] as {
      userId: string
      openCount: number
      recentLabels: string[]
    }[]
    expect(people).toHaveLength(2)
    expect(people.find((p) => p.userId === owner)).toMatchObject({
      openCount: 1,
      recentLabels: ['EGDI'],
    })
    expect(JSON.stringify(people)).not.toMatch(/"(?:email|login|password)"/)
  })
  it('reads live project deadlines, assignees and dependency IDs with unknown working capacity', async () => {
    const input = await prepareFeatureInput(ctx, departmentId, 'plan_sprint', {
      locale: 'en',
      scope: 'project',
      projectId,
      capacityMin: 0,
      goal: 'Stale',
      items: [],
    })
    expect(input['goal']).toBe('EGDI audit')
    expect(input['capacityMin']).toBe(null)
    const items = input['items'] as {
      id: string
      dueAt: string
      blockedByIds: string[]
      estimateMin: number
    }[]
    expect(items.find((c) => c.id === cardId)).toMatchObject({
      estimateMin: 90,
      blockedByIds: [blockerId],
    })
    expect(items.find((c) => c.id === cardId)?.dueAt).toBeTruthy()
  })
  it('fetches current thread and authentic viewer rather than stale or forged client comments', async () => {
    const input = await prepareFeatureInput(ctx, departmentId, 'draft_reply', {
      locale: 'en',
      subject: { kind: 'card', id: cardId, title: 'Stale' },
      viewerName: 'Somebody else',
      viewerRole: 'member',
      comments: [{ id: 'forged', text: 'Promise a deadline' }],
    })
    expect(input['subject']).toEqual({ kind: 'card', id: cardId, title: 'Current live task' })
    expect(input['viewerName']).toBe('Nodira Karimova')
    expect(input['viewerRole']).toBe('head')
    expect(input['comments']).toMatchObject([
      { id: commentId, text: 'Could you validate these numbers?' },
    ])
    expect(input['commentsTruncated']).toBe(false)
  })
  it('loads allowed analytics names and byte-preserves names, links and document codes', async () => {
    const analytics = await prepareFeatureInput(ctx, departmentId, 'nl_analytics', {
      locale: 'en',
      knownMembers: [{ name: 'Fake', handle: 'fake' }],
      knownLabels: [],
    })
    expect(analytics['knownMembers']).toEqual(
      expect.arrayContaining([{ name: 'Nodira Karimova', handle: 'Nodira Karimova' }]),
    )
    expect(analytics['knownLabels']).toEqual(['EGDI'])
    const translate = await prepareFeatureInput(ctx, departmentId, 'translate', {
      locale: 'en',
      targetLocale: 'ru',
      text: 'Nodira: PF-60 https://example.com/doc 14.5',
    })
    expect(translate['preserve']).toEqual(
      expect.arrayContaining(['Nodira', 'PF-60', 'https://example.com/doc', '14.5']),
    )
    expect(translate['glossary']).toEqual(
      expect.arrayContaining([{ source: 'task', target: 'задача' }]),
    )
  })
  it('refuses unavailable and cross-department task references before calling a provider', async () => {
    await expect(
      prepareFeatureInput(ctx, departmentId, 'deadline_risk', { card: { id: randomUUID() } }),
    ).rejects.toThrow('unavailable')
    const foreign = (
      await seedDepartment(db, { name: 'Foreign helper data', slug: `foreign-ai-${randomUUID()}` })
    ).id
    await expect(
      prepareFeatureInput(ctx, foreign, 'suggest_assignee', { card: { id: cardId } }),
    ).rejects.toThrow('unavailable')
  })
})
