// H1.2 / H25.1: object-level access control -- swap an id from one department into another
// department's session and prove the server never leaks or mutates it. Against a real, migrated
// Postgres (Testcontainers) and the real app (RLS + department-scoped repo queries), not the
// in-memory fake `Deps` unit tests use (see `harness.ts`'s header).
//
// Two access-control shapes exist in this codebase (see `packages/contracts/src/permissions.ts`):
//  - "department_child" scoped by the ACTOR's own department context (cards, projects, events, pages,
//    personal items): the URL carries only the *entity* id, so a cross-department request looks
//    exactly like "no such row" from the repo's point of view -> expect 404, never a 200 with someone
//    else's data, and never a 403 that would confirm the id exists.
//  - subject built straight from a URL `:departmentId` param (structure units/roster, notifications
//    department settings): `can()` itself denies with `not_a_member` before any query runs -> 403.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

let db: Db
let server: Server
let baseUrl: string

// Department A owns every seeded entity below; Department B's head/member are the attackers.
let deptA: { id: string }
let deptB: { id: string }
let aHead: Session
let aHeadUserId: string
let bHead: Session
let bHeadUserId: string
let bMember: Session

beforeAll(async () => {
  const h = await startHarness()
  db = h.db
  server = h.server
  baseUrl = server.baseUrl

  deptA = await seedDepartment(db, {
    name: 'Raqamli xizmatlar',
    slug: `dept-a-${randomUUID()}`,
  })
  deptB = await seedDepartment(db, {
    name: 'Boshqa boshqarma',
    slug: `dept-b-${randomUUID()}`,
  })

  const aHeadUser = await seedMember(db, deptA.id, { role: 'head' })
  const bHeadUser = await seedMember(db, deptB.id, { role: 'head' })
  const bMemberUser = await seedMember(db, deptB.id, { role: 'member' })
  aHeadUserId = aHeadUser.id
  bHeadUserId = bHeadUser.id

  aHead = await loginAs(baseUrl, aHeadUser.login)
  bHead = await loginAs(baseUrl, bHeadUser.login)
  bMember = await loginAs(baseUrl, bMemberUser.login)
}, 180_000)

afterAll(async () => {
  await stopHarness({ db, server })
})

describe('cards (work module) -- department_child, actor-context scoped', () => {
  let cardId: string

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({ title: 'Dept A only card' }),
    })
    expect(res.status).toBe(201)
    cardId = ((await res.json()) as { id: string }).id
  })

  it('a different department cannot GET the card by id (404, not 403 -- no existence leak)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot PATCH the card by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: bHead.headers,
      body: JSON.stringify({ title: 'pwned', version: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it("the other department's board never lists the card", async () => {
    const res = await fetch(`${baseUrl}/api/v1/board`, {
      headers: { cookie: bHead.cookie },
    })
    const board = (await res.json()) as {
      columns: { cards: { id: string }[] }[]
      unassigned: { id: string }[]
    }
    const allIds = [
      ...board.columns.flatMap((c) => c.cards.map((c2) => c2.id)),
      ...board.unassigned.map((c) => c.id),
    ]
    expect(allIds).not.toContain(cardId)
  })

  // H1.2 (was `it.fails`, fixed by the security hardening package): `work/repo.ts`'s
  // `addChecklistItem` and `addComment` used to insert `(department_id, card_id) = (actor's own
  // department, :cardId from the URL)` directly, with no query first confirming the card actually
  // belongs to that department (every other card sub-route -- patch, archive, label, watcher -- did
  // that check; these two did not), so a member of a *different* department could attach a checklist
  // item or comment row to *any* card id, cross-tenant, and get 201 where every sibling route returns
  // 404. The cross-department object-id refusal (H1.2/H1.11/H1.16) closed it; this now asserts the
  // fix rather than documenting the hole.
  it('a different department cannot add a checklist item or comment to the card', async () => {
    const checklist = await fetch(`${baseUrl}/api/v1/cards/${cardId}/checklist`, {
      method: 'POST',
      headers: bHead.headers,
      body: JSON.stringify({ text: 'pwned' }),
    })
    expect(checklist.status).toBe(404)
    const comment = await fetch(`${baseUrl}/api/v1/cards/${cardId}/comments`, {
      method: 'POST',
      headers: bHead.headers,
      body: JSON.stringify({ text: 'pwned' }),
    })
    expect(comment.status).toBe(404)
  })
})

describe('projects (work module) -- department_child, actor-context scoped', () => {
  let projectId: string
  let milestoneId: string

  beforeAll(async () => {
    const templates = (await (
      await fetch(`${baseUrl}/api/v1/projects/templates`, {
        headers: { cookie: aHead.cookie },
      })
    ).json()) as { key: string }[]
    const res = await fetch(`${baseUrl}/api/v1/projects/from-template`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({
        templateKey: templates[0]!.key,
        ownerUserId: aHeadUserId,
        members: [aHeadUserId],
      }),
    })
    expect(res.status).toBe(201)
    const project = (await res.json()) as {
      id: string
      milestones: { id: string }[]
    }
    projectId = project.id
    milestoneId = project.milestones[0]!.id
  })

  it('a different department cannot GET the project by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot complete the milestone by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: bHead.headers,
      body: JSON.stringify({ done: true }),
    })
    expect(res.status).toBe(404)
  })
})

