import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { settleCapture } from './platform-capture.js'
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

test('@flow card title resizing is stable and selectable label text remains readable', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const admin = await newFlowContext(browser)
  const head = await newFlowContext(browser)
  const member = await newFlowContext(browser)
  try {
    await loginAsSuperAdmin(admin)
    const department = await createApprovedDepartment(head, admin, {
      headLogin: uniqueLogin('readability.head'),
      headPassword: examplePassword(),
      departmentName: 'Mahalliy matn sinovi',
    })
    await joinDepartmentAsNewUser(member, {
      login: uniqueLogin('readability.member'),
      password: examplePassword(),
      joinKey: department.joinKey,
      joinPassword: department.joinPassword,
    })
    const me = (await (await head.request.get('/api/v1/me')).json()) as { user: { id: string } }
    const cardResponse = await authedPost(head, '/api/v1/cards', {
      title:
        'Hamkor tashkilotlar bilan ochiq maʼlumotlar rejasini kelishish va yakuniy jadvalni tayyorlash — barcha hamkorlar uchun yangilangan reja',
      assigneeUserId: me.user.id,
    })
    expect(cardResponse.status()).toBe(201)
    const card = (await cardResponse.json()) as { id: string }
    const labelResponse = await authedPost(head, '/api/v1/labels', {
      name: 'Hisobot',
      colour: '#fbe8cc',
    })
    expect(labelResponse.status()).toBe(201)
    const label = (await labelResponse.json()) as { id: string }
    await authedPatch(head, '/api/v1/me', { locale: 'en' })
    await authedPatch(member, '/api/v1/me', { locale: 'en' })
    const page = await head.newPage()
    const errors: string[] = []
    await page.exposeFunction('__devonRecordTitleResizeError', (message: string) => {
      errors.push(message)
    })
    await page.addInitScript(() => {
      // ResizeObserver errors are window error events; browsers need not emit a pageerror for them.
      window.addEventListener('error', (event) => {
        if (!event.message.includes('ResizeObserver')) return
        const capture = window as unknown as Window & {
          __devonRecordTitleResizeError: (message: string) => Promise<void>
        }
        void capture.__devonRecordTitleResizeError(event.message)
      })
    })
    page.on('pageerror', (error) => {
      if (error.message.includes('ResizeObserver')) errors.push(error.message)
    })
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
    )
    await mkdir(root, { recursive: true })
    const phase = process.env['CARD_READABILITY_PHASE'] ?? 'after'
    const themes = ['light', 'dark']
    const measurements: unknown[] = []
    for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
      const theme = themes[themeIndex]!
      await page.goto('/account')
      await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption(theme)
      await page.goto(`/work/card?id=${card.id}`)
      const title = page.getByRole('textbox', { name: 'Title', exact: true })
      await expect(title).toBeVisible()
      const widths = [1440, 768, 390, 320, 768, 1440, 390]
      // Resize the real containing page, including widening after a multiline title has grown.
      for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
        await page.setViewportSize({ width: widths[widthIndex]!, height: 844 })
        await expect
          .poll(() => title.evaluate((el) => el.scrollHeight - el.clientHeight))
          .toBeLessThanOrEqual(1)
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        )
      }
      const choice = page.getByRole('button').filter({ hasText: /^Hisobot$/ })
      await expect(choice).toBeEnabled()
      await expect.soft(choice).toHaveAccessibleName('Hisobot')
      await expect(choice).toHaveAttribute('aria-pressed', 'false')
      const measurement = await choice.evaluate((button) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        const luminance = () => {
          const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map((channel) => {
              const value = channel / 255
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
            })
          return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
        }
        const ancestors: Element[] = []
        let ancestor = button.parentElement
        while (ancestor) {
          ancestors.unshift(ancestor)
          ancestor = ancestor.parentElement
        }
        for (const layer of ancestors) {
          context.fillStyle = getComputedStyle(layer).backgroundColor
          context.fillRect(0, 0, 1, 1)
        }
        const parentSurface = context.getImageData(0, 0, 1, 1)
        const style = getComputedStyle(button)
        context.globalAlpha = Number(style.opacity)
        context.fillStyle = style.backgroundColor
        context.fillRect(0, 0, 1, 1)
        const background = luminance()
        // Opacity composites the whole button over its parent; text is not painted twice over
        // an already-composited background. Sample the two opaque pixels from the same parent.
        context.putImageData(parentSurface, 0, 0)
        context.fillStyle = style.color
        context.fillRect(0, 0, 1, 1)
        const foreground = luminance()
        return {
          opacity: Number(style.opacity),
          contrast:
            (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
          height: button.getBoundingClientRect().height,
        }
      })
      measurements.push({ theme, ...measurement })
      await choice.locator('..').screenshot({
        path: join(root, `${phase}-card-labels-390-${theme}.png`),
      })
      expect.soft(measurement.opacity).toBe(1)
      expect.soft(measurement.contrast).toBeGreaterThanOrEqual(4.5)
      expect.soft(measurement.height).toBeGreaterThanOrEqual(44 - 0.01)
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'true')
      await expect
        .poll(
          async () =>
            (
              (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()) as {
                labels: string[]
              }
            ).labels,
        )
        .toContain(label.id)
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'false')
      await expect
        .poll(
          async () =>
            (
              (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()) as {
                labels: string[]
              }
            ).labels,
        )
        .not.toContain(label.id)
    }
    await page.setViewportSize({ width: 320, height: 844 })
    await page.evaluate(() => {
      const root = document.documentElement
      const style = getComputedStyle(root)
      for (const suffix of ['', '--line-height']) {
        const token = `--text-h3${suffix}`
        root.style.setProperty(token, `${Number.parseFloat(style.getPropertyValue(token)) * 2}px`)
      }
    })
    const enlargedTitle = page.getByRole('textbox', { name: 'Title', exact: true })
    await expect
      .poll(() => enlargedTitle.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1)
    await settleCapture(page)
    await page.screenshot({
      path: join(root, `${phase}-card-title-320-text200-page.png`),
      fullPage: true,
    })
    // Verify that scrolling lets both ends of the enlarged title clear fixed application bars.
    const titleEnds = ['start', 'end'] as const
    for (let endIndex = 0; endIndex < titleEnds.length; endIndex++) {
      const end = titleEnds[endIndex]!
      await enlargedTitle.evaluate((el, end) => {
        const box = el.getBoundingClientRect()
        const y =
          end === 'start' ? box.top + scrollY - 100 : box.bottom + scrollY - innerHeight + 140
        window.scrollTo(0, Math.max(0, y))
      }, end)
      await settleCapture(page, false)
      await page.screenshot({ path: join(root, `${phase}-card-title-320-text200-${end}.png`) })
    }
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--text-h3')
      document.documentElement.style.removeProperty('--text-h3--line-height')
    })
    await writeFile(
      join(root, `${phase}-card-readability.json`),
      JSON.stringify({ errors, measurements }, null, 2),
    )
    expect(errors).toEqual([])
    const newLabel = page.getByRole('textbox', { name: 'New label', exact: true })
    const create = page.getByRole('button', { name: 'New label', exact: true })
    await newLabel.fill('Retained local label')
    let releaseFailure!: () => void
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve
    })
    await page.route('**/api/v1/labels', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await failureGate
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'temporarily_unavailable' }),
      })
    })
    try {
      await create.click()
      await expect(create).toBeDisabled()
      await expect(newLabel).toBeDisabled()
    } finally {
      releaseFailure()
    }
    await expect(newLabel).toBeEnabled()
    await expect(newLabel).toHaveValue('Retained local label')
    await page.unroute('**/api/v1/labels')
    const beforeRetry = (await (await head.request.get('/api/v1/labels')).json()) as {
      name: string
    }[]
    expect(beforeRetry.some((entry) => entry.name === 'Retained local label')).toBe(false)
    await newLabel.press('Enter')
    await expect(newLabel).toHaveValue('')
    await expect(
      page.getByRole('button', { name: 'Retained local label', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Hisobot', exact: true }).click()
    await expect
      .poll(
        async () =>
          (
            (await (await head.request.get(`/api/v1/cards/${card.id}`)).json()) as {
              labels: string[]
            }
          ).labels,
      )
      .toContain(label.id)
    const reader = await member.newPage()
    await reader.setViewportSize({ width: 320, height: 844 })
    await reader.goto(`/work/card?id=${card.id}`)
    const readonlyTitle = reader.getByRole('textbox', { name: 'Title', exact: true })
    await expect(readonlyTitle).toHaveAttribute('readonly', '')
    const readonlyLabels = reader.getByRole('region', { name: 'Labels', exact: true })
    await expect(readonlyLabels).toContainText('Hisobot')
    await expect(readonlyLabels.getByRole('button')).toHaveCount(0)
    await expect(readonlyLabels.getByRole('textbox')).toHaveCount(0)
    await expect(readonlyLabels).not.toContainText('Retained local label')
    await expect
      .poll(() => readonlyTitle.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeLessThanOrEqual(1)
    expect(
      await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true)
    await reader.screenshot({
      path: join(root, `${phase}-card-reader-320-light-en.png`),
      fullPage: true,
    })
    expect(errors).toEqual([])
  } finally {
    await admin.close()
    await head.close()
    await member.close()
  }
})
