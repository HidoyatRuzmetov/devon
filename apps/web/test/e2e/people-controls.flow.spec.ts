import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PEOPLE_VIEW_URL_PARAM, decodePeopleViewConfig } from '@devon/contracts'
import { expect, test } from '@playwright/test'
import {
  authedPatch,
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

const matrix = process.env['VISUAL_CONTROLS_MATRIX'] === 'true'
const themes = {
  'uz-Latn': 'Koʻrinish',
  'uz-Cyrl': 'Кўриниш',
  ru: 'Оформление',
  en: 'Appearance',
}

test('@flow people controls: table reflow, task targets, keyboard scrolling and column resizing', async ({
  browser,
}) => {
  test.setTimeout(matrix ? 300_000 : 180_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('people.visual.head'),
      headPassword: examplePassword(),
      departmentName: 'Mahalliy jadval sinovi',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('people.visual.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    const me = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const titles = [
      'Hamkorlar uchun maʼlumotlar jadvalini tayyorlash',
      'Natijalarni tekshirish',
      'Yakuniy hisobot',
    ]
    const responses = await Promise.all(
      titles.map((title) =>
        authedPost(head, '/api/v1/cards', { title, assigneeUserId: me.user.id }),
      ),
    )
    for (const response of responses) expect(response.status()).toBe(201)
    const page = await head.newPage()
    const captureRoot = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
    )
    await mkdir(captureRoot, { recursive: true })
    const locales = matrix ? (['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const) : (['en'] as const)
    const appearances = matrix ? (['light', 'dark'] as const) : (['light'] as const)
    const widths = [1440, 1024, 768, 390, 320]
    // Preferences and viewport share one page; each configuration depends on the preceding reset.
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      for (let themeIndex = 0; themeIndex < appearances.length; themeIndex++) {
        const theme = appearances[themeIndex]!
        expect((await authedPatch(head, '/api/v1/me', { locale })).status()).toBe(200)
        await page.goto('/account')
        await page.getByRole('combobox', { name: themes[locale], exact: true }).selectOption(theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
          const width = widths[widthIndex]!
          await page.setViewportSize({ width, height: 900 })
          await page.goto('/people/table')
          await expect(
            page
              .locator('main')
              .getByRole('link', { name: /^Test Head/ })
              .first(),
          ).toBeVisible()
          // Wait for finite row entrance, rather than counting transparent, not-yet-entered rows.
          await expect
            .poll(() =>
              page
                .locator('main article, main tbody tr')
                .evaluateAll((elements) =>
                  elements.every(
                    (el) =>
                      getComputedStyle(el.tagName === 'ARTICLE' ? el.parentElement! : el)
                        .opacity === '1',
                  ),
                ),
            )
            .toBe(true)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true)
          const links = page.locator('main a[href^="/work?card="]')
          await expect(links).toHaveCount(3)
          const linkBoxes = await Promise.all((await links.all()).map((link) => link.boundingBox()))
          for (const box of linkBoxes) {
            expect(box!.height).toBeGreaterThanOrEqual((width < 768 ? 44 : 24) - 0.01)
          }
          if (width >= 768) {
            const region = page.getByRole('region').filter({ has: page.locator('table') })
            await expect(region).toBeVisible()
            const size = await region.evaluate((el) => ({
              client: el.clientWidth,
              scroll: el.scrollWidth,
            }))
            expect(size.client).toBeLessThanOrEqual(width)
            if (size.scroll > size.client) {
              await region.focus()
              await region.press('ArrowRight')
              await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
            }
            const sliderBoxes = await Promise.all(
              (await page.getByRole('slider').all()).map((slider) => slider.boundingBox()),
            )
            for (const box of sliderBoxes) {
              expect(box!.width).toBeGreaterThanOrEqual(24 - 0.01)
              expect(box!.height).toBeGreaterThanOrEqual(24 - 0.01)
            }
            await region.evaluate((el) => {
              el.scrollLeft = 0
            })
          } else {
            await expect(page.locator('main article')).toHaveCount(2)
          }
          await page.screenshot({
            path: join(captureRoot, `after-people-${width}-${theme}-${locale}.png`),
            fullPage: true,
          })
        }
      }
    }
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/people/table')
    const slider = page.getByRole('slider').first()
    await expect(slider).toBeVisible()
    await expect(slider).toHaveAttribute('aria-orientation', 'horizontal')
    const name = await slider.getAttribute('aria-label')
    const before = await slider.locator('..').evaluate((el) => el.getBoundingClientRect().width)
    await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(before)))
    await slider.focus()
    await slider.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(before + 16)))
    await expect
      .poll(() => slider.locator('..').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(before + 8)
    await slider.press('ArrowUp')
    await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(before + 32)))
    await expect
      .poll(() => slider.locator('..').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(before + 24)
    await slider.press('ArrowDown')
    await expect(slider).toHaveAttribute('aria-valuenow', String(Math.round(before + 16)))
    const resized = decodePeopleViewConfig(
      new URL(page.url()).searchParams.get(PEOPLE_VIEW_URL_PARAM),
    )!
    const [column, width] = Object.entries(resized.widths)[0]!
    expect(width).toBe(Math.round(before + 16))
    await page.reload()
    const persisted = page.getByRole('slider', { name: name!, exact: true })
    await expect(persisted).toHaveAttribute('aria-valuenow', String(width))
    await expect
      .poll(() => persisted.locator('..').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(before + 8)
    await persisted.focus()
    await persisted.press('End')
    await expect(persisted).toHaveAttribute('aria-valuenow', '640')
    await persisted.press('Home')
    await expect
      .poll(
        () =>
          decodePeopleViewConfig(new URL(page.url()).searchParams.get(PEOPLE_VIEW_URL_PARAM))
            ?.widths[column] ?? null,
      )
      .toBeNull()
  } finally {
    await admin.close()
    await head.close()
    await member.close()
  }
})
