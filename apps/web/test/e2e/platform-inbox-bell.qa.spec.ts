/* eslint-disable no-restricted-syntax -- Count/viewport cases must execute sequentially on this same browser page and its intercepted count response. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

test('@qa unread count remains separate from its bell at enlarged text', async ({
  browser,
}, info) => {
  test.setTimeout(90_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    let count = 2
    // Render boundary values through the actual query and shell. This fixture does not prove
    // persisted notification mutations; those have separate actual API/browser journeys.
    await page.route('**/api/v1/notifications?*', async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: { ...body, unreadCount: count } })
    })
    const evidence = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/shell/bell',
      process.env['QA_RUN_ID'] ?? 'default',
      info.project.name,
    )
    mkdirSync(evidence, { recursive: true })
    for (count of [2, 0, 1, 99, 1000]) {
      await page.goto('/')
      await waitForLoadedRoute(page, '/')
      const bell = page
        .getByRole('banner')
        .locator('button')
        .filter({ has: page.locator('svg.lucide-bell') })
      await expect(bell).toBeVisible()
      await expect(bell).toHaveAccessibleName(`Notifications: ${count} unread`)
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: 480 })
        for (const scale of [1, 2]) {
          await setTextScale(page, scale)
          await settleCapture(page, false)
          const geometry = await bell.evaluate((button) => {
            const icon = button.querySelector('svg')!.getBoundingClientRect()
            const badge = button.querySelector('span[aria-hidden="true"]')?.getBoundingClientRect()
            const bounds = button.getBoundingClientRect()
            return {
              icon: { left: icon.left, right: icon.right },
              badge: badge
                ? { left: badge.left, right: badge.right, top: badge.top, bottom: badge.bottom }
                : null,
              button: {
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
              },
              scrollWidth: document.documentElement.scrollWidth,
              width: innerWidth,
            }
          })
          await page
            .getByRole('banner')
            .screenshot({ path: join(evidence, `${count}-${width}-${scale}.png`) })
          writeFileSync(
            join(evidence, `${count}-${width}-${scale}.json`),
            JSON.stringify(geometry, null, 2),
          )
          expect(geometry.scrollWidth).toBeLessThanOrEqual(width + 1)
          if (count > 0) {
            expect(geometry.badge).not.toBeNull()
            expect(
              geometry.badge!.left,
              'count must not cover the bell icon',
            ).toBeGreaterThanOrEqual(geometry.icon.right + 1)
            expect(geometry.badge!.right).toBeLessThanOrEqual(geometry.button.right)
            expect(geometry.badge!.top).toBeGreaterThanOrEqual(geometry.button.top)
            expect(geometry.badge!.bottom).toBeLessThanOrEqual(geometry.button.bottom)
          } else expect(geometry.badge).toBeNull()
        }
      }
    }
  } finally {
    await context.close()
  }
})
