import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('collapsed sidebar centers every icon inside its button @flow', async ({ browser }, info) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('rail.head'),
      headPassword: examplePassword(),
      departmentName: 'Sidebar alignment QA',
    })
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/work')
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
    const links = page.locator('aside .devon-nav-scroller a[href]')
    await expect.poll(() => links.count()).toBeGreaterThan(8)
    await expect
      .poll(() =>
        links.evaluateAll((rows) =>
          Math.max(
            ...rows.map((row) => {
              const icon = row.querySelector('svg')!.getBoundingClientRect()
              const button = row.getBoundingClientRect()
              return Math.max(
                Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2),
                Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2),
              )
            }),
          ),
        ),
      )
      .toBeLessThan(1)
    await page.screenshot({ path: info.outputPath('centered-sidebar.png') })
    const people = page.locator('aside a[href="/people"]')
    await people.focus()
    await expect(page.getByRole('tooltip')).toContainText('People')
    await people.press('Enter')
    await expect(people).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await expect(people.locator('[data-shell-label]')).toBeVisible()
  } finally {
    await Promise.all([head.close(), admin.close()])
  }
})
