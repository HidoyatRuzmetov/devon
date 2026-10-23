import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'

test('settings panes, legacy links and professional profiles work on desktop and phone @flow', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('settings.head'),
      headPassword: examplePassword(),
      departmentName: 'Synthetic Settings Department',
    })
    await registerUser(member, {
      login: uniqueLogin('settings.member'),
      password: examplePassword(),
      givenName: 'Test',
      familyName: 'Analyst',
    })
    expect(
      (
        await authedPost(member, '/api/v1/departments/join', {
          key: department.joinKey,
          password: department.joinPassword,
        })
      ).status(),
    ).toBe(200)
    expect((await authedPatch(member, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = (await (await member.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const unit = (await (
      await authedPost(head, `/api/v1/departments/${department.departmentId}/units`, {
        name: 'Research and Policy',
      })
    ).json()) as { id: string }
    expect(
      (
        await authedPost(head, `/api/v1/departments/${department.departmentId}/unit-roles`, {
          unitId: unit.id,
          userId: me.user.id,
          role: 'member',
        })
      ).status(),
    ).toBe(201)
    const csrf = await csrfToken(member)
    const invalid = await member.request.put('/api/v1/accounts/professional-profile', {
      headers: { 'x-csrf-token': csrf },
      data: { version: 1, profile: { certifications: [{ name: ' ', issuer: '', year: null }] } },
    })
    expect(invalid.status()).toBe(422)
    const saved = await member.request.put('/api/v1/accounts/professional-profile', {
      headers: { 'x-csrf-token': csrf },
      data: {
        version: 1,
        profile: {
          headline: 'Research analyst',
          about:
            'I translate evidence into practical policy and help teams build clear, measurable plans.',
          phone: '+998 00 000 00 00',
          location: 'Tashkent',
          education: [
            {
              institution: 'Example University',
              degree: 'Bachelor',
              field: 'Economics',
              startYear: 2016,
              endYear: 2020,
              current: false,
            },
            {
              institution: 'Example Graduate School',
              degree: 'Master',
              field: 'Public policy',
              startYear: 2025,
              endYear: 2027,
              current: true,
            },
          ],
          experience: [
            {
              organization: 'Example Research Center',
              role: 'Policy analyst',
              startYear: 2021,
              endYear: null,
              current: true,
              description: 'Research, analysis and delivery planning.',
            },
          ],
          skills: ['Research', 'Analysis'],
          languages: ['Uzbek', 'English'],
          hobbies: ['Hiking', 'Chess'],
          links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/' }],
        },
      },
    })
    expect(saved.status()).toBe(200)
    const page = await member.newPage()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Profile settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Professional profile', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Devices', exact: true })).toHaveCount(0)
    await expect(
      page.locator('aside').getByRole('link', { name: 'Calendar', exact: true }),
    ).toHaveCount(0)
    const settingsNav = page.getByRole('navigation', { name: 'Settings sections' })
    await page.screenshot({
      path: testInfo.outputPath('account-settings-desktop.png'),
      fullPage: true,
    })
    await settingsNav.getByRole('link', { name: 'Professional profile', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue(
      'Research analyst',
    )
    const year = page.getByRole('textbox', { name: 'Start year', exact: true }).first()
    await year.focus()
    await year.hover()
    await page.mouse.wheel(0, 300)
    await page.keyboard.press('ArrowDown')
    await expect(year).toHaveValue('2016')
    await page.screenshot({
      path: testInfo.outputPath('professional-settings-desktop.png'),
      fullPage: true,
    })
    await page.goto('/inbox/preferences')
    await expect(page).toHaveURL(/\/account\/notifications$/)
    await expect(settingsNav.getByRole('link', { name: /Notification/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.goto('/inbox/telegram')
    await expect(page).toHaveURL(/\/account\/telegram$/)
    await expect(page.getByRole('heading', { name: 'Telegram', exact: true })).toBeVisible()
    await page.goto('/calendar?tab=feeds')
    await expect(page).toHaveURL(/\/account\/calendar\?tab=feeds$/)
    await expect(page.getByRole('tab', { name: /Subscription|Feeds/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.goto('/department?tab=members')
    await expect(page).toHaveURL(/\/account\/department\?tab=members$/)
    await expect(page.getByRole('tab', { name: 'Members', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tab', { name: /Invite|Danger/ })).toHaveCount(0)
    await page.goto('/account#section-password')
    await expect(page).toHaveURL(/\/account\/security#section-password$/)
    await expect(page.getByRole('heading', { name: 'Change password', exact: true })).toBeVisible()
    await page
      .locator('aside')
      .getByRole('button', { name: 'Profile settings', exact: true })
      .click()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByRole('menu')).toHaveCount(0)
    const desktopA11y = await new AxeBuilder({ page }).analyze()
    expect(
      desktopA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
    ).toEqual([])
    await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('combobox', { name: 'Settings sections' })
      .selectOption('/account/professional')
    await expect(page.getByRole('textbox', { name: 'Headline', exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('professional-settings-mobile.png'),
      fullPage: true,
    })
    // Embedded workspace settings share the Account heading and keep their real controls. Check
    // both widths so the compact headers do not recreate a nested page or hide settings on phones.
    /* eslint-disable no-restricted-syntax -- These navigations and viewport changes share one browser page and must run in order. */
    for (const viewport of [
      { width: 1440, height: 1000, label: 'desktop' },
      { width: 390, height: 844, label: 'mobile' },
    ]) {
      await page.setViewportSize(viewport)
      for (const pane of ['notifications', 'telegram', 'calendar', 'department']) {
        await page.goto(`/account/${pane}`)
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Profile settings')
        if (pane === 'notifications') {
          await expect(page.getByRole('switch').first()).toBeVisible()
        } else if (pane === 'telegram') {
          const guide = page.locator('details').filter({ has: page.locator('summary') })
          await expect(guide).not.toHaveAttribute('open', '')
          await expect(
            page.getByRole('button', { name: 'Notification preferences', exact: true }),
          ).toBeVisible()
          await guide.locator('summary').click()
          await expect(guide.locator('ol li')).toHaveCount(3)
          await expect(guide.locator('ol')).toBeVisible()
          await guide.locator('summary').click()
        } else if (pane === 'calendar') {
          await expect(page.getByRole('tab', { name: /Subscription|Feeds/ })).toBeVisible()
        } else {
          await expect(page.getByRole('tab', { name: 'Members', exact: true })).toBeVisible()
        }
        await page.waitForLoadState('networkidle')
        // Inspect settled content rather than the partially transparent route entrance. Reset
        // scroll before full-page screenshots so sticky mobile chrome stays at the page top.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true)
        const accessibility = await new AxeBuilder({ page }).analyze()
        expect(
          accessibility.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
        ).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(`settings-${pane}-${viewport.label}.png`),
          fullPage: true,
        })
      }
    }
    /* eslint-enable no-restricted-syntax */
    await page.goto('/people')
    await expect(page.getByRole('heading', { name: /Research and Policy/ })).toBeVisible()
    const memberCard = page.getByRole('button', { name: /Test Analyst.*Research analyst/ })
    await expect(memberCard).toBeVisible()
    const unitColour = await memberCard.getAttribute('data-unit-color')
    await expect(
      page.locator('section[data-unit-color]').filter({ has: memberCard }),
    ).toHaveAttribute('data-unit-color', unitColour!)
    await memberCard.click()
    const drawer = page.getByRole('dialog')
    await expect(
      drawer.locator('h2:not(.sr-only)').filter({ hasText: 'Test Analyst' }),
    ).toBeVisible()
    await expect(
      drawer.getByRole('heading', { name: 'Hobbies & interests', exact: true }),
    ).toHaveCount(1)
    await expect(drawer.getByText('Expected 2027', { exact: false })).toHaveCount(1)
    const identity = drawer.locator('[data-profile-identity]')
    const identityBounds = await identity.boundingBox()
    expect(identityBounds?.height).toBeLessThan(190)
    await expect(identity.locator('h2')).toHaveText('Test Analyst')
    await expect(drawer.getByText('Example Research Center', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const mobileA11y = await new AxeBuilder({ page }).analyze()
    expect(
      mobileA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
    ).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('professional-profile-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    const contactRows = drawer.locator('[data-profile-contacts] > div')
    const positions = await contactRows.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top),
    )
    expect(positions).toHaveLength(3)
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2)
    const labels = drawer.locator('[data-profile-capabilities] h4')
    await expect(labels).toHaveCount(3)
    await expect(labels.locator('svg')).toHaveCount(3)
    await page.screenshot({ path: testInfo.outputPath('professional-profile-desktop.png') })
    // A head retains the full department toolset; four tabs must wrap cleanly at phone width.
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const headPage = await head.newPage()
    await headPage.setViewportSize({ width: 390, height: 844 })
    await headPage.goto('/account/department')
    await expect(headPage.getByRole('tab')).toHaveCount(4)
    await expect(headPage.getByRole('tab', { name: /Invite/ })).toBeVisible()
    await expect(headPage.getByRole('tab', { name: /Danger/ })).toBeVisible()
    await headPage.waitForLoadState('networkidle')
    expect(
      await headPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const headSettingsA11y = await new AxeBuilder({ page: headPage }).analyze()
    expect(
      headSettingsA11y.violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? '')),
    ).toEqual([])
    await headPage.screenshot({
      path: testInfo.outputPath('head-department-mobile.png'),
      fullPage: true,
    })
  } finally {
    await Promise.allSettled([admin.close(), head.close(), member.close()])
  }
})
