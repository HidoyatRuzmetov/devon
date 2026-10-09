import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'

test('@flow Avatar initials stay inside every categorical circle at200percent text enlargement', async ({
  browser,
}) => {
  const context = await newFlowContext(browser)
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/login')
    await page.addScriptTag({
      type: 'module',
      url: `/@fs/${join(import.meta.dirname, 'fixtures/avatar-readability.tsx').replaceAll('\\', '/')}`,
    })
    await expect(page.locator('[data-avatar-size]')).toHaveCount(32)
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
    )
    await mkdir(root, { recursive: true })
    const records: unknown[] = []
    for (let scale = 1; scale <= 2; scale++) {
      if (scale === 2)
        await page.evaluate(() => {
          const root = document.documentElement
          const style = getComputedStyle(root)
          for (const name of ['caption', 'small', 'body']) {
            for (const suffix of ['', '--line-height']) {
              const token = `--text-${name}${suffix}`
              const value = Number.parseFloat(style.getPropertyValue(token))
              root.style.setProperty(token, `${value * 2}px`)
            }
          }
        })
      const widths = [1440, 320]
      const themes = ['light', 'dark']
      for (let widthIndex = 0; widthIndex < widths.length; widthIndex++) {
        const width = widths[widthIndex]!
        await page.setViewportSize({ width, height: 900 })
        for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
          const theme = themes[themeIndex]!
          await page.evaluate((theme) => {
            document.documentElement.dataset['theme'] = theme
          }, theme)
          await settleCapture(page, false)
          const measurements = await page.locator('[data-avatar-size]').evaluateAll((elements) =>
            elements.map((element) => {
              const box = element.getBoundingClientRect()
              const initials = element.querySelector('[aria-hidden="true"]')!
              const range = document.createRange()
              range.selectNodeContents(initials)
              const glyph = range.getBoundingClientRect()
              return {
                size: element.getAttribute('data-avatar-size'),
                hue: element.getAttribute('data-avatar-hue'),
                font: Number.parseFloat(getComputedStyle(element).fontSize),
                circle: { width: box.width, height: box.height },
                clipped:
                  glyph.left < box.left - 1 ||
                  glyph.right > box.right + 1 ||
                  glyph.top < box.top - 1 ||
                  glyph.bottom > box.bottom + 1,
              }
            }),
          )
          records.push({ scale, width, theme, measurements })
          expect(measurements.filter((item) => item.clipped)).toEqual([])
          if (scale === 2)
            expect(
              measurements
                .filter((item) => item.size === 'sm')
                .every((item) => item.circle.width >= 48 - 0.01),
            ).toBe(true)
          const fixture = page.locator('[data-avatar-fixture]')
          await fixture.evaluate((el) => {
            el.scrollTop = 0
          })
          await page.screenshot({ path: join(root, `avatar-text-${scale}-${width}-${theme}.png`) })
          if (width === 320 && scale === 2) {
            const sizes = ['xs', 'sm', 'md', 'lg']
            for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex++) {
              const size = sizes[sizeIndex]!
              const section = fixture
                .locator('section')
                .filter({ has: page.locator(`[data-avatar-size="${size}"]`) })
              await section.screenshot({
                path: join(root, `avatar-section-${size}-${theme}-text200.png`),
              })
            }
          }
          expect(await fixture.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        }
      }
    }
    await writeFile(join(root, 'avatar-text-metrics.json'), JSON.stringify(records, null, 2))
  } finally {
    await context.close()
  }
})
