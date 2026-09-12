// H10.1: unique constraints + idempotency keys + row versions; RSVP/seat/poll races tested with
// parallel requests. Against a REAL Postgres (Testcontainers) with real transactions -- a race is a
// property of actual concurrent connections contending on actual locks/constraints, which the
// in-memory fake `Deps` (test/unit/**) cannot exercise honestly (there is no interleaving to get
// wrong when everything runs on one JS event loop against a plain object).
//
// Two outcomes are asserted here, both real:
//  - Positive controls: the setup-token consumption and the department-membership unique index ARE
//    race-safe (atomic `UPDATE ... WHERE ... IS NULL` / a real unique index respectively) -- exactly
//    one winner under true concurrency, every time.
//  - Confirmed bugs (`it.fails`, so the suite stays green while this stands as a live regression
//    probe -- see `tests.md`'s "requires external configuration" / "found bugs" section for detail
//    and the exact `repo.ts` lines): RSVP capacity, carpool seats and the card `version` optimistic-
//    concurrency check are all "read count/version, decide, then write" with NO row lock and no
//    constraint enforcing the invariant at the database level, so two simultaneous requests can both
//    read the pre-write state and both "win". Poll voting's delete-then-insert has the same shape for
//    a double-submit of the identical vote. The moment one of these is fixed, its `it.fails` will
//    itself start failing (Vitest reports an `it.fails` whose body did NOT throw as a failure) --
//    that is the intended signal to flip it back to a plain `it`.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedBareUser,
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
let baseUrl: string

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('positive control: setup-token consumption is race-safe', () => {
  it('two concurrent completions of the same setup token: exactly one wins', async () => {
    const issued = await server.deps.ensureSetupToken()
    // A fresh instance only issues a setup token once (`ensureSetupToken` returns null once any user
    // exists) -- this suite's `beforeAll` has not created any user yet at this point in the file, so
    // this is the one legitimate use of it.
    expect(issued).not.toBeNull()
    const attempt = (login: string) =>
      fetch(`${baseUrl}/api/v1/setup/${issued!.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          login,
          password: 'Str0ngExampleValue123',
          givenName: 'A',
          familyName: 'B',
          locale: 'uz-Latn',
        }),
      })
    const [a, b] = await Promise.all([
      attempt(`setup.race.a.${randomUUID().slice(0, 8)}`),
      attempt(`setup.race.b.${randomUUID().slice(0, 8)}`),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 410].sort() as number[])
  })
})

describe('positive control: department membership has a real unique index', () => {
  it('two concurrent identical joins from the same user leave exactly one membership row', async () => {
    const dept = await seedDepartment(db, {
      name: 'Join race dept',
      slug: `join-race-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const headSession = await loginAs(baseUrl, head.login)
    await fetch(`${baseUrl}/api/v1/departments/${dept.id}/settings`, {
      method: 'PATCH',
      headers: headSession.headers,
      body: JSON.stringify({ joinRequiresApproval: false }),
    })
    const keyRes = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/invite/rotate-key`, {
      method: 'POST',
      headers: headSession.headers,
      body: '{}',
    })
    const { joinKey } = (await keyRes.json()) as { joinKey: string }
    const pwRes = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/invite/rotate-password`, {
      method: 'POST',
      headers: headSession.headers,
      body: '{}',
    })
    const { password: joinPassword } = (await pwRes.json()) as { password: string }

    const joiner = await seedBareUser(db)
    const joinerSession = await loginAs(baseUrl, joiner.login)
    const attempt = () =>
      fetch(`${baseUrl}/api/v1/departments/join`, {
        method: 'POST',
        headers: joinerSession.headers,
        body: JSON.stringify({ key: joinKey, password: joinPassword }),
      })
    await Promise.all([attempt(), attempt()])

    const rows = await superuserQuery(
      db,
      `select count(*)::int as n from app.memberships where department_id = $1 and user_id = $2`,
      [dept.id, joiner.id],
    )
    expect((rows[0] as { n: number }).n).toBe(1)
  })
})

describe('BUG (H10.1): RSVP capacity is a check-then-act race, not enforced atomically', () => {
  it.fails(
    'capacity=1, two different users RSVP "yes" concurrently: exactly one should end up "yes" and the other "waitlist"',
    async () => {
      const dept = await seedDepartment(db, {
        name: 'RSVP race dept',
        slug: `rsvp-race-${randomUUID()}`,
      })
      const head = await seedMember(db, dept.id, { role: 'head' })
      const memberA = await seedMember(db, dept.id, { role: 'member' })
      const memberB = await seedMember(db, dept.id, { role: 'member' })
      const headSession = await loginAs(baseUrl, head.login)
      const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: headSession.headers,
        body: JSON.stringify({
          title: 'capacity race',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
          capacity: 1,
          waitlistEnabled: true,
        }),
      })
      const event = (await eventRes.json()) as { id: string }
      const [sessionA, sessionB] = await Promise.all([
        loginAs(baseUrl, memberA.login),
        loginAs(baseUrl, memberB.login),
      ])
      const rsvp = (s: Session) =>
        fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
          method: 'POST',
          headers: s.headers,
          body: JSON.stringify({ status: 'yes', guests: 0 }),
        })
      const [resA, resB] = await Promise.all([rsvp(sessionA), rsvp(sessionB)])
      const [bodyA, bodyB] = (await Promise.all([resA.json(), resB.json()])) as {
        myRsvp?: { status: string } | null
      }[]
      const statuses = [bodyA!.myRsvp?.status, bodyB!.myRsvp?.status].sort()
      // The intended invariant: capacity 1 can seat exactly one "yes"; the other must be "waitlist".
      expect(statuses).toEqual(['waitlist', 'yes'])
    },
  )
})

