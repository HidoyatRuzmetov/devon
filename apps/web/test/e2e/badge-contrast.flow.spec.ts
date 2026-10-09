import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'

test('@flow runtime Badge subtle variants retain readable text in actual app themes and surfaces', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/login')
    await expect(page.locator('main')).toBeVisible()
    const fixturePath = join(import.meta.dirname, 'fixtures/badge-contrast.tsx').replaceAll(
      '\\',
      '/',
    )
    await page.addScriptTag({ type: 'module', url: `/@fs/${fixturePath}` })
    await expect(page.locator('[data-contrast-tone]')).toHaveCount(14)
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
    )
    await mkdir(root, { recursive: true })
    const phase = process.env['BADGE_CONTRAST_BASELINE'] === 'true' ? 'before' : 'after'
    const rows: unknown[] = []
    const themes = ['light', 'dark']
    for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
      const theme = themes[themeIndex]!
      await page.evaluate((theme) => {
        document.documentElement.dataset['theme'] = theme
      }, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await settleCapture(page, false)
      const measurements = await page
        .locator('[data-contrast-tone], [data-contrast-avatar]')
        .evaluateAll((elements) => {
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
          return elements.map((element) => {
            context.clearRect(0, 0, 1, 1)
            // Paint all ancestors first, then the translucent badge tint over its actual surface.
            const ancestors: Element[] = []
            let ancestor: Element | null = element
            while (ancestor) {
              ancestors.unshift(ancestor)
              ancestor = ancestor.parentElement
            }
            for (const layer of ancestors) {
              context.fillStyle = getComputedStyle(layer).backgroundColor
              context.fillRect(0, 0, 1, 1)
            }
            const background = luminance()
            context.fillStyle = getComputedStyle(element).color
            context.fillRect(0, 0, 1, 1)
            const foreground = luminance()
            return {
              tone:
                element.getAttribute('data-contrast-tone') ??
                `avatar-${element.getAttribute('data-contrast-avatar')}`,
              surface: element.closest('section')!.className,
              contrast:
                (Math.max(background, foreground) + 0.05) /
                (Math.min(background, foreground) + 0.05),
            }
          })
        })
      rows.push({ theme, measurements })
      await page.screenshot({ path: join(root, `${phase}-badge-contrast-${theme}.png`) })
    }
    await writeFile(join(root, `${phase}-badge-contrast.json`), JSON.stringify(rows, null, 2))
    if (phase !== 'before') {
      for (const row of rows as {
        theme: string
        measurements: { tone: string; contrast: number }[]
      }[]) {
        for (const item of row.measurements)
          expect(item.contrast, `${row.theme} ${item.tone}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  } finally {
    await context.close()
  }
})

test('@flow native controls follow the rendered theme without resetting their values', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/login')
    await expect(page.locator('main')).toBeVisible()
    const fixturePath = join(import.meta.dirname, 'fixtures/badge-contrast.tsx').replaceAll(
      '\\',
      '/',
    )
    await page.addScriptTag({ type: 'module', url: `/@fs/${fixturePath}` })
    const date = page.getByLabel('Native date control', { exact: true })
    const select = page.getByLabel('Native select control', { exact: true })
    await expect(date).toBeVisible()
    await date.fill('2031-05-07')
    await select.selectOption('two')
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
    )
    await mkdir(root, { recursive: true })
    const themes = ['light', 'dark', 'light']
    // The same native controls remain mounted while the appearance changes.
    for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
      const theme = themes[themeIndex]!
      await page.evaluate((theme) => {
        document.documentElement.dataset['theme'] = theme
      }, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await settleCapture(page, false)
      await page.screenshot({ path: join(root, `native-controls-${themeIndex}-${theme}.png`) })
      await expect(date).toHaveCSS('color-scheme', theme)
      await expect(select).toHaveCSS('color-scheme', theme)
      await expect(date).toHaveValue('2031-05-07')
      await expect(select).toHaveValue('two')
    }
  } finally {
    await context.close()
  }
})
