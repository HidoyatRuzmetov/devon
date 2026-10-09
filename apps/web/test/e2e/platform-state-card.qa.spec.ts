/* eslint-disable no-restricted-syntax -- Locale, state and native keyboard transitions operate sequentially on one page. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  examplePassword,
  newFlowContext,
  registerUser,
  uniqueLogin,
} from './flow-api.js'
import { setTextScale, settleCapture } from './platform-capture.js'
import { assertStateCardFits } from './state-card-geometry.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

type Catalogue = {
  state: {
    error: { title: string; body: string; action: string }
    denied: { title: string; body: string; action: string }
    offline: { banner: string; body: string }
  }
}
const root = join(import.meta.dirname, '../../../..')
for (const theme of ['light', 'dark']) {
  test(`@qa forced shared recovery cards retain enlarged text and native focus in ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const context = await newFlowContext(browser)
    try {
      await registerUser(context, {
        login: uniqueLogin('state.geometry'),
        password: examplePassword(),
        givenName: 'Recovery',
        familyName: 'Synthetic',
      })
      await context.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), {
        key: THEME_STORAGE_KEY,
        theme,
      })
      const page = await context.newPage()
      await page.setViewportSize({ width: 320, height: 480 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        const catalogue = JSON.parse(
          readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
        ) as Catalogue
        for (const kind of ['error', 'forbidden', 'offline']) {
          const content =
            kind === 'error'
              ? catalogue.state.error
              : kind === 'forbidden'
                ? catalogue.state.denied
                : {
                    title: catalogue.state.offline.banner,
                    body: catalogue.state.offline.body,
                    action: catalogue.state.error.action,
                  }
          await page.goto(`/?__state=${kind}`)
          const heading = page
            .locator('main')
            .getByRole('heading', { name: content.title, exact: true })
          await expect(heading).toBeVisible()
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await setTextScale(page, 2)
          await settleCapture(page)
          await assertStateCardFits(heading, `${locale}/${theme}/${kind}/320/text200`)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(321)
          const action = page.locator('main [data-primary]')
          await expect(action).toHaveAccessibleName(content.action)
          for (
            let attempts = 0;
            attempts < 40 &&
            !(await action.evaluate((element) => element === document.activeElement));
            attempts++
          ) {
            await page.keyboard.press('Tab')
          }
          await expect(action).toBeFocused()
          const focusGeometry = () =>
            action.evaluate((element) => {
              const box = element.getBoundingClientRect()
              const top = element.ownerDocument.elementFromPoint(
                box.left + box.width / 2,
                box.top + box.height / 2,
              )
              const samplePoints = [
                [box.left + box.width / 2, box.top + 3],
                [box.left + box.width / 2, box.bottom - 3],
                [box.left + 3, box.top + box.height / 2],
                [box.right - 3, box.top + box.height / 2],
              ]
              const edgesVisible = samplePoints.every(([x, y]) => {
                const hit = element.ownerDocument.elementFromPoint(x!, y!)
                return !!hit && element.contains(hit)
              })
              return {
                visible:
                  box.top >= 0 &&
                  box.bottom <= innerHeight &&
                  !!top &&
                  element.contains(top) &&
                  edgesVisible,
                box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
                scrollY,
                viewportHeight: innerHeight,
                pageHeight: document.documentElement.scrollHeight,
                coveringElement: top?.tagName,
                coveringClass: top?.getAttribute('class'),
                scrollMarginTop: getComputedStyle(element).scrollMarginTop,
                scrollMarginBottom: getComputedStyle(element).scrollMarginBottom,
              }
            })
          await test.info().attach(`${locale}-${kind}-initial-focus`, {
            body: JSON.stringify(await focusGeometry(), null, 2),
            contentType: 'application/json',
          })
          try {
            await expect
              .poll(async () => (await focusGeometry()).visible, {
                message: 'Native focus is visible and not covered by sticky navigation',
                timeout: 3000,
              })
              .toBe(true)
          } finally {
            await test.info().attach(`${locale}-${kind}-settled-focus`, {
              body: JSON.stringify(await focusGeometry(), null, 2),
              contentType: 'application/json',
            })
            await page.screenshot({ path: test.info().outputPath(`${locale}-${kind}-focus.png`) })
          }
          await settleCapture(page)
          await page.screenshot({
            path: test.info().outputPath(`${locale}-${kind}-full.png`),
            fullPage: true,
          })
          const accessibility = await new AxeBuilder({ page })
            .include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
          expect(accessibility.violations).toEqual([])
        }
      }
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
}
