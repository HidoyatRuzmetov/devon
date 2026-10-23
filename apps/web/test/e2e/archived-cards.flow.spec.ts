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

test('archives retain visible completion and require explicit restoration @flow', async ({
  browser,
}, info) => {
  test.setTimeout(120_000)
  const admin = await newFlowContext(browser)
  const context = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    await createApprovedDepartment(context, admin, {
      headLogin: uniqueLogin('archive.head'),
      headPassword: examplePassword(),
      departmentName: 'Archive presentation QA',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const me = (await (await context.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const [unfinished, finished] = await Promise.all(
      ['Unfinished archive', 'Completed archive'].map(async (title) => {
        const response = await authedPost(context, '/api/v1/cards', {
          title,
          assigneeUserId: me.user.id,
          priority: title === 'Unfinished archive' ? 'urgent' : 'high',
          dueAt: '2026-10-22T12:00:00Z',
        })
        expect(response.status()).toBe(201)
        return (await response.json()) as { id: string }
      }),
    )
    expect(
      (await authedPatch(context, `/api/v1/cards/${finished!.id}`, { status: 'done' })).status(),
    ).toBe(200)
    const archived = await Promise.all(
      [unfinished!, finished!].map((card) =>
        authedPatch(context, `/api/v1/cards/${card.id}`, { status: 'archived' }),
      ),
    )
    for (const response of archived) expect(response.status()).toBe(200)
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
    const densityButton = page.getByRole('button', { name: /^(Roomy|Compact)$/ })
    await expect(densityButton).toBeVisible()
    const previousDensityLabel = await densityButton.innerText()
    await densityButton.click()
    await expect(densityButton).not.toHaveText(previousDensityLabel)
    await page.goto('/work/mine')
    await page.getByRole('button', { name: 'Completed & archived (2)' }).click()
    for (const title of ['Unfinished archive', 'Completed archive'])
      await expect(page.getByRole('checkbox', { name: title })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Unfinished archive' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Completed archive' })).toBeChecked()
    await expect(page.getByText('Unfinished archive', { exact: true })).not.toHaveClass(
      /line-through/,
    )
    await expect(page.getByText('Completed archive', { exact: true })).toHaveClass(/line-through/)
    await expect(page.getByRole('img', { name: 'Archived · Completed' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Archived · Not completed' })).toBeVisible()
    expect(
      (await page.getByText('Unfinished archive', { exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(180)
    await page.screenshot({ path: info.outputPath('archive-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('img', { name: 'Archived · Not completed' })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect(
      (await page.getByText('Unfinished archive', { exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(180)
    await page.screenshot({ path: info.outputPath('archive-mobile.png'), fullPage: true })
    const axe = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    )
    await page.goto('/work/archive')
    await expect(page).toHaveURL(/\/work\/mine\?q=status%3Aarchived&completed=1$/)
    await expect(
      page
        .getByRole('navigation', { name: 'Cards', exact: true })
        .getByRole('link', { name: 'Archive', exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'Archived · Not completed' })).toBeVisible()
    expect(
      (await page.getByText('Unfinished archive', { exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(180)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.screenshot({ path: info.outputPath('archive-list-mobile.png'), fullPage: true })
    await page.getByText('Unfinished archive', { exact: true }).click()
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }),
    ).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByRole('img', { name: 'Archived · Not completed' })).toHaveCount(0)
  } finally {
    await context.close()
    await admin.close()
  }
})
