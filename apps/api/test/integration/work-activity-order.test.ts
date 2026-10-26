import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { withContext, type RequestContext } from '@devon/db'
import { startHarness, stopHarness, seedDepartment, seedMember, superuserQuery } from './harness.js'
import {
  addChecklistItem,
  patchChecklistItem,
  deleteChecklistItem,
  getActivity,
  getMembers,
} from '../../src/modules/work/repo.js'
import { listMembers } from '../../src/modules/structure/repo.js'
import { listMembers as listSettingsMembers } from '../../src/modules/departments/repo.js'
import { activeMemberIds, nameRows } from '../../src/modules/people/repo.js'

let harness: Awaited<ReturnType<typeof startHarness>>
let ctx: RequestContext, departmentId: string, headId: string, memberId: string
const cardId = randomUUID()
beforeAll(async () => {
  harness = await startHarness()
  departmentId = (
    await seedDepartment(harness.db, { name: 'Activity QA', slug: `activity-${randomUUID()}` })
  ).id
  headId = (await seedMember(harness.db, departmentId, { role: 'head' })).id
  memberId = (await seedMember(harness.db, departmentId, { role: 'member' })).id
  await superuserQuery(
    harness.db,
    `update app.users set given_name=case when id=$1 then 'Ada' else 'Zarina' end,
      family_name=case when id=$1 then 'Adams' else 'Zaman' end where id in ($1,$2)`,
    [headId, memberId],
  )
  ctx = {
    requestId: randomUUID(),
    userId: headId,
    departmentId,
    departmentRole: 'head',
    actorRole: 'member',
    actingForUserId: null,
    viewAs: false,
    ip: '127.0.0.1',
    userAgent: 'activity-test',
  }
  await superuserQuery(
    harness.db,
    `update app.memberships set joined_at=case when user_id=$2 then '2020-01-01'::timestamptz else '2021-01-01'::timestamptz end where department_id=$1`,
    [departmentId, memberId],
  )
  await superuserQuery(
    harness.db,
    `insert into app.cards(id,department_id,title,giver_user_id,assignee_user_id,created_by_user_id) values($1,$2,'Activity fixture',$3,$3,$3)`,
    [cardId, departmentId, headId],
  )
})
afterAll(async () => {
  if (harness) await stopHarness(harness)
})
it('sorts only department settings members by joining date; board, directory and reports keep their existing order', async () => {
  expect((await listSettingsMembers(departmentId, headId, 'head')).map((m) => m.userId)).toEqual([
    memberId,
    headId,
  ])
  expect((await getMembers(ctx, departmentId)).map((m) => m.userId)).toEqual([headId, memberId])
  expect(await activeMemberIds(ctx, departmentId)).toEqual([headId, memberId])
  expect(
    (await withContext(ctx, (tx) => nameRows(tx, departmentId, [memberId, headId]))).map(
      (m) => m.userId,
    ),
  ).toEqual([headId, memberId])
  expect(
    (
      await listMembers(
        {
          requestId: ctx.requestId,
          userId: headId,
          role: 'member',
          ip: '127.0.0.1',
          userAgent: 'test',
        },
        departmentId,
      )
    ).map((m) => m.userId),
  ).toEqual([headId, memberId])
})
it('attributes checklist add, edit and removal to the human actor and marks assisted edits', async () => {
  const id = await addChecklistItem(ctx, departmentId, cardId, { text: 'Acceptance evidence' })
  expect(id).toBeTruthy()
  // Reproduce the historical missing-actor row, then prove the migration recovers the original
  // writer from the immutable audit rather than guessing from the card's assignee.
  await superuserQuery(
    harness.db,
    'update app.card_activity set actor_user_id=null where card_id=$1',
    [cardId],
  )
  await superuserQuery(
    harness.db,
    await readFile(
      new URL(
        '../../../../packages/db/migrations/2013_assistant_usage_activity.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  expect((await getActivity(ctx, cardId))[0]?.actorUserId).toBe(headId)
  await patchChecklistItem(
    { ...ctx, userAgent: 'WorkPortal ai-action/confirmed-proposal' },
    departmentId,
    cardId,
    id!,
    { done: true },
  )
  await deleteChecklistItem(ctx, departmentId, cardId, id!)
  const activity = await getActivity(ctx, cardId)
  expect(activity).toHaveLength(3)
  expect(
    activity.every(
      (event) => event.actorUserId === headId && typeof event.data['actorName'] === 'string',
    ),
  ).toBe(true)
  expect(activity.find((event) => event.data['operation'] === 'updated')?.data['via']).toBe('ai')
  expect(activity.find((event) => event.data['operation'] === 'deleted')?.data['via']).toBe(
    'manual',
  )
})
