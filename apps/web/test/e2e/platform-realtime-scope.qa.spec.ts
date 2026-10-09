import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  stripSecureCookies,
  uniqueLogin,
} from './flow-api.js'
import { adaptLocalUiDepartmentCookie, adaptLocalUiSessionCookies } from './flow-ui-cookies.js'
import { settleCapture } from './platform-capture.js'

function observe(page: Page) {
  const wire = {
    connections: 0,
    closed: 0,
    subscribed: [] as string[],
    configured: [] as { personal: string; department: string }[],
    publications: [] as { channel: string; type: string; payload: Record<string, unknown> }[],
    errors: [] as string[],
  }
  page.on('pageerror', (error) => wire.errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() === 200 && new URL(response.url()).pathname === '/api/v1/realtime/config')
      void response
        .json()
        .then((value) => wire.configured.push(value.channels))
        .catch(() => {})
  })
  page.on('websocket', (socket) => {
    socket.on('close', () => wire.closed++)
    socket.on('framereceived', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
          if (row?.connect?.client) wire.connections++
          if (row?.push?.pub?.data?.type)
            wire.publications.push({ channel: row.push.channel, ...row.push.pub.data })
        }
      }
    })
    socket.on('framesent', ({ payload }) => {
      for (const line of payload.toString().split('\n')) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        for (const row of Array.isArray(parsed) ? parsed : [parsed])
          if (row?.subscribe?.channel) wire.subscribed.push(row.subscribe.channel)
      }
    })
  })
  return wire
}

async function english(context: BrowserContext) {
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
}

async function createPage(context: BrowserContext, title: string) {
  const response = await authedPost(context, '/api/v1/pages', {
    kind: 'note',
    title,
    blocks: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }],
    },
  })
  expect(response.status()).toBe(201)
  return response.json() as Promise<{ id: string; title: string }>
}

async function fixture(browser: Browser) {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('scope.head'),
      headPassword: examplePassword(),
      departmentName: `Scope department ${randomUUID()}`,
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('scope.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await Promise.all([english(head), english(member)])
    const memberId = (await (await member.request.get('/api/v1/me')).json()).user.id as string
    return {
      admin,
      head,
      member,
      memberId,
      department,
      close: () => Promise.all([admin.close(), head.close(), member.close()]),
    }
  } catch (error) {
    await Promise.all([admin.close(), head.close(), member.close()])
    throw error
  }
}

test('@qa sign out closes the old broker and replacement login cannot inherit its private page', async ({
  browser,
}) => {
  const f = await fixture(browser)
  const replacement = await newFlowContext(browser)
  try {
    const credentials = { login: uniqueLogin('scope.replacement'), password: examplePassword() }
    await registerUser(replacement, {
      ...credentials,
      givenName: 'Replacement',
      familyName: 'Synthetic',
    })
    await english(replacement)
    const replacementId = (await (await replacement.request.get('/api/v1/me')).json()).user.id
    const record = await createPage(f.head, `Private old session ${randomUUID()}`)
    const page = await f.member.newPage()
    const wire = observe(page)
    await adaptLocalUiSessionCookies(f.member)
    await page.goto(`/pages?page=${record.id}`)
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      record.title,
    )
    await expect.poll(() => wire.connections).toBe(1)
    await page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/login\?signedOut=1$/)
    await expect.poll(() => wire.closed).toBe(1)
    expect((await f.member.request.get('/api/v1/me')).status()).toBe(401)
    await page.getByRole('textbox', { name: 'Login or email', exact: true }).fill(credentials.login)
    await page.getByLabel('Password', { exact: true }).fill(credentials.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await stripSecureCookies(f.member)
    expect((await (await f.member.request.get('/api/v1/me')).json()).user.id).toBe(replacementId)
    await expect.poll(() => wire.configured.at(-1)?.personal).toBe(`personal#${replacementId}`)
    expect(wire.configured.at(-1)?.department).toBe('')
    await expect.poll(() => wire.connections).toBe(2)
    await expect(
      page.getByRole('heading', { name: 'You are not in a department yet', exact: true }),
    ).toBeVisible()
    expect((await f.member.request.get(`/api/v1/pages/${record.id}`)).status()).toBe(403)
    await page.goto(`/pages?page=${record.id}`)
    await expect(
      page.getByRole('heading', { name: 'You are not in a department yet', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0)
    await expect(page.getByText(record.title, { exact: true })).toHaveCount(0)
    await expect(
      page.locator('main').getByRole('button', { name: 'Departments', exact: true }),
    ).toBeVisible()
    await settleCapture(page, false)
    expect(wire.errors).toEqual([])
    await page.screenshot({
      path: test.info().outputPath('replacement-denied-old-page.png'),
      fullPage: true,
    })
    await test.info().attach('account-scope-wire', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    })
    await page.locator('main').getByRole('button', { name: 'Departments', exact: true }).click()
    await expect(page).toHaveURL(/\/departments$/)
  } finally {
    await Promise.all([f.close(), replacement.close()])
  }
})

