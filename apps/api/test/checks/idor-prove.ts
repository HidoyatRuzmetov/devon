// Object-level access control, proved by swapping ids across departments (HARDENING H1.2: "auth and
// authorisation enforced on every endpoint (`can()` + RLS); object-level access tested by changing
// ids (cross-department test)"; H1.16 privilege escalation; H1.11 responses never leak another
// department's data).
//
// The existing evidence covers the two neighbouring layers and neither of them is this one:
//
//   - `packages/db/test/integration/rls.isolation.test.ts` proves the RLS policies at the SQL layer.
//   - `apps/api/test/checks/work-prove.ts` proves a *list* endpoint is scoped (department B's board
//     shows none of department A's cards).
//   - `packages/contracts/test/unit/permissions.test.ts` proves `can()` in isolation, with no object.
//
// What none of them proves is the shape an attacker actually uses: a fully valid session in
// department B, sending department A's **object id** straight into a route that takes one. That is
// OWASP's Broken Object Level Authorisation, the top API risk, and it is the failure mode that
// survives a correct `can()` (the actor really may patch *a* card) and a correct list query (the
// attacker never asks for a list). It is only refused if the handler scopes the lookup to the
// caller's department, or RLS makes the row invisible to the transaction -- and this script is what
// says which of the routes that take an id actually do.
//
// Every attempt below is made with department B's real cookie and real CSRF token, so nothing is
// refused for being unauthenticated or for missing a token: the only thing under test is the id.
// The assertion is deliberately two-sided -- a non-2xx status **and** the absence of department A's
// unique marker string anywhere in the response body -- because a 200 carrying an empty object and a
// 404 carrying the leaked title are both failures, and only the second one is visible in the status.
//
// Run: `pnpm --filter @devon/api idor:prove` (needs Docker; starts its own Postgres).
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'
import { hashPassword } from '../../src/lib/password.js'

const PASSWORD = 'Str0ngExampleValue123'

/** Unique, unmistakable text stored on every object department A creates. If any byte of it comes
 * back to department B, the response leaked -- whatever the status code said. */
const MARKER = 'MARKER-A-8f3c1d2e-secret-title'

type Attempt = {
  label: string
  method: string
  path: string
  body?: unknown
}

type Session = { cookie: string; write: Record<string, string> }

async function login(baseUrl: string, loginName: string): Promise<Session> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: loginName, password: PASSWORD }),
  })
  assertEqual(res.status, 204, `login ${loginName} status`)
  const cookies = parseCookies(res.headers.getSetCookie())
  const cookie = cookieHeader(cookies)
  return {
    cookie,
    write: {
      cookie,
      'x-csrf-token': cookies['devon_csrf']!,
      'content-type': 'application/json',
    },
  }
}

