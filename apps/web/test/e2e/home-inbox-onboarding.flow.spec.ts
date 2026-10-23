import { expect, test } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

test('@flow personal inbox remains reachable before joining a department and for administration accounts', async ({
  browser,
}) => {
  const admin = await newFlowContext(browser),
    newcomer = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await registerUser(newcomer, {
      login: uniqueLogin('inbox.new'),
      password: examplePassword(),
      givenName: 'New',
      familyName: 'Colleague',
    })
    await Promise.all(
      (
        [
          [admin, 'Go to Administration'],
          [newcomer, 'Departments'],
        ] as const
      ).map(async ([context, entry]) => {
        await authedPatch(context, '/api/v1/me', { locale: 'en' })
        const page = await context.newPage()
        await page.goto('/account')
        await page
          .getByRole('banner')
          .getByRole('button', { name: /^Notifications:/ })
          .click()
        await expect(page).toHaveURL(/\/\?inbox=all$/)
        const inbox = page.getByTestId('home-inbox')
        await expect(inbox).toBeVisible()
        await expect(page.getByRole('button', { name: entry, exact: true })).toBeVisible()
        await expect(inbox.getByRole('tab', { name: 'All', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        )
        await page.goto('/inbox?status=archived')
        await expect(page).toHaveURL(/\/\?inbox=archived$/)
        await expect(inbox).toBeVisible()
        await expect(inbox.getByRole('tab', { name: 'Archived', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
        )
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(inbox).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        await page.close()
      }),
    )
  } finally {
    await Promise.allSettled([admin.close(), newcomer.close()])
  }
})
