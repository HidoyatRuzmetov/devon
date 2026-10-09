import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { newFlowContext } from './flow-api.js'
import { settleCapture } from './platform-capture.js'

test('@flow short viewport dialog keeps full form reachable and nested menu/calendar portals usable', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const context = await newFlowContext(browser)
  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 320, height: 480 })
    const root = join(
      import.meta.dirname,
      '../../../../artifacts/qa/2026-10/visual-controls',
      test.info().project.name,
      'nested',
    )
    await mkdir(root, { recursive: true })
    const locales = ['uz-Latn', 'uz-Cyrl', 'ru', 'en']
    const themes = ['light', 'dark']
    for (let localeIndex = 0; localeIndex < locales.length; localeIndex++) {
      const locale = locales[localeIndex]!
      for (let themeIndex = 0; themeIndex < themes.length; themeIndex++) {
        const theme = themes[themeIndex]!
        await page.goto(`/login?visualLocale=${locale}`)
        await page.evaluate((theme) => {
          document.documentElement.dataset['theme'] = theme
        }, theme)
        await page.addScriptTag({
          type: 'module',
          url: `/@fs/${join(import.meta.dirname, 'fixtures/dialog-scroll.tsx').replaceAll('\\', '/')}`,
        })
        const trigger = page.getByRole('button', { name: 'Open tall form', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Tall form', exact: true })
        await settleCapture(page, false)
        await page.screenshot({ path: join(root, `dialog-short-${locale}-${theme}-320-start.png`) })
        const box = await dialog.boundingBox()
        expect(box!.y).toBeGreaterThanOrEqual(15)
        expect(box!.y + box!.height).toBeLessThanOrEqual(465)
        const save = dialog.getByRole('button', { name: 'Save form', exact: true })
        await save.scrollIntoViewIfNeeded()
        await expect(save).toBeInViewport()
        const menu = dialog.getByRole('button', { name: 'Choose action', exact: true })
        await menu.focus()
        await menu.press('Enter')
        await page.getByRole('menuitem', { name: 'Review', exact: true }).press('Enter')
        await expect(dialog.getByLabel('Action selected')).toHaveText('Review selected')
        await expect(menu).toBeFocused()
        const date = dialog.getByRole('button', { name: 'Choose date', exact: true })
        await date.click()
        const grid = page.getByRole('grid')
        await expect(grid).toBeVisible()
        await grid.locator('button:not([disabled])').first().click()
        await expect(dialog.getByLabel('Date selected')).not.toHaveText('None')
        await expect(date).toBeFocused()
        await save.click()
        await expect(
          dialog.getByRole('status').filter({ hasText: 'Saved without dismissing' }),
        ).toHaveText('Saved without dismissing')
        await settleCapture(page, false)
        await page.screenshot({ path: join(root, `dialog-short-${locale}-${theme}-320-end.png`) })
        await dialog.press('Escape')
        await expect(dialog).not.toBeVisible()
        await expect(trigger).toBeFocused()
      }
    }
  } finally {
    await context.close()
  }
})
