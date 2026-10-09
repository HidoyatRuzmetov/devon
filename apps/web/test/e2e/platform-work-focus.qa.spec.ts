/* eslint-disable no-restricted-syntax -- Actual Tab order must be exercised sequentially. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

const catalogue = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../../packages/i18n/messages/en.generated.json'),
    'utf8',
  ),
)
for (const environment of [
  { width: 360, height: 225, scale: 1 },
  { width: 390, height: 600, scale: 2 },
]) {
  test(`@qa native bulk-action focus stays outside navigation at ${environment.width}x${environment.height} text${environment.scale * 100}`, async ({
    browser,
  }) => {
    const context = await newFlowContext(browser)
    const admin = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      await createApprovedDepartment(context, admin, {
        headLogin: uniqueLogin('focus.head'),
        headPassword: examplePassword(),
        departmentName: 'Synthetic native focus',
      })
      expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
      expect(
        (await authedPost(context, '/api/v1/labels', { name: 'Synthetic focus label' })).status(),
      ).toBe(201)
      const created = await authedPost(context, '/api/v1/cards', {
        title: 'Synthetic focused task',
      })
      expect(created.status()).toBe(201)
      const { id } = await created.json()
      const page = await context.newPage()
      await page.setViewportSize({ width: environment.width, height: environment.height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto(`/work?card=${id}`)
      await waitForLoadedRoute(page, '/work')
      await setTextScale(page, environment.scale)
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('textbox', { name: catalogue.work.field.title, exact: true }),
      ).toHaveValue('Synthetic focused task')
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await page.locator(`[data-dnd-card="${id}"]`).getByRole('checkbox').check()
      const toolbar = page.getByRole('toolbar', {
        name: catalogue.work.bulk.toolbarLabel,
        exact: true,
      })
      await toolbar.getByRole('button', { name: catalogue.cmd.group.actions, exact: true }).click()
      // Pointer disclosure first; all following movement is native Tab rather than locator.focus().
      for (const name of [
        catalogue.work.bulk.clear,
        catalogue.work.bulk.assign,
        catalogue.work.bulk.label,
        catalogue.work.bulk.priority,
      ]) {
        await page.keyboard.press('Tab')
        await expect(toolbar.getByRole('button', { name, exact: true })).toBeFocused()
      }
      const priority = toolbar.getByRole('button', {
        name: catalogue.work.bulk.priority,
        exact: true,
      })
      await expect(priority).toHaveJSProperty('type', 'button')
      expect(await priority.evaluate((button) => button.matches(':focus-visible'))).toBe(true)
      await settleCapture(page, false)
      const measure = () =>
        priority.evaluate((button) => {
          const header = document.querySelector('header')!
          const navigation = document.querySelector('nav[class*="bottom-0"]')!
          const rect = button.getBoundingClientRect()
          return {
            top: rect.top,
            bottom: rect.bottom,
            headerBottom: header.getBoundingClientRect().bottom,
            navigationTop: navigation.getBoundingClientRect().top,
            focusVisible: button.matches(':focus-visible'),
            scrollY: window.scrollY,
          }
        })
      const bounds = await measure()
      await test.info().attach('native-priority-focus-bounds', {
        body: JSON.stringify(bounds),
        contentType: 'application/json',
      })
      await page.screenshot({ path: test.info().outputPath('native-priority-focus.png') })
      expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerBottom + 2)
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.navigationTop - 2)
      await priority.press('Enter')
      await expect(
        page.getByRole('menuitem', { name: catalogue.work.priority.high, exact: true }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(priority).toBeFocused()
      const restored = await measure()
      expect(restored.top).toBeGreaterThanOrEqual(restored.headerBottom + 2)
      expect(restored.bottom).toBeLessThanOrEqual(restored.navigationTop - 2)
    } finally {
      await admin.close()
      await context.close()
    }
  })
}
