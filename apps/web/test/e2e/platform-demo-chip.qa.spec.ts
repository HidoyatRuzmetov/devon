/* eslint-disable no-restricted-syntax -- Locale and open/close transitions inspect the same owned synthetic account sequentially. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

type Catalogue = { shell: { demo: { chip: { label: string }; popover: string } } }
const root = join(import.meta.dirname, '../../../..')
for (const theme of ['light', 'dark']) {
  test(`@qa mobile demo explanation retains the complete enlarged label and keyboard recovery in ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const context = await newFlowContext(browser)
    try {
      await registerUser(context, {
        login: uniqueLogin('demo.label'),
        password: examplePassword(),
        givenName: 'Demo',
        familyName: 'Synthetic',
      })
      await context.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), {
        key: THEME_STORAGE_KEY,
        theme,
      })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width: 320, height: 480 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        const catalogue = JSON.parse(
          readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
        ) as Catalogue
        await page.goto('/')
        await waitForLoadedRoute(page, '/')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await setTextScale(page, 2)
        await settleCapture(page)
        const chip = page.getByRole('button', {
          name: catalogue.shell.demo.chip.label,
          exact: true,
        })
        await expect(chip).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`${locale}-closed.png`) })
        const geometry = await chip.evaluate((button) => {
          const row = button.parentElement!
          const bounds = row.getBoundingClientRect()
          const style = getComputedStyle(row)
          const left = bounds.left + parseFloat(style.paddingLeft)
          const right = bounds.right - parseFloat(style.paddingRight)
          const box = button.getBoundingClientRect()
          const text = document.createRange()
          text.selectNodeContents(button)
          return {
            left,
            right,
            button: { left: box.left, right: box.right, width: box.width, height: box.height },
            text: Array.from(text.getClientRects()).map((rect) => ({
              left: rect.left,
              right: rect.right,
            })),
          }
        })
        expect(geometry.button.left, `${locale}: row left padding`).toBeGreaterThanOrEqual(
          geometry.left - 1,
        )
        expect(geometry.button.right, `${locale}: row right padding`).toBeLessThanOrEqual(
          geometry.right + 1,
        )
        expect(geometry.button.width).toBeGreaterThanOrEqual(24)
        expect(geometry.button.height).toBeGreaterThanOrEqual(24)
        geometry.text.forEach((rect) => {
          expect(rect.left).toBeGreaterThanOrEqual(geometry.left - 1)
          expect(rect.right).toBeLessThanOrEqual(geometry.right + 1)
        })
        await chip.click()
        const explanation = page.getByText(catalogue.shell.demo.popover, { exact: true })
        await expect(explanation).toBeVisible()
        await page.screenshot({ path: test.info().outputPath(`${locale}-open.png`) })
        const explanationBox = await explanation.boundingBox()
        expect(explanationBox!.x).toBeGreaterThanOrEqual(0)
        expect(explanationBox!.x + explanationBox!.width).toBeLessThanOrEqual(320)
        await page.keyboard.press('Escape')
        await expect(explanation).toBeHidden()
        await expect(chip).toBeFocused()
      }
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}
