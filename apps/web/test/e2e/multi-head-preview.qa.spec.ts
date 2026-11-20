import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installHeadPreview, previewDepartmentId } from './multi-head-preview-fixture.js'
import { settleCapture, waitForLoadedRoute } from './platform-capture.js'

const screenshots = resolve(
  import.meta.dirname,
  '../../../../artifacts/qa/multiple-heads/ui-preview',
)
async function capture(page: Page, name: string, fullPage = true) {
  await mkdir(screenshots, { recursive: true })
  await waitForLoadedRoute(page, new URL(page.url()).pathname)
  await settleCapture(page, fullPage)
  await page.screenshot({ path: resolve(screenshots, `${name}.png`), fullPage })
}

test('UI preview: co-head roster, role confirmations, settings, hub, directory and chart', async ({
  page,
}) => {
  const fixture = await installHeadPreview(page)
  await page.goto(`/department?id=${previewDepartmentId}&tab=members`)
  await expect(page.getByText('Department heads (2)')).toBeVisible()
  await capture(page, '01-members-two-heads-desktop')
  await page.getByRole('button', { name: 'Actions for Aziza Rahimova' }).click()
  await page.getByRole('menuitem', { name: 'Appoint as head' }).click()
  await capture(page, '02-appoint-head-confirmation')
  await page.getByRole('dialog').getByRole('button', { name: 'Appoint as head' }).click()
  await expect(page.getByText('Department heads (3)')).toBeVisible()
  expect(
    fixture.requests.find((request) => request.method === 'PATCH' && request.path.endsWith('/role'))
      ?.body,
  ).toEqual({ role: 'head', expectedVersion: 1 })
  await capture(page, '03-members-three-heads-desktop')
  await page.getByRole('button', { name: 'Actions for Nodira Karimova' }).click()
  await page.getByRole('menuitem', { name: 'Remove head role' }).click()
  await capture(page, '04-remove-head-confirmation')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Step down as head' }).click()
  await capture(page, '05-step-down-confirmation')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('tab', { name: 'General', exact: true }).click()
  await capture(page, '06-shared-settings')
  await page.getByRole('tab', { name: 'Invite', exact: true }).click()
  await capture(page, '07-shared-invitations')
  await page.goto('/departments')
  await expect(page.getByText('Department heads (3)')).toBeVisible()
  await capture(page, '08-hub-all-heads')
  await page.goto('/people')
  await waitForLoadedRoute(page, '/people')
  await capture(page, '09-people-leadership-group')
  await page.goto('/structure')
  await page.getByRole('tab', { name: /chart/i }).click()
  await expect(page.getByRole('tree')).toContainText('Nodira Karimova')
  await expect(page.getByRole('tree')).toContainText('Aziza Rahimova')
  await capture(page, '10-organization-chart-all-heads')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /PNG/ }).click()
  await (await download).saveAs(resolve(screenshots, '11-organization-chart-export.png'))
  expect([...fixture.missing]).toEqual([])
})

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
  test(`UI preview: ${locale} mobile, dark and last-head safeguards`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(() => localStorage.setItem('devon_theme', 'dark'))
    await installHeadPreview(page, locale, 1)
    const catalogue = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
        'utf8',
      ),
    )
    await page.goto(`/department?id=${previewDepartmentId}&tab=members`)
    await expect(
      page.getByRole('button', { name: catalogue.departments.members.leave }),
    ).toBeDisabled()
    await expect(page.getByText(catalogue.departments.members.leaveBlockedHead)).toBeVisible()
    await page.getByText(catalogue.departments.members.leaveBlockedHead).scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await capture(page, `12-last-head-mobile-dark-${locale}`, false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
  })
}

test('UI preview: an ordinary member sees the leadership list without management actions', async ({
  page,
}) => {
  await installHeadPreview(page, 'en', 2, 2)
  await page.goto(`/department?id=${previewDepartmentId}&tab=members`)
  await expect(page.getByText('Department heads (2)')).toBeVisible()
  await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0)
  await capture(page, '13-member-read-only-leadership')
})

test('UI preview: administration shows every department head in the table and detail', async ({
  page,
}) => {
  const fixture = await installHeadPreview(page, 'en', 3, 0, true)
  await page.goto('/admin/departments')
  await expect(page.getByRole('table')).toContainText(
    'Anvar Aliyev, Nodira Karimova, Aziza Rahimova',
  )
  await capture(page, '14-admin-department-list')
  await page.getByRole('button', { name: 'Raqamli rivojlanish boshqarmasi', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Anvar Aliyev, Nodira Karimova, Aziza Rahimova',
  )
  await capture(page, '15-admin-department-detail')
  expect([...fixture.missing]).toEqual([])
})

test('UI preview: the second head has the same management controls', async ({ page }) => {
  await installHeadPreview(page, 'en', 2, 1)
  await page.goto(`/department?id=${previewDepartmentId}&tab=members`)
  await expect(page.getByRole('tab', { name: 'Invite', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Aziza Rahimova' }).click()
  await expect(page.getByRole('menuitem', { name: 'Appoint as head' })).toBeVisible()
  await capture(page, '16-second-head-management')
})

test('UI preview: admin receives an explanation when locking the last head is rejected', async ({
  page,
}) => {
  await installHeadPreview(page, 'en', 1, 0, true)
  await page.goto('/admin/accounts')
  await page
    .getByRole('row')
    .filter({ hasText: 'Anvar Aliyev' })
    .getByRole('button', { name: 'Actions', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Lock', exact: true }).click()
  await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Preview safeguard check')
  await page.getByRole('dialog').getByRole('button', { name: 'Lock', exact: true }).click()
  await expect(
    page
      .getByRole('dialog')
      .getByText(
        'This account is the last active head of a department. Appoint another active head before locking or deleting it.',
      ),
  ).toBeVisible()
  await capture(page, '17-admin-last-head-protection')
})
