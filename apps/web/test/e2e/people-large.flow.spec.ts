import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
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
import { settleCapture } from './platform-capture.js'

test('@flow large People roster stays complete across mobile and measured desktop rows', async ({
  browser,
}) => {
  test.setTimeout(300_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('people.large.head'),
      headPassword: examplePassword(),
      departmentName: 'Large local roster',
    })
    const ids: string[] = []
    let joinKey = department.joinKey
    // Bound concurrent password hashing and local API work to four clients at a time.
    for (let start = 0; start < 64; start += 4) {
      // The invite intentionally allows ten joins in ten minutes. Rotate this disposable local
      // invite after eight successful members; preserve the real protection rather than disable it.
      if (start > 0 && start % 8 === 0) {
        const rotated = await authedPost(
          head,
          `/api/v1/departments/${department.departmentId}/invite/rotate-key`,
          {},
        )
        expect(rotated.status()).toBe(200)
        joinKey = ((await rotated.json()) as { joinKey: string }).joinKey
      }
      const created = await Promise.all(
        Array.from({ length: 4 }, async (_, offset) => {
          const member = await newFlowContext(browser)
          try {
            await joinDepartmentAsNewUser(member, {
              login: uniqueLogin('people.large.member'),
              password: examplePassword(),
              joinKey,
              joinPassword: department.joinPassword,
            })
            expect(
              (
                await authedPatch(member, '/api/v1/accounts/profile', {
                  givenName: 'Person',
                  familyName: String(start + offset).padStart(3, '0'),
                })
              ).status(),
            ).toBe(200)
            const me = (await (await member.request.get('/api/v1/me')).json()) as {
              user: { id: string }
            }
            return me.user.id
          } finally {
            await member.close()
          }
        }),
      )
      ids.push(...created)
    }
    const cards = await Promise.all(
      [0, 31, 63].flatMap((person) =>
        Array.from({ length: 5 }, (_, card) =>
          authedPost(head, '/api/v1/cards', {
            title: `Detailed task ${card + 1} for person ${person}: verify the department report and evidence`,
            assigneeUserId: ids[person],
          }),
        ),
      ),
    )
    for (const card of cards) expect(card.status()).toBe(201)
    expect((await authedPatch(head, '/api/v1/me', { locale: 'en' })).status()).toBe(200)
    const page = await head.newPage()
    const errors: string[] = []
    const lifecycleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('flushSync was called'))
        lifecycleErrors.push(message.text())
    })
    await page.exposeFunction('__devonRecordPeopleResizeError', (message: string) =>
      errors.push(message),
    )
    await page.addInitScript(() => {
      window.addEventListener('error', (event) => {
        if (!event.message.includes('ResizeObserver')) return
        const capture = window as unknown as Window & {
          __devonRecordPeopleResizeError: (message: string) => Promise<void>
        }
        void capture.__devonRecordPeopleResizeError(event.message)
      })
    })
    const captureRoot = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
      'nested',
    )
    await mkdir(captureRoot, { recursive: true })
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto('/people/table')
    await expect(page.getByRole('button', { name: /^Columns/ })).toBeVisible()
    await settleCapture(page, false)
    await page.screenshot({ path: join(captureRoot, 'large-people-320.png') })
    await expect.soft(page.locator('main article')).toHaveCount(65)
    const accessibility = await new AxeBuilder({ page }).include('main').analyze()
    await writeFile(
      join(captureRoot, 'large-people-axe.json'),
      JSON.stringify(accessibility.violations, null, 2),
    )
    expect
      .soft(accessibility.violations.filter((v) => ['definition-list', 'dlitem'].includes(v.id)))
      .toEqual([])
    await page.setViewportSize({ width: 1440, height: 900 })
    const region = page.getByRole('region').filter({ has: page.locator('table') })
    await expect(region).toBeVisible()
    const seen = new Set<string>()
    const measurements: unknown[] = []
    // Each scroll step depends on the virtual rows mounted by the previous step.
    for (let step = 0; step < 24; step++) {
      await settleCapture(page, false)
      for (const href of await region
        .locator('a[href^="/people?person="]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href')!)))
        seen.add(href)
      measurements.push(
        await region.evaluate((el) => ({
          top: el.scrollTop,
          height: el.clientHeight,
          scroll: el.scrollHeight,
          rows: [...el.querySelectorAll('tbody tr')].map((row) => ({
            h: row.getBoundingClientRect().height,
            text: row.textContent?.slice(0, 70),
          })),
        })),
      )
      const atEnd = await region.evaluate((el) => {
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true
        el.scrollTop += el.clientHeight * 0.65
        return false
      })
      if (atEnd) break
    }
    await writeFile(
      join(captureRoot, 'large-people-measurements.json'),
      JSON.stringify({ seen: [...seen], measurements, errors }, null, 2),
    )
    await page.screenshot({ path: join(captureRoot, 'large-people-1440-end.png') })
    expect(seen.size).toBe(65)
    await expect(region.getByRole('link', { name: 'Person 063', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    expect(errors).toEqual([])
    // Reuse the real >60-person roster in every supported locale/theme. At a 320 CSS-pixel
    // viewport this also covers the reflow width equivalent to 400% zoom of a 1280px page.
    const locales = ['uz-Latn', 'uz-Cyrl', 'ru', 'en'] as const
    const themes = ['light', 'dark']
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      expect((await authedPatch(head, '/api/v1/me', { locale })).status()).toBe(200)
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
        const theme = themes[themeIndex]!
        await page.goto('/people/table')
        await page.evaluate((theme) => {
          document.documentElement.dataset['theme'] = theme
        }, theme)
        await page.setViewportSize({ width: 320, height: 900 })
        await expect(page.locator('main article')).toHaveCount(65)
        await settleCapture(page, false)
        await page.screenshot({
          path: join(captureRoot, `large-people-${locale}-${theme}-320-start.png`),
        })
        const last = page.locator('main article').filter({ hasText: 'Person 063' })
        const lastName = last.getByRole('link', { name: 'Person 063', exact: true })
        await lastName.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await settleCapture(page, false)
        await page.screenshot({
          path: join(captureRoot, `large-people-${locale}-${theme}-320-end.png`),
        })
        await expect(lastName).toBeVisible()
        await page.evaluate(() => {
          const root = document.documentElement
          const style = getComputedStyle(root)
          for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
            for (const suffix of ['', '--line-height']) {
              const token = `--text-${name}${suffix}`
              const value = Number.parseFloat(style.getPropertyValue(token))
              if (Number.isFinite(value)) root.style.setProperty(token, `${value * 2}px`)
            }
          }
        })
        // Enlarging fonts moves the last card. DOM visibility alone does not prove viewport
        // reachability: scroll the real name again and require an unobscured pointer target.
        await lastName.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await settleCapture(page, false)
        await expect
          .poll(() =>
            lastName.evaluate((element) => {
              const box = element.getBoundingClientRect()
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              return box.top >= 0 && box.bottom <= innerHeight && element.contains(hit)
            }),
          )
          .toBe(true)
        await page.screenshot({
          path: join(captureRoot, `large-people-${locale}-${theme}-320-text200-end.png`),
        })
        await writeFile(
          join(captureRoot, `large-people-${locale}-${theme}-320-text200-overflow.json`),
          JSON.stringify(
            await page.evaluate(() => ({
              width: innerWidth,
              document: document.documentElement.scrollWidth,
              nodes: [...document.querySelectorAll('body *')]
                .filter((el) => {
                  const b = el.getBoundingClientRect()
                  return b.width && (b.left < -1 || b.right > innerWidth + 1)
                })
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  text: el.textContent?.slice(0, 90),
                  left: el.getBoundingClientRect().left,
                  right: el.getBoundingClientRect().right,
                }))
                .slice(0, 40),
            })),
            null,
            2,
          ),
        )
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.setViewportSize({ width: 768, height: 900 })
        const enlargedRegion = page.getByRole('region').filter({ has: page.locator('table') })
        await enlargedRegion.focus()
        await enlargedRegion.press('Control+End')
        await enlargedRegion.evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        await expect(
          enlargedRegion.getByRole('link', { name: 'Person 063', exact: true }),
        ).toBeVisible()
        await settleCapture(page, false)
        await page.screenshot({
          path: join(captureRoot, `large-people-${locale}-${theme}-768-text200-end.png`),
        })
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true)
        await page.evaluate(() => {
          for (const name of ['body', 'small', 'caption', 'eyebrow', 'h1', 'h2', 'h3']) {
            document.documentElement.style.removeProperty(`--text-${name}`)
            document.documentElement.style.removeProperty(`--text-${name}--line-height`)
          }
        })
      }
    }
    expect(errors).toEqual([])
    await writeFile(
      join(captureRoot, 'large-people-lifecycle-errors.json'),
      JSON.stringify(lifecycleErrors, null, 2),
    )
    expect(lifecycleErrors).toEqual([])
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/people/table')
    await page.getByRole('button', { name: 'New view', exact: true }).click()
    const viewDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('textbox', { name: 'View name', exact: true }) })
    await viewDialog
      .getByRole('textbox', { name: 'View name', exact: true })
      .fill('Large roster review')
    await viewDialog.getByRole('switch').first().click()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let reached!: () => void
    const started = new Promise<void>((resolve) => {
      reached = resolve
    })
    await page.route('**/api/v1/people/views', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      reached()
      await gate
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'service_unavailable',
          status: 503,
          title: 'Synthetic saved-view refusal',
        }),
      })
    })
    await viewDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await started
    await expect(viewDialog.getByRole('textbox', { name: 'View name', exact: true })).toBeDisabled()
    await expect(viewDialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    release()
    await expect(viewDialog.getByRole('alert')).toBeVisible()
    await expect(viewDialog.getByRole('textbox', { name: 'View name', exact: true })).toHaveValue(
      'Large roster review',
    )
    await expect(viewDialog.getByRole('switch').first()).toBeChecked()
    expect(
      ((await (await head.request.get('/api/v1/people/views')).json()) as { views: unknown[] })
        .views,
    ).toEqual([])
    await page.unroute('**/api/v1/people/views')
    await viewDialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(viewDialog).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Large roster review', exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Large roster review', exact: true }),
    ).toBeVisible()
  } finally {
    await head.close()
    await admin.close()
  }
})
