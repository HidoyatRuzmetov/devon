import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow home tabs stay flat and head risk review shares the view toolbar', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser),
    head = await newFlowContext(browser),
    member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('polish.head'),
      headPassword: examplePassword(),
      departmentName: 'Portal polish QA',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('polish.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    await Promise.all(
      (
        [
          ['head', head],
          ['member', member],
        ] as const
      ).map(async ([role, context]) => {
        await authedPatch(context, '/api/v1/me', { locale: 'en' })
        const page = await context.newPage()
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.goto('/')
        await expect(page.getByTestId(`${role}-overview`)).toBeVisible()
        const tabs = page.getByTestId('home-inbox').getByRole('tablist')
        await expect(tabs).toBeVisible()
        expect(
          await tabs.evaluate((el) => ({
            extra: el.scrollHeight - el.clientHeight,
            overflow: getComputedStyle(el).overflowY,
          })),
        ).toEqual({ extra: 0, overflow: 'hidden' })
        await page.screenshot({ path: testInfo.outputPath(`${role}-home.png`) })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.getByRole('radio', { name: 'Inbox', exact: true }).click()
        await expect(tabs).toBeVisible()
        expect(await tabs.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0)
        await page.close()
      }),
    )
    expect(
      (
        await authedPost(head, '/api/v1/cards', {
          title: 'Overdue evidence',
          dueAt: '2026-01-01T05:00:00.000Z',
        })
      ).status(),
    ).toBe(201)
    const page = await head.newPage()
    // Only the availability flag is controlled here; records and board layout use the real API.
    await page.route('**/api/v1/ai/settings', async (route) => {
      const response = await route.fetch(),
        body = await response.json()
      await route.fulfill({
        response,
        json: { ...body, flags: { ...body.flags, board_risk_digest: true }, budgetStatus: 'ok' },
      })
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/work')
    const trigger = page.getByRole('button', { name: 'Who is running late', exact: true })
    await expect(trigger).toBeVisible()
    const calendar = page
      .getByRole('navigation', { name: 'Cards', exact: true })
      .getByRole('link', { name: 'Calendar', exact: true })
    const a = await trigger.boundingBox(),
      b = await calendar.boundingBox()
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(8)
    await trigger.click()
    await expect(page.getByRole('button', { name: /Retry|Try again/ }).first()).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('head-risk-review.png') })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await Promise.allSettled([admin.close(), head.close(), member.close()])
  }
})
