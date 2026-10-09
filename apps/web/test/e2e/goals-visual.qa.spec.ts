/* eslint-disable no-restricted-syntax -- One real session owns sequential viewport/dialog/locale state; these transitions cannot run independently. */
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  csrfToken,
  examplePassword,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { visualLabel } from './visual-label.js'

for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Goals populated/create/conflict ${locale} ${theme} reflow and keyboard recovery`, async ({
      browser,
    }, testInfo) => {
      const head = await newFlowContext(browser)
      const admin = await newFlowContext(browser)
      const external: string[] = []
      await Promise.all(
        [head, admin].map((context) =>
          context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === FLOW_WEB_BASE_URL) return route.continue()
            external.push(route.request().url())
            return route.abort('blockedbyclient')
          }),
        ),
      )
      try {
        await loginAsSuperAdmin(admin)
        const department = await createApprovedDepartment(head, admin, {
          headLogin: uniqueLogin('goal.visual'),
          headPassword: examplePassword(),
          departmentName: 'Synthetic Goals visual department',
        })
        expect(
          (
            await head.request.put(`/api/v1/departments/${department.departmentId}/features`, {
              headers: { 'x-csrf-token': await csrfToken(head) },
              data: { features: { goals: true } },
            })
          ).status(),
        ).toBe(200)
        expect((await authedPatch(head, '/api/v1/me', { locale })).status()).toBe(200)
        const longDescription = `Synthetic description ${'longword'.repeat(28)}`
        const title = 'Synthetic long goal title for all four locales and meaningful progress'
        const created = await authedPost(head, '/api/v1/goals', {
          title,
          description: longDescription,
          filter: 'priority:high',
          metric: 'on_time_rate',
          targetValue: 85,
          dueOn: '2027-01-31',
        })
        expect(created.status()).toBe(201)
        const { id } = await created.json()
        const page = await head.newPage()
        await page.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
        for (const size of [
          { width: 320, height: 640, scale: 1 },
          { width: 768, height: 800, scale: 1 },
          { width: 1280, height: 600, scale: 2 },
        ]) {
          await page.setViewportSize({ width: size.width, height: size.height })
          await page.goto('/goals')
          await waitForLoadedRoute(page, '/goals')
          await setTextScale(page, size.scale)
          await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
          await settleCapture(page)
          await page.screenshot({
            path: testInfo.outputPath(`populated-${size.width}-${size.scale}.png`),
            fullPage: true,
          })
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(size.width + 1)
          const populatedAxe = await new AxeBuilder({ page }).include('main').analyze()
          expect(
            populatedAxe.violations.filter((issue) =>
              ['serious', 'critical'].includes(issue.impact ?? ''),
            ),
          ).toEqual([])
          await page
            .getByRole('button', {
              name: visualLabel('work', locale, 'work.goals.create'),
              exact: true,
            })
            .first()
            .click()
          const create = page.getByRole('dialog', {
            name: visualLabel('work', locale, 'work.goals.newTitle'),
            exact: true,
          })
          await expect(create).toBeVisible()
          await settleCapture(page, false)
          await page.screenshot({
            path: testInfo.outputPath(`create-${size.width}-${size.scale}.png`),
          })
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(size.width + 1)
          const createAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
          expect(
            createAxe.violations.filter((issue) =>
              ['serious', 'critical'].includes(issue.impact ?? ''),
            ),
          ).toEqual([])
          await page.keyboard.press('Escape')
          await expect(create).toBeHidden()
          const edit = page.getByRole('button', {
            name: visualLabel('work', locale, 'work.goals.edit').replace('{title}', title),
            exact: true,
          })
          await edit.click()
          const dialog = page.getByRole('dialog', {
            name: visualLabel('work', locale, 'work.goals.editTitle'),
            exact: true,
          })
          const authoritative = await (await head.request.get('/api/v1/goals')).json()
          expect(
            (
              await authedPatch(head, `/api/v1/goals/${id}`, {
                description: longDescription,
                version: authoritative.find((goal: { id: string }) => goal.id === id).version,
              })
            ).status(),
          ).toBe(204)
          const refused = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === `/api/v1/goals/${id}` &&
              response.request().method() === 'PATCH',
          )
          await dialog
            .getByRole('button', {
              name: visualLabel('work', locale, 'work.goals.save'),
              exact: true,
            })
            .click()
          expect((await refused).status()).toBe(409)
          await expect(dialog.getByRole('alert')).toBeVisible()
          await settleCapture(page, false)
          await page.screenshot({
            path: testInfo.outputPath(`conflict-${size.width}-${size.scale}.png`),
          })
          const conflictAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze()
          expect(
            conflictAxe.violations.filter((issue) =>
              ['serious', 'critical'].includes(issue.impact ?? ''),
            ),
          ).toEqual([])
          await dialog
            .getByRole('button', {
              name: visualLabel('goals-controls', locale, 'goalsControls.reload'),
              exact: true,
            })
            .focus()
          const focusBounds = await page.locator(':focus').evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return {
              top: bounds.top,
              bottom: bounds.bottom,
              right: bounds.right,
              left: bounds.left,
            }
          })
          expect(focusBounds.top).toBeGreaterThanOrEqual(0)
          expect(focusBounds.bottom).toBeLessThanOrEqual(size.height)
          expect(focusBounds.left).toBeGreaterThanOrEqual(0)
          expect(focusBounds.right).toBeLessThanOrEqual(size.width)
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
          await expect(edit).toBeFocused()
        }
      } finally {
        await Promise.all([head.close(), admin.close()])
        expect(external).toEqual([])
      }
    })
  }
}
