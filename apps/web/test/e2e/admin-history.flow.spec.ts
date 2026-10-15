import { expect, test } from '@playwright/test'
import '@devon/i18n/catalogues'
import { isLocale, translate } from '@devon/i18n'
import {
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
    // This administrator is shared with concurrent console flows. Read its locale without
    // changing the persisted preference underneath another user's browser journey.
    const me = (await (await admin.request.get('/api/v1/me')).json()) as {
      user: { locale: string }
    }
    const locale = me.user.locale
    if (!isLocale(locale)) throw new Error('The administrator locale must be recognized')
    const label = (key: string) => translate(locale, key)
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
      (
        await authedPost(head, '/api/v1/cards', {
          title: 'Historical head action',
        })
      ).status(),
    ).toBe(201)
    const page = await admin.newPage()
    await page.goto('/admin/accounts')
    await page
      .getByRole('textbox', {
        name: label('admin.console.accounts.searchPlaceholder'),
      })
      .fill(headLogin)
    const row = page.getByRole('row').filter({ hasText: headLogin })
    await expect(
      row.getByText(label('admin.console.accounts.role.head'), { exact: true }),
    ).toBeVisible()
    await row
      .getByRole('button', {
        name: label('admin.console.accounts.actionsMenu'),
      })
      .click()
    await page
      .getByRole('menuitem', {
        name: label('admin.console.accounts.anonymize'),
        exact: true,
      })
      .click()
    const dialog = page.getByRole('dialog', {
      name: label('admin.console.accounts.anonymizeDialogTitle'),
    })
    await expect(dialog.getByText(new RegExp(headLogin.replace(/\./g, '\\.')))).toBeVisible()
    await dialog
      .getByRole('button', {
        name: label('admin.console.accounts.anonymizeSubmit'),
        exact: true,
      })
      .click()
    await expect(dialog).not.toBeVisible()
    await expect(
      row.getByText(label('admin.console.accounts.status.deleted'), {
        exact: true,
      }),
    ).toBeVisible()
    await page.reload()
    await page
      .getByRole('textbox', {
        name: label('admin.console.accounts.searchPlaceholder'),
      })
      .fill(headLogin)
    await expect(row.getByText('Test Head', { exact: true })).toBeVisible()
    await expect(
      row.getByText(label('admin.console.accounts.role.head'), { exact: true }),
    ).toBeVisible()
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
      aiSpend: { available: boolean }
    }
    await expect(
      page.getByText(label('admin.console.analytics.totalPeople'), {
        exact: true,
      }),
    ).toBeVisible()
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
    expect(analytics.aiSpend.available).toBe(true)
    await expect(
      page.getByText(label('admin.console.analytics.aiSpendTitle'), {
        exact: true,
      }),
    ).toBeVisible()
  } finally {
    await Promise.all([admin.close(), head.close()])
  }
})