describe('events + RSVP + polls + carpools -- department_child, actor-context scoped', () => {
  let eventId: string
  let pollId: string
  let carpoolId: string

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({
        title: 'Dept A only event',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        capacity: 1,
      }),
    })
    expect(res.status).toBe(201)
    eventId = ((await res.json()) as { id: string }).id

    const pollRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/polls`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({
        kind: 'single',
        question: 'Qachon?',
        options: [{ label: 'Dushanba' }, { label: 'Seshanba' }],
      }),
    })
    expect(pollRes.status).toBe(201)
    pollId = ((await pollRes.json()) as { id: string; options: { id: string }[] }).id

    const carpoolRes = await fetch(`${baseUrl}/api/v1/events/${eventId}/carpools`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({ seats: 2 }),
    })
    expect(carpoolRes.status).toBe(201)
    carpoolId = ((await carpoolRes.json()) as { id: string }).id
  })

  it('a different department cannot GET the event by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/${eventId}`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot RSVP to the event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/${eventId}/rsvp`, {
      method: 'POST',
      headers: bMember.headers,
      body: JSON.stringify({ status: 'yes', guests: 0 }),
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot vote on the poll', async () => {
    const pollList = await fetch(`${baseUrl}/api/v1/events/${eventId}/polls`, {
      headers: { cookie: aHead.cookie },
    })
    const { items } = (await pollList.json()) as {
      items: { id: string; options: { id: string }[] }[]
    }
    const optionId = items.find((p) => p.id === pollId)!.options[0]!.id
    const res = await fetch(`${baseUrl}/api/v1/events/${eventId}/polls/${pollId}/vote`, {
      method: 'POST',
      headers: bMember.headers,
      body: JSON.stringify({ optionIds: [optionId] }),
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot claim a carpool seat', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/${eventId}/carpools/${carpoolId}/claim`, {
      method: 'POST',
      headers: bMember.headers,
      body: JSON.stringify({ seats: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot comment on the event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/${eventId}/comments`, {
      method: 'POST',
      headers: bHead.headers,
      body: JSON.stringify({ body: 'pwned' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('pages -- department_child, actor-context scoped', () => {
  let pageId: string

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/v1/pages`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({ kind: 'note', title: 'Dept A only page' }),
    })
    expect(res.status).toBe(201)
    pageId = ((await res.json()) as { id: string }).id
  })

  it('a different department cannot GET the page by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pages/${pageId}`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(404)
  })

  it('a different department cannot PATCH the page by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: bHead.headers,
      body: JSON.stringify({ title: 'pwned', version: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it("does not appear in the other department's page list", async () => {
    const res = await fetch(`${baseUrl}/api/v1/pages`, {
      headers: { cookie: bHead.cookie },
    })
    const list = (await res.json()) as { id: string }[]
    expect(list.map((p) => p.id)).not.toContain(pageId)
  })
})

describe('structure (units/roster) -- subject built from the :departmentId URL param', () => {
  it('a non-member of the department gets 403 reading its units overview (not 404: can() denies first)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/departments/${deptA.id}/units`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('a non-member of the department gets 403 creating a unit in it', async () => {
    const res = await fetch(`${baseUrl}/api/v1/departments/${deptA.id}/units`, {
      method: 'POST',
      headers: bHead.headers,
      body: JSON.stringify({ name: 'pwned unit' }),
    })
    expect(res.status).toBe(403)
  })

  it('a non-member of the department gets 403 reading its roster', async () => {
    const res = await fetch(`${baseUrl}/api/v1/departments/${deptA.id}/roster`, {
      headers: { cookie: bMember.cookie },
    })
    expect(res.status).toBe(403)
  })
})

