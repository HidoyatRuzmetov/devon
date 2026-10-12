import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_DB_NAME, FLOW_WEB_BASE_URL } from './flow-env.js'

if (FLOW_DB_NAME !== 'devon_flow_e2e_invite_password') {
  throw new Error('Invitation password journeys require their exact owned local namespace')
}

type Observation = { method: string; path: string; status: number }

async function fixture(browser: Browser) {
  const contexts: BrowserContext[] = []
  const foreign: string[] = []
  const pageerrors: string[] = []
  const responses: Observation[] = []
  async function context() {
    const value = await newFlowContext(browser)
    contexts.push(value)
    await value.addCookies([{ name: 'wp_locale', value: 'en', url: FLOW_WEB_BASE_URL }])
    await value.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === FLOW_WEB_BASE_URL) await route.continue()
      else {
        foreign.push(url.hostname)
        await route.abort('blockedbyclient')
      }
    })
    value.on('page', (page) => {
      page.on('pageerror', (error) => pageerrors.push(error.message))
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        if (path.includes('/invite/') || path === '/api/v1/departments/join') {
          responses.push({ method: response.request().method(), path, status: response.status() })
        }
      })
    })
    return value
  }
  const admin = await context()
  const head = await context()
  await loginAsSuperAdmin(admin)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('invite.head'),
    headPassword: examplePassword(),
    departmentName: 'Synthetic invitation password QA',
  })
  expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  async function newcomer() {
    const value = await context()
    await registerUser(value, {
      login: uniqueLogin('invite.member'),
      password: examplePassword(),
      givenName: 'Synthetic',
      familyName: 'Invite member',
    })
    expect((await authedPatch(value, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = await value.request.get('/api/v1/me')
    expect(me.status()).toBe(200)
    const userId = ((await me.json()) as { user: { id: string } }).user.id
    return { context: value, userId }
  }
  return {
    head,
    department,
    newcomer,
    responses,
    async readInvite() {
      const response = await head.request.get(
        `/api/v1/departments/${department.departmentId}/invite`,
      )
      expect(response.status()).toBe(200)
      const body = (await response.json()) as Record<string, unknown>
      expect(body['joinKey']).toBe(department.joinKey)
      expect(body['hasPassword']).toBe(true)
      expect(body).not.toHaveProperty('password')
      return body
    },
    async memberExists(userId: string, present: boolean) {
      const response = await head.request.get(
        `/api/v1/departments/${department.departmentId}/members`,
      )
      expect(response.status()).toBe(200)
      const body = (await response.json()) as { members: { userId: string; status: string }[] }
      expect(
        body.members.some((member) => member.userId === userId && member.status === 'active'),
      ).toBe(present)
    },
    async close() {
      await test.info().attach('sanitized-invitation-responses', {
        body: JSON.stringify({ responses, pageerrors, foreign }, null, 2),
        contentType: 'application/json',
      })
      await Promise.all(contexts.map((value) => value.close()))
      expect(pageerrors).toEqual([])
      expect(foreign).toEqual([])
    },
  }
}

async function openInvite(page: Page, departmentId: string) {
  await page.goto(`/department?id=${departmentId}&tab=invite`)
  await expect(page.getByRole('tab', { name: 'Invite', exact: true })).toHaveAttribute(
    'data-state',
    'active',
  )
  await expect(page.getByLabel('Set my own password', { exact: true })).toBeVisible()
}

async function capture(page: Page, name: string) {
  if (name === 'generated-password-once-masked.png') {
    await page.getByLabel('Password', { exact: true }).scrollIntoViewIfNeeded()
  } else if (name === 'custom-password-after-reload.png') {
    await page.getByLabel('Set my own password', { exact: true }).scrollIntoViewIfNeeded()
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true)
  await page.screenshot({
    path: test.info().outputPath(name),
    fullPage: false,
    mask: [page.locator('input[type="password"]'), page.getByLabel('Password', { exact: true })],
  })
}

async function refusedThenJoined(
  f: Awaited<ReturnType<typeof fixture>>,
  previousPassword: string,
  currentPassword: string,
) {
  const member = await f.newcomer()
  const page = await member.context.newPage()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/join?key=${f.department.joinKey}`)
  await page.getByLabel('Password', { exact: true }).fill(previousPassword)
  const refused = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/departments/join' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  expect((await refused).status()).toBe(404)
  await expect(page.getByRole('alert')).toHaveText('Invalid key or password')
  // Visibility begins at the first frame of Collapsible's entrance. Readable pixel evidence
  // requires the actual ancestor fade to settle; do not mistake an opening frame for low contrast.
  await expect
    .poll(() =>
      page.getByRole('alert').evaluate((element) => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          if (Number(getComputedStyle(current).opacity) < 0.999) return false
        }
        return true
      }),
    )
    .toBe(true)
  await expect(page.locator('.devon-shake')).toHaveCount(0)
  await f.memberExists(member.userId, false)
  await capture(page, 'old-password-refused.png')
  await page.getByLabel('Password', { exact: true }).fill(currentPassword)
  const accepted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/departments/join' &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Join', exact: true }).click()
  expect((await accepted).status()).toBe(200)
  await expect(
    page.getByRole('heading', { name: "You've joined the department", exact: true }),
  ).toBeVisible()
  await f.memberExists(member.userId, true)
  await page.getByRole('button', { name: 'Departments', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Synthetic invitation password QA' }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Synthetic invitation password QA' }),
  ).toBeVisible()
}

test('@qa custom invitation password persists and only its new value admits a newcomer', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.head.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    await openInvite(page, f.department.departmentId)
    const customPassword = examplePassword()
    await page.getByLabel('Set my own password', { exact: true }).fill(customPassword)
    const saved = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/invite/password'),
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).status()).toBe(204)
    await expect(page.getByLabel('Set my own password', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(customPassword)
    expect(
      f.responses.filter((response) => response.path.endsWith('/invite/password')),
    ).toHaveLength(1)
    await f.readInvite()
    await page.reload()
    await expect(page.getByLabel('Set my own password', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
    await capture(page, 'custom-password-after-reload.png')
    await refusedThenJoined(f, f.department.joinPassword, customPassword)
  } finally {
    await f.close()
  }
})

test('@qa cancelling password rotation preserves it and confirmed rotation retires its old value', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    const page = await f.head.newPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await openInvite(page, f.department.departmentId)
    const rotate = page.getByRole('button', { name: 'Rotate password', exact: true })
    await rotate.click()
    const dialog = page.getByRole('dialog', { name: 'Rotate the password', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(
      f.responses.filter((response) => response.path.endsWith('/invite/rotate-password')),
    ).toEqual([])
    const cancelledMember = await f.newcomer()
    const unchanged = await authedPost(cancelledMember.context, '/api/v1/departments/join', {
      key: f.department.joinKey,
      password: f.department.joinPassword,
    })
    expect(unchanged.status()).toBe(200)
    await f.memberExists(cancelledMember.userId, true)
    await rotate.click()
    const rotated = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/invite/rotate-password'),
    )
    await dialog.getByRole('button', { name: 'Rotate password', exact: true }).click()
    const response = await rotated
    expect(response.status()).toBe(200)
    const generated = ((await response.json()) as { password: string }).password
    expect(generated.length).toBeGreaterThanOrEqual(8)
    expect(generated).not.toBe(f.department.joinPassword)
    await expect(dialog).not.toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(generated)
    expect(
      f.responses.filter((entry) => entry.path.endsWith('/invite/rotate-password')),
    ).toHaveLength(1)
    await capture(page, 'generated-password-once-masked.png')
    await f.readInvite()
    await page.reload()
    await expect(page.getByLabel('Set my own password', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0)
    await refusedThenJoined(f, f.department.joinPassword, generated)
  } finally {
    await f.close()
  }
})
