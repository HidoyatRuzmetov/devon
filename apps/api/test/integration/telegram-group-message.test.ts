import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import type { Bot } from 'grammy'
import * as transport from '../../src/modules/telegram/transport.js'
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
let db: Db, server: Server, head: Session, member: Session, groupId: string
const send = vi.fn(async () => ({ ok: true as const, messageId: 100 }))
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const department = await seedDepartment(db, { name: 'Group message QA', slug: randomUUID() })
  const owner = await seedMember(db, department.id, { role: 'head' }),
    peer = await seedMember(db, department.id, { role: 'member' })
  head = await loginAs(server.baseUrl, owner.login)
  member = await loginAs(server.baseUrl, peer.login)
  groupId = randomUUID()
  await superuserQuery(
    db,
    'insert into app.telegram_groups(id,department_id,chat_id) values($1,$2,-991999)',
    [groupId, department.id],
  )
  await superuserQuery(
    db,
    "insert into app.telegram_group_members(group_id,telegram_user_id,first_name) values($1,101,'Verified'),($1,102,'Left')",
    [groupId],
  )
})
beforeEach(() => {
  const bot = {
    api: {
      getMe: async () => ({ id: 99 }),
      getChatAdministrators: async () => [],
      getChatMember: async (_chat: string, id: number) => ({
        status: id === 99 ? 'administrator' : id === 102 ? 'left' : 'member',
        user: { id, is_bot: id === 99, first_name: 'Verified' },
      }),
    },
  }
  vi.spyOn(transport, 'getBot').mockReturnValue(bot as unknown as Bot)
  vi.spyOn(transport, 'sendMentionMessage').mockImplementation(send)
})
afterAll(async () => {
  vi.restoreAllMocks()
  if (db && server) await stopHarness({ db, server })
})
function request(
  actor: Session,
  operationId: string,
  message = 'Please update your profile',
  mentionAll = false,
  id = groupId,
) {
  return fetch(server.baseUrl + '/api/v1/telegram/group-message', {
    method: 'POST',
    headers: { ...actor.headers, 'x-operation-id': operationId },
    body: JSON.stringify({ groupId: id, message, mentionAll }),
  })
}
it('refuses members and foreign group IDs, mentions only verified present people, and never replays a receipt', async () => {
  expect((await request(member, randomUUID())).status).toBe(403)
  expect((await request(head, randomUUID(), 'Foreign', false, randomUUID())).status).toBe(422)
  expect(send).not.toHaveBeenCalled()
  const operation = randomUUID()
  const first = await request(head, operation, '@all Please update your profile', true)
  expect(
    first.status,
    JSON.stringify({
      body: await first.clone().json(),
      receipts: await superuserQuery(
        db,
        'select status,recipients from app.telegram_message_receipts',
      ),
      sendCalls: send.mock.calls.length,
    }),
  ).toBe(200)
  expect(await first.json()).toEqual({ recipients: 1 })
  expect(send).toHaveBeenCalledOnce()
  expect((await request(head, operation, '@all Please update your profile', true)).status).toBe(200)
  expect((await request(head, operation, 'Changed body', true)).status).toBe(409)
  expect(send).toHaveBeenCalledOnce()
})
