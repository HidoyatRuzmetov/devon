// v1.1 critique SEV1 #1 -- the regression proof for the fields leak, and the cross-role integration
// test SPEC §2.1 asks for by name ("member → 403 on every head-only route; list endpoints omit
// head-only fields").
//
// What went wrong is worth stating plainly, because the test is shaped around it. `GET
// /api/v1/fields/values` was declared `{kind:'department_child'}`, whose P3 rule grants any active
// member every action, and `service.listValues` used its `isHead` argument for exactly one thing:
// deciding whether to write `audit.private_reads` rows. There was no filter to the caller's own
// subject anywhere, the requested `subjectIds` were only ever *added* to rather than honoured as a
// narrowing, and the definition's `visible_to: 'head_only'` flag was never consulted at all. Signed
// in as a xodim, asking for one colleague's membership id returned the whole department's answers --
// and because the head's lawful reads were the only audited ones, the unlawful read left no trace.
//
// Every assertion below is against the real migrated Postgres and the real Fastify app, so it
// exercises the whole chain (route declaration → `can()` → service filter → repo SQL → RLS) rather
// than any one layer that could be "fixed" while the others stay open.
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
let head: Session
let member: Session
let other: Session
let memberUserId: string
let otherUserId: string
let headUserId: string

/** `key` -> definition id, for the four definitions this file creates. */
const defs = new Map<string, string>()

type ValueRow = {
  defId: string
  key: string
  subjectId: string
  subjectUserId: string | null
  value: unknown
}

const get = (path: string, session: Session) =>
  fetch(`${baseUrl}${path}`, { headers: { cookie: session.cookie } })

async function createDef(
  session: Session,
  body: Record<string, unknown>,
): Promise<{ status: number; id: string | null }> {
  const res = await fetch(`${baseUrl}/api/v1/fields/defs`, {
    method: 'POST',
    headers: session.headers,
    body: JSON.stringify(body),
  })
  if (res.status !== 201 && res.status !== 200) return { status: res.status, id: null }
  const json = (await res.json()) as { def: { id: string } }
  return { status: res.status, id: json.def.id }
}

async function setValue(
  session: Session,
  body: Record<string, unknown>,
): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1/fields/values`, {
    method: 'PUT',
    headers: session.headers,
    body: JSON.stringify(body),
  })
  return res.status
}

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  dept = await seedDepartment(db, { name: 'Fields matrix', slug: `fm-${randomUUID()}` })
  const headUser = await seedMember(db, dept.id, { role: 'head' })
  const memberUser = await seedMember(db, dept.id, { role: 'member' })
  const otherUser = await seedMember(db, dept.id, { role: 'member' })
  headUserId = headUser.id
  memberUserId = memberUser.id
  otherUserId = otherUser.id
  head = await loginAs(baseUrl, headUser.login)
  member = await loginAs(baseUrl, memberUser.login)
  other = await loginAs(baseUrl, otherUser.login)

  // Two person fields the whole department may see, one the head keeps to themselves, one card field.
  for (const spec of [
    { key: 'talim', visibleTo: 'everyone', selfEditable: true },
    { key: 'tillar', visibleTo: 'everyone', selfEditable: true },
    { key: 'baholash', visibleTo: 'head_only', selfEditable: false },
  ] as const) {
    const created = await createDef(head, {
      appliesTo: 'person',
      key: spec.key,
      label: { 'uz-Latn': spec.key, 'uz-Cyrl': spec.key, ru: spec.key, en: spec.key },
      type: 'text',
      options: [],
      required: false,
      defaultValue: null,
      showInTable: true,
      showOnCardTile: false,
      selfEditable: spec.selfEditable,
      visibleTo: spec.visibleTo,
      reminderDays: 3,
    })
    expect(created.id).not.toBeNull()
    defs.set(spec.key, created.id!)
  }

  // Everyone answers, so "nothing came back" can never be confused with "there was nothing there".
  expect(await setValue(member, { defId: defs.get('talim'), value: 'magistr' })).toBe(204)
  expect(await setValue(member, { defId: defs.get('tillar'), value: 'ruscha' })).toBe(204)
  expect(await setValue(other, { defId: defs.get('talim'), value: 'bakalavr' })).toBe(204)
  expect(await setValue(head, { defId: defs.get('talim'), value: 'doktorantura' })).toBe(204)
  expect(
    await setValue(head, {
      defId: defs.get('baholash'),
      subjectUserId: memberUserId,
      value: 'yaxshi',
    }),
  ).toBe(204)
}, 240_000)

afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

describe('SEV1 #1 -- a xodim can never read a colleague’s answers', () => {
  it('the whole-department read (no ids at all) is refused for a member', async () => {
    const res = await get('/api/v1/fields/values?subjectType=person', member)
    expect(res.status).toBe(403)
  })

  it('naming a colleague by user id is refused for a member', async () => {
    const res = await get(
      `/api/v1/fields/values?subjectType=person&userIds=${otherUserId}`,
      member,
    )
    expect(res.status).toBe(403)
  })

  it('naming the head by user id is refused for a member', async () => {
    const res = await get(`/api/v1/fields/values?subjectType=person&userIds=${headUserId}`, member)
    expect(res.status).toBe(403)
  })

  it('smuggling a colleague in alongside themselves is refused', async () => {
    const res = await get(
      `/api/v1/fields/values?subjectType=person&userIds=${memberUserId},${otherUserId}`,
      member,
    )
    expect(res.status).toBe(403)
  })

  it('a raw membership id -- the exact shape of the original report -- is refused', async () => {
    // The reporter passed `subjectId=<Anvar's membership id>` and got 11 rows for 6 people back.
    // A member cannot resolve a membership id to a person, so any `subjectIds` query is head work.
    const res = await get(
      `/api/v1/fields/values?subjectType=person&subjectIds=${randomUUID()}`,
      member,
    )
    expect(res.status).toBe(403)
  })

  it('a member may read their OWN answers, and gets only their own rows', async () => {
    const res = await get(`/api/v1/fields/values?subjectType=person&userIds=${memberUserId}`, member)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { values: ValueRow[] }
    expect(body.values.length).toBeGreaterThan(0)
    for (const row of body.values) expect(row.subjectUserId).toBe(memberUserId)
  })

  it('a head_only definition’s answers never reach the person they are about', async () => {
    const res = await get(`/api/v1/fields/values?subjectType=person&userIds=${memberUserId}`, member)
    const body = (await res.json()) as { values: ValueRow[] }
    expect(body.values.some((v) => v.key === 'baholash')).toBe(false)
    // ...and the head does see it, so the assertion above is about permission, not about an
    // answer that was never stored.
    const asHead = await get(
      `/api/v1/fields/values?subjectType=person&userIds=${memberUserId}`,
      head,
    )
    const headBody = (await asHead.json()) as { values: ValueRow[] }
    expect(headBody.values.some((v) => v.key === 'baholash')).toBe(true)
  })

  it('the head sees the whole department, which is what the table is for', async () => {
    const res = await get('/api/v1/fields/values?subjectType=person', head)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { values: ValueRow[] }
    const people = new Set(body.values.map((v) => v.subjectUserId))
    expect(people.size).toBeGreaterThanOrEqual(3)
  })
})

