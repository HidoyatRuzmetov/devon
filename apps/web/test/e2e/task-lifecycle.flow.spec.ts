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
  }, info) => {
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
      const checklist = page.getByRole('region', { name: /^Checklist/ })
      for (const text of ['First check', 'Second check', 'Third check']) {
        // Creating in order proves later completion does not reorder the real database rows.
        // eslint-disable-next-line no-restricted-syntax
        await checklist.getByRole('textbox', { name: 'Add an item' }).fill(text)
        // eslint-disable-next-line no-restricted-syntax
        await checklist.getByRole('textbox', { name: 'Add an item' }).press('Enter')
        // eslint-disable-next-line no-restricted-syntax
        await expect(checklist.getByRole('checkbox', { name: text })).toBeVisible()
      }
      await checklist.getByText('Second check', { exact: true }).click()
      await expect(checklist.getByRole('checkbox', { name: 'Second check' })).toBeChecked()
      await expect(checklist.getByRole('checkbox', { name: 'First check' })).not.toBeChecked()
      await expect(checklist.locator('[data-checklist-id] label')).toHaveText([
        'First check',
        'Second check',
        'Third check',
      ])
      await checklist.getByRole('button', { name: 'Edit checklist item' }).nth(1).click()
      await checklist.getByRole('textbox', { name: 'Edit checklist item' }).fill('Revised second')
      await checklist.getByRole('button', { name: 'Save item' }).click()
      await expect(checklist.getByRole('checkbox', { name: 'Revised second' })).toBeChecked()
      await checklist.getByRole('button', { name: 'Delete', exact: true }).nth(2).click()
      await expect(checklist.getByRole('checkbox')).toHaveCount(2)
      // Let the creation toast leave naturally so evidence does not obscure the row actions.
      await page.mouse.move(0, 0)
      await expect(page.getByText(`"${title}" created`, { exact: true })).not.toBeVisible({
        timeout: 15_000,
      })
      const checklistImage = info.outputPath('checklist-edited.png')
      await checklist.screenshot({ path: checklistImage, animations: 'disabled' })
      await info.attach('Edited checklist', { path: checklistImage, contentType: 'image/png' })
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
