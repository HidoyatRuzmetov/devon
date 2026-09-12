// H1.6: server-side validation of type, size, format, range, enum, id, URL (SSRF-safe). Filename/MIME
// validation for uploads is already exhaustively covered by
// `apps/api/test/unit/accounts/avatar.test.ts` (magic-byte sniffing, size-vs-declaration mismatch,
// MIME allow-list, ClamAV fail-closed) -- not duplicated here; see `tests.md`'s coverage map.
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
let actor: Session

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  const dept = await seedDepartment(db, { name: 'Validation dept', slug: `val-${randomUUID()}` })
  const user = await seedMember(db, dept.id, { role: 'head' })
  actor = await loginAs(baseUrl, user.login)
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('type', () => {
  it('a numeric title where a string is required 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: 12345 }),
    })
    expect(res.status).toBe(422)
  })

  it('a string where a boolean is required (waitlistEnabled) 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'type probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        waitlistEnabled: 'yes',
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('size', () => {
  it('a card title over the 300-char ceiling 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: 'x'.repeat(301) }),
    })
    expect(res.status).toBe(422)
  })

  it('an empty title (below the 1-char floor) 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(422)
  })

  it('a poll question over its 300-char ceiling 400s', async () => {
    const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'poll size probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    })
    const event = (await eventRes.json()) as { id: string }
    const res = await fetch(`${baseUrl}/api/v1/events/${event.id}/polls`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        kind: 'single',
        question: 'q'.repeat(301),
        options: [{ label: 'a' }, { label: 'b' }],
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('range', () => {
  it('event capacity of 0 (min 1) 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'range probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        capacity: 0,
      }),
    })
    expect(res.status).toBe(422)
  })

  it('a negative RSVP guest count 400s', async () => {
    const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'guests range probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    })
    const event = (await eventRes.json()) as { id: string }
    const res = await fetch(`${baseUrl}/api/v1/events/${event.id}/rsvp`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ status: 'yes', guests: -1 }),
    })
    expect(res.status).toBe(422)
  })

  it('endsAt before startsAt on event create 400s (cross-field range, not just per-field)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'reversed range probe',
        startsAt: new Date(Date.now() + 90_000_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('enum', () => {
  it('an out-of-enum card priority 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: 'enum probe', priority: 'catastrophic' }),
    })
    expect(res.status).toBe(422)
  })

  it('an out-of-enum event category 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'enum probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        category: 'not-a-real-category',
      }),
    })
    expect(res.status).toBe(422)
  })

  it('an out-of-enum poll kind 400s', async () => {
    const eventRes = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        title: 'poll enum probe',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
      }),
    })
    const event = (await eventRes.json()) as { id: string }
    const res = await fetch(`${baseUrl}/api/v1/events/${event.id}/polls`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({
        kind: 'ranked_choice',
        question: 'q',
        options: [{ label: 'a' }, { label: 'b' }],
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('id (uuid) shape', () => {
  it('a non-uuid card id 400s (schema-level), not 404/500', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/not-a-uuid`, {
      headers: { cookie: actor.cookie },
    })
    expect(res.status).toBe(422)
  })

  it('a non-uuid label id inside an array field 400s', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ title: 'label id probe', labels: ['not-a-uuid'] }),
    })
    expect(res.status).toBe(422)
  })
})

describe('url / SSRF (link unfurl, H1.6 + H1.7 "SSRF-safe: no private ranges")', () => {
  const unsafeUrls = [
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
    'http://localhost/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://user:pass@example.com/', // embedded credentials
    'ftp://example.com/file', // non-http(s) scheme
  ]

  it.each(unsafeUrls)('rejects %s as a card link unfurl target', async (url) => {
    const res = await fetch(`${baseUrl}/api/v1/links/unfurl`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ url }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { errors?: { path: string; code: string }[] }
    expect(body.errors?.[0]?.code).toBe('unsafe_url')
  })

  it('a malformed URL string (not even a URL) 400s at the schema layer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/links/unfurl`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ url: 'definitely not a url' }),
    })
    expect(res.status).toBe(422)
  })
})
