import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test, expect, type Browser, type BrowserContext } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  login,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import {
  FLOW_WEB_BASE_URL,
  FLOW_DB_NAME,
  FLOW_DB_HOST,
  FLOW_DB_PORT,
  FLOW_DB_CONTAINER,
} from './flow-env.js'
import { assertLocalTestDatabase } from './flow-safety.js'
import { assertLocalDockerEndpoint } from './flow-services.js'

const evidence = join(import.meta.dirname, '../../../../artifacts/qa/2026-10/departments')

function ownedFixtureSql(statement: string) {
  assertLocalTestDatabase({
    host: FLOW_DB_HOST,
    port: FLOW_DB_PORT,
    container: FLOW_DB_CONTAINER,
    database: FLOW_DB_NAME,
  })
  if (FLOW_DB_NAME !== 'devon_flow_e2e_departments')
    throw new Error('Receipt proof requires the owned department namespace')
  const docker = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
  if (docker.status !== 0) throw new Error('Cannot verify local Docker context')
  assertLocalDockerEndpoint(docker.stdout.trim())
  if (process.env['DOCKER_HOST']) assertLocalDockerEndpoint(process.env['DOCKER_HOST'])
  const query = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      FLOW_DB_CONTAINER,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      FLOW_DB_NAME,
      '-At',
    ],
    {
      input: statement,
      encoding: 'utf8',
      timeout: 30_000,
    },
  )
  if (query.status !== 0) throw new Error('Owned membership state read failed')
  return query.stdout.trim()
}

function membershipState(departmentId: string, userId: string) {
  if (![departmentId, userId].every((value) => /^[0-9a-f-]{36}$/i.test(value)))
    throw new Error('Invalid fixture identifier')
  return JSON.parse(
    ownedFixtureSql(`select json_build_object('status', m.status, 'role', m.role, 'version', m.version,
      'userStatus', u.status, 'decisions', (select count(*) from audit.events a where a.department_id = m.department_id and a.subject_id = m.user_id::text and a.action in ('departments.join_approved','departments.join_rejected','departments.join_decision_undone')),
      'outboxChanges', (select count(*) from app.outbox_events o where o.department_id = m.department_id and o.type = 'departments.membership.changed' and o.payload->>'userId' = m.user_id::text))
      from app.memberships m join app.users u on u.id = m.user_id where m.department_id = '${departmentId}' and m.user_id = '${userId}' and m.deleted_at is null;`),
  ) as {
    status: string
    role: string
    version: number
    userStatus: string
    decisions: number
    outboxChanges: number
  }
}

async function pendingFixture(browser: Browser) {
  const f = await fixture(browser)
  const id = f.department.departmentId
  expect(
    (
      await authedPatch(f.head.context, `/api/v1/departments/${id}/invite/approval`, {
        joinRequiresApproval: true,
      })
    ).status(),
  ).toBe(204)
  const joined = await authedPost(f.member.context, '/api/v1/departments/join', {
    key: f.department.joinKey,
    password: f.department.joinPassword,
  })
  expect(joined.status()).toBe(200)
  expect((await joined.json()).status).toBe('pending_approval')
  return f
}

async function guardedContext(browser: Browser) {
  const context = await newFlowContext(browser)
  await context.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
  const foreign: string[] = []
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === FLOW_WEB_BASE_URL) await route.continue()
    else {
      foreign.push(url.hostname)
      await route.abort('blockedbyclient')
    }
  })
  return { context, foreign }
}

