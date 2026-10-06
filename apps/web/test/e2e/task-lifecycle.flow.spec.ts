import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

for (const role of ['head', 'member'] as const) {
  test(`@flow ${role} creates a card with punctuation, deletes and undoes it, and finds help`, async ({
    browser,
  }) => {
    const admin = await newFlowContext(browser)
    const head = await newFlowContext(browser)
    const member = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      const dept = await createApprovedDepartment(head, admin, {
        headLogin: uniqueLogin('lifecycle.head'),
        headPassword: examplePassword(),
        departmentName: uniqueLogin('lifecycle'),
      })
      await joinDepartmentAsNewUser(member, {
        login: uniqueLogin('lifecycle.member'),
        password: examplePassword(),
        joinKey: dept.joinKey,
        joinPassword: dept.joinPassword,
      })
      const context = role === 'head' ? head : member
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).ok()).toBeTruthy()
      const page = await context.newPage()
      await page.goto('/')
      await expect(
        page.getByRole('button', { name: role === 'head' ? 'Board' : 'Mine', exact: true }).first(),
      ).toBeVisible()
      await page.getByRole('button', { name: 'New card', exact: true }).click()
      const title = `Review: punctuation remains ${Date.now()}`
      await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title)
      await page
        .getByLabel('Assignee', { exact: true })
        .selectOption({ label: role === 'head' ? 'Test Head' : 'Test Member' })
      await page.getByLabel('Due', { exact: true }).fill('2030-10-10')
      const createdResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/cards') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'New card', exact: true }).click()
      const created = (await (await createdResponse).json()) as { id: string; title: string }
      expect(created.title).toBe(title)
      await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
      await expect(
        page.getByText('Card deleted. Its record remains in the admin audit log.'),
      ).toBeVisible()
      expect((await context.request.get(`/api/v1/cards/${created.id}`)).status()).toBe(404)
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect
        .poll(async () => (await context.request.get(`/api/v1/cards/${created.id}`)).status())
        .toBe(200)
      await page.goto('/pages')
      await page.getByRole('link', { name: /Quick help/ }).click()
      await page.getByRole('searchbox').fill('quiet hours')
      await expect(
        page.getByText('How do I connect Telegram and control notifications?'),
      ).toBeVisible()
      await expect(page.locator('details')).toHaveCount(1)
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByRole('searchbox')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    } finally {
      await Promise.all([admin.close(), head.close(), member.close()])
    }
  })
}
