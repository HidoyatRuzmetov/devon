import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow admin deletion preserves identity, head role, audit history and visible activity bars', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    expect((await authedPatch(admin, '/api/v1/me', { locale: 'en' })).ok()).toBeTruthy()
    const headLogin = uniqueLogin('history.head')
    await createApprovedDepartment(head, admin, {
      headLogin,
      headPassword: examplePassword(),
      departmentName: uniqueLogin('History department'),
    })
    const identity = (await (await head.request.get('/api/v1/me')).json()) as {
      user: { id: string }
    }
    expect(
      (await authedPost(head, '/api/v1/cards', { title: 'Historical head action' })).status(),
    ).toBe(201)
    const page = await admin.newPage()
    await page.goto('/admin/accounts')
    await page.getByRole('textbox', { name: 'Search by name or login' }).fill(headLogin)
    const row = page.getByRole('row').filter({ hasText: headLogin })
    await expect(row.getByText('Head', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: 'Actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete account' })
    await expect(dialog.getByText(new RegExp(headLogin.replace(/\./g, '\\.')))).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(row.getByText('Deleted', { exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('textbox', { name: 'Search by name or login' }).fill(headLogin)
    await expect(row.getByText('Test Head', { exact: true })).toBeVisible()
    await expect(row.getByText('Head', { exact: true })).toBeVisible()
    const saved = (await (
      await admin.request.get(`/api/v1/admin/accounts/${identity.user.id}`)
    ).json()) as {
      login: string
      status: string
      givenName: string
      familyName: string
      role: string
    }
    expect(saved).toMatchObject({
      status: 'deleted',
      givenName: 'Test',
      familyName: 'Head',
      role: 'head',
    })
    expect(saved.login).toMatch(new RegExp(`^${headLogin.replace(/\./g, '\\.')}\\.deleted-`))
    expect((await head.request.get('/api/v1/me')).status()).toBe(401)
    const history = (await (
      await admin.request.get(`/api/v1/admin/audit/events?actorUserId=${identity.user.id}`)
    ).json()) as { events: { actorName: string; actorStatus: string }[] }
    expect(history.events.length).toBeGreaterThan(0)
    expect(
      history.events.every(
        (event) => event.actorName === 'Test Head' && event.actorStatus === 'deleted',
      ),
    ).toBe(true)
    const verify = (await (await admin.request.get('/api/v1/admin/audit/verify')).json()) as {
      ok: boolean
    }
    expect(verify.ok).toBe(true)
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/admin/analytics') && response.ok(),
    )
    await page.goto('/admin/analytics')
    const analytics = (await (await responsePromise).json()) as {
      people: { total: number }
      activity: { weeklyLogins: { count: number }[] }
    }
    await expect(page.getByText('Active accounts', { exact: true })).toBeVisible()
    const bars = page.locator('div[role="img"]')
    await expect(bars).toBeVisible()
    await expect
      .poll(async () =>
        Math.max(
          ...(await bars
            .locator('div.bg-primary')
            .evaluateAll((elements) =>
              elements.map((element) => element.getBoundingClientRect().height),
            )),
        ),
      )
      .toBeGreaterThan(20)
    expect(analytics.activity.weeklyLogins).toHaveLength(8)
    await expect(page.getByText('The AI module is not connected yet.')).toHaveCount(0)
  } finally {
    await Promise.all([admin.close(), head.close()])
  }
})