describe('SEV1 #1 -- writes stay with the subject or the head', () => {
  it('a member cannot write a colleague’s answer', async () => {
    expect(
      await setValue(member, {
        defId: defs.get('talim'),
        subjectUserId: otherUserId,
        value: 'yozib qoʻydim',
      }),
    ).toBe(403)
  })

  it('a member cannot write the head’s answer', async () => {
    expect(
      await setValue(member, {
        defId: defs.get('talim'),
        subjectUserId: headUserId,
        value: 'yozib qoʻydim',
      }),
    ).toBe(403)
  })

  it('a member cannot write a head_only field even about themselves', async () => {
    const status = await setValue(member, { defId: defs.get('baholash'), value: 'aʼlo' })
    expect([403, 422]).toContain(status)
  })

  it('the head may write anyone’s answer', async () => {
    expect(
      await setValue(head, {
        defId: defs.get('tillar'),
        subjectUserId: otherUserId,
        value: 'inglizcha',
      }),
    ).toBe(204)
  })
})

describe('SEV1 #1 -- every other fields route, both roles', () => {
  const headOnly: { name: string; method: 'GET' | 'POST' | 'PATCH'; path: string }[] = [
    { name: 'create a definition', method: 'POST', path: '/api/v1/fields/defs' },
    { name: 'reorder definitions', method: 'POST', path: '/api/v1/fields/defs/reorder' },
    { name: 'ask a cohort to fill', method: 'POST', path: '/api/v1/fields/notify' },
  ]

  it.each(headOnly)('$name -- a member is refused', async ({ method, path }) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: member.headers,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('the per-definition notify is head-only too', async () => {
    const res = await fetch(`${baseUrl}/api/v1/fields/defs/${defs.get('talim')}/notify`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(403)
  })

  it('reading the definitions stays open -- a label is a form, not an answer', async () => {
    const res = await get('/api/v1/fields/defs?appliesTo=person', member)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { defs: { key: string }[]; canManage: boolean }
    expect(body.canManage).toBe(false)
    expect(body.defs.length).toBeGreaterThan(0)
  })

  it('"Mening maʼlumotlarim" is the member’s own door and it stays open', async () => {
    const res = await get('/api/v1/fields/me', member)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { fields: { def: { key: string } }[] }
    expect(body.fields.some((f) => f.def.key === 'talim')).toBe(true)
  })

  it('the head’s scoped ask reaches exactly the person it names', async () => {
    const res = await fetch(`${baseUrl}/api/v1/fields/notify`, {
      method: 'POST',
      headers: head.headers,
      body: JSON.stringify({ userIds: [otherUserId] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { asked: number; people: number }
    // `other` answered `talim` and `tillar` but not `baholash`... which is head-only and not
    // self-editable, so the only thing they can be asked for is nothing. Either way the ask is
    // bounded to one person and never fans out to the department.
    expect(body.people).toBeLessThanOrEqual(1)
  })
})
