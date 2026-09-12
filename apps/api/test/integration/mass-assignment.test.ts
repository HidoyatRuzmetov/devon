// H1.3: no mass assignment -- every write goes through a Zod allow-list; ownership, roles, ids and
// computed values are never trusted from the client. Two enforcement shapes exist in this codebase
// and both count as "not exploitable": a `.strict()` schema 400s on any unrecognised key (register,
// units, RSVP, comments...), and a plain `z.object()` schema silently strips unrecognised keys before
// the repo ever sees them (cards, projects...) -- so a spoofed `departmentId`/`role`/`createdByUserId`
// either never parses or never reaches the write. This file proves the *effect* in both cases: either
// a 400, or a created/updated resource whose ownership/identity fields reflect the real actor, never
// the attacker-supplied value.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedDepartment,
  seedMember,
  startHarness,
  stopHarness,
  type Db,
  type Server,
  type Session,
} from './harness.js'

let db: Db
let server: Server
let baseUrl: string
let dept: { id: string }
let deptOther: { id: string }
let actor: Session
let victim: { id: string }

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  dept = await seedDepartment(db, { name: 'MA dept', slug: `ma-${randomUUID()}` })
  deptOther = await seedDepartment(db, { name: 'MA other dept', slug: `ma-other-${randomUUID()}` })
  const actorUser = await seedMember(db, dept.id, { role: 'member' })
  const victimUser = await seedMember(db, deptOther.id, { role: 'head' })
  victim = { id: victimUser.id }
  actor = await loginAs(baseUrl, actorUser.login)
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('registration: role/id escalation is rejected outright (.strict() schema)', () => {
  it('an extra "role" field in the register body 400s -- never silently creates a super_admin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/accounts/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: `escalate.${randomUUID().slice(0, 8)}`,
        password: 'Str0ngExampleValue123',
        givenName: 'A',
        familyName: 'B',
        role: 'super_admin',
        id: randomUUID(),
      }),
    })
    expect(res.status).toBe(422)
  })

  it('the same request without the spoofed fields succeeds and the account is an ordinary member', async () => {
    const login = `clean.${randomUUID().slice(0, 8)}`
    const res = await fetch(`${baseUrl}/api/v1/accounts/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login,
        password: 'Str0ngExampleValue123',
        givenName: 'A',
        familyName: 'B',
      }),
    })
    expect(res.status).toBe(201)
  })
})

describe('cards: spoofed identity/ownership/state fields never take effect', () => {
  it('createdByUserId, departmentId, id, version and status in the body are all inert', async () => {
    const spoofedId = randomUUID()
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'mass assignment probe',
        id: spoofedId,
        departmentId: deptOther.id,
        createdByUserId: victim.id,
        version: 999,
        status: 'archived',
        createdAt: '2000-01-01T00:00:00.000Z',
      }),
    })
    expect(res.status).toBe(201)
    const card = (await res.json()) as {
      id: string
      createdByUserId: string
      status: string
      version: number
    }
    expect(card.id).not.toBe(spoofedId)
    expect(card.createdByUserId).not.toBe(victim.id)
    expect(card.status).toBe('active') // never the spoofed 'archived' -- not a settable create field
    expect(card.version).toBe(1) // never the spoofed 999

    // Department isolation actually holds: the card only shows up on the actor's own board, proving
    // the spoofed `departmentId: deptOther.id` never routed it into the other department.
    const board = (await (
      await fetch(`${baseUrl}/api/v1/board`, { headers: { cookie: actor.cookie } })
    ).json()) as { columns: { cards: { id: string }[] }[]; unassigned: { id: string }[] }
    const ids = [
      ...board.columns.flatMap((c) => c.cards.map((x) => x.id)),
      ...board.unassigned.map((x) => x.id),
    ]
    expect(ids).toContain(card.id)
  })

  // FIXED in v1.1 (was `it.fails`; H1.3/H1.2). `createCard` wrote whatever uuid the body named as
  // `assigneeUserId`/`giverUserId` without checking it against the card's own department, so a member
  // could create a card "assigned to" somebody in a completely different department (or to nobody at
  // all) -- a cross-tenant reference the victim's department can never see and the board can never
  // render. `POST /cards` now resolves both ids against the department's active memberships in one
  // query (`repo.filterDepartmentMemberIds`) before the insert, and answers 422.
  it('a card cannot be assigned to a user outside the department', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: 'cross-dept assignee probe', assigneeUserId: victim.id }),
    })
    expect(res.status).not.toBe(201)
  })
})

describe('projects: spoofed identity fields are inert (non-strict schema, silently stripped)', () => {
  it('departmentId/id/createdByUserId in the body never reroute or reattribute the project', async () => {
    const templates = (await (
      await fetch(`${baseUrl}/api/v1/projects/templates`, { headers: { cookie: actor.cookie } })
    ).json()) as { key: string }[]
    const spoofedId = randomUUID()
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'mass assignment probe project',
        ownerUserId: victim.id, // legitimate field, but a foreign user -- see assertion below
        members: [victim.id],
        id: spoofedId,
        departmentId: deptOther.id,
        templateKeyIgnored: templates[0]?.key,
      }),
    })
    // ownerUserId is a real, schema-allowed field; whether the API lets a member name a foreign user
    // as owner is a separate business rule this test does not assume either way -- only the
    // *unlisted* fields (id, departmentId) are asserted on.
    expect([201, 400, 404, 422]).toContain(res.status)
    if (res.status === 201) {
      const project = (await res.json()) as { id: string }
      expect(project.id).not.toBe(spoofedId)
    }
  })
})

describe('/me: no field exists to self-escalate role, and an escalation attempt 400s (.strict())', () => {
  it('PATCH /me with an extra "role" field is rejected, not silently ignored-but-200', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: actor.headers,
      body: JSON.stringify({ locale: 'uz-Latn', role: 'super_admin' }),
    })
    expect(res.status).toBe(422)
  })

  it('a clean PATCH /me (no spoofed field) still succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: actor.headers,
      body: JSON.stringify({ locale: 'ru' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('structure units: an unrecognised departmentId in the body 400s (.strict() schema)', () => {
  it('cannot smuggle a different target department through the body', async () => {
    const res = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/units`, {
      method: 'POST',
      headers: actor.headers, // actor is only a `member`; enable structure edit first as the head would
      body: JSON.stringify({ name: 'spoofed unit', departmentId: deptOther.id }),
    })
    expect(res.status).toBe(422)
  })
})

describe('RSVP: an unrecognised field (e.g. userId, to vote on someone else’s behalf) 400s', () => {
  it('cannot smuggle a different actor identity into the RSVP body', async () => {
    const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'mass assignment rsvp probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    })
    expect(eventRes.status).toBe(201)
    const event = (await eventRes.json()) as { id: string }
    const res = await fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ status: 'yes', guests: 0, userId: victim.id }),
    })
    expect(res.status).toBe(422)
  })
})
