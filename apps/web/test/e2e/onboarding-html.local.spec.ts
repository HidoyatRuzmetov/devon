/* eslint-disable no-restricted-syntax -- Each chapter follows the preceding navigation action. */
import { test, expect } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const source = process.env['ONBOARDING_REVIEW_HTML']
const output = resolve(import.meta.dirname, '../../../../artifacts/qa/viewer-v2/onboarding')
const chapters = [
  'welcome',
  'ministry',
  'centre',
  'organisation',
  'telegram',
  'office',
  'documents',
  'rhythm',
  'certificate',
]
test('All nine chapters preserve their landscape composition without scrolling or parts', async ({
  page,
}) => {
  test.skip(!source, 'Set ONBOARDING_REVIEW_HTML to the standalone local artifact')
  mkdirSync(output, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const results = []
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1024, 600],
    [854, 480],
    [640, 360],
    [480, 320],
  ]) {
    await page.setViewportSize({ width: width!, height: height! })
    await page.goto(pathToFileURL(source!).href)
    await page.evaluate(() => document.fonts.ready)
    for (const chapter of chapters) {
      await expect(page.locator('.step:not([hidden])')).toHaveAttribute('id', chapter)
      await page.waitForTimeout(150)
      const bounds = await page.evaluate(() => {
        const canvas = document.getElementById('content-canvas')!
        const view = document.getElementById('content-viewport')!.getBoundingClientRect()
        const active = document.querySelector('.step:not([hidden])')!.getBoundingClientRect()
        return {
          scale: canvas.dataset['fitScale'],
          chapter: document.querySelector('.step:not([hidden])')!.id,
          horizontal: document.documentElement.scrollWidth > innerWidth + 1,
          vertical: document.documentElement.scrollHeight > innerHeight + 1,
          inside:
            active.left >= view.left - 1 &&
            active.right <= view.right + 1 &&
            active.top >= view.top - 1 &&
            active.bottom <= view.bottom + 1,
          partsVisible: !document.getElementById('part-counter')!.hidden,
          missingImages: Array.from(
            document.querySelectorAll<HTMLImageElement>('.step:not([hidden]) img'),
          ).filter((img) => !img.complete || !img.naturalWidth).length,
        }
      })
      expect(bounds, `${width}x${height} ${chapter}`).toMatchObject({
        horizontal: false,
        vertical: false,
        inside: true,
        partsVisible: false,
        missingImages: 0,
      })
      results.push({ width, height, ...bounds })
      await page.screenshot({
        path: resolve(output, `${width}x${height}-${chapter}.png`),
        animations: 'disabled',
      })
      if (chapter !== 'certificate') await page.locator('#next').click()
    }
  }
  expect(errors).toEqual([])
  writeFileSync(resolve(output, 'responsive-results.json'), JSON.stringify(results, null, 2))
})
test('Portrait keeps navigation available and adapts its content', async ({ page }) => {
  test.skip(!source, 'Set ONBOARDING_REVIEW_HTML to the standalone local artifact')
  mkdirSync(output, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(pathToFileURL(source!).href)
  await page.evaluate(() => document.fonts.ready)
  for (let step = 0; step < 40; step++) {
    await page.waitForTimeout(100)
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth + 1 &&
          document.documentElement.scrollHeight <= innerHeight + 1,
      ),
    ).toBe(true)
    const chapter = await page.locator('.step:not([hidden])').getAttribute('id')
    if (step === 0 || chapter === 'ministry' || chapter === 'documents')
      await page.screenshot({
        path: resolve(output, `portrait-${step}-${chapter}.png`),
        animations: 'disabled',
      })
    if (chapter === 'certificate') break
    await page.locator('#next').click()
  }
  await expect(page.locator('.step:not([hidden])')).toHaveAttribute('id', 'certificate')
})
