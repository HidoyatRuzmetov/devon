import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow notification preferences expose working channels and save consistently for head and member', async ({
  browser,
}, info) => {
  const admin = await newFlowContext(browser)
  await loginAsSuperAdmin(admin)
  const head = await newFlowContext(browser)
  const department = await createApprovedDepartment(head, admin, {
    headLogin: uniqueLogin('prefs.head'),
    headPassword: examplePassword(),
    departmentName: 'Notification preferences flow',
  })
  await admin.close()
  const member = await newFlowContext(browser)
  await joinDepartmentAsNewUser(member, {
    login: uniqueLogin('prefs.member'),
    password: examplePassword(),
    joinKey: department.joinKey,
    joinPassword: department.joinPassword,
  })
  const users = [
    ['head', head],
    ['member', member],
  ] as const
  for (let i = 0; i < users.length; i += 1) {
    const [role, context] = users[i]!
    const page = await context.newPage()
    await page.goto('/inbox/preferences')
    await expect(page.getByRole('heading', { name: 'Bildirishnoma sozlamalari' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'E-pochta' })).toHaveCount(0)
    await expect(page.getByText('Doim yoqilgan', { exact: true })).toHaveCount(10)
    await expect(page.getByRole('switch', { name: /Maʼlumot.*Telegram/ })).toBeVisible()
    const assigned = page.getByRole('switch', { name: /Topshiriq.*Telegram/ })
    await expect(assigned).not.toBeChecked()
    await assigned.click()
    await expect(assigned).toBeChecked()
    await page.reload()
    await expect(assigned).toBeChecked()
    const digest = page.getByRole('combobox', { name: 'Telegram', exact: true })
    await digest.selectOption('weekly')
    await expect(digest).toHaveValue('weekly')
    await page.reload()
    await expect(digest).toHaveValue('weekly')
    await digest.selectOption('off')
    await expect(digest).toHaveValue('off')
    const summarySwitch = page.getByRole('switch', { name: /Xulosa.*Telegram/ })
    await expect(summarySwitch).not.toBeChecked()
    await summarySwitch.click()
    await expect(summarySwitch).toBeChecked()
    await expect(digest).toHaveValue('daily')
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(
      result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([])
    await page.screenshot({
      path: info.outputPath(`${role}-notification-preferences.png`),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await context.close()
  }
})