async function fixture(browser: Browser) {
  const admin = await guardedContext(browser)
  const head = await guardedContext(browser)
  const member = await guardedContext(browser)
  await loginAsSuperAdmin(admin.context)
  const department = await createApprovedDepartment(head.context, admin.context, {
    headLogin: uniqueLogin('dept.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic department QA',
  })
  expect((await authedPatch(head.context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const username = uniqueLogin('dept.member')
  const password = examplePassword()
  await registerUser(member.context, {
    login: username,
    password,
    givenName: 'Synthetic',
    familyName: 'Member',
  })
  expect((await authedPatch(member.context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const memberId = (await (await member.context.request.get('/api/v1/me')).json()).user.id as string
  return {
    admin,
    head,
    member,
    department,
    username,
    password,
    memberId,
    async close() {
      expect([...admin.foreign, ...head.foreign, ...member.foreign]).toEqual([])
      await Promise.all([admin.context.close(), head.context.close(), member.context.close()])
    },
  }
}

async function readDepartment(context: BrowserContext, id: string) {
  const response = await context.request.get(`/api/v1/departments/${id}`)
  expect(response.status()).toBe(200)
  return response.json()
}

test('permission draft survives an unrelated feature save and transport failure, then persists on retry', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}`)
    const selfAssign = page.getByRole('switch', {
      name: 'Members can assign themselves to units',
      exact: true,
    })
    await expect(selfAssign).toBeChecked()
    await selfAssign.click()
    const updated = page.waitForResponse(
      (r) => r.request().method() === 'PUT' && new URL(r.url()).pathname.endsWith('/features'),
    )
    await page.getByRole('switch', { name: 'Time estimates', exact: true }).click()
    expect((await updated).status()).toBe(200)
    await expect(page.getByRole('switch', { name: 'Time estimates', exact: true })).toBeChecked()
    expect((await readDepartment(f.head.context, id)).settings.features.estimates).toBe(true)
    // Feature invalidation must not replace a permission the head has not saved yet.
    await expect(selfAssign).not.toBeChecked()
    await page.route(`**/api/v1/departments/${id}/settings`, (route) =>
      route.abort('connectionfailed'),
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Could not save')
    await expect(selfAssign).not.toBeChecked()
    expect((await readDepartment(f.head.context, id)).settings.allowSelfAssign).toBe(true)
    await page.unroute(`**/api/v1/departments/${id}/settings`)
    const saved = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith('/settings'),
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(204)
    expect((await readDepartment(f.head.context, id)).settings.allowSelfAssign).toBe(false)
    await page.reload()
    await expect(selfAssign).not.toBeChecked()
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-permissions.png`),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('invitation rotation reports an interrupted request, copies an explicit raw key and retires the old key', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=invite`)
    await expect(page.getByRole('textbox', { name: 'Key', exact: true })).toHaveValue(
      f.department.joinKey,
    )
    await expect(page.getByRole('button', { name: 'Copy key', exact: true })).toBeVisible()
    await page.route(`**/api/v1/departments/${id}/invite/rotate-key`, (route) =>
      route.abort('connectionfailed'),
    )
    await page.getByRole('button', { name: 'Rotate key', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Rotate key', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Could not save')
    expect(
      (await (await f.head.context.request.get(`/api/v1/departments/${id}/invite`)).json()).joinKey,
    ).toBe(f.department.joinKey)
    await page.unroute(`**/api/v1/departments/${id}/invite/rotate-key`)
    const rotated = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/invite/rotate-key'),
    )
    await dialog.getByRole('button', { name: 'Rotate key', exact: true }).click()
    expect((await rotated).status()).toBe(200)
    await expect(dialog).not.toBeVisible()
    const current = (
      await (await f.head.context.request.get(`/api/v1/departments/${id}/invite`)).json()
    ).joinKey as string
    expect(current).not.toBe(f.department.joinKey)
    await expect(page.getByRole('textbox', { name: 'Key', exact: true })).toHaveValue(current)
    expect(
      (
        await f.member.context.request.get(`/api/v1/departments/join/${f.department.joinKey}`)
      ).status(),
    ).toBe(404)
    expect(
      (await f.member.context.request.get(`/api/v1/departments/join/${current}`)).status(),
    ).toBe(200)
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-invite.png`),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('join transport failure preserves the invitation and password for a real retry', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.member.context.newPage()
    await page.goto(`/join?key=${f.department.joinKey}`)
    await page.getByLabel('Password', { exact: true }).fill(f.department.joinPassword)
    await page.route('**/api/v1/departments/join', (route) => route.abort('connectionfailed'))
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'Could not complete the request. Check your connection and try again.',
    )
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
      f.department.joinPassword,
    )
    expect(
      (
        await (
          await f.head.context.request.get(
            `/api/v1/departments/${f.department.departmentId}/members`,
          )
        ).json()
      ).members,
    ).toHaveLength(1)
    await page.unroute('**/api/v1/departments/join')
    const joined = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/v1/departments/join',
    )
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    expect((await joined).status()).toBe(200)
    await expect(
      page.getByRole('heading', { name: "You've joined the department", exact: true }),
    ).toBeVisible()
    expect(
      (
        await (
          await f.head.context.request.get(
            `/api/v1/departments/${f.department.departmentId}/members`,
          )
        ).json()
      ).members,
    ).toHaveLength(2)
  } finally {
    await f.close()
  }
})

test('member cannot mutate head settings and privileged deep links show the permitted general tab', async ({
  browser,
}, info) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    expect(
      (
        await authedPatch(f.member.context, `/api/v1/departments/${id}/settings`, {
          allowSelfAssign: false,
        })
      ).status(),
    ).toBe(403)
    expect((await f.member.context.request.get(`/api/v1/departments/${id}/invite`)).status()).toBe(
      403,
    )
    const page = await f.member.context.newPage()
    await page.goto(`/department?id=${id}&tab=invite`)
    await expect(page.getByRole('heading', { name: 'Permissions', exact: true })).toBeVisible()
    await expect(
      page.getByRole('switch', { name: 'Members can assign themselves to units', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Invite', exact: true })).toHaveCount(0)
    expect((await readDepartment(f.head.context, id)).settings.allowSelfAssign).toBe(true)
    mkdirSync(evidence, { recursive: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: join(evidence, `${info.project.name}-member-readonly.png`),
      fullPage: true,
    })
  } finally {
    await f.close()
  }
})

test('head password reset reports a transport failure before returning a working temporary password', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    await page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Issue temporary password', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const endpoint = `**/api/v1/departments/${id}/members/${f.memberId}/reset-password`
    await page.route(endpoint, (route) => route.abort('connectionfailed'))
    await dialog.getByRole('button', { name: 'Issue temporary password', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Could not save')
    expect((await f.member.context.request.get('/api/v1/me')).status()).toBe(200)
    await page.unroute(endpoint)
    const reset = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/reset-password'))
    await dialog.getByRole('button', { name: 'Issue temporary password', exact: true }).click()
    const response = await reset
    expect(response.status()).toBe(200)
    const temporaryPassword = (await response.json()).temporaryPassword as string
    await expect(dialog.locator('code')).toHaveText(temporaryPassword)
    expect((await f.member.context.request.get('/api/v1/me')).status()).toBe(401)
    const loggedIn = await f.member.context.request.post('/api/v1/auth/login', {
      data: { login: f.username, password: temporaryPassword },
    })
    expect(loggedIn.status()).toBe(204)
    // The reset route is real; separate account journeys prove changing this temporary password.
  } finally {
    await f.close()
  }
})

test('department deletion request requires its name and exposes failed transport without changing state', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=danger`)
    await page.getByRole('button', { name: 'Request department deletion', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', { name: 'Request department deletion', exact: true })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill('Synthetic department QA')
    await page.route(`**/api/v1/departments/${id}/deletion-request`, (route) =>
      route.abort('connectionfailed'),
    )
    await confirm.click()
    await expect(dialog.getByRole('alert')).toHaveText('Could not save')
    expect((await readDepartment(f.head.context, id)).status).toBe('active')
    await page.unroute(`**/api/v1/departments/${id}/deletion-request`)
    const requested = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/deletion-request'),
    )
    await confirm.click()
    expect((await requested).status()).toBe(204)
    await expect(dialog).not.toBeVisible()
    expect((await readDepartment(f.head.context, id)).status).toBe('deletion_requested')
  } finally {
    await f.close()
  }
})

test('reopening a member confirmation starts without the previous transport error', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    const openReset = async () => {
      await page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Issue temporary password', exact: true }).click()
    }
    await openReset()
    const endpoint = `**/api/v1/departments/${id}/members/${f.memberId}/reset-password`
    await page.route(endpoint, (route) => route.abort('connectionfailed'))
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Issue temporary password', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Could not save')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.unroute(endpoint)
    await openReset()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    const reset = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/reset-password'))
    await dialog.getByRole('button', { name: 'Issue temporary password', exact: true }).click()
    expect((await reset).status()).toBe(200)
    await expect(dialog.locator('code')).toBeVisible()
    expect((await f.member.context.request.get('/api/v1/me')).status()).toBe(401)
  } finally {
    await f.close()
  }
})

test('head transfer immediately refreshes permissions before the former head leaves', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    await page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Transfer headship', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const transferred = page.waitForResponse((r) =>
      new URL(r.url()).pathname.endsWith('/transfer-headship'),
    )
    await dialog.getByRole('button', { name: 'Transfer headship', exact: true }).click()
    expect((await transferred).status()).toBe(204)
    await expect(dialog).not.toBeVisible()
    expect((await readDepartment(f.head.context, id)).myRole).toBe('member')
    expect((await readDepartment(f.member.context, id)).myRole).toBe('head')
    await expect(page.getByRole('tab', { name: 'Invite', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Danger zone', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Leave department', exact: true }).click()
    const left = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/leave'))
    await dialog.getByRole('button', { name: 'Leave department', exact: true }).click()
    expect((await left).status()).toBe(204)
    await expect(page).toHaveURL(`${FLOW_WEB_BASE_URL}/departments`)
    const roster = await f.member.context.request.get(`/api/v1/departments/${id}/members`)
    expect(
      (await roster.json()).members.filter((m: { status: string }) => m.status === 'active'),
    ).toHaveLength(1)
  } finally {
    await f.close()
  }
})

test('pending confirmation may close while another destructive action stays blocked until the actual response', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let received!: () => void
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  let submitted = 0
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    const endpoint = `**/api/v1/departments/${id}/members/${f.memberId}/reset-password`
    await page.route(endpoint, async (route) => {
      submitted += 1
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Issue temporary password', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Issue temporary password', exact: true }).click()
    await committed
    expect((await f.member.context.request.get('/api/v1/me')).status()).toBe(401)
    await expect(dialog.getByRole('status')).toHaveText(
      'This action is still running. You can close this window; closing does not cancel it.',
    )
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .filter({ hasText: /^Close$/ })
      .click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Leave department', exact: true })).toBeDisabled()
    expect(submitted).toBe(1)
    release()
    await expect(dialog.locator('code')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }),
    ).toBeEnabled()
    expect(submitted).toBe(1)
  } finally {
    release()
    await f.close()
  }
})

test('pending member removal stays blocked across tab remounts and reconciles its committed result', async ({
  browser,
}) => {
  const f = await fixture(browser)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let received!: () => void
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  let submitted = 0
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    await page.route(`**/api/v1/departments/${id}/members/${f.memberId}/remove`, async (route) => {
      submitted += 1
      const actual = await route.fetch()
      expect(actual.status()).toBe(204)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await committed
    expect((await f.member.context.request.get(`/api/v1/departments/${id}`)).status()).toBe(403)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await page.getByRole('tab', { name: 'General', exact: true }).click()
    await page.getByRole('tab', { name: 'Members', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Leave department', exact: true })).toBeDisabled()
    await page.getByRole('tab', { name: 'Danger zone', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Request department deletion', exact: true }),
    ).toBeDisabled()
    release()
    await expect(
      page.getByRole('button', { name: 'Request department deletion', exact: true }),
    ).toBeEnabled()
    await page.getByRole('tab', { name: 'Members', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Actions for Synthetic Member', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Leave department', exact: true })).toBeEnabled()
    await expect(dialog).not.toBeVisible()
    expect(submitted).toBe(1)
  } finally {
    release()
    await f.close()
  }
})

test('join decision controls respect another pending department action after tab remount', async ({
  browser,
}) => {
  const f = await pendingFixture(browser)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let received!: () => void
  const committed = new Promise<void>((resolve) => {
    received = resolve
  })
  try {
    const id = f.department.departmentId
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=invite`)
    await page.route(`**/api/v1/departments/${id}/invite/rotate-key`, async (route) => {
      const actual = await route.fetch()
      expect(actual.status()).toBe(200)
      received()
      await gate
      await route.fulfill({ response: actual })
    })
    await page.getByRole('button', { name: 'Rotate key', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Rotate key', exact: true }).click()
    await committed
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await page.getByRole('tab', { name: 'Members', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled()
    release()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled()
    const approved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/approve'))
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    expect((await approved).status()).toBe(204)
    expect(membershipState(id, f.memberId).status).toBe('active')
  } finally {
    release()
    await f.close()
  }
})

test('a late join approval Undo cannot revive a member removed by another committed operation', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const id = f.department.departmentId
    expect(
      (
        await authedPatch(f.head.context, `/api/v1/departments/${id}/invite/approval`, {
          joinRequiresApproval: true,
        })
      ).status(),
    ).toBe(204)
    const joined = await authedPost(f.member.context, '/api/v1/departments/join', {
      key: f.department.joinKey,
      password: f.department.joinPassword,
    })
    expect(joined.status()).toBe(200)
    expect((await joined.json()).status).toBe('pending_approval')
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    const approved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/approve'))
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    expect((await approved).status()).toBe(204)
    // A concurrent head operation commits while the older approval toast still offers Undo.
    expect(
      (
        await authedPost(
          f.head.context,
          `/api/v1/departments/${id}/members/${f.memberId}/remove`,
          {},
        )
      ).status(),
    ).toBe(204)
    expect((await f.member.context.request.get(`/api/v1/departments/${id}`)).status()).toBe(403)
    const undone = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/undo'))
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect((await undone).status()).toBe(409)
    const roster = await f.head.context.request.get(`/api/v1/departments/${id}/members`)
    expect(
      (await roster.json()).members.find((m: { userId: string }) => m.userId === f.memberId).status,
    ).toBe('removed')
    expect((await f.member.context.request.get(`/api/v1/departments/${id}`)).status()).toBe(403)
  } finally {
    await f.close()
  }
})

test('join decision receipts allow immediate UI Undo once and refuse malformed, wrong-state and superseded receipts', async ({
  browser,
}) => {
  const f = await pendingFixture(browser)
  try {
    const id = f.department.departmentId
    const base = `/api/v1/departments/${id}/join-requests/${f.memberId}`
    const initial = membershipState(id, f.memberId)
    expect(initial.status).toBe('pending_approval')
    const requests = await f.head.context.request.get(`/api/v1/departments/${id}/join-requests`)
    expect(
      (await requests.json()).requests.find((r: { userId: string }) => r.userId === f.memberId)
        .version,
    ).toBe(initial.version)
    expect((await authedPost(f.head.context, `${base}/undo`, {})).status()).toBe(409)
    expect(
      (await authedPost(f.head.context, `${base}/approve`, { expectedVersion: 0 })).status(),
    ).toBe(422)
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, {
          expectedVersion: initial.version + 1,
        })
      ).status(),
    ).toBe(409)
    expect(membershipState(id, f.memberId)).toEqual(initial)
    const page = await f.head.context.newPage()
    await page.goto(`/department?id=${id}&tab=members`)
    const approved = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/approve'))
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    expect((await approved).status()).toBe(204)
    const approvedState = membershipState(id, f.memberId)
    expect(approvedState).toMatchObject({
      status: 'active',
      version: initial.version + 1,
      decisions: initial.decisions + 1,
    })
    const undo = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/undo'))
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect((await undo).status()).toBe(204)
    const restored = membershipState(id, f.memberId)
    expect(restored).toMatchObject({
      status: 'pending_approval',
      version: initial.version + 2,
      decisions: initial.decisions + 2,
      outboxChanges: initial.outboxChanges + 1,
    })
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: approvedState.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: restored.version,
          originalDecision: 'reject',
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await authedPost(f.head.context, `${base}/reject`, { expectedVersion: restored.version })
      ).status(),
    ).toBe(204)
    const rejected = membershipState(id, f.memberId)
    expect(rejected.status).toBe('removed')
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: rejected.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect(membershipState(id, f.memberId)).toEqual(rejected)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: rejected.version,
          originalDecision: 'reject',
        })
      ).status(),
    ).toBe(204)
    const pending = membershipState(id, f.memberId)
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, { expectedVersion: pending.version })
      ).status(),
    ).toBe(204)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: approvedState.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect((await f.member.context.request.get(`/api/v1/departments/${id}`)).status()).toBe(200)
  } finally {
    await f.close()
  }
})

