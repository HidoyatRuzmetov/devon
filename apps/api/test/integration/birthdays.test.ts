import { randomUUID } from 'node:crypto'
import { MockProvider } from '@devon/ai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withContext } from '@devon/db'
import { sql } from 'drizzle-orm'
import { birthdayClock, nextDay } from '../../src/modules/birthdays/calendar.js'
import { processBirthdays } from '../../src/modules/birthdays/worker.js'
import { FALLBACK_BIRTHDAY_MESSAGE } from '../../src/modules/birthdays/message.js'
import { claimCelebration, ensureGreeting } from '../../src/modules/birthdays/repo.js'
import { __setProviderForTests } from '../../src/modules/ai/service.js'
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

let db: Db, server: Server, departmentId: string
let owner: { id: string; login: string }, head: { id: string; login: string }
let auth: Session
const today = birthdayClock().date
const tomorrow = nextDay(today)
beforeAll(async () => {
  ;({ db, server } = await startHarness())
  const dept = await seedDepartment(db, {
    name: 'Birthday privacy',
    slug: `birthday-${randomUUID()}`,
  })
  departmentId = dept.id
  owner = await seedMember(db, dept.id, { role: 'member' })
  head = await seedMember(db, dept.id, { role: 'head' })
  auth = await loginAs(server.baseUrl, owner.login)
})
afterAll(async () => {
  __setProviderForTests(null)
  if (db && server) await stopHarness({ db, server })
})
function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${server.baseUrl}/api/v1${path}`, {
    method,
    headers: auth.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('private birthday account and first-entry receipt', () => {
  it('recovers a personal AI letter, minimizes context, and shares it across Telegram and portal', async () => {
    const person = await seedMember(db, departmentId, { role: 'member' })
    const personalLetter =
      'May the year ahead bring fresh ideas for the systems you build, and unhurried afternoons with a good book. May your curiosity lead you to rewarding discoveries, with space for small adventures and the people you love. We wish you steady health, happy shared moments, and plenty of reasons to smile along the way.'
    await superuserQuery(
      db,
      `update app.users set title='chief_specialist',professional_profile=$2::jsonb where id=$1`,
      [
        person.id,
        JSON.stringify({
          headline: 'Private legacy headline',
          skills: ['Software engineering'],
          hobbies: ['Reading', 'Hiking'],
          about: 'Private omitted biography',
          phone: 'Secret phone',
          location: 'Secret location',
          education: [{ field: 'Computer science', institution: 'Secret institution' }],
          experience: [
            {
              current: true,
              role: 'Software engineer',
              organization: 'Secret employer',
              description: 'Secret detail',
            },
          ],
        }),
      ],
    )
    await superuserQuery(
      db,
      `insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2)`,
      [person.id, `2000-${tomorrow.slice(5)}`],
    )
    await superuserQuery(
      db,
      `insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source,generation_retry_at) values($1,$2,$3,$4,'fallback',now()-interval '1 minute')`,
      [person.id, Number(tomorrow.slice(0, 4)), tomorrow, FALLBACK_BIRTHDAY_MESSAGE],
    )
    await superuserQuery(
      db,
      `insert into app.telegram_links(user_id,chat_id,locale_at_link) values($1,123456789,'en') on conflict(user_id) do nothing`,
      [head.id],
    )
    await superuserQuery(
      db,
      `insert into app.personnel_records(department_id,owner_user_id,data) values($1,$2,$3::jsonb)`,
      [
        departmentId,
        person.id,
        JSON.stringify({
          fio: 'Private full name',
          relatives: [
            {
              rel: 'Ўғли',
              status: 'work',
              name: 'Secret child identity',
              year: '2010',
              address: 'Secret address',
            },
            {
              rel: 'Отаси',
              status: 'retired',
              name: 'Secret parent identity',
              year: '1960',
              job: 'Private employer',
            },
          ],
        }),
      ],
    )
    await superuserQuery(
      db,
      `insert into app.ai_department_settings(department_id,budget_uzs_per_month,flags) values($1,1000000,'{"semantic_ask":true}') on conflict(department_id) do update set flags=excluded.flags`,
      [departmentId],
    )
    const provider = new MockProvider({
      respond: () => ({
        content: null,
        reasoningContent: null,
        finishReason: 'tool_calls',
        usage: { promptTokens: 70, completionTokens: 80, totalTokens: 150 },
        toolCalls: [
          {
            id: randomUUID(),
            name: 'department_chat_answer',
            argumentsJson: JSON.stringify({
              content: personalLetter,
              citations: [],
              actions: [],
            }),
          },
        ],
      }),
    })
    __setProviderForTests(provider)
    try {
      const ctx = {
        requestId: randomUUID(),
        userId: person.id,
        actorRole: 'member' as const,
        departmentId,
        departmentRole: 'member' as const,
        actingForUserId: null,
        viewAs: false,
        ip: '',
        userAgent: 'test',
      }
      const result = await ensureGreeting(ctx, person.id, tomorrow)
      expect(result).toBe(personalLetter)
      expect(provider.calls).toHaveLength(1)
      const supplied = provider.calls[0]!.messages.filter((message) => message.role === 'user')
      expect(supplied).toHaveLength(1)
      expect(JSON.parse(supplied[0]!.content ?? '{}')).toEqual({
        family: { children: true, livingParent: true, family: true },
        interests: {
          role: 'Chief specialist',
          skills: ['Software engineering'],
          hobbies: ['Reading', 'Hiking'],
          fields: ['Computer science'],
          currentRoles: ['Software engineer'],
        },
      })
      expect(JSON.stringify(provider.calls[0]!.messages)).not.toMatch(
        /Secret|Private|1960|2010|2000/,
      )
      const saved = await superuserQuery(
        db,
        'select source from app.birthday_greetings where owner_user_id=$1',
        [person.id],
      )
      expect(saved[0]!['source']).toBe('ai')
      const unauthorizedHead = { ...ctx, userId: head.id, departmentRole: 'head' as const }
      const headRows = await withContext(unauthorizedHead, (tx) =>
        tx.raw(sql`select message from app.birthday_greetings where owner_user_id=${person.id}`),
      )
      expect(headRows).toHaveLength(0)
      const unrelatedDept = await seedDepartment(db, {
        name: 'Birthday separate tenant',
        slug: `birthday-other-${randomUUID()}`,
      })
      const wrongTenantWorker = {
        ...ctx,
        userId: null,
        actorRole: 'super_admin' as const,
        departmentRole: 'head' as const,
        departmentId: unrelatedDept.id,
      }
      const privateRows = await withContext(wrongTenantWorker, async (tx) => ({
        dates: await tx.raw(
          sql`select birth_date from app.account_birthdays where owner_user_id=${person.id}`,
        ),
        greetings: await tx.raw(
          sql`select message from app.birthday_greetings where owner_user_id=${person.id}`,
        ),
      }))
      expect(privateRows).toEqual({ dates: [], greetings: [] })
      const traces = await superuserQuery(
        db,
        'select feature from app.ai_traces where user_id=$1',
        [person.id],
      )
      expect(traces[0]!['feature']).toBe('semantic_ask')
      const delivered: string[] = []
      await processBirthdays(
        async (_chat, text) => {
          delivered.push(text)
          return { ok: true, messageId: 100 }
        },
        () => true,
        new Date(`${today}T04:00:00Z`),
      )
      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toContain(personalLetter)
      const portal = await claimCelebration(ctx, randomUUID(), new Date(`${tomorrow}T04:00:00Z`))
      expect(portal?.message).toBe(personalLetter)
      expect(provider.calls).toHaveLength(1)
    } finally {
      __setProviderForTests(null)
    }
  })
  it('saves DOB only in the private account response and rejects invalid dates', async () => {
    const dateOfBirth = `2000-${today.slice(5)}`
    const saved = await request('/accounts/profile', 'PATCH', { dateOfBirth })
    expect(saved.status).toBe(200)
    expect(((await saved.json()) as { dateOfBirth: string }).dateOfBirth).toBe(dateOfBirth)
    expect(
      ((await (await request('/me')).json()) as { user: Record<string, unknown> }).user,
    ).not.toHaveProperty('dateOfBirth')
    expect(
      (await request('/accounts/profile', 'PATCH', { dateOfBirth: '2100-01-01' })).status,
    ).toBe(422)
    expect(
      (await request('/accounts/profile', 'PATCH', { dateOfBirth: '2025-02-29' })).status,
    ).toBe(422)
    const outsider = await withContext(
      {
        requestId: randomUUID(),
        userId: head.id,
        actorRole: 'member',
        departmentId,
        departmentRole: 'head',
        actingForUserId: null,
        viewAs: false,
        ip: '',
        userAgent: '',
      },
      (tx) =>
        tx.raw(sql`select birth_date from app.account_birthdays where owner_user_id=${owner.id}`),
    )
    expect(outsider).toHaveLength(0)
  })
  it('does not present a birthday withdrawn while the portal greeting is preparing', async () => {
    const person = await seedMember(db, departmentId, { role: 'member' })
    await superuserQuery(
      db,
      `insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2)`,
      [person.id, `2000-${today.slice(5)}`],
    )
    await superuserQuery(
      db,
      `insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source) values($1,$2,$3,$4,'fallback')`,
      [person.id, Number(today.slice(0, 4)), today, FALLBACK_BIRTHDAY_MESSAGE],
    )
    const result = await claimCelebration(
      {
        requestId: randomUUID(),
        userId: person.id,
        actorRole: 'member',
        departmentId,
        departmentRole: 'member',
        actingForUserId: null,
        viewAs: false,
        ip: '',
        userAgent: 'test',
      },
      randomUUID(),
      new Date(`${today}T04:00:00Z`),
      async () => {
        await superuserQuery(db, 'delete from app.account_birthdays where owner_user_id=$1', [
          person.id,
        ])
        return FALLBACK_BIRTHDAY_MESSAGE
      },
    )
    expect(result).toBeNull()
  })
  it('permits one tab claim, supports receipt retry, and never repeats after acknowledgement', async () => {
    await superuserQuery(
      db,
      `insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source) values($1,$2,$3,$4,'fallback')`,
      [owner.id, Number(today.slice(0, 4)), today, FALLBACK_BIRTHDAY_MESSAGE],
    )
    const claimToken = randomUUID()
    const opened = await request('/accounts/birthday/open', 'POST', { claimToken })
    expect(opened.status).toBe(200)
    expect(
      ((await opened.json()) as { celebration: { message: string } }).celebration.message,
    ).toBe(FALLBACK_BIRTHDAY_MESSAGE)
    const secondTab = await request('/accounts/birthday/open', 'POST', { claimToken: randomUUID() })
    expect(((await secondTab.json()) as { celebration: unknown }).celebration).toBeNull()
    expect(
      (
        (await (await request('/accounts/birthday/open', 'POST', { claimToken })).json()) as {
          celebration: unknown
        }
      ).celebration,
    ).not.toBeNull()
    expect(
      (await request('/accounts/birthday/seen', 'POST', { claimToken, date: today })).status,
    ).toBe(200)
    expect(
      (
        (await (await request('/accounts/birthday/open', 'POST', { claimToken })).json()) as {
          celebration: unknown
        }
      ).celebration,
    ).toBeNull()
  })
})

describe('day-before head reminder', () => {
  it('revalidates DOB immediately before sending after message preparation', async () => {
    const person = await seedMember(db, departmentId, { role: 'member' })
    await superuserQuery(
      db,
      `insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2)`,
      [person.id, `2000-${tomorrow.slice(5)}`],
    )
    await superuserQuery(
      db,
      `insert into app.telegram_links(user_id,chat_id,locale_at_link) values($1,123456789,'en') on conflict(user_id) do nothing`,
      [head.id],
    )
    let calls = 0
    const send = async () => {
      calls++
      return { ok: true as const, messageId: 99 }
    }
    await processBirthdays(
      send,
      () => true,
      new Date(`${today}T04:00:00Z`),
      async (_ctx, ownerId) => {
        await superuserQuery(db, 'delete from app.account_birthdays where owner_user_id=$1', [
          ownerId,
        ])
        return FALLBACK_BIRTHDAY_MESSAGE
      },
    )
    expect(calls).toBe(0)
    const rows = await superuserQuery(
      db,
      'select status from app.birthday_reminders where owner_user_id=$1',
      [person.id],
    )
    expect(rows[0]!['status']).toBe('failed')
  })
  it('waits until 09:00 Tashkent and sends once only to the current head', async () => {
    const person = await seedMember(db, departmentId, { role: 'member' })
    await superuserQuery(
      db,
      `insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2)`,
      [person.id, `2000-${tomorrow.slice(5)}`],
    )
    await superuserQuery(
      db,
      `insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source) values($1,$2,$3,$4,'fallback')`,
      [person.id, Number(tomorrow.slice(0, 4)), tomorrow, FALLBACK_BIRTHDAY_MESSAGE],
    )
    await superuserQuery(
      db,
      `insert into app.telegram_links(user_id,chat_id,locale_at_link) values($1,123456789,'en') on conflict(user_id) do nothing`,
      [head.id],
    )
    const sent: Array<{ chat: string; text: string }> = []
    const send = async (chat: string, text: string) => {
      sent.push({ chat, text })
      return { ok: true as const, messageId: 101 }
    }
    await processBirthdays(send, () => true, new Date(`${today}T03:59:00Z`))
    expect(sent).toHaveLength(0)
    await Promise.all([
      processBirthdays(send, () => true, new Date(`${today}T04:00:00Z`)),
      processBirthdays(send, () => true, new Date(`${today}T04:00:00Z`)),
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0]!.chat).toBe('123456789')
    expect(sent[0]!.text).toContain('Tomorrow is')
    expect(sent[0]!.text).not.toContain('2000')
    await processBirthdays(send, () => true, new Date(`${today}T04:01:00Z`))
    expect(sent).toHaveLength(1)
  })
  it('retries a known unsent rate-limit response, but never retries an uncertain delivery', async () => {
    const person = await seedMember(db, departmentId, { role: 'member' })
    await superuserQuery(
      db,
      `insert into app.account_birthdays(owner_user_id,birth_date) values($1,$2)`,
      [person.id, `2000-${tomorrow.slice(5)}`],
    )
    await superuserQuery(
      db,
      `insert into app.birthday_greetings(owner_user_id,birthday_year,celebration_date,message,source) values($1,$2,$3,$4,'fallback')`,
      [person.id, Number(tomorrow.slice(0, 4)), tomorrow, FALLBACK_BIRTHDAY_MESSAGE],
    )
    let calls = 0
    const send = async () => {
      calls++
      return calls === 1
        ? { ok: false as const, error: '429: Too Many Requests' }
        : { ok: false as const, error: 'ETIMEDOUT' }
    }
    await processBirthdays(send, () => true, new Date(`${today}T04:00:00Z`))
    expect(calls).toBe(1)
    await processBirthdays(send, () => true, new Date(`${today}T04:04:00Z`))
    expect(calls).toBe(1)
    await processBirthdays(send, () => true, new Date(`${today}T04:05:00Z`))
    expect(calls).toBe(2)
    await processBirthdays(send, () => true, new Date(`${today}T05:00:00Z`))
    expect(calls).toBe(2)
    const rows = await superuserQuery(
      db,
      'select status from app.birthday_reminders where owner_user_id=$1',
      [person.id],
    )
    expect(rows[0]!['status']).toBe('uncertain')
  })
})
