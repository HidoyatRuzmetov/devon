/* eslint-disable no-restricted-syntax -- Locale/theme/viewport and keyboard transitions inspect one shared browser page sequentially; parallel changes would produce false environment evidence. */
import { readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { authedPatch, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

// Explicit synthetic example credentials; values stay identical to the original fixtures.
const qaExampleCredential1 = 'Ishonchli#2026'

const root = join(import.meta.dirname, '../../../..')
const locales = {
  en: 'English',
  'uz-Latn': 'Oʻzbekcha (lotin)',
  'uz-Cyrl': 'Ўзбекча (кирилл)',
  ru: 'Русский',
}
type Catalogue = {
  shell: { locale: { aria: string }; theme: { toggle: string }; search: { trigger: string } }
}
const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
  ) as Catalogue

test('@qa shared shell all locales, themes and responsive header controls', async ({
  browser,
}, info) => {
  test.setTimeout(360_000)
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.goto('/')
    await waitForLoadedRoute(page, '/')
    let current = catalogue('en')
    const artifacts = join(
      root,
      'artifacts/qa/2026-10/shell/runs',
      process.env['QA_RUN_ID'] ?? 'default',
      info.project.name,
    )
    mkdirSync(artifacts, { recursive: true })
    for (const [locale, autonym] of Object.entries(locales)) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.getByRole('button', { name: current.shell.locale.aria, exact: true }).click()
      await page.getByRole('menuitemradio', { name: autonym, exact: true }).click()
      current = catalogue(locale)
      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/me')
          expect(response.status()).toBe(200)
          return ((await response.json()) as { user: { locale: string } }).user.locale
        })
        .toBe(locale)
      await expect(
        page.getByRole('button', { name: current.shell.locale.aria, exact: true }),
      ).toBeVisible()
      for (const theme of ['light', 'dark']) {
        for (
          let count = 0;
          count < 3 && (await page.locator('html').getAttribute('data-theme')) !== theme;
          count++
        ) {
          const preference = await page.evaluate(
            (key) => localStorage.getItem(key) ?? 'light',
            THEME_STORAGE_KEY,
          )
          const next = preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light'
          await page.getByRole('button', { name: current.shell.theme.toggle, exact: true }).click()
          await expect
            .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
            .toBe(next)
          await expect(page.locator('html')).not.toHaveClass(/devon-theme-transition/)
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        for (const width of [1920, 1440, 1280, 1024, 768, 390, 320]) {
          await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
          await settleCapture(page, false)
          const header = page.getByRole('banner')
          const geometry = await header.evaluate((element) => {
            const buttons = [...element.querySelectorAll('button')]
              .map((button) => {
                const r = button.getBoundingClientRect()
                return {
                  name: button.getAttribute('aria-label') ?? button.textContent,
                  left: r.left,
                  right: r.right,
                  top: r.top,
                  bottom: r.bottom,
                  width: r.width,
                  height: r.height,
                }
              })
              .filter((button) => button.width > 0 && button.height > 0)
            return { viewport: innerWidth, scroll: document.documentElement.scrollWidth, buttons }
          })
          expect(geometry.scroll, `${locale}/${theme}/${width}: document fits`).toBeLessThanOrEqual(
            width + 1,
          )
          for (const button of geometry.buttons) {
            expect(button.width, `${button.name}: target width`).toBeGreaterThanOrEqual(24)
            expect(button.height, `${button.name}: target height`).toBeGreaterThanOrEqual(24)
            expect(button.left).toBeGreaterThanOrEqual(-1)
            expect(button.right).toBeLessThanOrEqual(width + 1)
          }
          const search = header.getByRole('button', { name: current.shell.search.trigger })
          const labelFits = await search.evaluate((element) => {
            const label = element.querySelector('[data-shell-label]')
            const kbd = element.querySelector('kbd')
            if (!label || !kbd) return true
            const text = document.createRange()
            text.selectNodeContents(label)
            return text.getBoundingClientRect().right <= kbd.getBoundingClientRect().left
          })
          expect(labelFits, `${locale}/${theme}/${width}: readable search label`).toBe(true)
          await header.screenshot({
            path: join(artifacts, `${locale}-${theme}-${width}-header.png`),
          })
          if (width === 768) {
            await settleCapture(page)
            await page.screenshot({
              path: join(artifacts, `${locale}-${theme}-768-home.png`),
              fullPage: true,
            })
          }
        }
        for (const width of [1440, 768, 320]) {
          await page.setViewportSize({ width, height: 480 })
          await setTextScale(page, 2)
          await settleCapture(page)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
            `${locale}/${theme}/${width}: enlarged short reflow`,
          ).toBeLessThanOrEqual(width + 1)
          const clipped = await page
            .locator('header button [data-shell-label], aside button [data-shell-label]')
            .evaluateAll((labels) =>
              labels.flatMap((label) => {
                const button = label.closest('button')!
                const bounds = button.getBoundingClientRect()
                if (!bounds.width || !bounds.height) return []
                const range = document.createRange()
                range.selectNodeContents(label)
                const rects = [...range.getClientRects()]
                return rects.some(
                  (rect) =>
                    rect.left < bounds.left - 1 ||
                    rect.right > bounds.right + 1 ||
                    rect.top < bounds.top - 1 ||
                    rect.bottom > bounds.bottom + 1,
                )
                  ? [label.textContent]
                  : []
              }),
            )
          expect(clipped, `${locale}/${theme}/${width}: shell text stays within controls`).toEqual(
            [],
          )
          await page.getByRole('banner').screenshot({
            path: join(artifacts, `${locale}-${theme}-${width}-text200-short-header.png`),
          })
          await page.screenshot({
            path: join(artifacts, `${locale}-${theme}-${width}-text200-short-home.png`),
            fullPage: true,
          })
          await setTextScale(page, 1)
        }
      }
    }
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 600 })
      const search = page
        .getByRole('banner')
        .getByRole('button', { name: current.shell.search.trigger })
      await search.focus()
      await search.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('dialog').press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(search).toBeFocused()
      const locale = page.getByRole('button', { name: current.shell.locale.aria, exact: true })
      await locale.focus()
      await locale.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByRole('dialog').press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(locale).toBeFocused()
    }
  } finally {
    await context.close()
  }
})

test('@qa repeated palette shortcut preserves the original opener', async ({ browser }) => {
  const context = await newFlowContext(browser)
  try {
    await login(context, { login: 'demo.boshliq', password: qaExampleCredential1 })
    expect((await authedPatch(context, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await context.newPage()
    await page.goto('/')
    await waitForLoadedRoute(page, '/')
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 600 })
      const search = page
        .getByRole('banner')
        .getByRole('button', { name: catalogue('en').shell.search.trigger })
      await search.focus()
      await search.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const input = dialog.getByRole('combobox')
      await expect(input).toBeFocused()
      await input.press('ControlOrMeta+k')
      await expect(dialog).toBeVisible()
      await input.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(search).toBeFocused()
    }
  } finally {
    await context.close()
  }
})
