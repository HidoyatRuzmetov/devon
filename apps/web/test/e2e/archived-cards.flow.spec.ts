import AxeBuilder from '@axe-core/playwright'
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

test('task actions pin, complete and delete without Archive @flow', async ({ browser }, info) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('archive.head'),
      headPassword: examplePassword(),
      departmentName: 'Task actions QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = (await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const [unfinished, finished] = await Promise.all(
      ['Active task', 'Completed task'].map(async (title) => {
        const response = await authedPost(context, '/api/v1/cards', {
          title,
          assigneeUserId: me.user.id,
          priority: title === 'Active task' ? 'urgent' : 'high',
          dueAt: '2026-10-22T12:00:00Z',
        })
        expect(response.status()).toBe(201)
        return (await response.json()) as { id: string }
      }),
    )
    expect(
      (await authedPatch(context, `/api/v1/cards/${finished!.id}`, { status: 'done' })).status(),
    ).toBe(200)
    expect(
      (
        await authedPatch(context, `/api/v1/cards/${unfinished!.id}`, { status: 'archived' })
      ).status(),
    ).toBe(422)
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/work/table')
    await expect(page.getByRole('heading', { name: 'Cards', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^(Compact|Comfortable)$/ })).toHaveCount(0)
    await expect(
      page
        .getByRole('navigation', { name: 'Cards', exact: true })
        .getByRole('link', { name: /^(Archive|Mine)$/ }),
    ).toHaveCount(0)
    await page.goto('/work')
    await page.getByRole('button', { name: 'Board guide and display', exact: true }).click()
    await expect(page.getByRole('button', { name: /^(Roomy|Compact)$/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const active = page.locator('[data-dnd-card="' + unfinished!.id + '"]')
    await active.getByRole('button', { name: 'Card actions', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Move to', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Pin', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await (await context.request.get('/api/v1/cards/' + unfinished!.id)).json()).focusPinned,
      )
      .toBe(true)
    await page.getByRole('button', { name: 'Active task', exact: true }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'More actions', exact: true })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'Delete', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto('/work/mine')
    await page.getByRole('button', { name: 'Completed (1)' }).click()
    await expect(page.getByRole('checkbox', { name: 'Completed task' })).toBeChecked()
    await expect(page.getByText('Completed task', { exact: true })).toHaveClass(/line-through/)
    await page.screenshot({ path: info.outputPath('done-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath('done-mobile.png'), fullPage: true })
    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    )
  } finally {
    await context.close()
    await admin.close()
  }
})
