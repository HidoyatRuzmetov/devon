import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RequestContext } from '@devon/db'
import { MockProvider, buildOfflineRespond } from '@devon/ai'
import {
  runFeatureForActor,
  __setProviderForTests,
  __clearCacheForTests,
} from '../../src/modules/ai/service.js'
import { comparisonContext, comparisonScope } from '../../src/modules/ai/ask-context.js'
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

let db: Db,
  server: Server,
  ctx: RequestContext,
  departmentId: string,
  owner: string,
  otherPerson: string
const cardIds = Array.from({ length: 5 }, () => randomUUID())
const projectIds = [randomUUID(), randomUUID()]
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  departmentId = (
    await seedDepartment(db, { name: 'Context testing', slug: `context-${randomUUID()}` })
  ).id
  owner = (await seedMember(db, departmentId, { role: 'head' })).id
  otherPerson = (await seedMember(db, departmentId, { role: 'member' })).id
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
    `insert into app.projects(id,department_id,title,owner_user_id,members,status) values
    ($1,$3,'Open data audit',$4,array[$4]::uuid[],'active'),($2,$3,'Open data audit review',$5,array[$5]::uuid[],'active')`,
    [...projectIds, departmentId, owner, otherPerson],
  )
  for (let i = 0; i < cardIds.length; i++)
    await superuserQuery(
      db,
      `insert into app.cards(id,department_id,title,giver_user_id,assignee_user_id,project_id,deleted_at,created_by_user_id)
    values($1,$2,$3,$4,$5,$6,$7,$4)`,
      [
        cardIds[i],
        departmentId,
        `Open data audit ${i}`,
        owner,
        i % 2 ? otherPerson : owner,
        i === 2 || i === 3 ? projectIds[0] : null,
        i === 4 ? new Date() : null,
      ],
    )
}, 180000)
afterAll(async () => {
  __setProviderForTests(null)
  __clearCacheForTests()
  if (db && server) await stopHarness({ db, server })
})

describe('automatic scoped AI context', () => {
  it('routes individual similarity, group comparison and broad overlap questions separately', () => {
    expect(comparisonScope('Any similar tasks?')).toBe('individual')
    expect(comparisonScope('Are two groups doing the same work?')).toBe('projects')
    expect(comparisonScope('Do individual tasks and group projects overlap?')).toBe('all')
    expect(comparisonScope('Yakka vazifalar va guruh loyihalari takrorlanadimi?')).toBe('all')
    expect(comparisonScope('Similar individual tasks, not group projects')).toBe('individual')
    expect(comparisonScope('Are people doing repetitive work?')).toBe('all')
    expect(comparisonScope('Oʻxshash yakka vazifalar bormi?')).toBe('individual')
    expect(comparisonScope('Alohida vazifalar takrorlanadimi?')).toBe('individual')
    expect(comparisonScope('Алоҳида вазифалар такрорланадими?')).toBe('individual')
    expect(comparisonScope('Какие проекты дублируют друг друга?')).toBe('projects')
    expect(comparisonScope('Лойиҳаларда бир хил ишлар борми?')).toBe('projects')
    expect(comparisonScope('When is the next event?')).toBe(null)
  })
  it('loads only active standalone tasks for creation-time duplicate checks, ignoring forged client candidates', async () => {
    const input = await prepareFeatureInput(ctx, departmentId, 'duplicate_check', {
      candidateTitle: 'Open data audit',
      existing: [{ id: 'forged' }],
    })
    expect((input['existing'] as { id: string }[]).map((x) => x.id).sort()).toEqual(
      cardIds.slice(0, 2).sort(),
    )
    await superuserQuery(db, 'update app.cards set title=$2 where id=$1', [
      cardIds[0],
      'Completely different printer delivery',
    ])
    const fresh = await prepareFeatureInput(ctx, departmentId, 'duplicate_check', {
      candidateTitle: 'Open data audit',
    })
    expect((fresh['existing'] as { id: string }[]).map((x) => x.id)).not.toContain(cardIds[0])
  })
  it('represents each group once and never includes internal assignments as rival work', async () => {
    const hits = await comparisonContext(ctx, departmentId, 'Any repetitive work?', 'all')
    expect(
      hits
        .filter((x) => x.subjectType === 'project')
        .map((x) => x.subjectId)
        .sort(),
    ).toEqual([...projectIds].sort())
    expect(
      hits
        .filter((x) => x.subjectType === 'card')
        .map((x) => x.subjectId)
        .sort(),
    ).toEqual(cardIds.slice(0, 2).sort())
    const individuals = await comparisonContext(ctx, departmentId, 'similar tasks', 'individual')
    expect(individuals.every((x) => x.subjectType === 'card')).toBe(true)
    const groups = await comparisonContext(ctx, departmentId, 'similar projects', 'projects')
    expect(groups.every((x) => x.subjectType === 'project')).toBe(true)
  })
  it('keeps personal quick-add isolated and supplies current board directories automatically', async () => {
    const privateInput = await prepareFeatureInput(ctx, departmentId, 'quick_add_parse', {
      scope: 'personal',
      locale: 'en',
      text: 'Personal reminder',
      members: [{ userId: owner, fullName: 'Forged', givenName: 'Forged' }],
    })
    expect(privateInput).toMatchObject({
      members: [],
      labels: [],
      projects: [],
      defaultAssigneeUserId: null,
    })
    const boardInput = await prepareFeatureInput(ctx, departmentId, 'quick_add_parse', {
      locale: 'en',
      text: 'Test: prepare report',
      defaultAssigneeUserId: 'not-a-member',
    })
    expect((boardInput['members'] as { userId: string }[]).map((x) => x.userId).sort()).toEqual(
      [owner, otherPerson].sort(),
    )
    expect(boardInput['defaultAssigneeUserId']).toBeNull()
    expect(JSON.stringify(boardInput)).not.toContain('password')
    const foreign = (await seedDepartment(db, { name: 'Foreign', slug: `foreign-${randomUUID()}` }))
      .id
    expect(await comparisonContext(ctx, foreign, 'similar work', 'all')).toEqual([])
  })
  it('caches only unchanged context for the same person and records no second charge', async () => {
    await superuserQuery(
      db,
      `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags)
      values($1,1000000,'{"quick_add_parse":true}') on conflict(department_id) do update set budget_uzs_per_month=1000000,flags='{"quick_add_parse":true}'`,
      [departmentId],
    )
    const provider = new MockProvider({ respond: buildOfflineRespond() })
    __setProviderForTests(provider)
    __clearCacheForTests()
    const params = {
      departmentId,
      userId: owner,
      feature: 'quick_add_parse',
      input: { locale: 'en', text: 'Prepare the report' },
    }
    await runFeatureForActor(ctx, params)
    const cached = await runFeatureForActor(ctx, params)
    expect(cached.meta).toMatchObject({ cached: true, costUzs: 0, totalTokens: 0 })
    expect(provider.calls).toHaveLength(1)
    await superuserQuery(db, 'update app.projects set title=$2 where id=$1', [
      projectIds[0],
      'Updated group title',
    ])
    await runFeatureForActor(ctx, params)
    expect(provider.calls).toHaveLength(2)
    await runFeatureForActor(
      { ...ctx, userId: otherPerson, departmentRole: 'member' },
      { ...params, userId: otherPerson },
    )
    expect(provider.calls).toHaveLength(3)
  })
})