test('concurrent join decisions and duplicate Undo have one winner and removal remains final', async ({
  browser,
}) => {
  const f = await pendingFixture(browser)
  try {
    const id = f.department.departmentId
    const base = `/api/v1/departments/${id}/join-requests/${f.memberId}`
    const initial = membershipState(id, f.memberId)
    const decisions = await Promise.all([
      authedPost(f.head.context, `${base}/approve`, { expectedVersion: initial.version }),
      authedPost(f.head.context, `${base}/reject`, { expectedVersion: initial.version }),
    ])
    expect(decisions.map((r) => r.status()).sort()).toEqual([204, 409])
    const decided = membershipState(id, f.memberId)
    expect(decided.version).toBe(initial.version + 1)
    expect(decided.decisions).toBe(initial.decisions + 1)
    const originalDecision = decided.status === 'active' ? 'approve' : 'reject'
    const undos = await Promise.all([
      authedPost(f.head.context, `${base}/undo`, {
        expectedVersion: decided.version,
        originalDecision,
      }),
      authedPost(f.head.context, `${base}/undo`, {
        expectedVersion: decided.version,
        originalDecision,
      }),
    ])
    expect(undos.map((r) => r.status()).sort()).toEqual([204, 409])
    const pending = membershipState(id, f.memberId)
    expect(pending).toMatchObject({
      status: 'pending_approval',
      version: initial.version + 2,
      decisions: initial.decisions + 2,
    })
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, { expectedVersion: pending.version })
      ).status(),
    ).toBe(204)
    const active = membershipState(id, f.memberId)
    const racing = await Promise.all([
      authedPost(f.head.context, `${base}/undo`, {
        expectedVersion: active.version,
        originalDecision: 'approve',
      }),
      authedPost(f.head.context, `/api/v1/departments/${id}/members/${f.memberId}/remove`, {}),
    ])
    expect([204, 409]).toContain(racing[0]!.status())
    expect(racing[1]!.status()).toBe(204)
    expect(membershipState(id, f.memberId).status).toBe('removed')
    expect((await f.member.context.request.get(`/api/v1/departments/${id}`)).status()).toBe(403)
  } finally {
    await f.close()
  }
})

