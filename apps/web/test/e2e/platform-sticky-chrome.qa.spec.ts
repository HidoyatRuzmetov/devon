/* eslint-disable no-restricted-syntax -- Locale and native scroll transitions inspect the same synthetic page in order. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
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
import { setTextScale, settleCapture, waitForLoadedRoute } from './platform-capture.js'
import { THEME_STORAGE_KEY } from '../../src/lib/constants.js'

const root = join(import.meta.dirname, '../../../..')
for (const theme of ['light', 'dark']) {
  test(`@qa sticky navigation stays readable over scrolled enlarged content in ${theme}`, async ({
    browser,
  }) => {
    test.setTimeout(120_000)
    const context = await newFlowContext(browser)
    const admin = await newFlowContext(browser)
    try {
      await loginAsSuperAdmin(admin)
      const department = await createApprovedDepartment(context, admin, {
        headLogin: uniqueLogin('sticky.head'),
        headPassword: examplePassword(),
        departmentName: 'Synthetic navigation readability',
      })
      expect(
        (
          await context.request.put(`/api/v1/departments/${department.departmentId}/features`, {
            headers: { 'x-csrf-token': await csrfToken(context) },
            data: { features: { templates: true } },
          })
        ).status(),
      ).toBe(200)
      const name = `Synthetic ${'ДлинноеНазваниеБезПробелов'.repeat(3)}`
      const created = await authedPost(context, '/api/v1/work/templates', {
        kind: 'card',
        scope: 'department',
        name,
        description:
          'Инструкция для подготовки ежемесячного отчёта с ответственными сотрудниками и понятным результатом',
        payload: {
          title: 'Synthetic useful report',
          priority: 'urgent',
          dueInDays: 7,
          estimateMin: 180,
          checklist: ['Check data', 'Review report'],
        },
      })
      expect(created.status()).toBe(201)
      await context.addInitScript(({ key, theme }) => localStorage.setItem(key, theme), {
        key: THEME_STORAGE_KEY,
        theme,
      })
      const page = await context.newPage()
      await page.setViewportSize({ width: 320, height: 600 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      for (const locale of ['en', 'ru', 'uz-Latn', 'uz-Cyrl']) {
        expect((await authedPatch(context, '/api/v1/me', { locale })).status()).toBe(200)
        const catalogue = JSON.parse(
          readFileSync(join(root, `packages/i18n/messages/${locale}.generated.json`), 'utf8'),
        ) as { shell: { nav: { aria: string } } }
        await page.goto('/work/templates')
        await waitForLoadedRoute(page, '/work/templates')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await setTextScale(page, 2)
        const heading = page.getByRole('heading', { name, exact: true })
        await expect(heading).toBeVisible()
        const banner = page.getByRole('banner')
        const navigation = page.getByRole('navigation', {
          name: catalogue.shell.nav.aria,
          exact: true,
        })
        await expect(navigation).toBeVisible()
        await page.mouse.move(160, 300)
        const scrollSteps = []
        // Wheel movement is engine-dependent. Approach the overlap with actual wheel
        // input, checking each movement instead of assuming deltaY equals CSS pixels.
        for (let step = 0; step < 8; step += 1) {
          const box = await heading.boundingBox()
          const header = await banner.boundingBox()
          if (!box || !header) throw new Error('The gallery and fixed header must be present')
          if (box.y < header.y + header.height && box.y + box.height > 0) break
          const delta = box.y > header.y + header.height ? box.y - header.height + 30 : box.y - 30
          await page.mouse.wheel(0, delta)
          await expect
            .poll(async () => (await heading.boundingBox())?.y, {
              message: 'Native wheel input must actually move the gallery',
            })
            .not.toBe(box.y)
          scrollSteps.push({ before: box.y, delta, after: (await heading.boundingBox())?.y })
        }
        await test.info().attach(`${locale}-native-wheel`, {
          body: JSON.stringify(scrollSteps),
          contentType: 'application/json',
        })
        await expect
          .poll(
            async () => {
              const box = await heading.boundingBox()
              const header = await banner.boundingBox()
              return !!box && !!header && box.y < header.y + header.height && box.y + box.height > 0
            },
            { message: 'Real enlarged page text is scrolled behind the fixed header' },
          )
          .toBe(true)
        await settleCapture(page, false)
        await banner.evaluate((element) => {
          element.setAttribute('data-qa-sticky-chrome', 'header')
        })
        await navigation.evaluate((element) => {
          element.setAttribute('data-qa-sticky-chrome', 'navigation')
        })
        const geometry = await page.locator('[data-qa-sticky-chrome]').evaluateAll((elements) =>
          elements.map((element) => ({
            kind: element.getAttribute('data-qa-sticky-chrome'),
            background: getComputedStyle(element).backgroundColor,
            top: element.getBoundingClientRect().top,
            bottom: element.getBoundingClientRect().bottom,
          })),
        )
        await test.info().attach(`${locale}-sticky-background`, {
          body: JSON.stringify(geometry),
          contentType: 'application/json',
        })
        await page.screenshot({ path: test.info().outputPath(`${locale}-scrolled-navigation.png`) })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          321,
        )
        const axe = await new AxeBuilder({ page })
          .include('[data-qa-sticky-chrome]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(axe.violations).toEqual([])
      }
      expect(errors).toEqual([])
    } finally {
      await admin.close()
      await context.close()
    }
  })
}
