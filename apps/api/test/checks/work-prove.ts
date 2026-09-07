// EPIC-004/005 evidence producer (mirrors `session-prove.ts`'s pattern): the work/projects modules,
// end to end, against a real migrated Postgres (every 0300-0302 migration, real RLS policies, the
// real `createRepo()`). EPIC-002 has not shipped a department-create/join flow yet, so this script
// bootstraps a department + membership by hand (superuser connection, bypasses RLS by design -- see
// `pg-fixture.ts`'s header) the same way a completed EPIC-002 would have produced one, then proves
// `req.actor.departmentId`/`memberships` (this build's fix to `lib/actor.ts`) actually lets a real
// signed-in member reach `{kind:'department_child'}` routes.
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { startProveDatabase } from './pg-fixture.js'
import { startProveServer } from './server-fixture.js'
import { step, assertEqual, assertTrue, parseCookies, cookieHeader } from './http.js'

const PASSWORD = 'Str0ngExampleValue123'

async function main(): Promise<void> {
  const db = await startProveDatabase()
  const server = await startProveServer(db)
  console.log(`api listening at ${server.baseUrl}`)

  try {
    step('bootstrap: create a user via setup, then attach a department + membership by hand')
    const issued = await server.deps.ensureSetupToken()
    const setupRes = await fetch(`${server.baseUrl}/api/v1/setup/${issued!.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        login: 'work.prove',
        password: PASSWORD,
        givenName: 'Nodira',
        familyName: 'Karimova',
        locale: 'uz-Latn',
      }),
    })
    assertEqual(setupRes.status, 201, 'setup status')
    const { user } = (await setupRes.json()) as { user: { id: string } }

    const departmentId = randomUUID()
    const superuser = new Client({ connectionString: db.superuserUrl })
    await superuser.connect()
    try {
      await superuser.query(`update app.users set role = 'member' where id = $1`, [user.id])
      await superuser.query(
        `insert into app.departments (id, name, slug) values ($1, 'Raqamli xizmatlar boshqarmasi', 'raqamli-xizmatlar')`,
        [departmentId],
      )
      await superuser.query(
        `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'head')`,
        [randomUUID(), departmentId, user.id],
      )
    } finally {
      await superuser.end()
    }

    step('POST /api/v1/auth/login')
    const loginRes = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'work.prove', password: PASSWORD }),
    })
    assertEqual(loginRes.status, 204, 'login status')
    const cookies = parseCookies(loginRes.headers.getSetCookie())
    const cookie = cookieHeader(cookies)
    const csrf = cookies['devon_csrf']!
    const headers = { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }

    step("GET /api/v1/me reports the real membership (this build's actor fix)")
    const me = (await (
      await fetch(`${server.baseUrl}/api/v1/me`, { headers: { cookie } })
    ).json()) as {
      memberships: { departmentId: string }[]
      activeDepartmentId: string | null
    }
    assertEqual(me.memberships.length, 1, 'membership count')
    assertEqual(me.activeDepartmentId, departmentId, 'activeDepartmentId')

    step('GET /api/v1/board with no cards yet')
    const boardEmpty = (await (
      await fetch(`${server.baseUrl}/api/v1/board`, { headers: { cookie } })
    ).json()) as {
      members: { userId: string }[]
    }
    assertEqual(boardEmpty.members.length, 1, 'board has exactly the one member')

    step('POST /api/v1/cards creates a card, visible on the board')
    const createRes = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Oylik hisobotni tayyorlash',
        assigneeUserId: user.id,
        giverUserId: user.id,
        priority: 'high',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        labels: [],
      }),
    })
    assertEqual(createRes.status, 201, 'create card status')
    const card = (await createRes.json()) as {
      id: string
      version: number
      checklistTotal: number
      commentCount: number
    }
    assertTrue(
      card.checklistTotal === 0 && card.commentCount === 0,
      'fresh card has no children yet',
    )

    const board = (await (
      await fetch(`${server.baseUrl}/api/v1/board`, { headers: { cookie } })
    ).json()) as {
      columns: { member: { userId: string }; cards: { id: string }[] }[]
    }
    assertEqual(board.columns[0]!.cards.length, 1, "the new card is in the assignee's column")

    // Array-binding regression (the `sql.param()` fix in `work/repo.ts`): a one-element array used
    // to render as `($1)::uuid[]` (malformed array literal), a multi-element one as
    // `($1, $2)::uuid[]` ("cannot cast type record to uuid[]") and an empty one as `()::uuid[]`
    // (syntax error). This step drives all three shapes through create AND patch.
    step(
      'labels: create two, create a card with one label, PATCH to both + a watcher, then to none',
    )
    const labelIds: string[] = []
    for (const [name, colour] of [
      ['Shoshilinch', '#dc2626'],
      ['Hisobot', '#2563eb'],
    ] as const) {
      const labelRes = await fetch(`${server.baseUrl}/api/v1/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, colour }),
      })
      assertEqual(labelRes.status, 201, `create label "${name}" status`)
      labelIds.push(((await labelRes.json()) as { id: string }).id)
    }
    const labelledRes = await fetch(`${server.baseUrl}/api/v1/cards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Yigʻilish bayonnomasini rasmiylashtirish',
        assigneeUserId: user.id,
        labels: [labelIds[0]!],
      }),
    })
    assertEqual(labelledRes.status, 201, 'create card with one label status')
    const labelled = (await labelledRes.json()) as {
      id: string
      version: number
      labels: string[]
    }
    assertEqual(labelled.labels.length, 1, 'a one-label card round-trips one label')
    assertEqual(labelled.labels[0], labelIds[0], 'the label id round-trips')
    const relabelRes = await fetch(`${server.baseUrl}/api/v1/cards/${labelled.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ labels: labelIds, watchers: [user.id], version: labelled.version }),
    })
    assertEqual(relabelRes.status, 200, 'patch labels + watchers status')
    const relabelled = (await relabelRes.json()) as {
      version: number
      labels: string[]
      watchers: string[]
    }
    assertEqual(relabelled.labels.length, 2, 'two labels after the patch')
    assertTrue(
      labelIds.every((id) => relabelled.labels.includes(id)),
      'both label ids round-trip',
    )
    assertEqual(relabelled.watchers.length, 1, 'one watcher after the patch')
    assertEqual(relabelled.watchers[0], user.id, 'the watcher id round-trips')
    const unlabelRes = await fetch(`${server.baseUrl}/api/v1/cards/${labelled.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ labels: [], version: relabelled.version }),
    })
    assertEqual(unlabelRes.status, 200, 'patch labels to empty status')
    const unlabelled = (await unlabelRes.json()) as { labels: string[] }
    assertEqual(unlabelled.labels.length, 0, 'labels cleared by an empty-array patch')

    step('POST checklist item, PATCH it done, GET card detail reflects it')
    const checklistRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}/checklist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Maʼlumotlarni yigʻish' }),
    })
    assertEqual(checklistRes.status, 201, 'checklist create status')
    const { id: itemId } = (await checklistRes.json()) as { id: string }
    const toggleRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}/checklist/${itemId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ done: true }),
    })
    assertEqual(toggleRes.status, 204, 'checklist toggle status')

    step('POST a comment with a self-mention, then GET card detail')
    const commentRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Tayyor, tekshirib chiqing.', mentions: [user.id] }),
    })
    assertEqual(commentRes.status, 201, 'comment create status')

    const detail = (await (
      await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, { headers: { cookie } })
    ).json()) as {
      checklistTotal: number
      checklistDone: number
      commentCount: number
      checklist: { doneAt: string | null }[]
      comments: { mentions: string[] }[]
      activity: { kind: string }[]
      version: number
    }
    assertEqual(detail.checklistTotal, 1, 'checklistTotal')
    assertEqual(detail.checklistDone, 1, 'checklistDone')
    assertEqual(detail.commentCount, 1, 'commentCount')
    assertTrue(detail.checklist[0]!.doneAt !== null, 'checklist item is marked done')
    assertTrue(detail.comments[0]!.mentions.includes(user.id), 'comment carries the mention')
    assertTrue(
      detail.activity.some((a) => a.kind === 'created') &&
        detail.activity.some((a) => a.kind === 'comment'),
      'activity timeline has created + comment entries',
    )

    step(
      'filter grammar: GET /cards?q=assignee:@me status:active matches; a mismatched filter does not',
    )
    const meMatch = (await (
      await fetch(
        `${server.baseUrl}/api/v1/cards?q=${encodeURIComponent('assignee:@me status:active')}`,
        {
          headers: { cookie },
        },
      )
    ).json()) as { items: { id: string }[] }
    assertTrue(
      meMatch.items.some((c) => c.id === card.id),
      'assignee:@me status:active matches the card',
    )
    const noMatch = (await (
      await fetch(`${server.baseUrl}/api/v1/cards?q=${encodeURIComponent('status:done')}`, {
        headers: { cookie },
      })
    ).json()) as { items: { id: string }[] }
    assertTrue(
      !noMatch.items.some((c) => c.id === card.id),
      'status:done does not match an active card',
    )

    step('optimistic concurrency: a stale version is rejected with 409')
    const staleRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'Stale write', version: 9999 }),
    })
    assertEqual(staleRes.status, 409, 'stale version conflict status')

    step('archive: PATCH status=archived, GET /archive shows it, POST /restore brings it back')
    const archiveRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'archived', version: card.version }),
    })
    assertEqual(archiveRes.status, 200, 'archive status')
    const archiveList = (await (
      await fetch(`${server.baseUrl}/api/v1/archive?userId=${user.id}`, { headers: { cookie } })
    ).json()) as { items: { id: string }[] }
    assertTrue(
      archiveList.items.some((c) => c.id === card.id),
      'archived card appears in /archive',
    )
    // Body `{}` mirrors the web client (`apiClient.post(..., {}, ...)` in `features/work/api.ts`):
    // Fastify rejects a body-less request that still carries `content-type: application/json`.
    const restoreRes = await fetch(`${server.baseUrl}/api/v1/cards/${card.id}/restore`, {
      method: 'POST',
      headers,
      body: '{}',
    })
    assertEqual(restoreRes.status, 204, 'restore status')

    step(
      "cross-department isolation: a second department sees none of the first department's cards",
    )
    const otherDeptId = randomUUID()
    const sharedPasswordHash = (await server.deps.findUserById(user.id))!.passwordHash
    const superuser2 = new Client({ connectionString: db.superuserUrl })
    await superuser2.connect()
    let otherUserId: string
    try {
      const otherUser = await superuser2.query<{ id: string }>(
        `insert into app.users (id, login, password_hash, given_name, family_name, role)
         values ($1, 'work.prove.other', $2, 'Bekzod', 'Yusupov', 'member') returning id`,
        [randomUUID(), sharedPasswordHash],
      )
      otherUserId = otherUser.rows[0]!.id
      await superuser2.query(
        `insert into app.departments (id, name, slug) values ($1, 'Boshqa boshqarma', 'boshqa-boshqarma')`,
        [otherDeptId],
      )
      await superuser2.query(
        `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'head')`,
        [randomUUID(), otherDeptId, otherUserId],
      )
    } finally {
      await superuser2.end()
    }
    const otherLogin = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'work.prove.other', password: PASSWORD }),
    })
    assertEqual(otherLogin.status, 204, 'second user login status')
    const otherCookie = cookieHeader(parseCookies(otherLogin.headers.getSetCookie()))
    const otherBoard = (await (
      await fetch(`${server.baseUrl}/api/v1/board`, { headers: { cookie: otherCookie } })
    ).json()) as { columns: { cards: unknown[] }[] }
    assertTrue(
      otherBoard.columns.every((c) => c.cards.length === 0),
      "the second department's board shows none of the first department's cards",
    )

    step('projects: create from the built-in template, then complete a milestone')
    const templatesRes = await fetch(`${server.baseUrl}/api/v1/projects/templates`, {
      headers: { cookie },
    })
    const templates = (await templatesRes.json()) as { key: string }[]
    assertTrue(templates.length >= 1, 'at least one project template exists')
    const fromTemplateRes = await fetch(`${server.baseUrl}/api/v1/projects/from-template`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        templateKey: templates[0]!.key,
        ownerUserId: user.id,
        members: [user.id],
      }),
    })
    assertEqual(fromTemplateRes.status, 201, 'create project from template status')
    const project = (await fromTemplateRes.json()) as {
      id: string
      milestones: { id: string }[]
      progress: number
    }
    assertEqual(project.progress, 0, 'a fresh project has zero progress')
    const milestoneRes = await fetch(
      `${server.baseUrl}/api/v1/projects/${project.id}/milestones/${project.milestones[0]!.id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ done: true }) },
    )
    assertEqual(milestoneRes.status, 200, 'milestone complete status')
    const afterMilestone = (await milestoneRes.json()) as {
      milestones: { doneAt: string | null }[]
    }
    assertTrue(afterMilestone.milestones[0]!.doneAt !== null, 'milestone marked done')

    // Same array-binding regression for `projects.members` (`sql.param()` in `projects/repo.ts`):
    // a one-member create, then a two-member patch. The second member is made a real member of
    // this department first so the data stays honest (project members are not FK-checked).
    step('projects: POST /projects with one member, then PATCH members to two')
    const superuser3 = new Client({ connectionString: db.superuserUrl })
    await superuser3.connect()
    try {
      await superuser3.query(
        `insert into app.memberships (id, department_id, user_id, role) values ($1, $2, $3, 'member')`,
        [randomUUID(), departmentId, otherUserId],
      )
    } finally {
      await superuser3.end()
    }
    const directRes = await fetch(`${server.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Yillik ish rejasi',
        ownerUserId: user.id,
        members: [user.id],
      }),
    })
    assertEqual(directRes.status, 201, 'create project status')
    const direct = (await directRes.json()) as { id: string; version: number; members: string[] }
    assertEqual(direct.members.length, 1, 'a one-member project round-trips one member')
    assertEqual(direct.members[0], user.id, 'the member id round-trips')
    const membersRes = await fetch(`${server.baseUrl}/api/v1/projects/${direct.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ members: [user.id, otherUserId], version: direct.version }),
    })
    assertEqual(membersRes.status, 200, 'patch members status')
    const widened = (await membersRes.json()) as { members: string[] }
    assertEqual(widened.members.length, 2, 'two members after the patch')
    assertTrue(widened.members.includes(otherUserId), 'the second member id round-trips')

    console.log('\nwork:prove PASSED')
  } finally {
    await server.stop()
    await db.stop()
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