test('@qa removal from an open department drops its socket scope and exposes only the remaining membership', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const f = await fixture(browser)
  const secondHead = await newFlowContext(browser)
  try {
    const second = await createApprovedDepartment(secondHead, f.admin, {
      headLogin: uniqueLogin('scope.secondhead'),
      headPassword: examplePassword(),
      departmentName: `Remaining department ${randomUUID()}`,
    })
    expect(
      (
        await authedPost(f.member, '/api/v1/departments/join', {
          key: second.joinKey,
          password: second.joinPassword,
        })
      ).status(),
    ).toBe(200)
    await adaptLocalUiDepartmentCookie(f.member)
    const old = await createPage(f.head, `Revoked department page ${randomUUID()}`)
    const other = await createPage(secondHead, `Remaining department page ${randomUUID()}`)
    const page = await f.member.newPage()
    const wire = observe(page)
    await page.goto(`/pages?page=${old.id}`)
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(old.title)
    await expect.poll(() => wire.connections).toBe(1)
    await expect.poll(() => wire.subscribed).toContain(`dept:${f.department.departmentId}`)
    expect(
      (
        await authedPost(
          f.head,
          `/api/v1/departments/${f.department.departmentId}/members/${f.memberId}/remove`,
          {},
        )
      ).status(),
    ).toBe(204)
    await expect.poll(() => wire.configured.at(-1)?.department).toBe(`dept:${second.departmentId}`)
    await expect.poll(() => wire.closed).toBeGreaterThan(0)
    await expect.poll(() => wire.subscribed).toContain(`dept:${second.departmentId}`)
    const me = await (await f.member.request.get('/api/v1/me')).json()
    expect(me.memberships.map((row: { departmentId: string }) => row.departmentId)).toEqual([
      second.departmentId,
    ])
    expect(me.activeDepartmentId).toBe(second.departmentId)
    expect((await f.member.request.get(`/api/v1/pages/${old.id}`)).status()).toBe(404)
    expect(
      (
        await authedPost(f.member, '/api/v1/realtime/subscribe-token', {
          channel: `dept:${f.department.departmentId}`,
        })
      ).status(),
    ).toBe(403)
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0)
    await page.goto('/pages')
    await expect(page.getByText(other.title, { exact: true })).toBeVisible()
    await expect(page.getByText(old.title, { exact: true })).toHaveCount(0)
    const before = wire.publications.length
    const oldLate = await createPage(f.head, `After revoked membership ${randomUUID()}`)
    const allowedLate = await createPage(secondHead, `After remaining membership ${randomUUID()}`)
    await expect
      .poll(() =>
        wire.publications.slice(before).some((row) => row.payload['pageId'] === allowedLate.id),
      )
      .toBe(true)
    expect(
      wire.publications.slice(before).some((row) => row.payload['pageId'] === oldLate.id),
    ).toBe(false)
    await expect(page.getByText(allowedLate.title, { exact: true })).toBeVisible()
    expect(wire.errors).toEqual([])
    await page.screenshot({
      path: test.info().outputPath('remaining-department-only.png'),
      fullPage: true,
    })
    await test.info().attach('revoked-scope-wire', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await Promise.all([f.close(), secondHead.close()])
  }
})

test('@qa head transfer updates another open tab while preserving former head work-board access', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.head.newPage()
    const wire = observe(page)
    await page.goto('/pages?tab=onboarding')
    await expect(page.getByRole('button', { name: 'New checklist', exact: true })).toBeVisible()
    await expect.poll(() => wire.connections).toBe(1)
    expect(
      (
        await authedPost(
          f.head,
          `/api/v1/departments/${f.department.departmentId}/members/${f.memberId}/transfer-headship`,
          {},
        )
      ).status(),
    ).toBe(204)
    await expect
      .poll(() => wire.publications.some((row) => row.type === 'departments.membership.changed'))
      .toBe(true)
    await expect(page.getByRole('button', { name: 'New checklist', exact: true })).toHaveCount(0)
    const me = await (await f.head.request.get('/api/v1/me')).json()
    expect(me.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: f.department.departmentId, role: 'member' }),
      ]),
    )
    await expect(page.locator('a[href="/work"]').first()).toBeVisible()
    expect(
      (
        await authedPost(f.head, '/api/v1/pages/onboarding/templates', {
          name: 'Former head refused',
          items: [],
          enabled: true,
        })
      ).status(),
    ).toBe(403)
    expect((await f.head.request.get('/api/v1/board')).status()).toBe(200)
    expect(wire.errors).toEqual([])
    await page.screenshot({
      path: test.info().outputPath('former-head-current-role.png'),
      fullPage: true,
    })
    await test.info().attach('head-transfer-scope-wire', {
      body: JSON.stringify(wire, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await f.close()
  }
})