describe('BUG (H10.1): carpool seat claiming has the identical check-then-act race', () => {
  it.fails(
    'seats=1, two different users each claim 1 seat concurrently: exactly one should be "confirmed"',
    async () => {
      const dept = await seedDepartment(db, {
        name: 'Carpool race dept',
        slug: `carpool-race-${randomUUID()}`,
      })
      const head = await seedMember(db, dept.id, { role: 'head' })
      const memberA = await seedMember(db, dept.id, { role: 'member' })
      const memberB = await seedMember(db, dept.id, { role: 'member' })
      const headSession = await loginAs(baseUrl, head.login)
      const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: headSession.headers,
        body: JSON.stringify({
          title: 'carpool race',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        }),
      })
      const event = (await eventRes.json()) as { id: string }
      const carpoolRes = await fetch(`${baseUrl}/api/v1/events/${event.id}/carpools`, {
        method: 'POST',
        headers: headSession.headers,
        body: JSON.stringify({ seats: 1 }),
      })
      const carpool = (await carpoolRes.json()) as { id: string }
      const [sessionA, sessionB] = await Promise.all([
        loginAs(baseUrl, memberA.login),
        loginAs(baseUrl, memberB.login),
      ])
      const claim = (s: Session) =>
        fetch(`${baseUrl}/api/v1/events/${event.id}/carpools/${carpool.id}/claim`, {
          method: 'POST',
          headers: s.headers,
          body: JSON.stringify({ seats: 1 }),
        })
      await Promise.all([claim(sessionA), claim(sessionB)])

      const rows = await superuserQuery<{ status: string }>(
        db,
        `select status from app.carpool_seats where carpool_id = $1`,
        [carpool.id],
      )
      const statuses = rows.map((r) => r.status).sort()
      expect(statuses).toEqual(['confirmed', 'waitlist'])
    },
  )
})

describe('BUG (H10.1): a double-submitted identical poll vote is not deduplicated', () => {
  it.fails(
    'the same user voting for the same option twice, concurrently, ends with exactly one recorded vote',
    async () => {
      const dept = await seedDepartment(db, {
        name: 'Poll race dept',
        slug: `poll-race-${randomUUID()}`,
      })
      const head = await seedMember(db, dept.id, { role: 'head' })
      const headSession = await loginAs(baseUrl, head.login)
      const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: headSession.headers,
        body: JSON.stringify({
          title: 'poll race',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        }),
      })
      const event = (await eventRes.json()) as { id: string }
      const pollRes = await fetch(`${baseUrl}/api/v1/events/${event.id}/polls`, {
        method: 'POST',
        headers: headSession.headers,
        body: JSON.stringify({
          kind: 'single',
          question: 'double submit?',
          options: [{ label: 'a' }, { label: 'b' }],
        }),
      })
      const poll = (await pollRes.json()) as { id: string; options: { id: string }[] }
      const optionId = poll.options[0]!.id
      const vote = () =>
        fetch(`${baseUrl}/api/v1/events/${event.id}/polls/${poll.id}/vote`, {
          method: 'POST',
          headers: headSession.headers,
          body: JSON.stringify({ optionIds: [optionId] }),
        })
      await Promise.all([vote(), vote()])

      const rows = await superuserQuery(
        db,
        `select count(*)::int as n from app.poll_votes where poll_id = $1`,
        [poll.id],
      )
      expect((rows[0] as { n: number }).n).toBe(1)
    },
  )
})

describe('BUG (H10.1): the card `version` optimistic-concurrency check is check-then-act, not atomic', () => {
  it.fails(
    'two concurrent PATCHes sent with the identical (stale) version: only one should succeed with 200, the other 409',
    async () => {
      const dept = await seedDepartment(db, {
        name: 'Card race dept',
        slug: `card-race-${randomUUID()}`,
      })
      const head = await seedMember(db, dept.id, { role: 'head' })
      const session = await loginAs(baseUrl, head.login)
      const createRes = await fetch(`${baseUrl}/api/v1/cards`, {
        method: 'POST',
        headers: session.headers,
        body: JSON.stringify({ title: 'lost update probe' }),
      })
      const card = (await createRes.json()) as { id: string; version: number }
      const patch = (title: string) =>
        fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
          method: 'PATCH',
          headers: session.headers,
          body: JSON.stringify({ title, version: card.version }),
        })
      const [resA, resB] = await Promise.all([patch('write A'), patch('write B')])
      const statuses = [resA.status, resB.status].sort()
      expect(statuses).toEqual([200, 409])
    },
  )
})
