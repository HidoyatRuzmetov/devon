// H25.1 "state-transition tests": actions that must be refused once an entity has moved past the
// state that allows them -- RSVPing on a cancelled event, voting on a closed poll, mutating anything
// in a paused department. Against a real Postgres + real app (see `harness.ts`).
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loginAs,
  seedBareUser,
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

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

async function createEvent(session: Session, overrides: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/api/v1/events`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify({
      title: 'state transition probe',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

describe('events: a cancelled event refuses new RSVPs', () => {
  it('RSVP after cancel is a 409, not a silent 200', async () => {
    const dept = await seedDepartment(db, {
      name: 'Cancel dept',
      slug: `cancel-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const session = await loginAs(baseUrl, head.login)
    const event = await createEvent(session)

    const cancel = await fetch(`${baseUrl}/api/v1/events/${event.id}/cancel`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ reason: 'no longer happening' }),
    })
    expect(cancel.status).toBe(200)

    const rsvp = await fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ status: 'yes', guests: 0 }),
    })
    expect(rsvp.status).toBe(409)
  })

  it('cancelling an already-cancelled event again is also a conflict, not a duplicate 200', async () => {
    const dept = await seedDepartment(db, {
      name: 'Double cancel dept',
      slug: `dcancel-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const session = await loginAs(baseUrl, head.login)
    const event = await createEvent(session)
    const first = await fetch(`${baseUrl}/api/v1/events/${event.id}/cancel`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ reason: 'first cancel' }),
    })
    expect(first.status).toBe(200)
    const second = await fetch(`${baseUrl}/api/v1/events/${event.id}/cancel`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ reason: 'second cancel' }),
    })
    expect(second.status).toBe(409)
  })
})

describe('events: RSVP deadline is enforced as a hard state boundary', () => {
  it('a "yes" after the RSVP deadline is refused; a "no" still goes through', async () => {
    const dept = await seedDepartment(db, {
      name: 'Deadline dept',
      slug: `deadline-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const session = await loginAs(baseUrl, head.login)
    const event = await createEvent(session, {
      rsvpDeadline: new Date(Date.now() - 60_000).toISOString(), // already passed
    })

    const yesRes = await fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ status: 'yes', guests: 0 }),
    })
    expect(yesRes.status).toBe(409)

    const noRes = await fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ status: 'no', guests: 0 }),
    })
    expect(noRes.status).toBe(200)
  })
})

describe('polls: a closed poll refuses new votes', () => {
  it('voting after closesAt has passed is a 409', async () => {
    const dept = await seedDepartment(db, {
      name: 'Poll close dept',
      slug: `pollclose-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const session = await loginAs(baseUrl, head.login)
    const event = await createEvent(session)
    const pollRes = await fetch(`${baseUrl}/api/v1/events/${event.id}/polls`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({
        kind: 'single',
        question: 'already closed?',
        closesAt: new Date(Date.now() - 60_000).toISOString(),
        options: [{ label: 'a' }, { label: 'b' }],
      }),
    })
    expect(pollRes.status).toBe(201)
    const poll = (await pollRes.json()) as {
      id: string
      options: { id: string }[]
    }
    const vote = await fetch(`${baseUrl}/api/v1/events/${event.id}/polls/${poll.id}/vote`, {
      method: 'POST',
      headers: session.headers,
      body: JSON.stringify({ optionIds: [poll.options[0]!.id] }),
    })
    expect(vote.status).toBe(409)
  })
})

describe('admin pause: a paused department blocks writes but not reads (H30.1 "admin pause" flow)', () => {
  it('after pause, the board is still readable but a card mutation is refused; resume restores it', async () => {
    const dept = await seedDepartment(db, {
      name: 'Pausable dept',
      slug: `pause-${randomUUID()}`,
    })
    const head = await seedMember(db, dept.id, { role: 'head' })
    const superAdminUser = await seedBareUser(db, {
      instanceRole: 'super_admin',
    })
    const headSession = await loginAs(baseUrl, head.login)
    const superSession = await loginAs(baseUrl, superAdminUser.login)

    const createRes = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: headSession.headers,
      body: JSON.stringify({ title: 'before pause' }),
    })
    const card = (await createRes.json()) as { id: string; version: number }

    const pauseRes = await fetch(`${baseUrl}/api/v1/admin/departments/${dept.id}/pause`, {
      method: 'POST',
      headers: superSession.headers,
      body: JSON.stringify({ reason: 'hardening test' }),
    })
    expect(pauseRes.status).toBe(204)

    const readWhilePaused = await fetch(`${baseUrl}/api/v1/board`, {
      headers: { cookie: headSession.cookie },
    })
    expect(readWhilePaused.status).toBe(200)

    const writeWhilePaused = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'PATCH',
      headers: headSession.headers,
      body: JSON.stringify({
        title: 'edited while paused',
        version: card.version,
      }),
    })
    expect(writeWhilePaused.status).toBe(403)

    const resumeRes = await fetch(`${baseUrl}/api/v1/admin/departments/${dept.id}/resume`, {
      method: 'POST',
      headers: superSession.headers,
      body: '{}',
    })
    expect(resumeRes.status).toBe(204)

    const writeAfterResume = await fetch(`${baseUrl}/api/v1/cards/${card.id}`, {
      method: 'PATCH',
      headers: headSession.headers,
      body: JSON.stringify({
        title: 'edited after resume',
        version: card.version,
      }),
    })
    expect(writeAfterResume.status).toBe(200)
  })
})
