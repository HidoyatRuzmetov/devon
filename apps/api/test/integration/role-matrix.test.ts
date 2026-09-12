// v1.1 SPEC §2 -- the cross-role proof. `packages/contracts/test/unit/app-actions.test.ts` proves the
// matrix in isolation; this file proves the real HTTP routes wire it in: a xodim asking for a
// boshqarma boshlig'i's data gets 403, list endpoints omit head-only fields for a member, and the
// same request from the head succeeds.
//
// Everything runs against a real migrated Postgres + the real Fastify app (`harness.ts`), because the
// point is the whole chain -- route declaration, `can()`, RLS -- not the decision function alone.
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
let memberUserId: string
let headUserId: string

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  dept = await seedDepartment(db, {
    name: 'Matrix dept',
    slug: `matrix-${randomUUID()}`,
  })
  const headUser = await seedMember(db, dept.id, { role: 'head' })
  const memberUser = await seedMember(db, dept.id, { role: 'member' })
  memberUserId = memberUser.id
  headUserId = headUser.id
  head = await loginAs(baseUrl, headUser.login)
  member = await loginAs(baseUrl, memberUser.login)
}, 180_000)

afterAll(async () => {
  if (db && server) await stopHarness({ db, server })
})

const get = (path: string, session: Session) =>
  fetch(`${baseUrl}${path}`, { headers: { cookie: session.cookie } })

describe('head-only reads: a member gets 403, the head gets 200', () => {
  const headOnlyReads: { name: string; path: string }[] = [
    {
      name: 'people indicators (SPEC §4.2)',
      path: '/api/v1/people/indicators',
    },
    {
      name: 'people indicator registry',
      path: '/api/v1/people/indicators/registry',
    },
    {
      name: 'onboarding templates (D4c)',
      path: '/api/v1/pages/onboarding/templates',
    },
    {
      name: 'per-person analytics CSV (D3b)',
      path: '/api/v1/analytics/export.csv?chart=loadPerPerson',
    },
  ]

  it.each(headOnlyReads)('$name -- member is refused', async ({ path }) => {
    const res = await get(path, member)
    expect(res.status).toBe(403)
  })

  it.each(headOnlyReads)('$name -- head is served', async ({ path }) => {
    const res = await get(path, head)
    expect(res.status).toBe(200)
  })

  it('the Telegram groups list is head-only on the server, not just hidden in the UI (D8)', async () => {
    expect((await get(`/api/v1/telegram/departments/${dept.id}/groups`, member)).status).toBe(403)
    expect((await get(`/api/v1/telegram/departments/${dept.id}/groups`, head)).status).toBe(200)
  })
})

describe('list endpoints omit head-only fields for a member (D2, D3)', () => {
  it('AI settings: a member sees the flags, never the money (D2a)', async () => {
    const asMember = (await (await get('/api/v1/ai/settings', member)).json()) as Record<
      string,
      unknown
    >
    expect(asMember['flags']).toBeDefined()
    expect(asMember).not.toHaveProperty('budgetUzsPerMonth')
    expect(asMember).not.toHaveProperty('spentUzsThisMonth')
    expect(asMember).not.toHaveProperty('usedPct')
    expect(asMember).not.toHaveProperty('budgetStatus')

    const asHead = (await (await get('/api/v1/ai/settings', head)).json()) as Record<
      string,
      unknown
    >
    expect(asHead).toHaveProperty('budgetUzsPerMonth')
    expect(asHead).toHaveProperty('spentUzsThisMonth')
  })

  it("AI usage: a member sees only their own runs, never a colleague's (D2b)", async () => {
    const asMember = (await (await get('/api/v1/ai/usage', member)).json()) as {
      traces: { userId: string }[]
    }
    for (const trace of asMember.traces) expect(trace.userId).toBe(memberUserId)
  })

  it('analytics summary: a member sees only their own row on the person axis (D3a)', async () => {
    const asMember = (await (await get('/api/v1/analytics/summary', member)).json()) as {
      loadPerPerson: { userId: string }[]
      loadPerUnit: unknown[]
    }
    for (const row of asMember.loadPerPerson) expect(row.userId).toBe(memberUserId)
    // The unit-level aggregate is deliberately NOT narrowed: a bo'lim is a team, not a person.
    expect(Array.isArray(asMember.loadPerUnit)).toBe(true)
  })

  it('the department aggregates a member may see are still there', async () => {
    const asMember = (await (await get('/api/v1/analytics/summary', member)).json()) as Record<
      string,
      unknown
    >
    expect(asMember['throughput']).toBeDefined()
    expect(asMember['onTimeRate']).toBeDefined()
    expect(asMember['projectProgress']).toBeDefined()
  })

  it('a department-level CSV export a member may see still works', async () => {
    const res = await get('/api/v1/analytics/export.csv?chart=throughput', member)
    expect(res.status).toBe(200)
  })
})

