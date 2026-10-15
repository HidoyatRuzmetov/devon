import { expect, test } from '@playwright/test'
import type { CardDetail } from '../../src/features/work/api.js'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

for (const role of ['head', 'member'] as const) {
  test(`@flow ${role} opens card details from Home and keeps Mine focus working`, async ({
    browser,
  }) => {
    const admin = await newFlowContext(browser)
    const head = await newFlowContext(browser)
    const member = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      const department = await createApprovedDepartment(head, admin, {
        headLogin: uniqueLogin('homefocus.head'),
        headPassword: examplePassword(),
        departmentName: uniqueLogin('homefocus'),
      })
      await joinDepartmentAsNewUser(member, {
        login: uniqueLogin('homefocus.member'),
        password: examplePassword(),
        joinKey: department.joinKey,
        joinPassword: department.joinPassword,
      })
      expect(
        (
          await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
            data: { features: { focus_list: true } },
            headers: { 'x-csrf-token': await csrfToken(head) },
          })
        ).ok(),
      ).toBeTruthy()
      const context = role === 'head' ? head : member
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).ok()).toBeTruthy()
      const me = (await (await context.request.get('/api/v1/me')).json()) as {
        user: { id: string }
      }
      const title = `Home focus ${role}`
      const response = await authedPost(context, '/api/v1/cards', {
        title,
        assigneeUserId: me.user.id,
      })
      expect(response.status()).toBe(201)
      const card = (await response.json()) as { id: string }
      expect(
        (
          await authedPost(context, `/api/v1/cards/${card.id}/checklist`, { text: 'Review guide' })
        ).status(),
      ).toBe(201)
      expect((await authedPost(context, '/api/v1/work/focus', { cardId: card.id })).status()).toBe(
        204,
      )
      const page = await context.newPage()
      // Member Home has the personal Focus list; head Home is a management dashboard.
      // Its routed card link must still resolve to the same real details panel.
      await page.goto(role === 'head' ? `/?card=${card.id}` : '/')
      if (role === 'member') {
        await page.getByRole('button', { name: title, exact: true }).click()
      }
      await expect(page).toHaveURL(new RegExp(`/\\?card=${card.id}$`))
      const dialog = page.getByRole('dialog', { name: 'Card details', exact: true })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title)
      const checkbox = dialog.getByRole('checkbox', { name: 'Review guide', exact: true })
      await expect(checkbox).not.toBeChecked()
      await checkbox.click()
      await expect(checkbox).toBeChecked()
      await expect
        .poll(async () => {
          const saved = (await (
            await context.request.get(`/api/v1/cards/${card.id}`)
          ).json()) as CardDetail
          return Boolean(saved.checklist.find((item) => item.text === 'Review guide')?.doneAt)
        })
        .toBe(true)
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      expect(new URL(page.url()).pathname).toBe('/')
      expect(new URL(page.url()).searchParams.has('card')).toBe(false)
      await page.goto(`/?card=${card.id}`)
      await expect(
        dialog.getByRole('checkbox', { name: 'Review guide', exact: true }),
      ).toBeChecked()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page.goto('/work/mine')
      await page
        .getByRole('region', { name: 'Focus list', exact: true })
        .getByRole('button', { name: title, exact: true })
        .click()
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('checkbox', { name: 'Review guide', exact: true }),
      ).toBeChecked()
    } finally {
      await Promise.all([admin.close(), head.close(), member.close()])
    }
  })
}
