import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, flowClientHeaders, login } from './flow-api.js'
import { FLOW_WEB_BASE_URL } from './flow-env.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(locale: string, key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing ${locale}:${key}`)
  return value
}
for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
  for (const theme of ['light', 'dark']) {
    test(`@qa card sticky header keeps pointer keyboard and touch targets stable ${locale} ${theme}`, async ({
      browser,
    }) => {
      test.setTimeout(180_000)
      const rows: unknown[] = []
      for (const environment of [
        { width: 1440, height: 900, scale: 1, touch: false },
        { width: 390, height: 600, scale: 1, touch: true },
      ]) {
        const context = await browser.newContext({
          baseURL: FLOW_WEB_BASE_URL,
          extraHTTPHeaders: flowClientHeaders(),
          viewport: environment,
          hasTouch: environment.touch,
        })
        try {
          await login(context, { login: 'demo.boshliq', password: examplePassword })
          expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
          await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
          const title = `QA native target ${randomUUID().slice(0, 8)}`
          const response = await authedPost(context, '/api/v1/cards', { title, kind: 'task' })
          expect(response.status()).toBe(201)
          const { id } = (await response.json()) as { id: string }
          const page = await context.newPage()
          await page.goto('/work')
          await waitForLoadedRoute(page, '/work')
          await setTextScale(page, environment.scale)
          const tile = page.locator(`[data-dnd-card="${id}"]`)
          const checkbox = tile.getByRole('checkbox')
          const titleButton = tile.getByRole('button', { name: title, exact: true })
          await tile.hover()
          await checkbox.check()
          await expect(checkbox).toBeChecked()
          await checkbox.uncheck()
          // Programmatic entry on Title, then a real native backward Tab and Space on selection.
          await titleButton.focus()
          await page.keyboard.press('Shift+Tab')
          await expect(checkbox).toBeFocused()
          await settleCapture(page, false)
          const geometry = await checkbox.evaluate((element) => {
            const column = element.closest('[data-dnd-column]')?.parentElement
            const header = column?.firstElementChild
            const card = element.closest('[data-dnd-card]')
            const isolated = card?.closest('.isolate')
            return {
              checkbox: element.getBoundingClientRect().toJSON(),
              header: header?.getBoundingClientRect().toJSON(),
              margin: getComputedStyle(element).scrollMarginTop,
              isolated: isolated ? getComputedStyle(isolated).isolation : null,
              hitRole: document
                .elementFromPoint(
                  element.getBoundingClientRect().x + element.getBoundingClientRect().width / 2,
                  element.getBoundingClientRect().y + element.getBoundingClientRect().height / 2,
                )
                ?.closest('[role]')
                ?.getAttribute('role'),
            }
          })
          expect(geometry.isolated).toBe('isolate')
          expect(parseFloat(geometry.margin)).toBeGreaterThanOrEqual(geometry.header!.height + 7)
          expect(geometry.checkbox.top).toBeGreaterThanOrEqual(geometry.header!.bottom + 1)
          expect(geometry.hitRole).toBe('checkbox')
          await page.keyboard.press('Space')
          await expect(checkbox).toBeChecked()
          await page.keyboard.press('Space')
          await expect(checkbox).not.toBeChecked()
          if (environment.touch) {
            await checkbox.tap()
            await expect(checkbox).toBeChecked()
            await checkbox.tap()
            await expect(checkbox).not.toBeChecked()
          }
          await titleButton.click()
          await expect(
            page
              .getByRole('dialog')
              .getByRole('textbox', { name: label(locale, 'work.field.title'), exact: true }),
          ).toHaveValue(title)
          await page.keyboard.press('Escape')
          await expect(page.getByRole('dialog')).not.toBeVisible()
          if (environment.touch) {
            await titleButton.tap()
            await expect(page.getByRole('dialog')).toBeVisible()
            await page.keyboard.press('Escape')
          }
          await checkbox.focus()
          const runtime = await tile.evaluate((element) => ({
            unit4: getComputedStyle(document.documentElement).getPropertyValue('--color-unit-4'),
            avatars: [...element.querySelectorAll('[class*="bg-unit-"]')].map((avatar) => ({
              className: avatar.getAttribute('class'),
              background: getComputedStyle(avatar).backgroundColor,
              color: getComputedStyle(avatar).color,
              ancestors: (() => {
                const result = []
                for (
                  let ancestor = avatar.parentElement;
                  ancestor;
                  ancestor = ancestor.parentElement
                )
                  result.push({
                    tag: ancestor.tagName,
                    opacity: getComputedStyle(ancestor).opacity,
                    transform: getComputedStyle(ancestor).transform,
                  })
                return result
              })(),
            })),
          }))
          writeFileSync(
            test.info().outputPath(`runtime-${environment.width}.json`),
            JSON.stringify(runtime, null, 2),
          )
          const screenshot = test
            .info()
            .outputPath(`card-target-${environment.width}-text${environment.scale * 100}.png`)
          await page.screenshot({ path: screenshot })
          expect(
            (
              await new AxeBuilder({ page })
                .include(`[data-dnd-card="${id}"]`)
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze()
            ).violations,
          ).toEqual([])
          const persisted = await context.request.get(`/api/v1/cards/${id}`)
          expect(persisted.status()).toBe(200)
          expect((await persisted.json()).assigneeUserId).toBeNull()
          rows.push({
            ...environment,
            geometry,
            screenshot,
            pixelInspected: false,
            boundary:
              'Native mouse, backward Tab/Space after programmatic Title entry, touch emulation where stated; no force or click retry.',
          })
          writeFileSync(
            test.info().outputPath('card-targets.json'),
            JSON.stringify({ locale, theme, rows }, null, 2),
          )
        } finally {
          await context.close()
        }
      }
    })
  }
}
