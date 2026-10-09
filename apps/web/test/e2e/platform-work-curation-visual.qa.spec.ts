/* eslint-disable no-restricted-syntax -- Viewport and native keyboard transitions are sequential. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'

const examplePassword = 'Ishonchli#2026'
function label(locale: string, key: string, params: Record<string, string> = {}): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing ${locale}:${key}`)
  return value.replace(/\{(\w+)\}/g, (match, key: string) => params[key] ?? match)
}
async function capture(page: Page, state: string, metadata: Record<string, unknown>) {
  await settleCapture(page, false)
  const screenshot = test.info().outputPath(`${state}.png`)
  await page.screenshot({ path: screenshot })
  appendFileSync(
    test.info().outputPath('captures.jsonl'),
    JSON.stringify({ ...metadata, state, screenshot, pixelInspected: false }) + '\n',
  )
}
for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
  for (const theme of ['light', 'dark']) {
    test(`@qa curation reflow ${locale} ${theme}`, async ({ browser }) => {
      test.setTimeout(240_000)
      const context = await newFlowContext(browser)
      const errors: string[] = []
      try {
        await login(context, { login: 'demo.boshliq', password: examplePassword })
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        const name = `QA ${'ДлинноеНаименованиеБезПробелов'.repeat(3)} ${randomUUID().slice(0, 8)}`
        const response = await authedPost(context, '/api/v1/work/templates', {
          kind: 'card',
          scope: 'department',
          name,
          description:
            'Инструкция для подготовки ежемесячного отчёта с ответственными сотрудниками',
          payload: {
            title: 'Подготовить подробный отчёт с приложениями и повторной проверкой данных',
            priority: 'urgent',
            dueInDays: 7,
            estimateMin: 180,
            checklist: ['Проверить исходные данные', 'Согласовать документ'],
          },
        })
        expect(response.status()).toBe(201)
        const page = await context.newPage()
        page.on('pageerror', (error) => errors.push(error.message))
        for (const environment of [
          { width: 1440, height: 900, scale: 1 },
          { width: 768, height: 600, scale: 2 },
          { width: 390, height: 600, scale: 2 },
          { width: 320, height: 600, scale: 2 },
          { width: 360, height: 225, scale: 1 },
        ]) {
          await page.setViewportSize({ width: environment.width, height: environment.height })
          await page.goto('/work/templates')
          await waitForLoadedRoute(page, '/work/templates')
          await setTextScale(page, environment.scale)
          const item = page
            .getByRole('article')
            .filter({ has: page.getByRole('heading', { name, exact: true }) })
          await expect(item).toBeVisible()
          await item.scrollIntoViewIfNeeded()
          await capture(
            page,
            `gallery-${environment.width}-${environment.height}-text${environment.scale * 100}`,
            { locale, theme, ...environment },
          )
          appendFileSync(
            test.info().outputPath('overflow.jsonl'),
            JSON.stringify({
              locale,
              theme,
              ...environment,
              nodes: await page.evaluate(() =>
                [...document.querySelectorAll('main *')]
                  .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
                  .map((node) => ({
                    tag: node.tagName,
                    text: node.textContent?.slice(0, 100),
                    right: node.getBoundingClientRect().right,
                    className: node.getAttribute('class'),
                  })),
              ),
            }) + '\n',
          )
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(environment.width + 1)
          const edit = item.getByRole('button', {
            name: label(locale, 'work.templateEditor.edit', { name }),
            exact: true,
          })
          await edit.focus()
          await edit.press('Enter')
          const dialog = page.getByRole('dialog', {
            name: label(locale, 'work.templateEditor.editTitle'),
            exact: true,
          })
          await expect(dialog).toBeVisible()
          await expect(
            dialog.getByLabel(label(locale, 'work.templateEditor.name'), { exact: true }),
          ).toBeFocused()
          const bounds = await dialog.boundingBox()
          expect(bounds!.x).toBeGreaterThanOrEqual(0)
          expect(bounds!.y).toBeGreaterThanOrEqual(0)
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(environment.width + 1)
          expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(environment.height + 1)
          const save = dialog.getByRole('button', {
            name: label(locale, 'common.save'),
            exact: true,
          })
          await save.focus()
          await expect(save).toBeFocused()
          const saveBounds = await save.boundingBox()
          expect(saveBounds!.y).toBeGreaterThanOrEqual(0)
          expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(environment.height + 1)
          await capture(
            page,
            `editor-${environment.width}-${environment.height}-text${environment.scale * 100}`,
            { locale, theme, ...environment },
          )
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(environment.width + 1)
          const axe = await new AxeBuilder({ page })
            .include('[role="dialog"]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze()
          expect(axe.violations).toEqual([])
          await save.press('Escape')
          await expect(dialog).not.toBeVisible()
          await expect(edit).toBeFocused()
        }
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