describe('owner-set writes: a bystander cannot touch a colleague’s card (D6)', () => {
  let cardId: string

  beforeAll(async () => {
    // The head gives themselves a card; the member is neither giver, assignee nor creator.
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: head.headers,
      body: JSON.stringify({ title: 'the head’s own card' }),
    })
    expect(res.status).toBe(201)
    cardId = ((await res.json()) as { id: string }).id
  })

  it('a member may still READ it -- the board is the product', async () => {
    expect((await get(`/api/v1/cards/${cardId}`, member)).status).toBe(200)
  })

  it('a member may not retitle it', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({ title: 'rewritten by a bystander' }),
    })
    expect(res.status).toBe(403)
  })

  it('a member may not archive it', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({ status: 'archived' }),
    })
    expect(res.status).toBe(403)
  })

  it('a member may not add a checklist item to it', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}/checklist`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ text: 'not mine to plan' }),
    })
    expect(res.status).toBe(403)
  })

  it('the giver may edit their own card', async () => {
    const created = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ title: 'my own card' }),
    })
    const own = (await created.json()) as { id: string }
    const res = await fetch(`${baseUrl}/api/v1/cards/${own.id}`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({ title: 'renamed by its creator' }),
    })
    expect(res.status).toBe(200)
  })

  it('the head may edit anything in the department', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: head.headers,
      body: JSON.stringify({ title: 'renamed by the head' }),
    })
    expect(res.status).toBe(200)
  })

  it('every card DTO carries the server’s own canEdit answer', async () => {
    const board = (await (await get('/api/v1/board', member)).json()) as {
      columns: { cards: { id: string; canEdit?: boolean }[] }[]
      unassigned: { id: string; canEdit?: boolean }[]
    }
    const all = [...board.columns.flatMap((c) => c.cards), ...board.unassigned]
    const headsCard = all.find((c) => c.id === cardId)
    expect(headsCard?.canEdit).toBe(false)
  })

  it('creating a department label is head-only (D6d)', async () => {
    const asMember = await fetch(`${baseUrl}/api/v1/labels`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ name: 'member-made label' }),
    })
    expect(asMember.status).toBe(403)
    const asHead = await fetch(`${baseUrl}/api/v1/labels`, {
      method: 'POST',
      headers: head.headers,
      body: JSON.stringify({ name: 'head-made label' }),
    })
    expect(asHead.status).toBe(201)
  })
})

describe('projects and pages: owner or head (D4, D5)', () => {
  it('a member cannot appoint somebody else the owner of a project they create (D5b)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({
        title: 'ownership probe',
        ownerUserId: randomUUID(),
        members: [memberUserId],
      }),
    })
    expect(res.status).toBe(201)
    const project = (await res.json()) as { ownerUserId: string }
    expect(project.ownerUserId).toBe(memberUserId)
  })

  it("a member cannot edit the head's project or its milestones (D5a/D5c)", async () => {
    const created = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: head.headers,
      body: JSON.stringify({
        title: "the head's project",
        ownerUserId: headUserId,
        members: [headUserId],
      }),
    })
    const project = (await created.json()) as { id: string; version: number }

    const patch = await fetch(`${baseUrl}/api/v1/projects/${project.id}`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({ title: 'rewritten', version: project.version }),
    })
    expect(patch.status).toBe(403)

    const milestone = await fetch(`${baseUrl}/api/v1/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ title: 'not mine', dueOn: '2026-12-31' }),
    })
    expect(milestone.status).toBe(403)
  })

  it("a member cannot delete the head's page, but may still edit it (D4a)", async () => {
    const created = await fetch(`${baseUrl}/api/v1/pages`, {
      method: 'POST',
      headers: head.headers,
      body: JSON.stringify({ title: "the head's page", kind: 'note' }),
    })
    expect(created.status).toBe(201)
    const page = (await created.json()) as { id: string; version: number }

    const edit = await fetch(`${baseUrl}/api/v1/pages/${page.id}`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({
        title: 'a wiki is collaborative',
        version: page.version,
      }),
    })
    expect(edit.status).toBe(200)

    const del = await fetch(`${baseUrl}/api/v1/pages/${page.id}`, {
      method: 'DELETE',
      headers: member.headers,
      body: '{}',
    })
    expect(del.status).toBe(403)
  })
})

describe('SPEC §2.3 -- the department switcher', () => {
  it('refuses a department the caller is not a member of', async () => {
    const other = await seedDepartment(db, {
      name: 'Not mine',
      slug: `nm-${randomUUID()}`,
    })
    const res = await fetch(`${baseUrl}/api/v1/me/active-department`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ departmentId: other.id }),
    })
    expect(res.status).toBe(403)
  })

  it('accepts one of the caller’s own memberships and reports it back on /me', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me/active-department`, {
      method: 'POST',
      headers: member.headers,
      body: JSON.stringify({ departmentId: dept.id }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { activeDepartmentId: string }
    expect(body.activeDepartmentId).toBe(dept.id)
    expect(res.headers.get('set-cookie') ?? '').toContain('devon_dept=')
  })
})