describe('notifications department settings -- subject built from the :departmentId URL param', () => {
  it('a non-member gets 403 reading another department’s notification settings', async () => {
    const res = await fetch(`${baseUrl}/api/v1/notifications/departments/${deptA.id}/settings`, {
      headers: { cookie: bHead.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('a non-member gets 403 writing another department’s notification settings', async () => {
    const res = await fetch(`${baseUrl}/api/v1/notifications/departments/${deptA.id}/settings`, {
      method: 'PUT',
      headers: bHead.headers,
      body: JSON.stringify({ groupConnectHeadOnly: true }),
    })
    expect(res.status).toBe(403)
  })
})

describe("memberships -- the :departmentId in the URL is the actor's own, the :userId is the object", () => {
  it("dept A's head removing a userId that belongs to dept B (not dept A) is a no-op 404, never removes dept B's membership", async () => {
    // No request body on this route -- `content-type: application/json` with an empty body is itself
    // a 400 at Fastify's parser, so only the cookie + CSRF header go here, never `aHead.headers`
    // (which always sets `content-type`, correctly, for every call that *does* carry a JSON body).
    const res = await fetch(
      `${baseUrl}/api/v1/departments/${deptA.id}/members/${bHeadUserId}/remove`,
      {
        method: 'POST',
        headers: { cookie: aHead.cookie, 'x-csrf-token': aHead.csrf },
      },
    )
    // `repo.removeMember` scopes its UPDATE by `(department_id, user_id)` together -- a `userId` that
    // is real but belongs to a *different* department matches zero rows, same as a made-up uuid.
    expect(res.status).toBe(404)
    const stillActive = await fetch(`${baseUrl}/api/v1/departments/${deptB.id}/members`, {
      headers: { cookie: bHead.cookie },
    })
    const { members } = (await stillActive.json()) as {
      members: { userId: string; status: string }[]
    }
    expect(members.find((m) => m.userId === bHeadUserId)?.status).toBe('active')
  })

  it("dept A's head cannot transfer dept A's headship to a userId that belongs to dept B", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/departments/${deptA.id}/members/${bHeadUserId}/transfer-headship`,
      {
        method: 'POST',
        headers: { cookie: aHead.cookie, 'x-csrf-token': aHead.csrf },
      },
    )
    expect(res.status).toBe(409)
  })
})

describe("AI settings (H1.2/H25.1) -- subject built from the actor's own department, no id in the URL", () => {
  // `GET /ai/settings` reads `req.actor.departmentId` server-side, never a client-supplied id -- there
  // is no id for an attacker to swap in the first place. The positive control below proves that
  // scoping is real (dept B's own distinct budget is never what dept A sees), not merely absent by
  // construction. Pre-seeded directly (bypassing the app role) so this positive control does not also
  // exercise the BUG documented right below it.
  beforeAll(async () => {
    await superuserQuery(
      db,
      `insert into app.ai_department_settings (department_id, budget_uzs_per_month) values ($1, 999000) on conflict (department_id) do nothing`,
      [deptA.id],
    )
    await superuserQuery(
      db,
      `insert into app.ai_department_settings (department_id, budget_uzs_per_month) values ($1, 111000) on conflict (department_id) do nothing`,
      [deptB.id],
    )
  })

  it("a department's own head sees only its own AI budget, never the other department's", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ai/settings`, {
      headers: { cookie: aHead.cookie },
    })
    expect(res.status).toBe(200)
    const settings = (await res.json()) as {
      departmentId: string
      budgetUzsPerMonth: number
    }
    expect(settings.departmentId).toBe(deptA.id)
    expect(settings.budgetUzsPerMonth).toBe(999000)
  })

  // BUG (found by the `admin-pause`/`board-move`/`group-project` H30.1 `@flow` e2e specs, live: any
  // freshly-approved department's board/project page 500s the moment it renders anything that reads
  // AI settings, because `GET /ai/settings` on a department with no `ai_department_settings` row yet
  // lazily INSERTs a default row (`ai/repo.ts`'s `getSettings`) and that INSERT is rejected by RLS).
  // Root cause: `ai_department_settings_write`'s policy (`packages/db/migrations/0800_ai.sql`) requires
  // `app.current_actor_role() in ('head', 'super_admin')` -- but `current_actor_role()` reads the GUC
  // the API sets from `Actor.role` (`lib/actor.ts`: `role: user.role`, the *instance-wide* role, which
  // is only ever `'member'` or `'super_admin'`, I-8b), never the per-department *membership* role
  // (`'head'`/`'member'`, a completely separate column). A department head's instance-wide role is
  // always `'member'`, so this check can never be true for any real head -- only `super_admin` can
  // ever pass it. The very first `GET /ai/settings` for any new department (head or member, whoever
  // gets there first) 500s instead of lazily creating the row it was designed to create; every
  // subsequent read/write also 500s forever after, since the row never got created either.
  //
  // FIXED in v1.1, both halves: migration `0904_department_role_guc.sql` adds
  // `app.current_department_role()` (a new transaction-local GUC set by `withContext()` from
  // `RequestContext.departmentRole`) and re-creates `ai_department_settings_write` to read it, and the
  // AI module now passes the actor's *membership* role via `lib/actor.ts`'s `contextDepartmentRole()`.
  // The database boundary and `can()` now derive "is this the head?" from the same source.
  it("a fresh department's own head can read (and lazily initialise) its AI settings on first visit", async () => {
    const freshDept = await seedDepartment(db, {
      name: 'Fresh AI dept',
      slug: `dept-ai-${randomUUID()}`,
    })
    const freshHeadUser = await seedMember(db, freshDept.id, { role: 'head' })
    const freshHead = await loginAs(baseUrl, freshHeadUser.login)
    const res = await fetch(`${baseUrl}/api/v1/ai/settings`, {
      headers: { cookie: freshHead.cookie },
    })
    expect(res.status).toBe(200)
  })
})

describe('personal tasks -- owner-only, not department scoped at all', () => {
  let taskId: string

  beforeAll(async () => {
    const res = await fetch(`${baseUrl}/api/v1/personal/tasks`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({ title: 'my private task' }),
    })
    expect(res.status).toBe(201)
    taskId = ((await res.json()) as { id: string }).id
  })

  it('another user (even the same department head, if there were one) cannot PATCH the task by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/personal/tasks/${taskId}`, {
      method: 'PATCH',
      headers: bHead.headers,
      body: JSON.stringify({ title: 'pwned', version: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it('another user cannot DELETE the task by id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/personal/tasks/${taskId}`, {
      method: 'DELETE',
      headers: bHead.headers,
      body: '{}', // a `content-type: application/json` header needs a body, even an empty one
    })
    expect(res.status).toBe(404)
  })

  it("does not appear in another user's task list", async () => {
    const res = await fetch(`${baseUrl}/api/v1/personal/tasks`, {
      headers: { cookie: bHead.cookie },
    })
    const list = (await res.json()) as { id: string }[]
    expect(list.map((t) => t.id)).not.toContain(taskId)
  })
})

describe('admin routes -- instance-scoped, not reachable via any department id at all', () => {
  it('a department head (not super_admin) cannot pause another department', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/departments/${deptB.id}/pause`, {
      method: 'POST',
      headers: aHead.headers,
      body: JSON.stringify({ reason: 'test' }),
    })
    expect(res.status).toBe(403)
  })
})