test('account lock, leave, rejoin and head transfer invalidate old join Undo receipts', async ({
  browser,
}) => {
  const f = await pendingFixture(browser)
  try {
    const id = f.department.departmentId
    const base = `/api/v1/departments/${id}/join-requests/${f.memberId}`
    let row = membershipState(id, f.memberId)
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, { expectedVersion: row.version })
      ).status(),
    ).toBe(204)
    const original = membershipState(id, f.memberId)
    expect(
      (
        await authedPost(f.admin.context, `/api/v1/admin/accounts/${f.memberId}/lock`, {
          reason: 'Synthetic receipt guard QA',
        })
      ).status(),
    ).toBe(204)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: original.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await authedPost(f.admin.context, `/api/v1/admin/accounts/${f.memberId}/unlock`, {})
      ).status(),
    ).toBe(204)
    row = membershipState(id, f.memberId)
    expect(row.version).toBe(original.version + 2)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: original.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    await login(f.member.context, { login: f.username, password: f.password })
    expect(
      (await authedPost(f.member.context, `/api/v1/departments/${id}/leave`, {})).status(),
    ).toBe(204)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: original.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect(
      (
        await authedPost(f.member.context, '/api/v1/departments/join', {
          key: f.department.joinKey,
          password: f.department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    const rejoined = membershipState(id, f.memberId)
    expect(rejoined).toMatchObject({ status: 'pending_approval', version: original.version + 4 })
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, { expectedVersion: rejoined.version })
      ).status(),
    ).toBe(204)
    const latest = membershipState(id, f.memberId)
    expect(
      (
        await authedPost(
          f.head.context,
          `/api/v1/departments/${id}/members/${f.memberId}/transfer-headship`,
          {},
        )
      ).status(),
    ).toBe(204)
    expect(membershipState(id, f.memberId)).toMatchObject({
      role: 'head',
      version: latest.version + 1,
    })
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: latest.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await authedPost(f.member.context, `${base}/undo`, {
          expectedVersion: latest.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(409)
    expect(membershipState(id, f.memberId)).toMatchObject({ status: 'active', role: 'head' })
  } finally {
    await f.close()
  }
})

