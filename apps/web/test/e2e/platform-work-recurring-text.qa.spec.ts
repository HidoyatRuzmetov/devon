/* eslint-disable no-restricted-syntax -- Native viewport and text-range checks are sequential. */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
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
    test(`@qa recurrence explanation text fits narrow enlarged viewport ${locale} ${theme}`, async ({
      browser,
    }) => {
      const context = await newFlowContext(browser)
      try {
        await login(context, { login: 'demo.boshliq', password: examplePassword })
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        const title = `QA recurrence text ${randomUUID().slice(0, 8)}`
        const response = await authedPost(context, '/api/v1/cards', {
          title,
          kind: 'task',
          dueAt: '2026-11-30T12:00:00Z',
          recurrence: { freq: 'monthly', interval: 2, mode: 'schedule', dayOfMonth: 31 },
        })
        expect(response.status()).toBe(201)
        const { id } = (await response.json()) as { id: string }
        const page = await context.newPage()
        const rows: unknown[] = []
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 600 })
          await page.goto(`/work?card=${id}`)
          await waitForLoadedRoute(page, '/work')
          await setTextScale(page, 2)
          await expect(
            page
              .getByRole('dialog')
              .getByRole('textbox', { name: label(locale, 'work.field.title'), exact: true }),
          ).toHaveValue(title)
          const toggle = page.locator(`button[aria-controls="card-repeat-${id}"]`)
          await toggle.focus()
          if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.press('Enter')
          const panel = page.locator(`[id="card-repeat-${id}"]`)
          await settleCapture(page, false)
          await expect
            .poll(() =>
              panel.evaluate((element) => element.clientHeight >= element.scrollHeight - 1),
            )
            .toBe(true)
          await panel.getByRole('radio').first().focus()
          const screenshot = test.info().outputPath(`recurrence-text-${width}-text200.png`)
          await page.screenshot({ path: screenshot })
          const overflow = await panel.evaluate((element) => {
            const panelBounds = element.getBoundingClientRect()
            const visibleLeft = Math.max(0, panelBounds.left)
            const visibleRight = Math.min(innerWidth, panelBounds.right)
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
            const result: { text: string; left: number; right: number }[] = []
            while (walker.nextNode()) {
              const node = walker.currentNode
              if (!node.textContent?.trim()) continue
              const range = document.createRange()
              range.selectNodeContents(node)
              for (const bounds of range.getClientRects()) {
                if (
                  bounds.width > 0 &&
                  (bounds.left < visibleLeft - 1 || bounds.right > visibleRight + 1)
                )
                  result.push({ text: node.textContent, left: bounds.left, right: bounds.right })
              }
            }
            return result
          })
          rows.push({
            width,
            height: 600,
            textScale: 2,
            screenshot,
            overflow,
            pixelInspected: false,
          })
          writeFileSync(
            test.info().outputPath('text-ranges.json'),
            JSON.stringify({ locale, theme, rows }, null, 2),
          )
          expect(overflow).toEqual([])
          expect(
            (
              await new AxeBuilder({ page })
                .include(`[id="card-repeat-${id}"]`)
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
                .analyze()
            ).violations,
          ).toEqual([])
        }
      } finally {
        await context.close()
      }
    })
  }
}