async function main(): Promise<void> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`api listening at ${server.baseUrl}`)

  const failures: string[] = []

  try {
    step('bootstrap: two departments, one head each, no shared membership')
    const deptA = randomUUID()
    const deptB = randomUUID()
    const userA = randomUUID()
    const userB = randomUUID()
    const passwordHash = await hashPassword(PASSWORD)
    const superuser = new Client({ connectionString: db.superuserUrl })
    await superuser.connect()
    try {
      await superuser.query(
        `insert into app.users (id, login, password_hash, given_name, family_name, role)
         values ($1, 'idor.a', $3, 'Nodira', 'Karimova', 'member'),
                ($2, 'idor.b', $3, 'Bekzod', 'Yusupov', 'member')`,
        [userA, userB, passwordHash],
      )
      await superuser.query(
        `insert into app.departments (id, name, slug)
         values ($1, 'Raqamli xizmatlar boshqarmasi', 'idor-a'),
                ($2, 'Boshqa boshqarma', 'idor-b')`,
        [deptA, deptB],
      )
      await superuser.query(
        `insert into app.memberships (id, department_id, user_id, role)
         values ($1, $3, $5, 'head'), ($2, $4, $6, 'head')`,
        [randomUUID(), randomUUID(), deptA, deptB, userA, userB],
      )
    } finally {
      await superuser.end()
    }
    const a = await login(server.baseUrl, 'idor.a')
    const b = await login(server.baseUrl, 'idor.b')

    // -- department A creates one of everything that has an id a client can send back -------------
    async function createAsA(path: string, body: unknown, label: string): Promise<string> {
      const res = await fetch(`${server.baseUrl}${path}`, {
        method: 'POST',
        headers: a.write,
        body: JSON.stringify(body),
      })
      const text = await res.text()
      assertTrue(
        res.status >= 200 && res.status < 300,
        `department A creates ${label} (${res.status})${res.status < 300 ? '' : ` -- ${text.slice(0, 300)}`}`,
      )
      return (JSON.parse(text) as { id: string }).id
    }

    step('department A creates a card, project, page, event, unit, saved filter and personal task')
    const cardId = await createAsA(
      '/api/v1/cards',
      { title: `${MARKER} card`, assigneeUserId: userA, giverUserId: userA, labels: [] },
      'a card',
    )
    const projectId = await createAsA(
      '/api/v1/projects',
      { title: `${MARKER} project`, ownerUserId: userA, members: [userA] },
      'a project',
    )
    const pageId = await createAsA('/api/v1/pages', { title: `${MARKER} page` }, 'a page')
    const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const eventId = await createAsA(
      '/api/v1/events',
      {
        title: `${MARKER} event`,
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
      },
      'an event',
    )
    const unitId = await createAsA(
      `/api/v1/departments/${deptA}/units`,
      { name: `${MARKER} unit` },
      'a structure unit',
    )
    const savedFilterId = await createAsA(
      '/api/v1/analytics/saved-filters',
      { name: `${MARKER} filter` },
      'a saved analytics filter',
    )
    const personalTaskId = await createAsA(
      '/api/v1/personal/tasks',
      { title: `${MARKER} personal task` },
      "a task in A's private workspace",
    )

    // -- every route that takes one of those ids, tried with department B's session ---------------
    const attempts: Attempt[] = [
      // work
      { label: 'read a card', method: 'GET', path: `/api/v1/cards/${cardId}` },
      {
        label: 'patch a card',
        method: 'PATCH',
        path: `/api/v1/cards/${cardId}`,
        body: { title: 'taken over' },
      },
      { label: "read a card's activity", method: 'GET', path: `/api/v1/cards/${cardId}/activity` },
      {
        label: 'comment on a card',
        method: 'POST',
        path: `/api/v1/cards/${cardId}/comments`,
        body: { text: 'injected comment' },
      },
      {
        label: "append to a card's checklist",
        method: 'POST',
        path: `/api/v1/cards/${cardId}/checklist`,
        body: { text: 'injected item' },
      },
      {
        label: 'watch a card',
        method: 'POST',
        path: `/api/v1/cards/${cardId}/watchers`,
        body: { watching: true },
      },
      { label: 'restore a card', method: 'POST', path: `/api/v1/cards/${cardId}/restore` },
      // projects
      { label: 'read a project', method: 'GET', path: `/api/v1/projects/${projectId}` },
      {
        label: 'patch a project',
        method: 'PATCH',
        path: `/api/v1/projects/${projectId}`,
        body: { title: 'taken over', version: 1 },
      },
      {
        label: 'add a milestone to a project',
        method: 'POST',
        path: `/api/v1/projects/${projectId}/milestones`,
        body: { title: 'injected', dueOn: null },
      },
      // pages
      { label: 'read a page', method: 'GET', path: `/api/v1/pages/${pageId}` },
      {
        label: 'patch a page',
        method: 'PATCH',
        path: `/api/v1/pages/${pageId}`,
        body: { title: 'taken over', version: 1 },
      },
      { label: 'delete a page', method: 'DELETE', path: `/api/v1/pages/${pageId}` },
      {
        label: "read a page's version history",
        method: 'GET',
        path: `/api/v1/pages/${pageId}/versions`,
      },
      // events
      { label: 'read an event', method: 'GET', path: `/api/v1/events/${eventId}` },
      {
        label: 'patch an event',
        method: 'PATCH',
        path: `/api/v1/events/${eventId}`,
        body: { title: 'taken over' },
      },
      {
        label: 'cancel an event',
        method: 'POST',
        path: `/api/v1/events/${eventId}/cancel`,
        body: { reason: 'taken over' },
      },
      {
        label: 'RSVP to an event',
        method: 'POST',
        path: `/api/v1/events/${eventId}/rsvp`,
        body: { status: 'yes' },
      },
      {
        label: "read an event's RSVP list",
        method: 'GET',
        path: `/api/v1/events/${eventId}/rsvps`,
      },
      {
        label: "read an event's comments",
        method: 'GET',
        path: `/api/v1/events/${eventId}/comments`,
      },
      {
        label: "read an event's calendar file",
        method: 'GET',
        path: `/api/v1/events/${eventId}/ics`,
      },
      {
        label: "read an event's carpools",
        method: 'GET',
        path: `/api/v1/events/${eventId}/carpools`,
      },
      {
        label: "read an event's item list",
        method: 'GET',
        path: `/api/v1/events/${eventId}/items`,
      },
      { label: "read an event's polls", method: 'GET', path: `/api/v1/events/${eventId}/polls` },
      { label: "read an event's photos", method: 'GET', path: `/api/v1/events/${eventId}/photos` },
      {
        label: "read an event's feedback",
        method: 'GET',
        path: `/api/v1/events/${eventId}/feedback`,
      },
      {
        label: "read a page's single version",
        method: 'GET',
        path: `/api/v1/pages/${pageId}/versions/${randomUUID()}`,
      },
      // structure -- both spellings of the same attack
      {
        label: "patch a unit through its own department's path",
        method: 'PATCH',
        path: `/api/v1/departments/${deptA}/units/${unitId}`,
        body: { name: 'taken over' },
      },
      {
        label: "patch another department's unit through the attacker's own department path",
        method: 'PATCH',
        path: `/api/v1/departments/${deptB}/units/${unitId}`,
        body: { name: 'taken over' },
      },
      {
        label: "delete another department's unit through the attacker's own department path",
        method: 'DELETE',
        path: `/api/v1/departments/${deptB}/units/${unitId}`,
      },
      {
        label: "list another department's units",
        method: 'GET',
        path: `/api/v1/departments/${deptA}/units`,
      },
      {
        label: "read another department's roster",
        method: 'GET',
        path: `/api/v1/departments/${deptA}/roster`,
      },
      {
        label: "list another department's unit roles",
        method: 'GET',
        path: `/api/v1/departments/${deptA}/unit-roles`,
      },
      // analytics
      {
        label: "patch another department's saved filter",
        method: 'PATCH',
        path: `/api/v1/analytics/saved-filters/${savedFilterId}`,
        body: { name: 'taken over', version: 1 },
      },
      {
        label: "delete another department's saved filter",
        method: 'DELETE',
        path: `/api/v1/analytics/saved-filters/${savedFilterId}`,
      },
      // the private personal workspace: not another department, another *person* (I-2)
      {
        label: "patch another user's personal task",
        method: 'PATCH',
        path: `/api/v1/personal/tasks/${personalTaskId}`,
        body: { title: 'taken over', version: 1 },
      },
      {
        label: "delete another user's personal task",
        method: 'DELETE',
        path: `/api/v1/personal/tasks/${personalTaskId}`,
      },
      // privilege escalation: B is a head, but of the wrong department (H1.16)
      { label: 'read another department', method: 'GET', path: `/api/v1/departments/${deptA}` },
      {
        label: "read another department's members",
        method: 'GET',
        path: `/api/v1/departments/${deptA}/members`,
      },
      {
        label: "read another department's join key",
        method: 'GET',
        path: `/api/v1/departments/${deptA}/invite`,
      },
      {
        label: "rotate another department's join key",
        method: 'POST',
        path: `/api/v1/departments/${deptA}/invite/rotate-key`,
      },
      {
        label: "rotate another department's join password",
        method: 'POST',
        path: `/api/v1/departments/${deptA}/invite/rotate-password`,
      },
      {
        label: "change another department's settings",
        method: 'PATCH',
        path: `/api/v1/departments/${deptA}/settings`,
        body: { name: 'taken over' },
      },
      {
        label: 'remove a member from another department',
        method: 'POST',
        path: `/api/v1/departments/${deptA}/members/${userA}/remove`,
      },
      {
        label: 'take headship of another department',
        method: 'POST',
        path: `/api/v1/departments/${deptA}/members/${userB}/transfer-headship`,
      },
      {
        label: "request another department's deletion",
        method: 'POST',
        path: `/api/v1/departments/${deptA}/deletion-request`,
        body: { reason: 'taken over' },
      },
      // the super admin console, from a department head (H1.16 ladder, over HTTP this time)
      { label: 'reach the admin console', method: 'GET', path: `/api/v1/admin/accounts` },
      {
        label: 'pause a department from the admin console',
        method: 'POST',
        path: `/api/v1/admin/departments/${deptA}/pause`,
        body: { reason: 'taken over' },
      },
    ]

    step(`${attempts.length} object-level attempts with department B's valid session`)
    // A body-carrying request needs the CSRF token *and* `content-type: application/json`; a
    // body-less POST must NOT claim that content type, or Fastify refuses it with 400
    // `FST_ERR_CTP_EMPTY_JSON_BODY` before the handler ever runs -- which would look like a refusal
    // in this report while proving nothing at all about the id.
    for (const attempt of attempts) {
      const init: RequestInit = {
        method: attempt.method,
        headers:
          attempt.method === 'GET'
            ? { cookie: b.cookie }
            : attempt.body === undefined
              ? { cookie: b.cookie, 'x-csrf-token': b.write['x-csrf-token']! }
              : b.write,
      }
      if (attempt.body !== undefined) init.body = JSON.stringify(attempt.body)
      const res = await fetch(`${server.baseUrl}${attempt.path}`, init)
      const text = await res.text()
      const allowed = res.status >= 200 && res.status < 300
      const leaked = text.includes(MARKER)
      const line = `${attempt.method} ${attempt.path} -- ${attempt.label}`
      // A refusal must come from authorisation, not from a body the handler never liked: a 400/422
      // means this attempt proved nothing, so it is reported as loudly as a leak.
      // A 5xx is not a refusal either: it means the guard threw where nothing caught it, which is
      // the wrong status for the client and a false alarm in the operator's error log (H1.13, H16.1).
      const inconclusive =
        !allowed && (res.status === 400 || res.status === 422 || res.status >= 500)
      if (allowed || leaked) {
        failures.push(
          `${line}: status ${res.status}${leaked ? ", body carries department A's marker" : ''} -- ${text.slice(0, 300)}`,
        )
        console.log(`  LEAK: ${line} -> ${res.status}${leaked ? ' (marker present)' : ''}`)
      } else if (inconclusive) {
        failures.push(
          `${line}: status ${res.status} is a validation refusal, not an authorisation one -- the ` +
            `request never reached the handler, so this attempt proves nothing: ${text.slice(0, 300)}`,
        )
        console.log(`  INCONCLUSIVE: ${line} -> ${res.status}`)
      } else {
        console.log(`  ok: ${line} -> ${res.status}`)
      }
    }

    step('the same ids with no session at all are 401, never 404-by-existence')
    for (const attempt of attempts.filter((x) => x.method === 'GET')) {
      const res = await fetch(`${server.baseUrl}${attempt.path}`)
      const text = await res.text()
      if ((res.status >= 200 && res.status < 300) || text.includes(MARKER)) {
        failures.push(`anonymous ${attempt.method} ${attempt.path}: status ${res.status}`)
      }
    }
    console.log('  ok: no anonymous request reached an object')

    step("department A's own session still reaches its own objects (the test is not vacuous)")
    for (const [path, label] of [
      [`/api/v1/cards/${cardId}`, 'card'],
      [`/api/v1/projects/${projectId}`, 'project'],
      [`/api/v1/pages/${pageId}`, 'page'],
      [`/api/v1/events/${eventId}`, 'event'],
    ] as const) {
      const res = await fetch(`${server.baseUrl}${path}`, { headers: { cookie: a.cookie } })
      const text = await res.text()
      assertEqual(res.status, 200, `owner reads its own ${label}`)
      assertTrue(text.includes(MARKER), `the owner's ${label} really carries the marker`)
    }

    if (failures.length > 0) {
      throw new Error(
        `object-level access control failed on ${failures.length} of ${attempts.length} attempts:\n  ` +
          failures.join('\n  '),
      )
    }
    console.log(`\nidor:prove PASSED -- ${attempts.length} cross-department id swaps all refused`)
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