test('join Undo rolls back membership, audit and outbox together when its actual outbox insert fails', async ({
  browser,
}) => {
  const f = await pendingFixture(browser)
  const id = f.department.departmentId
  const base = `/api/v1/departments/${id}/join-requests/${f.memberId}`
  const trigger = `qa_join_undo_reject_${f.memberId.replaceAll('-', '')}`
  try {
    const pending = membershipState(id, f.memberId)
    expect(
      (
        await authedPost(f.head.context, `${base}/approve`, { expectedVersion: pending.version })
      ).status(),
    ).toBe(204)
    const active = membershipState(id, f.memberId)
    // This target-scoped fixture trigger fails the real transaction's final outbox insertion.
    // It never modifies application production code or another namespace/target's behavior.
    ownedFixtureSql(`create function app.${trigger}() returns trigger language plpgsql as $$ begin
      if new.type = 'departments.membership.changed' and new.payload->>'userId' = '${f.memberId}' then
        raise exception 'Synthetic join Undo outbox failure' using errcode = '23514';
      end if; return new; end $$;
      create trigger ${trigger} before insert on app.outbox_events for each row execute function app.${trigger}();`)
    const failed = await authedPost(f.head.context, `${base}/undo`, {
      expectedVersion: active.version,
      originalDecision: 'approve',
    })
    expect(failed.status()).toBe(500)
    expect(membershipState(id, f.memberId)).toEqual(active)
    ownedFixtureSql(`drop trigger ${trigger} on app.outbox_events; drop function app.${trigger}();`)
    expect(
      (
        await authedPost(f.head.context, `${base}/undo`, {
          expectedVersion: active.version,
          originalDecision: 'approve',
        })
      ).status(),
    ).toBe(204)
    expect(membershipState(id, f.memberId)).toMatchObject({
      status: 'pending_approval',
      version: active.version + 1,
      decisions: active.decisions + 1,
      outboxChanges: active.outboxChanges + 1,
    })
  } finally {
    ownedFixtureSql(
      `drop trigger if exists ${trigger} on app.outbox_events; drop function if exists app.${trigger}();`,
    )
    await f.close()
  }
})
