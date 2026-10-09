/* eslint-disable no-restricted-syntax -- Actual route, viewport and capture transitions are sequential. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { authedPatch, authedPost, login, newFlowContext } from './flow-api.js'
import { setTextScale, settleCapture } from './platform-capture.js'

const locales = ['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const
const examplePassword = 'Ishonchli#2026'
function label(locale: string, key: string): string {
  let value: unknown = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../packages/i18n/messages/${locale}.generated.json`),
      'utf8',
    ),
  )
  for (const part of key.split('.')) value = (value as Record<string, unknown>)[part]
  if (typeof value !== 'string') throw new Error(`Missing localized key ${locale}:${key}`)
  return value
}
for (const locale of locales) {
  for (const theme of ['light', 'dark'] as const) {
    test(`@qa knowledge visual matrix ${locale} ${theme}`, async ({ browser }) => {
      test.setTimeout(180_000)
      const context = await newFlowContext(browser)
      try {
        await login(context, { login: 'demo.boshliq', password: examplePassword })
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        await context.addInitScript((value) => localStorage.setItem('devon_theme', value), theme)
        const templateResponse = await authedPost(context, '/api/v1/pages/onboarding/templates', {
          name: `QA ${locale} ${'Unicode O‘g‘il Амир '.repeat(7)} ${randomUUID()}`.slice(0, 200),
          enabled: true,
          items: [
            {
              id: 'long',
              text: 'Long instruction — O‘g‘il Амир '.repeat(14),
              ownerRole: 'newcomer',
            },
            { id: 'buddy', text: 'Meet the buddy', ownerRole: 'buddy' },
            { id: 'head', text: 'Review the first week', ownerRole: 'head' },
          ],
        })
        expect(templateResponse.status()).toBe(201)
        const template = await templateResponse.json()
        const pageResponse = await authedPost(context, '/api/v1/pages', {
          kind: 'note',
          title: `QA knowledge ${locale} ${randomUUID()}`,
          blocks: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'A readable knowledge document with bold, links, lists and mentions.',
                  },
                ],
              },
              {
                type: 'codeBlock',
                content: [
                  {
                    type: 'text',
                    text: 'const longIdentifier = "a-long-code-line-that-must-scroll-within-the-editor-instead-of-the-page";',
                  },
                ],
              },
            ],
          },
        })
        expect(pageResponse.status()).toBe(201)
        const created = await pageResponse.json()
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        for (const environment of [
          { width: 1440, height: 900, scale: 1 },
          { width: 1366, height: 768, scale: 1 },
          { width: 768, height: 800, scale: 1 },
          { width: 390, height: 844, scale: 1 },
          { width: 320, height: 480, scale: 1 },
          { width: 768, height: 600, scale: 2 },
          { width: 360, height: 225, scale: 1 },
        ]) {
          await page.setViewportSize({ width: environment.width, height: environment.height })
          for (const surface of ['templates', 'editor', 'faq'] as const) {
            const route =
              surface === 'templates'
                ? '/pages?tab=onboarding'
                : surface === 'editor'
                  ? `/pages?page=${created.id}`
                  : '/help'
            await page.goto(route)
            if (surface === 'templates')
              await expect(
                page.getByRole('heading', { name: template.name, exact: true }),
              ).toBeVisible()
            if (surface === 'editor')
              await expect(
                page.getByRole('textbox', {
                  name: label(locale, 'pages.editor.contentLabel'),
                  exact: true,
                }),
              ).toBeVisible()
            if (surface === 'faq') {
              await expect(page.locator('main details')).toHaveCount(10)
              await page.locator('main summary').first().click()
            }
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
            await setTextScale(page, environment.scale)
            await settleCapture(page)
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeLessThanOrEqual(environment.width + 1)
            const screenshot = test
              .info()
              .outputPath(
                `${surface}-${environment.width}-${environment.height}-text${environment.scale * 100}.png`,
              )
            await page.screenshot({ path: screenshot, fullPage: true })
            if (surface === 'templates') {
              const cardShot = test
                .info()
                .outputPath(
                  `template-card-${environment.width}-${environment.height}-text${environment.scale * 100}.png`,
                )
              await page
                .getByRole('region', { name: template.name, exact: true })
                .screenshot({ path: cardShot })
              appendFileSync(
                test.info().outputPath('captures.jsonl'),
                JSON.stringify({
                  role: 'department-head',
                  locale,
                  theme,
                  surface: 'template-card',
                  route,
                  ...environment,
                  screenshot: cardShot,
                  pixelInspected: false,
                }) + '\n',
              )
            }
            const geometry = await page.locator('main').evaluate((main) => {
              const bad = [
                ...main.querySelectorAll('button, input, select, summary, [role="textbox"]'),
              ].filter((element) => {
                const rect = element.getBoundingClientRect()
                return (
                  rect.width > 0 &&
                  rect.height > 0 &&
                  (rect.left < -1 || rect.right > innerWidth + 1)
                )
              })
              return bad.map((element) => ({
                tag: element.tagName,
                name: element.getAttribute('aria-label') ?? element.textContent,
                width: element.getBoundingClientRect().width,
              }))
            })
            expect(geometry).toEqual([])
            let axeIds: string[] | undefined
            if (environment.width === 390) {
              const result = await new AxeBuilder({ page })
                .include('main')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
                .analyze()
              axeIds = result.violations.map((violation) => violation.id)
              expect(result.violations).toEqual([])
            }
            appendFileSync(
              test.info().outputPath('captures.jsonl'),
              JSON.stringify({
                role: 'department-head',
                locale,
                theme,
                surface,
                route,
                ...environment,
                screenshot,
                pixelInspected: false,
                geometry,
                axeIds,
              }) + '\n',
            )
            if (surface === 'editor') {
              const popupResponse = await authedPost(context, '/api/v1/pages', {
                kind: 'note',
                title: `QA popup ${randomUUID()}`,
                blocks: { type: 'doc', content: [{ type: 'paragraph' }] },
              })
              expect(popupResponse.status()).toBe(201)
              const popupPage = await popupResponse.json()
              await page.goto(`/pages?page=${popupPage.id}`)
              const body = page.getByRole('textbox', {
                name: label(locale, 'pages.editor.contentLabel'),
                exact: true,
              })
              await expect(body).toBeVisible()
              await setTextScale(page, environment.scale)
              await body.fill('/')
              await expect(
                page.getByRole('listbox', {
                  name: label(locale, 'pages.editor.suggestions.commands'),
                  exact: true,
                }),
              ).toBeVisible()
              const listBounds = await page.getByRole('listbox').boundingBox()
              expect(listBounds!.x).toBeGreaterThanOrEqual(0)
              expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(environment.width)
              expect(listBounds!.y).toBeGreaterThanOrEqual(0)
              expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(environment.height)
              const popupShot = test
                .info()
                .outputPath(
                  `slash-${environment.width}-${environment.height}-text${environment.scale * 100}.png`,
                )
              await page.screenshot({ path: popupShot })
              appendFileSync(
                test.info().outputPath('captures.jsonl'),
                JSON.stringify({
                  role: 'department-head',
                  locale,
                  theme,
                  surface: 'slash-popup',
                  route: `/pages?page=${popupPage.id}`,
                  ...environment,
                  screenshot: popupShot,
                  pixelInspected: false,
                }) + '\n',
              )
              await body.press('Escape')
              await expect(page.getByRole('listbox')).toHaveCount(0)
            }
          }
        }
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
