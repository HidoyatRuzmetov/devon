// H1.16: privilege escalation review -- member -> head -> super_admin paths tested negatively, and
// admin routes reviewed as a group. Against a real Postgres + real app (see `harness.ts`).
//
// `packages/contracts/src/permissions.ts`'s own unit tests (`packages/contracts/test/unit/
// permissions.test.ts`) already prove `can()`'s rules in isolation; this file proves the real HTTP
// routes actually wire those rules in (the route's declared `{action, subject}`, not a hand-rolled
// check) and that a repo-level role gate (structure's `assertCanEditStructure`, which `can()` itself
// does not see) also holds.
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
let dept: { id: string }
let head: Session
let member: Session
let superAdmin: Session

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  dept = await seedDepartment(db, { name: 'Escalation dept', slug: `esc-${randomUUID()}` })
  const headUser = await seedMember(db, dept.id, { role: 'head' })
  const memberUser = await seedMember(db, dept.id, { role: 'member' })
  // I-8b: a real super_admin is never also a department member.
  const superAdminUser = await seedBareUser(db, { instanceRole: 'super_admin' })

  head = await loginAs(baseUrl, headUser.login)
  member = await loginAs(baseUrl, memberUser.login)
  superAdmin = await loginAs(baseUrl, superAdminUser.login)
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('member -> head: department-head-only actions reject a plain member (own department)', () => {
  it('PATCH /departments/:id/settings: member denied, head allowed', async () => {
    const asMember = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/settings`, {
      method: 'PATCH',
      headers: member.headers,
      body: JSON.stringify({ allowSelfAssign: true }),
    })
    expect(asMember.status).toBe(403)

    const asHead = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/settings`, {
      method: 'PATCH',
      headers: head.headers,
      body: JSON.stringify({ allowSelfAssign: true }),
    })
    expect(asHead.status).toBe(204)
  })

  it('POST /departments/:id/invite/rotate-password: member denied, head allowed', async () => {
    const asMember = await fetch(
      `${baseUrl}/api/v1/departments/${dept.id}/invite/rotate-password`,
      {
        method: 'POST',
        headers: member.headers,
        body: '{}', // a `content-type: application/json` header needs a body, even an empty one
      },
    )
    expect(asMember.status).toBe(403)

    const asHead = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/invite/rotate-password`, {
      method: 'POST',
      headers: head.headers,
      body: '{}',
    })
    expect(asHead.status).toBe(200)
  })

  it('PUT /notifications/departments/:id/settings: member denied, head allowed (own department)', async () => {
    const asMember = await fetch(
      `${baseUrl}/api/v1/notifications/departments/${dept.id}/settings`,
      {
        method: 'PUT',
        headers: member.headers,
        body: JSON.stringify({ groupConnectHeadOnly: true }),
      },
    )
    expect(asMember.status).toBe(403)

    const asHead = await fetch(`${baseUrl}/api/v1/notifications/departments/${dept.id}/settings`, {
      method: 'PUT',
      headers: head.headers,
      body: JSON.stringify({ groupConnectHeadOnly: true }),
    })
    expect(asHead.status).toBe(200)
  })

  // FIXED in v1.1 (was `it.fails`; D1/H1.16/H28). `departments/repo.ts`'s `updateDepartmentSettings`
  // writes the merged settings jsonb with its TypeScript (camelCase) property names --
  // `{"allowStructureEdit": false, ...}` -- while `structure/repo.ts`'s `readSettings` read the
  // SNAKE_CASE key, which nothing ever writes: the lookup was always `undefined`, `undefined !== false`
  // was always `true`, and the head's "only heads may edit the structure" switch did nothing at all.
  // `readSettings` now reads the writer's key (keeping the snake_case spelling as a fallback) and
  // defaults `allowStructureEdit` to **off** (v1.1 SPEC §2.2), and unit delete/restore moved to
  // `{kind:'department_managed'}` so no switch can ever open them.
  it(
    'a plain member cannot patch/delete a structure unit once a head disables member self-service',
    async () => {
      const disable = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/settings`, {
        method: 'PATCH',
        headers: head.headers,
        body: JSON.stringify({ allowStructureEdit: false }),
      })
      expect(disable.status).toBe(204)

      const createAsMember = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/units`, {
        method: 'POST',
        headers: member.headers,
        body: JSON.stringify({ name: 'member-created unit' }),
      })
      expect(createAsMember.status).toBe(403)

      const createAsHead = await fetch(`${baseUrl}/api/v1/departments/${dept.id}/units`, {
        method: 'POST',
        headers: head.headers,
        body: JSON.stringify({ name: 'head-created unit' }),
      })
      expect(createAsHead.status).toBe(201)
      const unit = (await createAsHead.json()) as { id: string; version: number }

      const patchAsMember = await fetch(
        `${baseUrl}/api/v1/departments/${dept.id}/units/${unit.id}`,
        {
          method: 'PATCH',
          headers: member.headers,
          body: JSON.stringify({ name: 'renamed by member', version: unit.version }),
        },
      )
      expect(patchAsMember.status).toBe(403)

      const deleteAsMember = await fetch(
        `${baseUrl}/api/v1/departments/${dept.id}/units/${unit.id}`,
        {
          method: 'DELETE',
          headers: member.headers,
          body: '{}', // a `content-type: application/json` header needs a body, even an empty one
        },
      )
      expect(deleteAsMember.status).toBe(403)
    },
  )
})

describe('head -> super_admin: instance-only admin routes reject a department head', () => {
  const adminRoutes: { method: string; path: string; body?: unknown }[] = [
    { method: 'GET', path: '/api/v1/admin/instance' },
    { method: 'GET', path: '/api/v1/admin/departments' },
    { method: 'GET', path: `/api/v1/admin/departments/${randomUUID()}` },
    { method: 'GET', path: '/api/v1/admin/accounts' },
    { method: 'GET', path: '/api/v1/admin/analytics' },
    { method: 'GET', path: '/api/v1/admin/audit/events' },
    { method: 'GET', path: '/api/v1/admin/health' },
    { method: 'GET', path: '/api/v1/admin/maintenance' },
    { method: 'GET', path: '/api/v1/admin/sentinel/status' },
    { method: 'GET', path: '/api/v1/admin/wipe/status' },
    {
      method: 'POST',
      path: `/api/v1/admin/accounts/${randomUUID()}/lock`,
      body: { reason: 'escalation test' },
    },
    {
      method: 'POST',
      path: `/api/v1/admin/departments/${randomUUID()}/pause`,
      body: { reason: 'x' },
    },
    { method: 'PATCH', path: '/api/v1/admin/maintenance', body: { enabled: true, message: null } },
    { method: 'PATCH', path: '/api/v1/admin/registration', body: { open: false } },
    {
      method: 'POST',
      path: '/api/v1/admin/wipe/start',
      body: { phrase: 'WIPE', password: 'example-not-a-real-password' },
    },
  ]

  it.each(adminRoutes)(
    '$method $path -> 403 for a head, not 200/204',
    async ({ method, path, body }) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: head.headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      expect(res.status).toBe(403)
    },
  )

  it('the identical routes succeed (or at least are not 403) for the real super_admin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: superAdmin.cookie },
    })
    expect(res.status).toBe(200)
  })
})

describe('member -> super_admin directly (skipping head): every admin route still denies', () => {
  it('a plain member gets 403 on an admin route exactly like a head does', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: member.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('a plain member cannot approve a department request either (instance-scoped)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/departments/requests/${randomUUID()}/approve`, {
      method: 'POST',
      headers: member.headers,
      body: '{}',
    })
    expect(res.status).toBe(403)
  })
})

describe('unmatched admin path returns the byte-identical 403 (design.md §3.4: no route-existence oracle)', () => {
  it('a made-up /admin/* path gets the same forbidden body shape as a real one', async () => {
    const real = await fetch(`${baseUrl}/api/v1/admin/instance`, {
      headers: { cookie: head.cookie },
    })
    const fake = await fetch(`${baseUrl}/api/v1/admin/this-route-does-not-exist`, {
      headers: { cookie: head.cookie },
    })
    expect(real.status).toBe(403)
    expect(fake.status).toBe(403)
    const [realBody, fakeBody] = await Promise.all([real.json(), fake.json()])
    expect(fakeBody).toEqual(realBody)
  })
})
