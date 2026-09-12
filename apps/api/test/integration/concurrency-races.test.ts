// H10.1: unique constraints + idempotency keys + row versions; RSVP/seat/poll races tested with
// parallel requests. Against a REAL Postgres (Testcontainers) with real transactions -- a race is a
// property of actual concurrent connections contending on actual locks/constraints, which the
// in-memory fake `Deps` (test/unit/**) cannot exercise honestly (there is no interleaving to get
// wrong when everything runs on one JS event loop against a plain object).
//
// Every case below is now a plain `it` asserting the invariant holds under true concurrency:
//  - Positive controls: the setup-token consumption and the department-membership unique index ARE
//    race-safe (atomic `UPDATE ... WHERE ... IS NULL` / a real unique index respectively) -- exactly
//    one winner under true concurrency, every time.
//  - Four cases were written as `it.fails` while they documented live check-then-act bugs. Poll
//    voting was fixed first (unique constraints + a same-voter advisory lock, H10.1, api-data
//    hardening). v1.1 fixed the remaining three: RSVP capacity and carpool seats are aggregate
//    invariants no single-row constraint can express, so each capacity decision now takes a
//    `pg_advisory_xact_lock` scoped to that one event/carpool (`events/repo.ts`'s
//    `lockEventForCapacity` / `lockCarpoolForSeats`); the card `version` check moved into the
//    statement itself (`update app.cards ... where id = $1 and version = $2`, `work/repo.ts`).
//    Each `it.fails` was flipped back to a plain `it` the moment its product fix landed -- which is
//    the whole point of having written the bug as an executable statement (Vitest reports an
//    `it.fails` whose body did NOT throw as a failure, so a fix cannot land unnoticed).
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

// v1.1: fixed by `events/service.ts`'s `lockEventForCapacity` (an advisory transaction lock on the
// event id, so the count/decide/write sequence is indivisible per event). Flipped from `it.fails` to
// a plain `it` the moment the product fix landed, exactly as this file's header prescribes.
describe('H10.1: RSVP capacity is enforced atomically', () => {
  it(
    'capacity=1, two different users RSVP "yes" concurrently: exactly one ends up "yes" and the other "waitlist"',
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

// v1.1: fixed by `events/service.ts`'s `lockCarpoolForSeats`, the carpool twin of the RSVP lock
// above (claim *and* release take it, so a release racing a claim cannot over-promote either).
describe('H10.1: carpool seat claiming is enforced atomically', () => {
  it(
    'seats=1, two different users each claim 1 seat concurrently: exactly one is "confirmed"',
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

// H10.1 (fixed by the api-data hardening package, merged 2026-09-12): `poll_votes` now carries a
// unique constraint on (poll_id, option_id, user_id) / (poll_id, option_id, voter_hash) and a
// same-voter advisory lock serialises a replace, so the double submit below collapses to one row.
// Was `it.fails` while this file documented the bug; flipped to a normal assertion the moment the
// product fix landed, which is the whole point of having written it as an executable statement.
describe('H10.1: a double-submitted identical poll vote is deduplicated', () => {
  it('the same user voting for the same option twice, concurrently, ends with exactly one recorded vote', async () => {
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
  })
})

// v1.1: fixed by moving the guard into the statement -- `update app.cards set ... where id = $1 and
// version = $2` (`work/repo.ts`'s `patchCard`), so "check" and "act" are one row-locked step and the
// loser matches zero rows and gets its 409 instead of silently overwriting the winner.
describe('H10.1: the card `version` optimistic-concurrency check is atomic', () => {
  it(
    'two concurrent PATCHes sent with the identical (stale) version: only one succeeds with 200, the other 409',
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
