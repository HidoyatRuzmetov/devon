import { expect, test, type Browser } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  flowClientHeaders,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'

async function fixture(browser: Browser, department = false, timezoneId?: string) {
  const context = timezoneId
    ? await browser.newContext({
        baseURL: FLOW_WEB_BASE_URL,
        extraHTTPHeaders: flowClientHeaders(),
        timezoneId,
      })
    : await newFlowContext(browser)
  const external: string[] = []
  await context.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== FLOW_WEB_BASE_URL) {
      external.push(new URL(route.request().url()).hostname)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const login = uniqueLogin('calendar.fields')
  let departmentInfo: Awaited<ReturnType<typeof createApprovedDepartment>> | undefined
  if (department) {
    const admin = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      departmentInfo = await createApprovedDepartment(context, admin, {
        headLogin: login,
        headPassword: examplePassword(),
        departmentName: `Synthetic calendar/fields ${login}`,
      })
    } finally {
      await admin.close()
    }
  } else {
    await registerUser(context, {
      login,
      password: examplePassword(),
      givenName: 'Synthetic',
      familyName: 'Calendar',
    })
  }
  expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
  const page = await context.newPage()
  return {
    context,
    page,
    departmentInfo,
    close: async () => {
      await context.close()
      expect(external).toEqual([])
    },
  }
}

test('a refused subscription create explains failure and preserves a retryable draft', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/calendar?tab=feeds')
    await f.page.getByRole('button', { name: 'Create subscription', exact: true }).click()
    const dialog = f.page.getByRole('dialog', { name: 'New subscription', exact: true })
    await dialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Synthetic calendar subscription')
    await f.page.route('**/api/v1/calendar/feeds', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({ status: 503, json: { code: 'unavailable' } })
    })
    const refused = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/calendar/feeds'),
    )
    await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
    expect((await refused).status()).toBe(503)
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      'Synthetic calendar subscription',
    )
    expect(
      (await (await f.context.request.get('/api/v1/calendar/feeds')).json()).items,
    ).toHaveLength(0)
    await f.page.unroute('**/api/v1/calendar/feeds')
    const saved = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/calendar/feeds'),
    )
    await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
    expect((await saved).status()).toBe(200)
    await expect(dialog).not.toBeVisible()
    const stored = await (await f.context.request.get('/api/v1/calendar/feeds')).json()
    expect(stored.items.map((item: { label: string }) => item.label)).toEqual([
      'Synthetic calendar subscription',
    ])
    await f.page.reload()
    await expect(
      f.page.getByRole('heading', { name: 'Synthetic calendar subscription', exact: true }),
    ).toBeVisible()
  } finally {
    await f.close()
  }
})

