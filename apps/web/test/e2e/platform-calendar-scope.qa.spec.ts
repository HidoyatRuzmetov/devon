/* eslint-disable no-restricted-syntax -- Locale/viewport/focus transitions are sequential. */
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
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

const root = join(import.meta.dirname, '../../../..')
const help = {
  en: 'Events from your departments.',
  ru: 'События ваших управлений.',
  'uz-Latn': 'Boshqarmalaringizdagi tadbirlar.',
  'uz-Cyrl': 'Бошқармаларингиздаги тадбирлар.',
}

test('@qa closing subscription creation restores its actual invoking action', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    await registerUser(context, {
      login: uniqueLogin('calendar.focus'),
      password: examplePassword(),
      givenName: 'Calendar',
      familyName: 'Synthetic focus',
    })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.goto('/calendar?tab=feeds')
    await waitForLoadedRoute(page, '/calendar?tab=feeds')
    for (const name of ['Create subscription', 'Create a subscription']) {
      const opener = page.getByRole('button', { name, exact: true }).first()
      await opener.click()
      const dialog = page.getByRole('dialog', { name: 'New subscription', exact: true })
      await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
    }
    expect((await (await context.request.get('/api/v1/calendar/feeds')).json()).items).toEqual([])
  } finally {
    await context.close()
  }
})

for (const theme of ['light', 'dark']) {
  test(`@qa subscription event scope is clear and readable in all locales in ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(180_000)
    const context = await newFlowContext(browser)
    try {
      await registerUser(context, {
        login: uniqueLogin('calendar.scope'),
        password: examplePassword(),
        givenName: 'Calendar',
        familyName: 'Synthetic scope',
      })
      await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: THEME_STORAGE_KEY,
        value: theme,
      })
      const page = await context.newPage()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const) {
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        const catalogue = JSON.parse(
          readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
        )
        // October 9 user steering defers tiny-screen and enlarged-text matrices for this release.
        // Their earlier failures remain in the retained report, rather than being called fixed.
        for (const [width, height, scale] of [
          [1280, 720, 1],
          [768, 720, 1],
          [390, 600, 1],
        ]) {
          await page.setViewportSize({ width: width!, height: height! })
          await page.goto('/calendar?tab=feeds')
          await waitForLoadedRoute(page, '/calendar?tab=feeds')
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
          await setTextScale(page, scale!)
          await page
            .getByRole('button', { name: catalogue.calendar.feeds.create.submit, exact: true })
            .first()
            .click()
          const dialog = page.getByRole('dialog', {
            name: catalogue.calendar.feeds.create.title,
            exact: true,
          })
          const eventChoice = dialog.getByRole('radio', {
            name: `${catalogue.calendar.feeds.kind.events} ${help[locale]}`,
            exact: true,
          })
          await eventChoice.click()
          await expect(eventChoice).toBeChecked()
          await expect(dialog.getByText(help[locale], { exact: true })).toBeVisible()
          expect(
            await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
          ).toBeLessThanOrEqual(1)
          const scan = await new AxeBuilder({ page })
            .include('[role="dialog"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze()
          expect(scan.violations).toEqual([])
          await settleCapture(page, false)
          await page.screenshot({
            path: test.info().outputPath(`${locale}-${width}-${height}-text${scale! * 100}.png`),
          })
          await page.keyboard.press('Escape')
          await expect(dialog).toBeHidden()
        }
      }
      expect(errors).toEqual([])
      expect((await (await context.request.get('/api/v1/calendar/feeds')).json()).items).toEqual([])
    } finally {
      await context.close()
    }
  })
}
