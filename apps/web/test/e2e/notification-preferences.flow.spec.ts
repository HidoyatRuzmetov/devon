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
  test.setTimeout(90_000)
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
    await page.goto('/account')
    await expect(
      page.getByRole('heading', { name: 'Profil sozlamalari', exact: true }),
    ).toBeVisible()
    const desktopSettings = page.getByRole('navigation', {
      name: 'Sozlamalar boʻlimlari',
      exact: true,
    })
    await expect(desktopSettings.getByRole('link', { name: 'Telegram', exact: true })).toBeVisible()
    const theme = page.getByRole('combobox', {
      name: 'Koʻrinish',
      exact: true,
    })
    await theme.selectOption('dark')
    await page.reload()
    await expect(theme).toHaveValue('dark')
    await theme.selectOption('light')
    const language = page.getByRole('combobox', { name: 'Til', exact: true })
    await language.selectOption('en')
    await expect(page.getByRole('heading', { name: 'Profile settings', exact: true })).toBeVisible()
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('uz-Latn')
    await expect(
      page.getByRole('heading', { name: 'Profil sozlamalari', exact: true }),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await page.screenshot({
      path: info.outputPath(`${role}-profile-settings.png`),
      fullPage: true,
    })
    // The focused settings pane uses a native picker on phones and links on desktop.
    // Keep this as real navigation rather than jumping straight to the final URL.
    const settingsPane = page.getByRole('combobox', {
      name: 'Sozlamalar boʻlimlari',
      exact: true,
    })
    await settingsPane.selectOption('/account/telegram')
    await expect(page).toHaveURL(/\/account\/telegram$/)
    await expect(page.getByRole('heading', { name: 'Telegram', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Bildirishnoma sozlamalari', exact: true }).click()
    await expect(page).toHaveURL(/\/account\/notifications$/)
    await expect(
      page.getByRole('heading', { name: 'Profil sozlamalari', exact: true }),
    ).toBeVisible()
    await expect(settingsPane).toHaveValue('/account/notifications')
    await expect(page.getByRole('heading', { name: 'Telegram', exact: true })).toHaveCount(0)
    // Old inbox bookmarks stay usable and resolve to the same settings surface.
    await page.goto('/inbox/telegram')
    await expect(page).toHaveURL(/\/account\/telegram$/)
    await page.goto('/inbox/preferences')
    await expect(page).toHaveURL(/\/account\/notifications$/)
    await expect(page.getByRole('heading', { name: 'Bildirishnoma sozlamalari' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'E-pochta' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Ilovada', exact: true })).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: 'Turi va kanali boʻyicha', exact: true })
        .getByRole('switch'),
    ).toHaveCount(20)
    async function telegramPreference(reason: string, channel = 'telegram') {
      const response = await context.request.get('/api/v1/notifications/prefs')
      expect(response.status()).toBe(200)
      const payload = (await response.json()) as {
        items: {
          reason: string
          channel: string
          enabled: boolean
          digestMode: string
        }[]
      }
      return payload.items.find((item) => item.reason === reason && item.channel === channel)
    }
    const currentPreferences = await context.request.get('/api/v1/notifications/prefs')
    expect(currentPreferences.status()).toBe(200)
    const inApp = (await currentPreferences.json()).items.filter(
      (preference: { channel: string }) => preference.channel === 'inapp',
    )
    expect(inApp).toHaveLength(10)
    expect(
      inApp.every(
        (preference: { enabled: boolean; digestMode: string }) =>
          preference.enabled && preference.digestMode === 'instant',
      ),
    ).toBe(true)
    await expect(page.getByRole('switch', { name: /Maʼlumot.*Telegram/ })).toBeVisible()
    const assigned = page.getByRole('switch', { name: /Topshiriq.*Telegram/ })
    await expect(assigned).not.toBeChecked()
    await assigned.click()
    await expect(assigned).toBeChecked()
    await expect
      .poll(() => telegramPreference('assigned'))
      .toMatchObject({ enabled: true, digestMode: 'instant' })
    await page.reload()
    await expect(assigned).toBeChecked()
    const appAssigned = page.getByRole('switch', {
      name: /Topshiriq.*Ilovada/,
    })
    await expect(appAssigned).toBeChecked()
    await appAssigned.click()
    await expect
      .poll(() => telegramPreference('assigned', 'inapp'))
      .toMatchObject({ enabled: false, digestMode: 'instant' })
    await page.reload()
    await expect(appAssigned).not.toBeChecked()
    await expect(assigned).toBeChecked()
    await appAssigned.click()
    await expect
      .poll(() => telegramPreference('assigned', 'inapp'))
      .toMatchObject({ enabled: true, digestMode: 'instant' })
    const digest = page.getByRole('combobox', {
      name: 'Telegram',
      exact: true,
    })
    await digest.selectOption('weekly')
    await expect(digest).toHaveValue('weekly')
    await expect
      .poll(() => telegramPreference('digest'))
      .toMatchObject({ enabled: true, digestMode: 'weekly' })
    await page.reload()
    await expect(digest).toHaveValue('weekly')
    await digest.selectOption('off')
    await expect(digest).toHaveValue('off')
    await expect
      .poll(() => telegramPreference('digest'))
      .toMatchObject({ enabled: false, digestMode: 'off' })
    const summarySwitch = page.getByRole('switch', {
      name: /Xulosa.*Telegram/,
    })
    await expect(summarySwitch).not.toBeChecked()
    await summarySwitch.click()
    await expect(summarySwitch).toBeChecked()
    await expect(digest).toHaveValue('daily')
    await expect
      .poll(() => telegramPreference('digest'))
      .toMatchObject({ enabled: true, digestMode: 'daily' })
    const appSummary = page.getByRole('switch', { name: /Xulosa.*Ilovada/ })
    await appSummary.click()
    await expect
      .poll(() => telegramPreference('digest', 'inapp'))
      .toMatchObject({ enabled: false, digestMode: 'instant' })
    await expect(digest).toHaveValue('daily')
    await appSummary.click()
    await expect
      .poll(() => telegramPreference('digest', 'inapp'))
      .toMatchObject({ enabled: true, digestMode: 'instant' })
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(
      result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([])
    await page.screenshot({
      path: info.outputPath(`${role}-notification-preferences-mobile-full.png`),
      fullPage: true,
    })
    await page
      .getByRole('heading', { name: 'Turi va kanali boʻyicha', exact: true })
      .scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath(`${role}-notification-preferences-mobile.png`) })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.screenshot({
      path: info.outputPath(`${role}-notification-preferences-desktop.png`),
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    await context.close()
  }
})