test('subscription kinds, selectable credentials, read-only ICS, renewal refusal/retry and revocation persist', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    await f.page.goto('/calendar?tab=feeds')
    const kinds = [
      ['all', 'Everything'],
      ['events', 'Events only'],
      ['tasks', 'Card due dates only'],
    ] as const
    // These actions share one dialog and page; complete each create before reopening it.
    for (let index = 0; index < kinds.length; index += 1) {
      const [kind, choice] = kinds[index]!
      await f.page.getByRole('button', { name: 'Create subscription', exact: true }).click()
      const dialog = f.page.getByRole('dialog', { name: 'New subscription' })
      await dialog
        .getByRole('textbox', { name: 'Name', exact: true })
        .fill(`Synthetic ${kind} feed`)
      await dialog.getByRole('radio', { name: choice, exact: false }).check()
      const created = f.page.waitForResponse(
        (r) =>
          r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/v1/calendar/feeds',
      )
      await dialog.getByRole('button', { name: 'Create subscription', exact: true }).click()
      expect((await created).status()).toBe(200)
      await expect(dialog).not.toBeVisible()
    }
    const stored = await (await f.context.request.get('/api/v1/calendar/feeds')).json()
    expect(stored.items.map((item: { kind: string }) => item.kind).sort()).toEqual([
      'all',
      'events',
      'tasks',
    ])
    const original = stored.items.find((item: { kind: string }) => item.kind === 'all')
    const card = f.page
      .locator('section')
      .filter({ has: f.page.getByRole('heading', { name: 'Synthetic all feed', exact: true }) })
    const link = card.getByRole('textbox', { name: 'Link (https)', exact: true })
    await expect(link).toHaveValue(original.url)
    await link.focus()
    expect(
      await link.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
    ).toEqual([0, original.url.length])
    if (test.info().project.name === 'chromium') {
      await f.context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await card.getByRole('button', { name: 'Copy', exact: true }).first().click()
      await expect(card.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
      expect(await f.page.evaluate(() => navigator.clipboard.readText())).toBe(original.url)
    }
    await expect(card.getByRole('textbox', { name: 'Webcal link', exact: true })).toHaveValue(
      original.webcalUrl,
    )
    await expect(card.getByRole('textbox', { name: 'CalDAV link', exact: true })).toHaveValue(
      original.caldavUrl,
    )
    const ics = await f.context.request.get(original.url)
    expect(ics.status()).toBe(200)
    expect(ics.headers()['content-type']).toContain('text/calendar')
    expect(await ics.text()).toContain('BEGIN:VCALENDAR')
    expect(
      (await f.context.request.put(`${original.caldavUrl}calendar/`, { data: {} })).status(),
    ).toBe(403)

    await card.getByRole('button', { name: 'Open', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Renew the link', exact: true }).click()
    let rotateDialog = f.page.getByRole('dialog', { name: 'Renew this link?', exact: true })
    await rotateDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await f.context.request.get(original.url)).status()).toBe(200)
    await card.getByRole('button', { name: 'Open', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Renew the link', exact: true }).click()
    rotateDialog = f.page.getByRole('dialog', { name: 'Renew this link?', exact: true })
    await f.page.route(`**/api/v1/calendar/feeds/${original.id}/rotate`, (route) =>
      route.fulfill({ status: 503, json: { code: 'unavailable' } }),
    )
    await rotateDialog.getByRole('button', { name: 'Yes, renew it', exact: true }).click()
    await expect(rotateDialog.getByRole('alert')).toHaveText('Could not save')
    expect((await f.context.request.get(original.url)).status()).toBe(200)
    await f.page.unroute(`**/api/v1/calendar/feeds/${original.id}/rotate`)
    const rotated = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).pathname.endsWith(`/${original.id}/rotate`),
    )
    await rotateDialog.getByRole('button', { name: 'Yes, renew it', exact: true }).click()
    expect((await rotated).status()).toBe(200)
    await expect(rotateDialog).not.toBeVisible()
    const renewed = (
      await (await f.context.request.get('/api/v1/calendar/feeds')).json()
    ).items.find((item: { id: string }) => item.id === original.id)
    expect(renewed.url).not.toBe(original.url)
    expect((await f.context.request.get(original.url)).status()).toBe(404)
    expect((await f.context.request.get(renewed.url)).status()).toBe(200)
    await expect(link).toHaveValue(renewed.url)
    await f.page.reload()
    await expect(link).toHaveValue(renewed.url)
    await f.page.route(`**/api/v1/calendar/feeds/${original.id}`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 503, json: { code: 'unavailable' } })
        : route.continue(),
    )
    await card.getByRole('button', { name: 'Open', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(f.page.getByText('Could not save', { exact: true })).toBeVisible()
    expect((await f.context.request.get(renewed.url)).status()).toBe(200)
    await f.page.unroute(`**/api/v1/calendar/feeds/${original.id}`)
    const revoked = f.page.waitForResponse(
      (r) =>
        r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith(`/${original.id}`),
    )
    await card.getByRole('button', { name: 'Open', exact: true }).click()
    await f.page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    expect((await revoked).status()).toBe(200)
    await expect(card).not.toBeVisible()
    expect((await f.context.request.get(renewed.url)).status()).toBe(404)
    expect(
      (await (await f.context.request.get('/api/v1/calendar/feeds')).json()).items,
    ).toHaveLength(2)
    await f.page.reload()
    await expect(
      f.page.getByRole('heading', { name: 'Synthetic all feed', exact: true }),
    ).not.toBeVisible()
  } finally {
    await f.close()
  }
})

test('concurrent subscription creation enforces twenty live credentials atomically', async ({
  browser,
}) => {
  const f = await fixture(browser)
  try {
    for (let index = 0; index < 19; index += 1)
      expect(
        (
          await authedPost(f.context, '/api/v1/calendar/feeds', {
            kind: 'all',
            label: `Synthetic cap ${index}`,
          })
        ).status(),
      ).toBe(200)
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        authedPost(f.context, '/api/v1/calendar/feeds', {
          kind: 'events',
          label: `Synthetic parallel ${index}`,
        }),
      ),
    )
    const statuses = responses.map((response) => response.status())
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 422)).toHaveLength(7)
    const actual = await (await f.context.request.get('/api/v1/calendar/feeds')).json()
    expect(actual.items).toHaveLength(20)
  } finally {
    await f.close()
  }
})

test('members cannot renew or revoke another owner’s calendar feed', async ({ browser }) => {
  const f = await fixture(browser, true)
  const member = await newFlowContext(browser)
  try {
    const ownerFeed = await authedPost(f.context, '/api/v1/calendar/feeds', {
      kind: 'all',
      label: 'Synthetic head feed',
    })
    expect(ownerFeed.status()).toBe(200)
    const feed = await ownerFeed.json()
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('fields.member'),
      password: examplePassword(),
      joinKey: f.departmentInfo!.joinKey,
      joinPassword: f.departmentInfo!.joinPassword,
    })
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    expect(
      (await authedPost(member, `/api/v1/calendar/feeds/${feed.id}/rotate`, {})).status(),
    ).toBe(404)
    expect(
      (
        await member.request.delete(`/api/v1/calendar/feeds/${feed.id}`, {
          headers: { 'x-csrf-token': await csrfToken(member) },
        })
      ).status(),
    ).toBe(200)
    expect((await f.context.request.get(feed.url)).status()).toBe(200)
    expect((await (await member.request.get('/api/v1/calendar/feeds')).json()).items).toEqual([])
  } finally {
    await member.close()
    await f.close()
  }
})
