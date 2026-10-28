import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  claimGroupMention,
  connectedMentionGroup,
  finishGroupMention,
  mentionCandidateIds,
  rememberGroupMember,
} from '../../src/modules/telegram/group-mentions-repo.js'
import {
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  superuserQuery,
  type Db,
  type Server,
} from './harness.js'
let db: Db, server: Server, department: string, foreign: string
const group = randomUUID(),
  otherGroup = randomUUID()
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  department = (await seedDepartment(db, { name: 'Mentions QA', slug: randomUUID() })).id
  foreign = (await seedDepartment(db, { name: 'Other group QA', slug: randomUUID() })).id
  const own = await seedMember(db, department, { role: 'member' }),
    other = await seedMember(db, foreign, { role: 'member' })
  await superuserQuery(
    db,
    'insert into app.telegram_groups(id,department_id,chat_id) values($1,$2,-991301),($3,$4,-991302)',
    [group, department, otherGroup, foreign],
  )
  await superuserQuery(
    db,
    'insert into app.telegram_links(user_id,chat_id) values($1,901301),($2,901302)',
    [own.id, other.id],
  )
}, 180000)
afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})
describe('durable group mention boundaries', () => {
  it('combines observed members with only the connected department accounts', async () => {
    await rememberGroupMember(group, { id: 901303, is_bot: false, first_name: 'Observed' })
    await rememberGroupMember(otherGroup, { id: 901304, is_bot: false, first_name: 'Foreign' })
    await rememberGroupMember(group, { id: 901305, is_bot: true, first_name: 'Bot' })
    expect(await connectedMentionGroup(-991301)).toMatchObject({
      id: group,
      department_id: department,
    })
    expect((await mentionCandidateIds(group, department)).sort()).toEqual([901301, 901303])
    await rememberGroupMember(group, { id: 901303, is_bot: false, first_name: 'Observed' }, false)
    expect(await mentionCandidateIds(group, department)).toEqual([901301])
  })
  it('claims once across concurrent deliveries and preserves the receipt after completion', async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimGroupMention(group, 40)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    await finishGroupMention(group, 40, true, 2)
    expect(await claimGroupMention(group, 40)).toBe(false)
    expect(await claimGroupMention(otherGroup, 40)).toBe(true)
    const rows = await superuserQuery(
      db,
      'select status,recipients from app.telegram_group_mentions where group_id=$1 and message_id=40',
      [group],
    )
    expect(rows).toEqual([{ status: 'sent', recipients: 2 }])
    const audit = await superuserQuery(
      db,
      "select id from audit.events where action='telegram.group_mentioned' and subject_id=$1",
      [group],
    )
    expect(audit).toHaveLength(1)
  })
  it('does not resolve disconnected groups', async () => {
    await superuserQuery(db, 'update app.telegram_groups set disconnected_at=now() where id=$1', [
      group,
    ])
    expect(await connectedMentionGroup(-991301)).toBeNull()
  })
})
