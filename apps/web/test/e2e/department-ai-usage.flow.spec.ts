import { expect, test } from '@playwright/test'
import {
  authedPatch,
  createApprovedDepartment,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow department head switches between monthly and all-time AI totals independently of recent calls', async ({
  browser,
}, testInfo) => {
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('usage.head'),
      headPassword: examplePassword(),
      departmentName: 'Usage report QA',
    })
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await head.newPage()
    await page.goto('/account/ai')
    await page.getByRole('tab', { name: 'Usage', exact: true }).click()
    const summary = page.getByRole('region', { name: 'Department usage' })
    await expect(summary.getByText('UZS 0', { exact: true })).toBeVisible()
    // Populate historical totals without creating paid calls. The detail endpoint stays real and empty.
    await page.route('**/api/v1/ai/usage/summary*', (route) => {
      const month = new URL(route.request().url()).searchParams.get('month') ?? '2026-11'
      return route.fulfill({
        json: {
          today: '2026-11-11',
          month,
          firstMonth: '2026-09',
          monthly:
            month === '2026-10'
              ? { tokens: 2050, costUzs: 74, runs: 60 }
              : { tokens: 1210, costUzs: 36, runs: 91 },
          allTime: { tokens: 5050, costUzs: 200, runs: 283 },
        },
      })
    })
    await page.reload()
    await page.getByRole('tab', { name: 'Usage', exact: true }).click()
    const period = summary.getByRole('combobox', { name: 'Totals period' })
    await expect(period).toHaveValue('2026-11')
    await expect(summary.getByText('1,210', { exact: true })).toBeVisible()
    await expect(summary.getByText('91', { exact: true })).toBeVisible()
    await period.selectOption({ label: 'October 2026' })
    await expect(summary.getByText('UZS 74', { exact: true })).toBeVisible()
    await period.selectOption({ label: 'All time' })
    await expect(summary.getByText('5,050', { exact: true })).toBeVisible()
    await expect(summary.getByText('283', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Latest 50 calls' })).toContainText(
      'No AI calls yet',
    )
    await page.screenshot({ path: testInfo.outputPath('department-ai-usage.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(period).toBeVisible()
  } finally {
    await head.close()
    await admin.close()
  }
})
